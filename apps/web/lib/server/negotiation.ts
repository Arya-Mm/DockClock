import "server-only";
import { randomUUID } from "node:crypto";
import { prisma, sha256Json } from "@dockclock/db";
import {
  priceOffer, defaultOffer, rankOptions, tonuAdvice, chargeForDwell, maxCapturableCents, checkPayout, paypalRequestId,
  reconcileTimeline, OFFER_FUNDER, DEMO_FACILITY_ECONOMICS, type EvidenceEvent, type OfferKind, type PricingContext, type PricedOffer, type CarrierClock, type ValuationRow, type AccessorialContract,
} from "@dockclock/core";
import { checkMandate, decide, geminiLlm, PROMPTS, Mandate as MandateSchema, type AgentKind, type Mandate, type GuardVerdict, type Llm } from "@dockclock/agents";
import { payoutCarrier, createPurchaseOrder, captureOrder, approveLinkOf, type PayoutBatch, type Order } from "@dockclock/paypal";
import { isOn } from "../flags";
import { appendAction } from "./chain";
import { getLoad, contractOf, facilityDwells, evidenceOf } from "./loads";
import { recorded } from "./ops";
import { notify } from "./executor";
import { llmAllowed } from "./llm-budget";
import { DomainError } from "./http";

// Lock waiters queue behind a slow cross-region holder; Prisma's 5s default would abort the loser of a double accept.
const TX_OPTS = { maxWait: 15_000, timeout: 30_000 } as const;
export const MAX_ROUNDS = 3;            // A5
export const OFFER_TTL_MS = 120_000;    // A5: short TTL bounds price drift between offer and accept
const RATE_WINDOW_MS = 60_000, RATE_MAX_OFFERS = 6; // A5: at most two full negotiations a minute per load
const FUNDER_AGENT: Record<"SHIPPER" | "FACILITY" | "CARRIER", AgentKind> = { SHIPPER: "SHIPPER_TREASURY", FACILITY: "FACILITY", CARRIER: "CARRIER" };
const PROPOSAL_ORDER: OfferKind[] = ["SLOT_SWAP_WITH_CREDIT", "WAIT_GUARANTEED", "RELEASE_TONU", "PRIORITY_SLOT_PURCHASE"];
const usd = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;

/** Simulated ELD clock for the demo carrier (synthetic, labelled in UI). */
export const DEMO_CARRIER_CLOCK: CarrierClock = { hosDrivingLeftMin: 420, hosWindowLeftMin: 300, nextApptInMin: 330, deadheadMin: 180, revenuePerHourCents: 8_500, nextLoadRevenueCents: 140_000 };

async function llm(): Promise<Llm | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || process.env.LLM_PROVIDER === "none" || !(await llmAllowed())) return null; // F4 spend cap -> deterministic defaults
  return geminiLlm(key, process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite");
}

type LoadFull = Awaited<ReturnType<typeof getLoad>>;

function pricingContext(load: LoadFull, contract: AccessorialContract, nowMs: number): PricingContext {
  // Same clock as settlement and the driver app: reconciled arrival (not the latest arrival row), started no earlier
  // than the appointment (T1).
  const events = evidenceOf(load, nowMs);
  const arrival = (events.length ? reconcileTimeline(events).arrivalMs : null) ?? nowMs;
  const waitedMin = Math.max(0, Math.floor((nowMs - Math.max(arrival, load.appointmentAt.getTime())) / 60_000));
  const historicalDwellsMin = facilityDwells(load.facilityId);
  const final = tonuAdvice(waitedMin, historicalDwellsMin, contract).expectedFinalDwellMin ?? waitedMin + 60;
  const e = DEMO_FACILITY_ECONOMICS;
  return { waitedMin, historicalDwellsMin, minutesSaved: Math.max(0, final - waitedMin - e.swapSlotLeadMin), facilityDoorMinuteCents: e.doorMinuteCents, priorityBandCents: e.priorityBandCents };
}

/** planHash binds an offer to its price and the evidence it was priced on (A3). */
const planHashOf = (loadId: string, kind: OfferKind, priceCents: number, contractVersionId: string, evidenceCount: number) =>
  sha256Json({ loadId, kind, priceCents, contractVersionId, evidenceCount });

