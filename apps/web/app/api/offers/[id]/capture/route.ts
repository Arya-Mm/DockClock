import { handle } from "@/lib/server/http";
import { captureOfferOrder } from "@/lib/server/negotiation";

// PayPal sends the carrier back here after approval. We never trust query params: the order id comes from our
// own PayPalOp row for this offer, and the capture is keyed by the offer (a reload cannot capture twice).
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/offers/[id]/capture">) => {
  const { id } = await ctx.params;
  const r = await captureOfferOrder(id);
  const to = new URL("/dispatch", req.url);
  to.searchParams.set("offer", id);
  to.searchParams.set("capture", r.status);
  return Response.redirect(to, 303);
});

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/offers/[id]/capture">) => {
  const { id } = await ctx.params;
  return Response.json({ data: await captureOfferOrder(id) });
});
