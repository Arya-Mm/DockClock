import { handle, requireOps, fail } from "@/lib/server/http";
import { ledgerRows, reviewRows, agentRows, reconcileRows } from "@/lib/server/cockpit";

const SOURCES = { ledger: ledgerRows, review: reviewRows, agents: agentRows, recon: reconcileRows } as const;

/** Cockpit grid data (ops). Amounts are engine output or PayPal-reported; the grid only formats them. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/cockpit/[dataset]">) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const { dataset } = await ctx.params;
  const fn = SOURCES[dataset as keyof typeof SOURCES];
  if (!fn) return fail(404, "not_found", `unknown dataset ${dataset}`);
  return Response.json({ data: await fn() });
});