async function mandateFor(agent: AgentKind): Promise<Mandate | null> {
  const m = await prisma.mandate.findFirst({ where: { agent }, orderBy: { createdAt: "desc" } });
  return m ? MandateSchema.parse({ ...m, expiresAtMs: m.expiresAt.getTime(), revokedAtMs: m.revokedAt?.getTime() ?? null }) : null;
}

/** ALLOWED accepts today; `excludeOfferId` drops the offer being re-checked at execution so it is not counted twice. */
export async function spentToday(mandateId: string, nowMs: number, excludeOfferId?: string, db: Pick<typeof prisma, "agentAction" | "offer"> = prisma): Promise<number> {
  const day = new Date(nowMs); day.setUTCHours(0, 0, 0, 0);
  const rows = await db.agentAction.findMany({ where: { mandateId, verdict: "ALLOWED", action: "ACCEPT", createdAt: { gte: day }, ...(excludeOfferId ? { NOT: { offerId: excludeOfferId } } : {}) }, select: { payload: true, offerId: true } });
  // Accepts on synthetic loads (seed data, red-team runs) never consume a real mandate's budget.
  const real = new Set((await db.offer.findMany({ where: { id: { in: rows.map((r) => r.offerId).filter((x): x is string => !!x) }, load: { synthetic: false } }, select: { id: true } })).map((o) => o.id));
  return rows.filter((r) => r.offerId && real.has(r.offerId)).reduce((s, r) => s + (Number((r.payload as { cents?: number }).cents) || 0), 0);
}

function holdCeiling(load: LoadFull): number | null {
  if (!load.authorizationId || !load.holdCents) return null;
  if (!["AUTHORIZED", "AT_FACILITY", "DEPARTED", "NEEDS_REVIEW"].includes(load.state)) return null;
  return maxCapturableCents(load.holdCents, isOn("OVERCAPTURE"), false);
}

function payeeOf(load: LoadFull, nowMs: number) {
  const c = load.carrier;
  const v = checkPayout({ carrierId: c.id, receiverEmail: c.verifiedPayeeEmail, cents: 1, loadId: load.id }, {
    carrierId: c.id, usdot: c.usdot, legalName: c.name, payoutEmail: c.verifiedPayeeEmail,
    payoutEmailVerifiedAtMs: c.payeeVerifiedAt?.getTime() ?? null, payoutEmailChangedAtMs: c.payeeEmailChangedAt?.getTime() ?? null,
    status: c.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
  }, nowMs);
  return { email: c.verifiedPayeeEmail, verified: v.allowed };
}

/** Carrier's view: status quo (keep waiting on the meter) vs the offer, valued by core rankOptions. */
function carrierOptions(offer: { id: string; kind: OfferKind; priceCents: number }, ctx: PricingContext, c: AccessorialContract): ValuationRow[] {
  const final = tonuAdvice(ctx.waitedMin, ctx.historicalDwellsMin, c).expectedFinalDwellMin ?? ctx.waitedMin + 60;
  const remaining = Math.max(0, final - ctx.waitedMin);
  const share = (cents: number) => Math.floor((cents * c.driverShareBps) / 10_000);
  const saved = ctx.minutesSaved ?? 0;
  const opts: { offerId: string; payoutCents: number; extraWaitMin: number }[] = [
    { offerId: "KEEP_WAITING", payoutCents: share(chargeForDwell(final, c)), extraWaitMin: remaining },
    offer.kind === "SLOT_SWAP_WITH_CREDIT" ? { offerId: offer.id, payoutCents: offer.priceCents + share(chargeForDwell(Math.max(ctx.waitedMin, final - saved), c)), extraWaitMin: Math.max(0, remaining - saved) }
    : offer.kind === "RELEASE_TONU" ? { offerId: offer.id, payoutCents: share(offer.priceCents), extraWaitMin: 0 }
    : offer.kind === "PRIORITY_SLOT_PURCHASE" ? { offerId: offer.id, payoutCents: -offer.priceCents, extraWaitMin: Math.max(0, remaining - saved) }
    : { offerId: offer.id, payoutCents: share(offer.priceCents), extraWaitMin: remaining },
  ];
  // Payout is already signed from the carrier's side, so value it as a plain (non carrier-funded) amount.
  return rankOptions(opts.map((o) => ({ offerId: o.offerId, offer: { kind: "WAIT_GUARANTEED", priceCents: o.payoutCents, basis: "" } as PricedOffer, extraWaitMin: o.extraWaitMin })), DEMO_CARRIER_CLOCK)
    .map((r) => ({ ...r, kind: r.offerId === "KEEP_WAITING" ? "WAIT_GUARANTEED" : offer.kind }));
}

