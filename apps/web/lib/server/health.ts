import "server-only";
import { prisma } from "@dockclock/db";
import { heartbeat, lastReconcileRunMs } from "./jobs";

/** Health for Render's health check and the judge-mode health page (PLAN §7.4): counts and times only, no money or ids. */
export async function health(nowMs = Date.now()) {
  const t0 = Date.now();
  const [awaitingPayout, settling, review, disputed, openOffers, lastReconcileMs, lastWebhook] = await Promise.all([
    prisma.load.count({ where: { state: "CAPTURED", synthetic: false } }),
    prisma.load.count({ where: { state: "SETTLING", synthetic: false } }),
    prisma.load.count({ where: { state: "NEEDS_REVIEW", synthetic: false } }),
    prisma.load.count({ where: { state: "DISPUTED", synthetic: false } }),
    prisma.offer.count({ where: { status: "OPEN", expiresAt: { gt: new Date(nowMs) } } }),
    lastReconcileRunMs(),
    prisma.webhookEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
  ]);
  const iso = (ms: number) => (ms ? new Date(ms).toISOString() : null);
  return {
    ok: true, dbMs: Date.now() - t0, now: iso(nowMs),
    queue: { awaitingPayout, settling, review, disputed, openOffers, total: awaitingPayout + settling + review + disputed + openOffers },
    worker: { mode: process.env.RUN_WORKER_IN_WEB === "0" ? "separate worker" : "in web service", lastTickAt: iso(heartbeat.lastTickAt), lastTickMs: heartbeat.lastTickMs, lastError: heartbeat.lastError },
    cron: { lastReconcileAt: iso(lastReconcileMs) },
    lastWebhookAt: lastWebhook?.receivedAt.toISOString() ?? null,
  };
}
