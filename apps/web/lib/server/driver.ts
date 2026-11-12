import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma, sha256Json } from "@dockclock/db";
import { chargeForDwell, deriveGeofenceEvents, reconcileTimeline, type OfferKind, OFFER_FUNDER } from "@dockclock/core";
import { getLoad, contractOf, moveState, evidenceOf } from "./loads";
import { acceptOffer } from "./negotiation";
import { settleLoad } from "./settle";
import { appendAction } from "./chain";
import { notify } from "./executor";
import { DomainError, fail, requireOps } from "./http";
import { isOn } from "../flags";

// --- Driver link auth ----------------------------------------------------------------------------
// The driver's phone gets a per-load link: /driver/<loadId>?k=<hmac>. The key only opens that one load.
// shortcut: HMAC link, not accounts; replace with carrier login when real drivers onboard.
function secret() {
  const k = process.env.DOCKCLOCK_OPS_KEY ?? process.env.PAYPAL_CLIENT_SECRET;
  if (k) return k;
  if (process.env.NODE_ENV === "production") throw new Error("DOCKCLOCK_OPS_KEY must be set in production (driver links)");
  return "dev-only-driver-secret";
}
export const driverKey = (loadId: string) => createHmac("sha256", secret()).update(`driver:${loadId}`).digest("base64url").slice(0, 22);

export function requireDriver(req: Request, loadId: string): Response | null {
  const got = Buffer.from(new URL(req.url).searchParams.get("k") ?? req.headers.get("x-driver-key") ?? "");
  const want = Buffer.from(driverKey(loadId));
  return got.length === want.length && timingSafeEqual(got, want) ? null : fail(401, "unauthorized", "driver link is invalid for this load");
}

/**
 * Evidence writers (ELD pings, gate-cam/BOL images) are hardware or ops, never the driver: a driver could fake a trace.
 * The demo simulator may use the driver link only outside production with FLAG_GEOFENCE_SIM on.
 */
export function simOrOps(req: Request, loadId: string): Response | null {
  if (!requireOps(req)) return null;
  if (process.env.NODE_ENV !== "production" && isOn("GEOFENCE_SIM") && !requireDriver(req, loadId)) return null;
  return fail(401, "unauthorized", "evidence uploads need the ops key");
}

// --- Snapshot (what the phone renders; every number computed here) -------------------------------

export interface DriverSnapshot {
  loadId: string; state: string; facility: { name: string; zone: string };
  appointmentMs: number; arrivalMs: number | null; departureMs: number | null; serverNowMs: number;
  waitedMin: number | null; freeTimeEndsMs: number | null; detentionSoFarCents: number; holdCents: number | null;
  offer: { id: string; version: number; planHash: string; kind: OfferKind; priceCents: number; carrierPays: boolean; door: string | null; slotStartMs: number | null; expiresAtMs: number } | null;
  settlement: { action: string; captureCents: number; driverPayoutCents: number } | null;
  payout: { batchId: string | null; status: "NONE" | "SENT" | "PAID" };
  receiptSlug: string | null;
}