const tableOf = (rows: ValuationRow[]) => rows.map((r) => `${r.offerId}: payout ${usd(r.payoutCents)}, hours lost ${usd(r.hoursLostCents)}, miss-next-load risk ${usd(r.missRiskCents)}, net ${usd(r.netCents)}`).join("\n");

export interface RoundLog { round: number; offerId: string; kind: OfferKind; priceCents: number; facility: { source: string; rationale: string }; carrier: { action: string; source: string; rationale: string }; valuation: ValuationRow[] }

/**
 * Dock-jam negotiation (PLAN §4.6): Facility Agent proposes, Carrier Agent answers, at most 3 rounds.
 * Every price is engine output; LLMs choose only menu items; every step is a hash-chained agent_action row.
 */
export async function negotiate(loadId: string, nowMs = Date.now()) {
  if (!isOn("AGENTS")) throw new DomainError("flag_off", "FLAG_AGENTS is off");
  const load = await getLoad(loadId);
  if (!["AUTHORIZED", "AT_FACILITY"].includes(load.state)) throw new DomainError("state_conflict", `negotiation needs a truck at the dock, load is ${load.state}`);
  const recent = await prisma.offer.count({ where: { loadId, createdAt: { gte: new Date(nowMs - RATE_WINDOW_MS) } } });
  if (recent >= RATE_MAX_OFFERS) throw new DomainError("rate_limited", `too many offers for ${loadId} in the last minute (A5)`);

  const contract = contractOf(load.contractVersion.terms);
  const ctx = pricingContext(load, contract, nowMs);
  const facilityMandate = await mandateFor("FACILITY");
  const ceiling = holdCeiling(load);
  const model = await llm();
  const rounds: RoundLog[] = [];
  const declined = new Set<OfferKind>();
  let lastCarrierText = "";

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const priced = PROPOSAL_ORDER.filter((k) => !declined.has(k) && facilityMandate?.allowedActions.includes(k)).map((k) => priceOffer(k, ctx, contract))
      // Never propose what the shipper's hold cannot fund: the guard would block it anyway.
      .filter((p): p is PricedOffer => !!p && (OFFER_FUNDER[p.kind] !== "SHIPPER" || p.priceCents <= (ceiling ?? -1)));
    if (!priced.length) break;
    const menu = priced.map((p) => p.kind) as [OfferKind, ...OfferKind[]];
    const fallback = round === 1 ? defaultOffer(ctx, contract)?.kind ?? menu[0] : menu[0];
    const fd = await decide({
      agent: "FACILITY", template: PROMPTS.FACILITY, menu, counterpartyText: lastCarrierText,
      facts: [`Truck waited ${ctx.waitedMin} min.`, ...priced.map((p) => `${p.kind}: ${usd(p.priceCents)} (${p.basis})`)].join("\n"),
      defaultAction: menu.includes(fallback) ? fallback : menu[0], defaultRationale: "Deterministic default offer (engine).", llm: model,
    });
    const chosen = priced.find((p) => p.kind === fd.action)!;
    const offer = await createOffer(load, chosen, fd.rationale, nowMs, { mandateId: facilityMandate?.id, promptHash: fd.promptHash, round, source: fd.source, error: fd.error ?? null });

    const rows = carrierOptions(offer, ctx, contract);
    const offerRow = rows.find((r) => r.offerId === offer.id)!, keepRow = rows.find((r) => r.offerId === "KEEP_WAITING")!;
    const better = offerRow.netCents >= keepRow.netCents;
    const carrierMenu = (round < MAX_ROUNDS ? ["ACCEPT", "COUNTER", "DECLINE"] : ["ACCEPT", "DECLINE"]) as ["ACCEPT", ...("COUNTER" | "DECLINE")[]];
    const cd = await decide({
      agent: "CARRIER", template: PROMPTS.CARRIER, menu: carrierMenu, counterpartyText: offer.rationale,
      facts: `Offer ${offer.kind} ${usd(offer.priceCents)}. Valuation (code):\n${tableOf(rows)}`,
      defaultAction: better ? "ACCEPT" : round < MAX_ROUNDS ? "COUNTER" : "DECLINE",
      defaultRationale: `Engine valuation: offer ${better ? "beats" : "loses to"} keeping the meter running.`, llm: model,
    });
    // A decision, not a guarded action: logged as DECIDE_*; the guarded ACCEPT row is written by acceptOffer.
    await appendAction({ agent: "CARRIER", action: `DECIDE_${cd.action}`, offerId: offer.id, verdict: "ALLOWED", promptHash: cd.promptHash,
      payload: { loadId, round, valuation: rows.map((r) => ({ ...r })), source: cd.source, error: cd.error ?? null } });
    rounds.push({ round, offerId: offer.id, kind: offer.kind, priceCents: offer.priceCents, facility: { source: fd.source, rationale: fd.rationale }, carrier: { action: cd.action, source: cd.source, rationale: cd.rationale }, valuation: rows });

    if (cd.action === "ACCEPT") return { loadId, rounds, outcome: await acceptOffer(offer.id, { version: offer.version, planHash: offer.planHash }, "CARRIER", nowMs) };
    await prisma.offer.updateMany({ where: { id: offer.id, status: "OPEN" }, data: { status: "DECLINED" } });
    declined.add(offer.kind);
    lastCarrierText = cd.rationale;
    if (cd.action === "DECLINE") break;
  }
  return { loadId, rounds, outcome: { status: "NO_DEAL" as const } };
}

