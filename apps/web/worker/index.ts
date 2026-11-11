// Background worker (Render Background Worker in Phase 6; locally: pnpm worker).
// Loops: capture poll fallback (M10), payout poll, reauth watchdog, offer expiry, nightly reconcile.
import { prisma } from "@dockclock/db";
import { watchdogAction, paypalRequestId } from "@dockclock/core";
import { getCapture, getPayoutBatch } from "@dockclock/paypal";
import { onCaptureOutcome } from "../lib/server/webhooks";
import { applyOutcome, notify, runSteps, latestPlan } from "../lib/server/executor";
import { reauthorizeHold } from "../lib/server/holds";
import { runReconcile } from "../lib/server/reconcile";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 15_000);
const POLL_AFTER_MS = Number(process.env.POLL_AFTER_MS ?? 60_000); // M10: poll only if no webhook moved the load
const DAY = 86_400_000;
let lastReconcile = 0;

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

let running = false; // ticks must not overlap: PayPal calls can outlast TICK_MS
async function tick() {
  if (running) return;
  running = true;
  try { await tickOnce(); } finally { running = false; }
}

async function tickOnce() {
  const now = Date.now();
  const jobs = [["captures", pollCaptures], ["payouts", pollPayouts], ["watchdog", reauthWatchdog], ["offers", expireOffers], ["evidence", retryDisputeEvidence]] as const;
  for (const [name, job] of jobs) {
    try { await job(now); } catch (e) { log(`job ${name} failed`, { error: (e as Error).message }); }
  }
  if (now - lastReconcile > DAY) {
    try { log("reconcile", await runReconcile()); lastReconcile = now; } catch (e) { log("reconcile failed", { error: (e as Error).message }); }
  }
}

if (process.argv.includes("--once")) {
  tick().then(() => prisma.$disconnect());
} else {
  log("worker started", { tickMs: TICK_MS });
  void tick();
  setInterval(() => void tick(), TICK_MS);
}
