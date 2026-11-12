import { handle, requireOps } from "@/lib/server/http";
import { driverKey } from "@/lib/server/driver";

/** Ops mints the driver's per-load link (sent by SMS in production). */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/driver/[id]/link">) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  return Response.json({ data: { url: new URL(`/driver/${encodeURIComponent(id)}?k=${driverKey(id)}`, req.url).toString() } });
});