/** Create an engine-priced offer; older open offers on the load are superseded, so only the newest version can be accepted (A3). */
export async function createOffer(load: LoadFull, chosen: PricedOffer, rationale: string, nowMs: number, meta: { mandateId?: string; promptHash?: string; round?: number; source: string; error?: string | null }) {
  const version = (await prisma.offer.count({ where: { loadId: load.id } })) + 1;
  await prisma.offer.updateMany({ where: { loadId: load.id, status: "OPEN" }, data: { status: "SUPERSEDED" } });
  const slot = chosen.kind === "SLOT_SWAP_WITH_CREDIT" || chosen.kind === "PRIORITY_SLOT_PURCHASE";
  const offer = await prisma.offer.create({ data: {
    id: `OF-${randomUUID().slice(0, 8)}`, version, loadId: load.id, fromAgent: "FACILITY", toAgent: "CARRIER", kind: chosen.kind, priceCents: chosen.priceCents,
    ttlMs: OFFER_TTL_MS, expiresAt: new Date(nowMs + OFFER_TTL_MS), rationale: rationale.slice(0, 600), contractVersionId: load.contractVersionId,
    planHash: planHashOf(load.id, chosen.kind, chosen.priceCents, load.contractVersionId, load.evidence.length),
    ...(slot ? { slotDoorId: "D-3", slotStartAt: new Date(nowMs + DEMO_FACILITY_ECONOMICS.swapSlotLeadMin * 60_000) } : {}),
  } }).catch((e: unknown) => {
    if ((e as { code?: string }).code === "P2002") throw new DomainError("conflict", `another negotiation on ${load.id} created version ${version}; retry`);
    throw e;
  });
  await appendAction({ agent: "FACILITY", action: "PROPOSE", offerId: offer.id, mandateId: meta.mandateId, verdict: "ALLOWED", promptHash: meta.promptHash,
    payload: { loadId: load.id, round: meta.round ?? null, kind: offer.kind, cents: offer.priceCents, basis: chosen.basis, version, planHash: offer.planHash, source: meta.source, error: meta.error ?? null } });
  return offer;
}

/** Human / dispatcher proposes one offer kind (no LLM). Price still comes only from the engine. */
export async function proposeOffer(loadId: string, kind: OfferKind, nowMs = Date.now()) {
  const load = await getLoad(loadId);
  if (!["AUTHORIZED", "AT_FACILITY"].includes(load.state)) throw new DomainError("state_conflict", `offers need a truck at the dock, load is ${load.state}`);
  const contract = contractOf(load.contractVersion.terms);
  const priced = priceOffer(kind, pricingContext(load, contract, nowMs), contract);
  if (!priced) throw new DomainError("not_offerable", `${kind} cannot be priced for ${loadId}`);
  return createOffer(load, priced, "Proposed by dispatcher.", nowMs, { mandateId: (await mandateFor("FACILITY"))?.id, source: "HUMAN" });
}

