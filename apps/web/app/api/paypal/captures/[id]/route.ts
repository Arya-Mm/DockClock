import { getCapture } from "@dockclock/paypal";
import { handle } from "@/lib/server/http";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/paypal/captures/[id]">) => {
  const { id } = await ctx.params;
  const r = await getCapture(id);
  return Response.json({ data: r.data, debugId: r.debugId });
});
