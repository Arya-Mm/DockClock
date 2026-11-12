import { handle, requireOps } from "@/lib/server/http";
import { settleLoad } from "@/lib/server/settle";

/** load, reconcileTimeline, planSettlement, nextSteps, execute. Every step idempotent and recorded. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/settle">) => {
  const denied = requireOps(req); // money write: ops only once the app is public
  if (denied) return denied;
  const { id } = await ctx.params;
  return Response.json({ data: await settleLoad(id) });
});
