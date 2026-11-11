import { z } from "zod";
import { handle, parseBody } from "@/lib/server/http";
import { authorizeHold } from "@/lib/server/holds";

const Body = z.object({ loadId: z.string().min(1) });

/** Called by the JS SDK v6 onApprove handler. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/paypal/orders/[orderId]/authorize">) => {
  const { orderId } = await ctx.params;
  const b = await parseBody(req, Body);
  if (b instanceof Response) return b;
  return Response.json({ data: await authorizeHold(b.loadId, orderId) });
});
