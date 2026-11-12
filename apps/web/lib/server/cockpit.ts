import "server-only";
import { prisma } from "@dockclock/db";
import { seedNetwork, toLedgerRow, DEMO_CONTRACT, type LedgerRow, type SettlementPlan } from "@dockclock/core";
import { searchTransactions } from "@dockclock/paypal";
import { verifyChainCached } from "./chain";
import { settleLoad } from "./settle";
import { voidLoadHold } from "./holds";
import { DomainError } from "./http";

/**
 * Data for the AG Grid cockpit (PLAN §7.1). Every money number is engine output (the saved settlement plan) or a
 * PayPal-reported amount; the grids only format them. Seeded rows are flagged `synthetic` and badged in the UI.
 */
export type CockpitLedgerRow = LedgerRow & { synthetic: boolean; state: string; week: string; dwellTrend: number[]; receiptSlug: string | null; leakageUsd: number };

/** ISO week label, e.g. 2026-W46 (Monday weeks). */
export function isoWeek(ms: number): string {
  const d = new Date(ms); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const y = d.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4));
  const wk = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}

let network: { ledger: LedgerRow[]; trend: Map<string, number[]> } | null = null;
function syntheticNetwork() {
  if (network) return network;
  const { history, ledger } = seedNetwork(DEMO_CONTRACT);
  // Dwell sparkline: the last 12 dwells at each facility, oldest first (synthetic history).
  const trend = new Map<string, number[]>();
  for (const h of history) trend.set(h.facilityId, [...(trend.get(h.facilityId) ?? []), h.dwellMin].slice(-12));
  return (network = { ledger, trend });
}

/** Leakage = what the carrier claims on paper that was neither captured nor invoiced (spillover is billed, not lost). */
const leak = (r: LedgerRow) => Math.max(0, Math.round((r.claimedUsd - r.capturedUsd - r.invoicedUsd) * 100) / 100);

export async function ledgerRows(): Promise<CockpitLedgerRow[]> {
  const net = syntheticNetwork();
  const synthetic = net.ledger.map((r): CockpitLedgerRow => ({ ...r, synthetic: true, state: r.needsReview ? "NEEDS_REVIEW" : r.capturedUsd > 0 ? "PAID_OUT" : "VOIDED",
    week: isoWeek(Date.parse(r.appointmentIso)), dwellTrend: net.trend.get(r.facilityId) ?? [], receiptSlug: null, leakageUsd: leak(r) }));
  const loads = await prisma.load.findMany({ where: { synthetic: false, plans: { some: {} } }, orderBy: { updatedAt: "desc" }, take: 500, include: { facility: true, carrier: true, receipts: { select: { publicSlug: true }, take: 1 }, plans: { orderBy: { version: "desc" }, take: 1 } } });
  const real = loads.map((l): CockpitLedgerRow => {
    const plan = l.plans[0]!.body as unknown as SettlementPlan;
    const row = toLedgerRow(plan, { facilityId: l.facilityId, facilityName: l.facility.name, carrierName: l.carrier.name, appointmentMs: l.appointmentAt.getTime(), authorizationId: l.authorizationId ?? undefined, captureId: l.captureId ?? undefined });
    return { ...row, needsReview: l.state === "NEEDS_REVIEW", synthetic: false, state: l.state, week: isoWeek(l.appointmentAt.getTime()), dwellTrend: net.trend.get(l.facilityId) ?? [], receiptSlug: l.receipts[0]?.publicSlug ?? null, leakageUsd: leak(row) };
  });
  return [...real, ...synthetic];
}

export interface ReviewRow { loadId: string; facilityName: string; carrierName: string; state: string; holdUsd: number; flags: string; audit: string; decision: "PENDING" | "APPROVE" | "REJECT"; captureId: string | null; payoutBatchId: string | null }

const loadForReview = (where: { id: string }) => prisma.load.findUniqueOrThrow({ where, include: { facility: true, carrier: true, plans: { orderBy: { version: "desc" }, take: 1 } } });
function rowOf(l: Awaited<ReturnType<typeof loadForReview>>): ReviewRow {
  const plan = l.plans[0]?.body as unknown as SettlementPlan | undefined;
  return { loadId: l.id, facilityName: l.facility.name, carrierName: l.carrier.name, state: l.state, holdUsd: (l.holdCents ?? 0) / 100,
    flags: (plan?.audit ?? []).filter((a) => a.startsWith("HOLD") || a.startsWith("Review approved")).join("; "), audit: (plan?.audit ?? []).join("\n"),
    decision: l.state === "NEEDS_REVIEW" ? "PENDING" : l.state === "VOIDED" ? "REJECT" : "APPROVE", captureId: l.captureId, payoutBatchId: l.payoutBatchId };
}
export const reviewRow = async (id: string) => rowOf(await loadForReview({ id }));