export async function snapshot(loadId: string, nowMs = Date.now()): Promise<DriverSnapshot> {
  const load = await getLoad(loadId);
  const c = contractOf(load.contractVersion.terms);
  const events = evidenceOf(load, nowMs);
  const tl = events.length ? reconcileTimeline(events) : null;
  // A departure only counts once the state machine has moved past the dock (geofence exit / gate), never from paper alone.
  const left = !["AUTHORIZED", "AT_FACILITY", "DISPATCHED", "AWAITING_PAYER"].includes(load.state);
  const arrivalMs = tl?.arrivalMs ?? null, departureMs = left ? tl?.departureMs ?? null : null;
  // The clock starts at the later of appointment and arrival (T1); the server clock decides (T15).
  const clockStart = arrivalMs === null ? null : Math.max(arrivalMs, load.appointmentAt.getTime());
  const end = departureMs ?? nowMs;
  const waitedMin = clockStart === null ? null : Math.max(0, Math.floor((end - clockStart) / 60_000));
  const [offer, plan, receipt, payoutOp] = await Promise.all([
    prisma.offer.findFirst({ where: { loadId, status: "OPEN", expiresAt: { gt: new Date(nowMs) } }, orderBy: { version: "desc" } }),
    prisma.plan.findFirst({ where: { loadId }, orderBy: { version: "desc" } }),
    prisma.receipt.findFirst({ where: { loadId }, orderBy: { createdAt: "desc" }, select: { publicSlug: true } }),
    prisma.payPalOp.findFirst({ where: { loadId, operation: "PAYOUT", status: "SUCCEEDED" } }),
  ]);
  const p = plan?.body as { action?: string; captureCents?: number; driverPayoutCents?: number } | undefined;
  return {
    loadId, state: load.state, facility: { name: load.facility.name, zone: load.facility.ianaZone },
    appointmentMs: load.appointmentAt.getTime(), arrivalMs, departureMs, serverNowMs: nowMs,
    waitedMin, freeTimeEndsMs: clockStart === null ? null : clockStart + c.freeTimeMin * 60_000,
    detentionSoFarCents: waitedMin === null ? 0 : chargeForDwell(waitedMin, c), holdCents: load.holdCents,
    offer: offer ? { id: offer.id, version: offer.version, planHash: offer.planHash, kind: offer.kind as OfferKind, priceCents: offer.priceCents,
      carrierPays: OFFER_FUNDER[offer.kind as OfferKind] === "CARRIER", door: offer.slotDoorId, slotStartMs: offer.slotStartAt?.getTime() ?? null, expiresAtMs: offer.expiresAt.getTime() } : null,
    settlement: p?.action ? { action: p.action, captureCents: p.captureCents ?? 0, driverPayoutCents: p.driverPayoutCents ?? 0 } : null,
    payout: { batchId: load.payoutBatchId, status: load.state === "PAID_OUT" ? "PAID" : payoutOp ? "SENT" : "NONE" },
    receiptSlug: receipt?.publicSlug ?? null,
  };
}

// --- Actions -------------------------------------------------------------------------------------

/** Driver check-in. Server time is the evidence time; the phone's clock is kept as evidence only (T15). */
export async function checkIn(loadId: string, deviceAtIso?: string, nowMs = Date.now()) {
  const load = await getLoad(loadId);
  if (load.evidence.some((e) => e.source === "DRIVER_APP_CHECKIN" && e.kind === "ARRIVAL")) return { already: true };
  await prisma.evidenceEvent.create({ data: { loadId, source: "DRIVER_APP_CHECKIN", kind: "ARRIVAL", utcAt: new Date(nowMs), deviceAt: deviceAtIso ? new Date(deviceAtIso) : undefined, confidence: 0.7, citation: "driver app check-in (server time)" } });
  if (load.state === "AUTHORIZED") await moveState(loadId, "AUTHORIZED", "AT_FACILITY");
  return { already: false };
}

export const Decision = z.object({ decision: z.enum(["ACCEPT", "DECLINE"]), version: z.number().int().positive(), planHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

/** Driver taps Accept on the confirmation card (A9). Same guarded path as every other accept. */
export async function decideOffer(loadId: string, offerId: string, d: z.infer<typeof Decision>) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer || offer.loadId !== loadId) throw new DomainError("not_found", `offer ${offerId} is not on load ${loadId}`);
  if (d.decision === "ACCEPT") return acceptOffer(offerId, { version: d.version, planHash: d.planHash }, "HUMAN");
  const r = await prisma.offer.updateMany({ where: { id: offerId, status: "OPEN" }, data: { status: "DECLINED" } });
  await appendAction({ agent: "CARRIER", action: "DRIVER_DECLINE", offerId, verdict: "ALLOWED", payload: { loadId, kind: offer.kind, cents: offer.priceCents, changed: r.count === 1 } });
  return { status: "DECLINED" as const, offerId };
}

