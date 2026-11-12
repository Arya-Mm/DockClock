import { requireOps, handle } from "@/lib/server/http";
import { reissueMandate } from "@/lib/server/control";

/** Restore an agent after the kill switch: issues a fresh mandate with the same scope; the revoked one stays in the audit. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/mandates/[id]/reissue">) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  return Response.json({ data: await reissueMandate(id) }, { status: 201 });
});
