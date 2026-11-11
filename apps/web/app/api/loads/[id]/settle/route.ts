import { handle } from "@/lib/server/http";
import { settleLoad } from "@/lib/server/settle";

/** load, reconcileTimeline, planSettlement, nextSteps, execute. Every step idempotent and recorded. */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/loads/[id]/settle">) => {
  const { id } = await ctx.params;
  return Response.json({ data: await settleLoad(id) });
});
