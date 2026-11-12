import { z } from "zod";
import { handle, parseBody, requireOps } from "@/lib/server/http";
import { decideReview } from "@/lib/server/cockpit";

// The grid cell that moves money (PLAN §7.1). No amount in the body: the engine computes it from evidence.
const Body = z.object({ decision: z.enum(["APPROVE", "REJECT"]) }).strict();

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/cockpit/review/[loadId]">) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const { loadId } = await ctx.params;
  const b = await parseBody(req, Body);
  if (b instanceof Response) return b;
  return Response.json({ data: await decideReview(loadId, b.decision, "ops-cockpit") });
});