export const PingsBody = z.object({
  pings: z.array(z.object({ tMs: z.number().int(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), source: z.string().max(40).default("ELD") })).min(1).max(2_000),
});

/**
 * ELD ping trace -> geofence events -> evidence -> state. Exit triggers settlement ("paid at the gate").
 * Spoofed streams are rejected (T8); a truck still inside never settles (T10). Re-posting the same trace is a no-op.
 */
export async function ingestPings(loadId: string, pings: z.infer<typeof PingsBody>["pings"]) {
  const load = await getLoad(loadId);
  const geo = deriveGeofenceEvents(pings, { id: load.facilityId, lat: load.facility.lat, lng: load.facility.lng, radiusM: load.facility.radiusM });
  if (geo.spoofSuspected) {
    await notify(loadId, "OPS", "MANUAL_REVIEW", `ELD stream rejected: ${geo.issues.join("; ")}`);
    return { accepted: false, issues: geo.issues, settled: null };
  }
  let state = load.state;
  for (const e of geo.events) {
    const exists = load.evidence.some((x) => x.source === "ELD_GEOFENCE" && x.kind === e.kind && x.utcAt.getTime() === e.utcMs);
    if (!exists) await prisma.evidenceEvent.create({ data: { loadId, source: "ELD_GEOFENCE", kind: e.kind, utcAt: new Date(e.utcMs), confidence: e.confidence, citation: e.citation } });
    if (e.kind === "ARRIVAL" && state === "AUTHORIZED") { await moveState(loadId, "AUTHORIZED", "AT_FACILITY"); state = "AT_FACILITY"; }
    if (e.kind === "DEPARTURE" && state === "AT_FACILITY") { await moveState(loadId, "AT_FACILITY", "DEPARTED"); state = "DEPARTED"; }
  }
  let settled: Awaited<ReturnType<typeof settleLoad>> | null = null;
  if (state === "DEPARTED") {
    settled = await settleLoad(loadId);
    await ensureReceipt(loadId);
  }
  return { accepted: true, issues: geo.issues, settled };
}

// --- Proof-of-Wait receipt -----------------------------------------------------------------------

/** One receipt per settled stop. Body is the engine plan + evidence + PayPal ids; auditHash = sha256 of the body. */
export async function ensureReceipt(loadId: string) {
  const existing = await prisma.receipt.findFirst({ where: { loadId } });
  if (existing) return existing;
  const load = await getLoad(loadId);
  const plan = await prisma.plan.findFirst({ where: { loadId }, orderBy: { version: "desc" } });
  if (!plan || !["CAPTURED", "PAID_OUT", "VOIDED", "INVOICED_SPILLOVER"].includes(load.state)) return null;
  const ops = await prisma.payPalOp.findMany({ where: { loadId, status: "SUCCEEDED" }, orderBy: { createdAt: "asc" }, select: { operation: true, paypalId: true, debugId: true, amountCents: true } });
  const body = {
    loadId, stopSeq: load.stopSeq, facility: load.facility.name, carrier: load.carrier.name, contractVersionId: load.contractVersionId,
    appointment: load.appointmentAt.toISOString(),
    evidence: load.evidence.map((e) => ({ source: e.source, kind: e.kind, utc: e.utcAt.toISOString(), confidence: e.confidence, citation: e.citation })).sort((a, b) => a.utc.localeCompare(b.utc)),
    planVersion: plan.version, planHash: plan.hash, plan: plan.body,
    paypal: ops,
  };
  const auditHash = sha256Json(body);
  return prisma.receipt.upsert({ where: { auditHash }, update: {}, create: { loadId, auditHash, publicSlug: randomBytes(9).toString("base64url"), body } });
}

/** Public verify: recompute the hash from the stored body. */
export async function verifyReceipt(slug: string) {
  const r = await prisma.receipt.findUnique({ where: { publicSlug: slug } });
  if (!r) return null;
  return { receipt: r, recomputed: sha256Json(r.body), ok: sha256Json(r.body) === r.auditHash };
}
