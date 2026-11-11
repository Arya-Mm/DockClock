import { handle } from "@/lib/server/http";
import { reauthorizeHold } from "@/lib/server/holds";

/** Gated by authLifecycle: 409 inside the honor period (M1). */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/loads/[id]/reauthorize">) => {
  const { id } = await ctx.params;
  return Response.json({ data: await reauthorizeHold(id) });
});
