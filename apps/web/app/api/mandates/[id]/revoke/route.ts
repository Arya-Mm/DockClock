import { requireOps, handle } from "@/lib/server/http";
import { revokeMandate } from "@/lib/server/negotiation";

/** Human kill switch: a revoked mandate is refused at accept and again at execution (A8). */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/mandates/[id]/revoke">) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  return Response.json({ data: await revokeMandate(id) });
});
