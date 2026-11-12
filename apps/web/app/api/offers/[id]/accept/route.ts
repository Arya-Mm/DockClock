import { z } from "zod";
import { NextResponse } from "next/server";
import { requireOps, handle, parseBody } from "@/lib/server/http";
import { acceptOffer } from "@/lib/server/negotiation";

// No price in the body: the accept names the offer version + planHash it saw (A3); the engine owns the amount (A1).
const Body = z.object({ version: z.number().int().positive(), planHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
// The caller of this route is always a human operator; agents accept only inside negotiate().

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/offers/[id]/accept">) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  if (b instanceof NextResponse) return b;
  const r = await acceptOffer(id, { version: b.version, planHash: b.planHash }, "HUMAN");
  return Response.json({ data: r }, { status: r.status === "ACCEPTED" ? 200 : 409 });
});
