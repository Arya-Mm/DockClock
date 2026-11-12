import { handle, requireOps } from "@/lib/server/http";
import { reauthorizeHold } from "@/lib/server/holds";

/** Gated by authLifecycle: 409 inside the honor period (M1). */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/reauthorize">) => {
  const denied = requireOps(req); // money write: ops only once the app is public
  if (denied) return denied;
  const { id } = await ctx.params;
  return Response.json({ data: await reauthorizeHold(id) });
});
