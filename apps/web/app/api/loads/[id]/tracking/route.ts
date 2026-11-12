import { handle, requireOps } from "@/lib/server/http";
import { attachTracking } from "@/lib/server/tracking";

/** Add PayPal shipment tracking to the load's captured order. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/tracking">) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  return Response.json({ data: await attachTracking(id) }, { status: 201 });
});
