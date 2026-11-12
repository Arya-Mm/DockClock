import { handle } from "@/lib/server/http";
import { requireDriver, snapshot } from "@/lib/server/driver";

/** Driver view of one load. Every number in it is computed on the server. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/driver/[id]">) => {
  const { id } = await ctx.params;
  const denied = requireDriver(req, id);
  if (denied) return denied;
  return Response.json({ data: await snapshot(id) });
});
