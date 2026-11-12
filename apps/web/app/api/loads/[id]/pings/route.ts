import { handle, parseBody, requireOps } from "@/lib/server/http";
import { requireDriver, ingestPings, PingsBody } from "@/lib/server/driver";

/** ELD trace in, geofence evidence out; geofence exit settles the stop ("paid at the gate"). */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/pings">) => {
  const { id } = await ctx.params;
  if (requireDriver(req, id) && requireOps(req)) return requireDriver(req, id)!;
  const b = await parseBody(req, PingsBody);
  if (b instanceof Response) return b;
  const r = await ingestPings(id, b.pings);
  return Response.json({ data: r }, { status: r.accepted ? 200 : 422 });
});
