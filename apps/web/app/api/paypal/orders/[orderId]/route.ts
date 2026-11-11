import { getOrder } from "@dockclock/paypal";
import { handle } from "@/lib/server/http";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/paypal/orders/[orderId]">) => {
  const { orderId } = await ctx.params;
  const r = await getOrder(orderId);
  return Response.json({ data: r.data, debugId: r.debugId });
});
