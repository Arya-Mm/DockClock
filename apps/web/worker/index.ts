// Background worker (Render Background Worker in Phase 6; locally: pnpm worker).
// Loops: capture poll fallback (M10), payout poll, reauth watchdog, offer expiry, nightly reconcile.
import { prisma } from "@dockclock/db";
import { watchdogAction } from "@dockclock/core";
import { getCapture, getPayoutBatch } from "@dockclock/paypal";
import { onCaptureOutcome } from "../lib/server/webhooks";
import { applyOutcome, notify } from "../lib/server/executor";
import { reauthorizeHold } from "../lib/server/holds";
import { runReconcile } from "../lib/server/reconcile";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 15_000);
const POLL_AFTER_MS = Number(process.env.POLL_AFTER_MS ?? 60_000); // M10: poll only if no webhook moved the load
const DAY = 86_400_000;
let lastReconcile = 0;

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

export async function pollCaptures(now = Date.now()) {
  const loads = await prisma.load.findMany({ where: { state: "CAPTURED", captureId: { not: null }, payoutBatchId: null, updatedAt: { lt: new Date(now - POLL_AFTER_MS) } }, take: 20 });
  for (const l of loads) {
    const c = await getCapture(l.captureId!);
    const s = c.data.status;
    if (s === "COMPLETED") log("poll: capture completed", { loadId: l.id, result: await onCaptureOutcome(l.id, { type: "CAPTURE_COMPLETED", captureId: c.data.id }), debugId: c.debugId });
    else if (s === "DECLINED" || s === "FAILED") await onCaptureOutcome(l.id, { type: "CAPTURE_FAILED", issue: "INSTRUMENT_DECLINED" });
    else log("poll: capture not final", { loadId: l.id, status: s });
  }
}

export async function pollPayouts(now = Date.now()) {
  const loads = await prisma.load.findMany({ where: { state: "CAPTURED", payoutBatchId: { not: null }, updatedAt: { lt: new Date(now - POLL_AFTER_MS) } }, take: 20 });
  for (const l of loads) {
    const b = await getPayoutBatch(l.payoutBatchId!);
    const item = b.data.items?.[0]?.transaction_status;
    if (item === "SUCCESS") await applyOutcome(l.id, { type: "PAYOUT_SUCCEEDED" });
    else if (item === "UNCLAIMED") await applyOutcome(l.id, { type: "PAYOUT_UNCLAIMED" });
    else if (item && ["FAILED", "BLOCKED", "RETURNED", "REFUNDED"].includes(item)) await applyOutcome(l.id, { type: "PAYOUT_FAILED", issue: item });
    log("poll: payout", { loadId: l.id, batch: l.payoutBatchId, item: item ?? b.data.batch_header?.batch_status, debugId: b.debugId });
  }
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

export async function expireOffers(now = Date.now()) {
  const r = await prisma.offer.updateMany({ where: { status: "OPEN", expiresAt: { lt: new Date(now) } }, data: { status: "EXPIRED" } });
  if (r.count) log("offers expired", { count: r.count });
}

async function tick() {
  const now = Date.now();
  const jobs = [["captures", pollCaptures], ["payouts", pollPayouts], ["watchdog", reauthWatchdog], ["offers", expireOffers]] as const;
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
