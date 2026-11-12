import { handle } from "@/lib/server/http";
import { settleOffer } from "@/lib/server/negotiation";

/** Retry settlement of an accepted offer (idempotent: every PayPal write is keyed by the offer id). */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/offers/[id]/settle">) => {
  const { id } = await ctx.params;
  return Response.json({ data: await settleOffer(id) });
});
