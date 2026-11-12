import { z } from "zod";
import { handle, parseBody, requireOps } from "@/lib/server/http";
import { proposeOffer } from "@/lib/server/negotiation";

// Dispatcher proposes one offer kind to the driver. The engine sets the price; the body cannot.
const Body = z.object({ kind: z.enum(["WAIT_GUARANTEED", "SLOT_SWAP_WITH_CREDIT", "RELEASE_TONU", "PRIORITY_SLOT_PURCHASE"]) }).strict();

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/offers">) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  if (b instanceof Response) return b;
  return Response.json({ data: await proposeOffer(id, b.kind) }, { status: 201 });
});