interface OfferRef { id: string; loadId: string; kind: OfferKind; priceCents: number; version: number; planHash: string; expiresAt: Date }

/** Guard an offer against the live load and the funder's mandate. `atExecution` re-checks after accept (A8). */
async function guardOffer(offer: OfferRef, nowMs: number, atExecution: boolean) {
  const load = await getLoad(offer.loadId);
  const funder = FUNDER_AGENT[OFFER_FUNDER[offer.kind]];
  const mandate = await mandateFor(funder);
  let current: { version: number; planHash: string } | null;
  if (atExecution) current = { version: offer.version, planHash: offer.planHash }; // accepted price is locked
  else {
    const contract = contractOf(load.contractVersion.terms);
    const latest = await prisma.offer.findFirst({ where: { loadId: offer.loadId }, orderBy: { version: "desc" }, select: { version: true } });
    if (offer.kind === "PART_PURCHASE") {
      // A part's price is the Channel3 quote fixed at creation (re-fetched server-side by parts.ts, never from the client);
      // staleness here is version-only, and the short TTL bounds quote drift.
      current = latest ? { version: latest.version, planHash: offer.planHash } : null;
    } else {
      const now = priceOffer(offer.kind, pricingContext(load, contract, nowMs), contract);
      current = now && latest ? { version: latest.version, planHash: planHashOf(offer.loadId, offer.kind, now.priceCents, load.contractVersionId, load.evidence.length) } : null;
    }
  }
  const verdict = checkMandate({
    mandate, agent: funder, kind: offer.kind, counterparty: load.carrierId, cents: offer.priceCents,
    spentTodayCents: mandate ? await spentToday(mandate.id, nowMs, atExecution ? offer.id : undefined) : 0,
    holdCeilingCents: OFFER_FUNDER[offer.kind] === "SHIPPER" ? holdCeiling(load) : null,
    payee: payeeOf(load, nowMs),
    offer: { expiresAtMs: atExecution ? Number.MAX_SAFE_INTEGER : offer.expiresAt.getTime(), version: offer.version, planHash: offer.planHash },
    current, nowMs,
  });
  return { load, funder, mandate, verdict };
}

export type LoadForOffer = LoadFull;

export type AcceptResult =
  | { status: "ACCEPTED"; offerId: string; idempotent: boolean; settlement: Awaited<ReturnType<typeof settleOffer>> | null }
  | { status: "BLOCKED" | "ESCALATED"; offerId: string; verdict: GuardVerdict };

/**
 * Accept: row lock on the offer (A4), idempotent (a repeat accept of the same version is a no-op), guard in PLAN §4.5 order.
 * Shipper-funded offers also pass the Shipper Treasury Agent, which can only make the decision stricter.
 */
