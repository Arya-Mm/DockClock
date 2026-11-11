import { handle } from "@/lib/server/http";
import { voidLoadHold } from "@/lib/server/holds";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/loads/[id]/void">) => {
  const { id } = await ctx.params;
  return Response.json({ data: await voidLoadHold(id) });
});