/** Real loads that went to review (still waiting, or already decided so the row stays visible). Never synthetic. */
export async function reviewRows(): Promise<ReviewRow[]> {
  const flagged = await prisma.notification.findMany({ where: { kind: "MANUAL_REVIEW", message: { startsWith: "evidence insufficient" }, loadId: { not: null } }, select: { loadId: true }, distinct: ["loadId"] });
  const ids = flagged.map((f) => f.loadId!).filter(Boolean);
  const loads = await prisma.load.findMany({ where: { synthetic: false, OR: [{ state: "NEEDS_REVIEW" }, { id: { in: ids } }] }, include: { facility: true, carrier: true, plans: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, take: 200 });
  return loads.map(rowOf);
}

/** The grid cell that moves money: APPROVE runs the executor (real capture), REJECT voids the hold. */
export async function decideReview(loadId: string, decision: "APPROVE" | "REJECT", by: string) {
  // One decision per load at a time: a REJECT racing an APPROVE waits, then sees the new state and stops.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"review:" + loadId}))`;
    return decideLocked(loadId, decision, by);
  }, { maxWait: 15_000, timeout: 120_000 });
}

async function decideLocked(loadId: string, decision: "APPROVE" | "REJECT", by: string) {
  const l = await prisma.load.findUnique({ where: { id: loadId }, select: { state: true, synthetic: true } });
  if (!l) throw new DomainError("not_found", `load ${loadId} not found`);
  if (l.synthetic) throw new DomainError("synthetic", "synthetic rows never move money");
  if (l.state !== "NEEDS_REVIEW") throw new DomainError("state_conflict", `load is ${l.state}, not waiting for review`);
  if (decision === "APPROVE") {
    const r = await settleLoad(loadId, Date.now(), { approvedBy: by });
    return { row: await reviewRow(loadId), steps: r.steps.map((s) => ({ do: s.step.do, status: s.status, debugId: s.debugId ?? null, paypalId: s.paypalId ?? null })) };
  }
  const v = await voidLoadHold(loadId);
  return { row: await reviewRow(loadId), steps: [{ do: "VOID", status: "DONE", debugId: v.debugId ?? null, paypalId: v.authorizationId ?? null }] };
}

export interface AgentRow { seq: number; agent: string; action: string; verdict: string; offerId: string | null; mandateId: string | null; cents: number | null; reasons: string; promptHash: string | null; hash: string; prevHash: string; source: string | null; createdAt: string; chainOk: boolean }

export async function agentRows(): Promise<AgentRow[]> {
  const [rows, chain] = await Promise.all([prisma.agentAction.findMany({ orderBy: { seq: "desc" }, take: 1000 }), verifyChainCached()]);
  return rows.map((r) => {
    const p = r.payload as { cents?: number; source?: string };
    return { seq: r.seq, agent: r.agent, action: r.action, verdict: r.verdict, offerId: r.offerId, mandateId: r.mandateId, cents: typeof p.cents === "number" ? p.cents : null,
      reasons: r.reasons.join("; "), promptHash: r.promptHash, hash: r.hash, prevHash: r.prevHash, source: p.source ?? null, createdAt: r.createdAt.toISOString(),
      // Rows before the first broken link still verify; that row and everything after it do not.
      chainOk: chain.ok || (chain.brokenAtSeq !== null && r.seq < chain.brokenAtSeq) };
  });
}

export interface ReconRow { loadId: string | null; operation: string; paypalId: string; ledgerUsd: number | null; paypalUsd: number | null; status: "MATCHED" | "AMOUNT_DIFF" | "MISSING_IN_PAYPAL" | "PENDING_SEARCH_LAG"; at: string; debugId: string | null }

const LATENCY_MS = 3 * 3_600_000; // Transaction Search lags up to 3h (https://developer.paypal.com/docs/api/transaction-search/v1/)
let reconCache: { at: number; rows: ReconRow[] } | null = null;

/** DockClock captures vs PayPal Transaction Search, every row (matched and not). Cached 60 s. */
export async function reconcileRows(nowMs = Date.now()): Promise<ReconRow[]> {
  if (reconCache && nowMs - reconCache.at < 60_000) return reconCache.rows;
  const start = new Date(nowMs - 30 * 86_400_000), iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const paypal = new Map<string, number | null>();
  for (let page = 1; page <= 20; page++) {
    const r = await searchTransactions(iso(start), iso(new Date(nowMs)), page);
    for (const t of r.data.transaction_details ?? []) {
      const id = t.transaction_info?.transaction_id, v = t.transaction_info?.transaction_amount?.value;
      if (id) paypal.set(id, v ? Math.round(Math.abs(Number(v)) * 100) : null);
    }
    if (!r.data.total_pages || page >= r.data.total_pages) break;
  }
  const ours = await prisma.payPalOp.findMany({ where: { status: "SUCCEEDED", operation: { in: ["CAPTURE", "CAPTURE_OFFER"] }, createdAt: { gte: start }, paypalId: { not: null } }, orderBy: { createdAt: "desc" } });
  const rows = ours.map((op): ReconRow => {
    const known = paypal.has(op.paypalId!);
    const pp = known ? paypal.get(op.paypalId!) ?? null : null;
    const status: ReconRow["status"] = !known ? (nowMs - op.createdAt.getTime() > LATENCY_MS ? "MISSING_IN_PAYPAL" : "PENDING_SEARCH_LAG")
      : op.amountCents !== null && pp !== op.amountCents ? "AMOUNT_DIFF" : "MATCHED";
    return { loadId: op.loadId, operation: op.operation, paypalId: op.paypalId!, ledgerUsd: op.amountCents === null ? null : op.amountCents / 100, paypalUsd: pp === null ? null : pp / 100, status, at: op.createdAt.toISOString(), debugId: op.debugId };
  });
  reconCache = { at: nowMs, rows };
  return rows;
}