export async function acceptOffer(offerId: string, claim: { version: number; planHash: string }, by: AgentKind | "HUMAN", nowMs = Date.now()): Promise<AcceptResult> {
  const pre = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!pre) throw new DomainError("not_found", `offer ${offerId} not found`);
  const g = await guardOffer({ ...pre, kind: pre.kind as OfferKind, version: claim.version, planHash: claim.planHash }, nowMs, false);
  let verdict = g.verdict;
  let treasury: { action: string; promptHash: string; source: string } | null = null;
  // Every shipper-funded accept passes Treasury, whoever accepts. It sees only code facts, no agent-written text (A2).
  if (verdict.verdict === "ALLOWED" && g.funder === "SHIPPER_TREASURY") {
    const t = await decide({ agent: "SHIPPER_TREASURY", template: PROMPTS.SHIPPER_TREASURY, menu: ["APPROVE", "ESCALATE"] as const,
      facts: `${pre.kind} ${usd(pre.priceCents)} from the PayPal hold (capture ceiling ${usd(holdCeiling(g.load) ?? 0)}). Mandate guard: ALLOWED.`,
      defaultAction: "APPROVE", defaultRationale: "Guard passed; engine price within mandate.", llm: await llm() });
    treasury = { action: t.action, promptHash: t.promptHash, source: t.source };
    if (t.action === "ESCALATE") verdict = { verdict: "ESCALATED", codes: [], reasons: ["Shipper Treasury Agent escalated to a human"] };
  }

  const anomaly = pre.kind === "SLOT_SWAP_WITH_CREDIT" ? await creditAnomaly(g.load.facilityId, g.load.carrierId, pre.priceCents, nowMs) : null;
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string; version: number; planHash: string }[]>`SELECT status::text AS status, version, "planHash" FROM "Offer" WHERE id = ${offerId} FOR UPDATE`;
    const row = locked[0]!;
    if ((row.status === "ACCEPTED" || row.status === "SETTLED") && row.version === claim.version && row.planHash === claim.planHash) return "IDEMPOTENT" as const;
    if (row.status !== "OPEN" && verdict.verdict === "ALLOWED") verdict = { verdict: "BLOCKED", codes: ["STALE_OFFER"], reasons: [`offer is ${row.status} (A4: already decided)`] };
    // Re-check revocation and the daily cap under a mandate row lock: concurrent accepts on different offers
    // serialise here, and a revoke that landed during the Treasury call is seen (A7, A8).
    if (verdict.verdict === "ALLOWED" && g.mandate) {
      const m = (await tx.$queryRaw<{ revokedAt: Date | null; dailyCapCents: number }[]>`SELECT "revokedAt", "dailyCapCents" FROM "Mandate" WHERE id = ${g.mandate.id} FOR UPDATE`)[0];
      const spent = await spentToday(g.mandate.id, nowMs, undefined, tx);
      if (!m || (m.revokedAt && m.revokedAt.getTime() <= nowMs)) verdict = { verdict: "BLOCKED", codes: ["REVOKED"], reasons: [`mandate ${g.mandate.id} revoked`] };
      else if (spent + pre.priceCents > m.dailyCapCents) verdict = { verdict: "ESCALATED", codes: ["DAILY_CAP"], reasons: [`${usd(spent + pre.priceCents)} today over daily cap ${usd(m.dailyCapCents)}`] };
    }
    await appendAction({ agent: g.funder, action: "ACCEPT", offerId, mandateId: g.mandate?.id, verdict: verdict.verdict, reasons: verdict.reasons, promptHash: treasury?.promptHash,
      payload: { loadId: pre.loadId, kind: pre.kind, cents: pre.priceCents, by, claim, codes: verdict.codes, treasury, anomaly } }, tx);
    if (verdict.verdict !== "ALLOWED") return "REFUSED" as const;
    await tx.offer.update({ where: { id: offerId }, data: { status: "ACCEPTED", acceptedAt: new Date(nowMs) } });
    return "ACCEPTED" as const;
  }, TX_OPTS);

  if (result === "IDEMPOTENT") {
    // A retry after a failed settlement must finish it: settleOffer's PayPal writes are request-id keyed, so replay is safe.
    const cur = await prisma.offer.findUnique({ where: { id: offerId }, select: { status: true } });
    return { status: "ACCEPTED", offerId, idempotent: true, settlement: cur?.status === "ACCEPTED" ? await settleOffer(offerId, nowMs) : null };
  }
  if (anomaly && result === "ACCEPTED") await notify(pre.loadId, "OPS", "MANUAL_REVIEW", `A12 credit anomaly: ${anomaly}`);
  if (result === "REFUSED") {
    if (verdict.verdict === "ESCALATED") await notify(pre.loadId, "OPS", "MANUAL_REVIEW", `offer ${offerId} escalated: ${verdict.reasons.join("; ")}`);
    return { status: verdict.verdict === "ESCALATED" ? "ESCALATED" : "BLOCKED", offerId, verdict };
  }
  return { status: "ACCEPTED", offerId, idempotent: false, settlement: await settleOffer(offerId, nowMs) };
}

/**
 * Settle an accepted offer through the Phase 1/2 money paths, after re-checking the mandate (A8).
 * FACILITY credit -> payout now; SHIPPER-funded -> locked into the departure capture; CARRIER purchase -> carrier-paid order.
 */
