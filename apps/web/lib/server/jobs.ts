import "server-only";
// Worker jobs (capture poll fallback M10, payout poll, reauth watchdog, offer expiry, dispute evidence retry, nightly reconcile).
// Run by: pnpm worker (Render Background Worker, paid), the in-process loop in instrumentation.ts (free web service),
// or POST /api/cron/[job] from a free external scheduler (GitHub Actions). All three call the same code.
import { prisma } from "@dockclock/db";
import { watchdogAction, paypalRequestId } from "@dockclock/core";
import { getCapture, getPayoutBatch } from "@dockclock/paypal";
import { onCaptureOutcome } from "./webhooks";
import { applyOutcome, notify, runSteps, latestPlan } from "./executor";
import { reauthorizeHold } from "./holds";
import { runReconcile } from "./reconcile";

const POLL_AFTER_MS = Number(process.env.POLL_AFTER_MS ?? 60_000); // M10: poll only if no webhook moved the load
const DAY = 86_400_000;

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

// One bad load must not stop the rest; touching updatedAt rotates it to the back of the queue.
async function perLoad(loadId: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { log("load job failed", { loadId, error: (e as Error).message }); }
  await prisma.load.update({ where: { id: loadId }, data: { updatedAt: new Date() } }).catch(() => {});
}

export async function pollCaptures(now = Date.now()) {
  const loads = await prisma.load.findMany({ where: { state: "CAPTURED", captureId: { not: null }, payoutBatchId: null, updatedAt: { lt: new Date(now - POLL_AFTER_MS) } }, orderBy: { updatedAt: "asc" }, take: 20 });
  for (const l of loads) await perLoad(l.id, async () => {
    const c = await getCapture(l.captureId!);
    const s = c.data.status;
    if (s === "COMPLETED") log("poll: capture completed", { loadId: l.id, result: await onCaptureOutcome(l.id, { type: "CAPTURE_COMPLETED", captureId: c.data.id }), debugId: c.debugId });
    else if (s === "DECLINED" || s === "FAILED") await onCaptureOutcome(l.id, { type: "CAPTURE_FAILED", issue: "INSTRUMENT_DECLINED" });
    else log("poll: capture not final", { loadId: l.id, status: s });
  });
}

export async function pollPayouts(now = Date.now()) {
  const loads = await prisma.load.findMany({ where: { state: "CAPTURED", payoutBatchId: { not: null }, updatedAt: { lt: new Date(now - POLL_AFTER_MS) } }, orderBy: { updatedAt: "asc" }, take: 20 });
  for (const l of loads) await perLoad(l.id, async () => {
    const b = await getPayoutBatch(l.payoutBatchId!);
    const item = b.data.items?.[0]?.transaction_status;
    if (item === "SUCCESS") await applyOutcome(l.id, { type: "PAYOUT_SUCCEEDED" });
    else if (item === "UNCLAIMED") await applyOutcome(l.id, { type: "PAYOUT_UNCLAIMED" });
    else if (item && ["FAILED", "BLOCKED", "RETURNED", "REFUNDED"].includes(item)) await applyOutcome(l.id, { type: "PAYOUT_FAILED", issue: item });
    log("poll: payout", { loadId: l.id, batch: l.payoutBatchId, item: item ?? b.data.batch_header?.batch_status, debugId: b.debugId });
  });
}

export async function reauthWatchdog(now = Date.now()) {
  const loads = await prisma.load.findMany({ where: { state: { in: ["AUTHORIZED", "AT_FACILITY", "DEPARTED"] }, authorizationId: { not: null }, synthetic: false } });
  for (const l of loads) {
    if (!l.authorizedAt || !l.lastAuthorizedAt) continue;
    const a = watchdogAction({ authorizationId: l.authorizationId!, originalAuthorizedAtMs: l.authorizedAt.getTime(), lastAuthorizedAtMs: l.lastAuthorizedAt.getTime(), reauthCount: l.reauthCount }, now, l.state === "DEPARTED");
    if (a === "REAUTHORIZE") log("watchdog: reauthorized", { loadId: l.id, ...(await reauthorizeHold(l.id, now)) });
    else if (a === "REPLACE_AUTH") await notify(l.id, "OPS", "NOTIFY", "authorization expired or reauth used: settlement will replace it from the vault (M2)");
  }
}

// Dispute evidence retry: PayPal can refuse evidence (422 ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE) right after a case
// opens; the stored op keeps the same PayPal-Request-Id, so a retry is safe. Never on a SUCCEEDED op.
const EVIDENCE_RETRY_MS = 10 * 60_000;
export async function retryDisputeEvidence(now = Date.now()) {
  const loads = await prisma.load.findMany({ where: { state: "DISPUTED", disputeId: { not: null } }, select: { id: true, disputeId: true }, take: 20 });
  for (const l of loads) {
    const op = await prisma.payPalOp.findUnique({ where: { requestId: paypalRequestId(l.id, "EVIDENCE", l.disputeId!) } });
    if (op && (op.status === "SUCCEEDED" || op.updatedAt.getTime() > now - EVIDENCE_RETRY_MS)) continue;
    const r = await runSteps(l.id, [{ do: "SUBMIT_DISPUTE_EVIDENCE", disputeId: l.disputeId! }], await latestPlan(l.id), now);
    log("dispute evidence retry", { loadId: l.id, disputeId: l.disputeId, status: r[0]?.status, debugId: r[0]?.debugId });
  }
}

export async function expireOffers(now = Date.now()) {
  const r = await prisma.offer.updateMany({ where: { status: "OPEN", expiresAt: { lt: new Date(now) } }, data: { status: "EXPIRED" } });
  if (r.count) log("offers expired", { count: r.count });
}

/** Health-page heartbeat (per instance). */
export const heartbeat = { lastTickAt: 0, lastTickMs: 0, lastError: null as string | null, lastReconcileAt: 0 };

let running = false; // ticks must not overlap: PayPal calls can outlast TICK_MS
/** One pass of every poll job. Returns false when a tick is already running (an overlapping trigger is a no-op). */
export async function tick(now = Date.now()): Promise<boolean> {
  if (running) return false;
  running = true;
  const t0 = Date.now();
  try {
    const jobs = [["captures", pollCaptures], ["payouts", pollPayouts], ["watchdog", reauthWatchdog], ["offers", expireOffers], ["evidence", retryDisputeEvidence]] as const;
    heartbeat.lastError = null;
    for (const [name, job] of jobs) {
      try { await job(now); } catch (e) { heartbeat.lastError = `${name}: ${(e as Error).message}`; log(`job ${name} failed`, { error: (e as Error).message }); }
    }
    if (now - heartbeat.lastReconcileAt > DAY && now - (await lastReconcileRunMs()) > DAY) await reconcileNow(now);
  } finally { heartbeat.lastTickAt = now; heartbeat.lastTickMs = Date.now() - t0; running = false; }
  return true;
}

export const RECONCILE_NOTE = "reconcile run:";
/** Nightly reconcile vs PayPal Transaction Search. Leaves an OPS note so the health page shows the last run (any instance). */
export async function reconcileNow(now = Date.now()) {
  const r = await runReconcile(3, now);
  heartbeat.lastReconcileAt = now;
  await notify(null, "OPS", "NOTIFY", `${RECONCILE_NOTE} ${JSON.stringify(r)}`);
  log("reconcile", r as unknown as Record<string, unknown>);
  return r;
}

export async function lastReconcileRunMs(): Promise<number> {
  const n = await prisma.notification.findFirst({ where: { who: "OPS", message: { startsWith: RECONCILE_NOTE } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return n?.createdAt.getTime() ?? 0;
}
