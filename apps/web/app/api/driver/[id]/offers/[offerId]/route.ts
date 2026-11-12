import { handle, parseBody } from "@/lib/server/http";
import { requireDriver, decideOffer, Decision } from "@/lib/server/driver";

/** Driver confirms or declines on the confirmation card. No amount in the body: the engine owns it (A1, A9). */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/driver/[id]/offers/[offerId]">) => {
  const { id, offerId } = await ctx.params;
  const denied = requireDriver(req, id);
  if (denied) return denied;
  const b = await parseBody(req, Decision);
  if (b instanceof Response) return b;
  const r = await decideOffer(id, offerId, b);
  return Response.json({ data: r }, { status: r.status === "BLOCKED" || r.status === "ESCALATED" ? 409 : 200 });
});
