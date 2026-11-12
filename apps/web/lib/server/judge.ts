import "server-only";
import { prisma } from "@dockclock/db";
import { runScenarios, type ScenarioResult } from "@dockclock/core";

/**
 * Judge mode (PLAN §8). Each scenario shows the engine plan (sim clock, deterministic) next to the real sandbox
 * records of that kind: PayPal calls with debug_id, webhook arrivals and ledger rows. A scenario with no live record
 * says so; nothing is faked. Read-only: this page never calls PayPal.
 */
export interface LiveOp { at: string; operation: string; status: string; usd: number | null; paypalId: string | null; debugId: string | null; loadId: string | null }
export interface JudgeScenario { n: number; id: string; title: string; story: string; tryAt: { label: string; href: string }; engine: ScenarioResult | null; agentic?: string[]; live: LiveOp[]; liveNote: string }

const OPS_FOR: Record<string, string[]> = {
  "early-dent": ["VOID"], "reefer-spike": ["CAPTURE", "PAYOUT", "TRACKING"], overage: ["INVOICE_SPILL", "CAPTURE"], reauth: ["REAUTHORIZE"],
  spoof: [], dispute: ["EVIDENCE", "REFUND"], "dock-jam": ["ORDER_OFFER", "CAPTURE_OFFER", "PAYOUT_OFFER"], strap: ["ORDER", "PART_ORDER", "PART_CAPTURE"],
};
const TRY: Record<string, { label: string; href: string }> = {
  "early-dent": { label: "Dispatch console", href: "/dispatch" }, "reefer-spike": { label: "Dispatch console", href: "/dispatch" },
  overage: { label: "Dispatch console", href: "/dispatch" }, reauth: { label: "Health page (watchdog)", href: "/health" },
  spoof: { label: "Agent ledger", href: "/cockpit" }, dispute: { label: "Cockpit ledger", href: "/cockpit" },
  "dock-jam": { label: "Dock board", href: "/dock" }, strap: { label: "Driver app", href: "/driver" },
};

export async function judgeData() {
  const engine = runScenarios();
  const ops = await prisma.payPalOp.findMany({ where: { status: "SUCCEEDED" }, orderBy: { createdAt: "desc" }, take: 300,
    select: { createdAt: true, operation: true, status: true, amountCents: true, paypalId: true, debugId: true, loadId: true } });
  const toLive = (o: (typeof ops)[number]): LiveOp => ({ at: o.createdAt.toISOString(), operation: o.operation, status: o.status, usd: o.amountCents === null ? null : o.amountCents / 100, paypalId: o.paypalId, debugId: o.debugId, loadId: o.loadId });
  const row = (n: number, id: string, title: string, story: string, e: ScenarioResult | null, agentic?: string[]): JudgeScenario => {
    const live = ops.filter((o) => OPS_FOR[id]!.includes(o.operation)).slice(0, 4).map(toLive);
    return { n, id, title, story, tryAt: TRY[id] ?? { label: "Dispatch console", href: "/dispatch" }, engine: e, agentic, live,
      liveNote: live.length ? "Latest real sandbox calls of this kind" : OPS_FOR[id]?.length ? "Not run live in the sandbox yet: the engine plan is shown on the simulated clock" : "Nothing reaches PayPal in this scenario by design" };
  };
  const scenarios: JudgeScenario[] = engine.map((e, i) => row(i + 1, e.id, e.title, e.story, e));
  scenarios.push(row(7, "dock-jam", "Dock jam negotiation", "A jam is predicted; agents trade a slot swap with a facility credit. Code sets the price, the mandate guard approves.", null,
    ["Facility agent picks from a typed offer menu; prices come from the engine", "Driver agent accepts at or above its floor", "Accepted swap moves the bar on the dock board, then capture and payout"]));
  scenarios.push(row(8, "strap", "Carrier buys a missing strap (Channel3)", "Carrier agent finds a strap and pays by PayPal order under a $150/load mandate; an over-cap attempt is blocked.", null,
    ["Three options with price and delivery time", "Mandate check before the order", "Cost line is carrier-payable and netted from the payout"]));

  const [webhooks, redTeam, verdicts] = await Promise.all([
    prisma.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 8, select: { eventType: true, receivedAt: true, processedAt: true } }),
    prisma.agentAction.findMany({ where: { verdict: { in: ["BLOCKED", "ESCALATED"] } }, orderBy: { seq: "desc" }, take: 12, select: { seq: true, agent: true, action: true, verdict: true, reasons: true, createdAt: true } }),
    prisma.agentAction.groupBy({ by: ["verdict"], _count: true }),
  ]);
  return {
    scenarios,
    webhooks: webhooks.map((w) => ({ type: w.eventType, at: w.receivedAt.toISOString(), processed: !!w.processedAt })),
    redTeam: redTeam.map((r) => ({ seq: r.seq, agent: r.agent, action: r.action, verdict: r.verdict, reasons: r.reasons.join("; "), at: r.createdAt.toISOString() })),
    verdicts: Object.fromEntries(verdicts.map((v) => [v.verdict, v._count])) as Record<string, number>,
  };
}