export async function settleOffer(offerId: string, nowMs = Date.now()) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) throw new DomainError("not_found", `offer ${offerId} not found`);
  if (offer.status !== "ACCEPTED") throw new DomainError("state_conflict", `offer is ${offer.status}`);
  const kind = offer.kind as OfferKind;
  const g = await guardOffer({ ...offer, kind }, nowMs, true);
  const base = { loadId: offer.loadId, kind, cents: offer.priceCents };
  if (g.verdict.verdict !== "ALLOWED") {
    await appendAction({ agent: g.funder, action: "EXECUTE", offerId, mandateId: g.mandate?.id, verdict: g.verdict.verdict, reasons: g.verdict.reasons, payload: { ...base, codes: g.verdict.codes } });
    await notify(offer.loadId, "OPS", "BLOCKED", `accepted offer ${offerId} blocked at execution: ${g.verdict.reasons.join("; ")}`);
    return { status: "BLOCKED" as const, reasons: g.verdict.reasons };
  }
  const funder = OFFER_FUNDER[kind];
  if (funder === "SHIPPER") {
    await appendAction({ agent: g.funder, action: "EXECUTE", offerId, mandateId: g.mandate?.id, verdict: "ALLOWED", payload: { ...base, deferred: "captured from the hold at departure" } });
    return { status: "LOCKED_FOR_DEPARTURE" as const };
  }
  if (funder === "FACILITY") {
    const requestId = paypalRequestId(offer.loadId, "PAYOUT", `offer-${offerId}`);
    const r = await recorded<PayoutBatch>({ loadId: offer.loadId, operation: "PAYOUT_OFFER", requestId, amountCents: offer.priceCents, paypalIdOf: (d) => (d as PayoutBatch).batch_header?.payout_batch_id },
      () => payoutCarrier(offer.loadId, g.load.carrier.verifiedPayeeEmail, offer.priceCents, `offer-${offerId}`));
    const batchId = r.data.batch_header?.payout_batch_id ?? null;
    await prisma.offer.updateMany({ where: { id: offerId, status: "ACCEPTED" }, data: { status: "SETTLED" } });
    await appendAction({ agent: g.funder, action: "EXECUTE", offerId, mandateId: g.mandate?.id, verdict: "ALLOWED", payload: { ...base, payoutBatchId: batchId, debugId: r.debugId, requestId, replayed: r.replayed } });
    return { status: "PAID_OUT" as const, payoutBatchId: batchId, debugId: r.debugId };
  }
  // Carrier-paid: create the order; the carrier approves in PayPal, then captureOfferOrder runs on return.
  if (!isOn("CARRIER_ORDERS")) throw new DomainError("flag_off", "FLAG_CARRIER_ORDERS is off");
  const app = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const requestId = paypalRequestId(offer.loadId, "ORDER", `offer-${offerId}`);
  const r = await recorded<Order>({ loadId: offer.loadId, operation: "ORDER_OFFER", requestId, amountCents: offer.priceCents },
    () => createPurchaseOrder(offer.loadId, offer.priceCents, `DockClock ${kind}, load ${offer.loadId}`, `offer-${offerId}`, `${app}/api/offers/${offerId}/capture`, `${app}/dispatch?cancelled=${offerId}`));
  await appendAction({ agent: g.funder, action: "EXECUTE", offerId, mandateId: g.mandate?.id, verdict: "ALLOWED", payload: { ...base, orderId: r.data.id, debugId: r.debugId, requestId } });
  return { status: "AWAITING_CARRIER_APPROVAL" as const, orderId: r.data.id, approveUrl: approveLinkOf(r.data), debugId: r.debugId };
}

