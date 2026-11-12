import { handle, requireOps } from "@/lib/server/http";
import { voidLoadHold } from "@/lib/server/holds";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/void">) => {
  const denied = requireOps(req); // money write: ops only once the app is public
  if (denied) return denied;
  const { id } = await ctx.params;
  return Response.json({ data: await voidLoadHold(id) });
});
