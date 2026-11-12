import { handle, requireOps } from "@/lib/server/http";
import { captureOfferOrder } from "@/lib/server/negotiation";

// PayPal sends the carrier back here after approval. We never trust query params: the order id comes from our
// own PayPalOp row for this offer, and the capture is keyed by the offer (a reload cannot capture twice).
// GET stays open because PayPal's redirect cannot carry a header; it only captures an ACCEPTED, re-guarded offer
// whose order the carrier already approved in PayPal (PayPal refuses to capture an unapproved order).
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/offers/[id]/capture">) => {
  const { id } = await ctx.params;
  const r = await captureOfferOrder(id);
  const to = new URL("/dispatch", req.url);
  to.searchParams.set("offer", id);
  to.searchParams.set("capture", r.status);
  return Response.redirect(to, 303);
});

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/offers/[id]/capture">) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  return Response.json({ data: await captureOfferOrder(id) });
});