/** After the carrier approves in PayPal: capture the carrier-paid order once (request id keyed by offer). */
export async function captureOfferOrder(offerId: string) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) throw new DomainError("not_found", `offer ${offerId} not found`);
  if (offer.status !== "ACCEPTED") throw new DomainError("state_conflict", `offer is ${offer.status}`);
  const g = await guardOffer({ ...offer, kind: offer.kind as OfferKind }, Date.now(), true); // A8: revoke stops the capture
  if (g.verdict.verdict !== "ALLOWED") {
    await appendAction({ agent: g.funder, action: "PAY", offerId, mandateId: g.mandate?.id, verdict: g.verdict.verdict, reasons: g.verdict.reasons, payload: { loadId: offer.loadId, kind: offer.kind, cents: offer.priceCents } });
    throw new DomainError("mandate_blocked", g.verdict.reasons.join("; "));
  }
  const op = await prisma.payPalOp.findUnique({ where: { requestId: paypalRequestId(offer.loadId, "ORDER", `offer-${offerId}`) } });
  const orderId = op?.paypalId;
  if (!orderId) throw new DomainError("no_order", `offer ${offerId} has no carrier order`);
  const requestId = paypalRequestId(offer.loadId, "CAPTURE", `offer-${offerId}`);
  const r = await recorded<Order>({ loadId: offer.loadId, operation: "CAPTURE_OFFER", requestId, amountCents: offer.priceCents, paypalIdOf: (d) => (d as Order).purchase_units?.[0]?.payments?.captures?.[0]?.id },
    () => captureOrder(offer.loadId, orderId, `offer-${offerId}`));
  const capture = r.data.purchase_units?.[0]?.payments?.captures?.[0];
  if (capture?.status === "COMPLETED") await prisma.offer.updateMany({ where: { id: offerId, status: "ACCEPTED" }, data: { status: "SETTLED" } });
  await appendAction({ agent: "CARRIER", action: "PAY", offerId, mandateId: g.mandate?.id, verdict: "ALLOWED", payload: { loadId: offer.loadId, orderId, captureId: capture?.id ?? null, status: capture?.status ?? r.data.status, debugId: r.debugId, requestId } });
  return { orderId, captureId: capture?.id ?? null, status: capture?.status ?? r.data.status, debugId: r.debugId };
}

/**
 * A12 collusion signal: a facility paying the same carrier unusually often or much today. The engine band and the daily
 * cap already bound each credit; this flags the pattern in the ledger and to ops without blocking the payment.
 */
const ANOMALY_CREDITS_PER_DAY = 3, ANOMALY_CENTS_PER_DAY = 10_000;
export async function creditAnomaly(facilityId: string, carrierId: string, cents: number, nowMs: number): Promise<string | null> {
  const day = new Date(nowMs); day.setUTCHours(0, 0, 0, 0);
  const prior = await prisma.offer.findMany({ where: { kind: "SLOT_SWAP_WITH_CREDIT", status: { in: ["ACCEPTED", "SETTLED"] }, acceptedAt: { gte: day }, load: { facilityId, carrierId, synthetic: false } }, select: { priceCents: true } });
  const n = prior.length + 1, total = prior.reduce((s, o) => s + o.priceCents, 0) + cents;
  if (n > ANOMALY_CREDITS_PER_DAY) return `${n} credits from ${facilityId} to ${carrierId} today`;
  if (total > ANOMALY_CENTS_PER_DAY) return `$${(total / 100).toFixed(2)} credited from ${facilityId} to ${carrierId} today`;
  return null;
}

/** Human kill switch (A8): revoked mandates are refused at accept and again at execution. */
export async function revokeMandate(id: string, nowMs = Date.now()) {
  const r = await prisma.mandate.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(nowMs) } });
  if (!r.count) throw new DomainError("not_found", `mandate ${id} not found or already revoked`);
  return { id, revokedAt: new Date(nowMs).toISOString() };
}

/** Accepted shipper-funded offer to apply at departure (settle.ts), re-guarded there (A8). */
export async function lockedOfferFor(loadId: string, nowMs = Date.now()) {
  const offer = await prisma.offer.findFirst({ where: { loadId, status: "ACCEPTED", kind: { in: ["WAIT_GUARANTEED", "RELEASE_TONU"] } }, orderBy: { acceptedAt: "desc" } });
  if (!offer) return null;
  const g = await guardOffer({ ...offer, kind: offer.kind as OfferKind }, nowMs, true);
  if (g.verdict.verdict !== "ALLOWED") {
    await appendAction({ agent: g.funder, action: "EXECUTE", offerId: offer.id, mandateId: g.mandate?.id, verdict: g.verdict.verdict, reasons: g.verdict.reasons, payload: { loadId, kind: offer.kind, cents: offer.priceCents, at: "departure" } });
    await notify(loadId, "OPS", "BLOCKED", `accepted offer ${offer.id} blocked at departure, metered detention applies: ${g.verdict.reasons.join("; ")}`);
    return null;
  }
  return offer;
}
