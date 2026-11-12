import "server-only";
import { prisma } from "@dockclock/db";
import { health } from "./health";
import { verifyChainCached } from "./chain";
import { notify } from "./executor";
import { DomainError } from "./http";

/** Control-room data (/control): one end-to-end view of loads, money, agents, PayPal and the worker. Real rows only. */
export async function controlData(nowMs = Date.now()) {
  const day = new Date(nowMs - 86_400_000);
  const [h, chain, byState, ops, opsAll, mandates, verdicts, offers, recentLoads] = await Promise.all([
    health(nowMs), verifyChainCached(),
    prisma.load.groupBy({ by: ["state"], where: { synthetic: false }, _count: true }),
    prisma.payPalOp.findMany({ orderBy: { createdAt: "desc" }, take: 14, select: { createdAt: true, operation: true, status: true, amountCents: true, paypalId: true, debugId: true, loadId: true } }),
    prisma.payPalOp.groupBy({ by: ["operation"], where: { status: "SUCCEEDED" }, _sum: { amountCents: true }, _count: true }),
    prisma.mandate.findMany({ orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 20 }),
    prisma.agentAction.groupBy({ by: ["verdict"], where: { createdAt: { gte: day } }, _count: true }),
    prisma.offer.groupBy({ by: ["status"], _count: true }),
    prisma.load.findMany({ where: { synthetic: false }, orderBy: { updatedAt: "desc" }, take: 8, include: { facility: { select: { name: true } }, carrier: { select: { name: true } } } }),
  ]);
  const sum = (op: string) => opsAll.find((o) => o.operation === op)?._sum.amountCents ?? 0;
  const count = (op: string) => opsAll.find((o) => o.operation === op)?._count ?? 0;
  return {
    health: h, chainOk: chain.ok,
    kpi: {
      capturedCents: sum("CAPTURE") + sum("CAPTURE_OFFER"), captures: count("CAPTURE") + count("CAPTURE_OFFER"),
      paidOutCents: sum("PAYOUT") + sum("PAYOUT_OFFER"), payouts: count("PAYOUT") + count("PAYOUT_OFFER"),
      holdsPlaced: count("AUTHORIZE") + count("ORDER_VAULTED"), evidence: count("EVIDENCE"),
    },
    pipeline: Object.fromEntries(byState.map((s) => [s.state, s._count])) as Record<string, number>,
    verdicts24h: Object.fromEntries(verdicts.map((v) => [v.verdict, v._count])) as Record<string, number>,
    offers: Object.fromEntries(offers.map((o) => [o.status, o._count])) as Record<string, number>,
    ops: ops.map((o) => ({ at: o.createdAt.toISOString(), op: o.operation, status: o.status, usd: o.amountCents === null ? null : o.amountCents / 100, paypalId: o.paypalId, debugId: o.debugId, loadId: o.loadId })),
    mandates: mandates.map((m) => ({ id: m.id, agent: m.agent, actions: m.allowedActions.join(", "), perActionUsd: m.perActionCapCents / 100, dailyUsd: m.dailyCapCents / 100,
      expiresAt: m.expiresAt.toISOString(), revokedAt: m.revokedAt?.toISOString() ?? null, expired: m.expiresAt.getTime() < nowMs })),
    loads: recentLoads.map((l) => ({ id: l.id, state: l.state, facility: l.facility.name, carrier: l.carrier.name, holdUsd: (l.holdCents ?? 0) / 100, updatedAt: l.updatedAt.toISOString() })),
  };
}

/** Kill switch undo: a revoked mandate stays revoked (audit); a fresh one with the same scope is issued in its place. */
export async function reissueMandate(id: string, nowMs = Date.now()) {
  const m = await prisma.mandate.findUnique({ where: { id } });
  if (!m) throw new DomainError("not_found", `mandate ${id} not found`);
  if (!m.revokedAt) throw new DomainError("state_conflict", "mandate is still active");
  const fresh = await prisma.mandate.create({ data: { id: `${m.id.replace(/-r[0-9a-z]+$/, "")}-r${nowMs.toString(36)}`, agent: m.agent, ownerId: m.ownerId,
    allowedActions: m.allowedActions, counterparties: m.counterparties, perActionCapCents: m.perActionCapCents, dailyCapCents: m.dailyCapCents,
    expiresAt: new Date(Math.max(m.expiresAt.getTime(), nowMs + 7 * 86_400_000)) } });
  await notify(null, "OPS", "NOTIFY", `mandate ${m.id} re-issued as ${fresh.id}`);
  return { id: fresh.id };
}

/**
 * Safe demo reset (PLAN §8, F4). Only clears what blocks a fresh run: open offers expire, nothing is deleted.
 * Never touches loads, PayPal ops, webhooks, receipts or the hash-chained ledger, so no money record is lost.
 */
export async function resetDemo() {
  const offers = await prisma.offer.updateMany({ where: { status: "OPEN" }, data: { status: "EXPIRED" } });
  await notify(null, "OPS", "NOTIFY", `demo reset: ${offers.count} open offers expired; no money records changed`);
  return { offersExpired: offers.count };
}
