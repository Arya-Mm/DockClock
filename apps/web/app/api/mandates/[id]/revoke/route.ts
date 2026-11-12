import { handle } from "@/lib/server/http";
import { revokeMandate } from "@/lib/server/negotiation";

/** Human kill switch: a revoked mandate is refused at accept and again at execution (A8). */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/mandates/[id]/revoke">) => {
  const { id } = await ctx.params;
  return Response.json({ data: await revokeMandate(id) });
});
