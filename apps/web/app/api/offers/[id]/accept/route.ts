import { z } from "zod";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/server/http";
import { acceptOffer } from "@/lib/server/negotiation";

// No price in the body: the accept names the offer version + planHash it saw (A3); the engine owns the amount (A1).
const Body = z.object({ version: z.number().int().positive(), planHash: z.string().regex(/^[0-9a-f]{64}$/), by: z.enum(["CARRIER", "HUMAN"]).default("HUMAN") }).strict();

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/offers/[id]/accept">) => {
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  if (b instanceof NextResponse) return b;
  const r = await acceptOffer(id, { version: b.version, planHash: b.planHash }, b.by);
  return Response.json({ data: r }, { status: r.status === "ACCEPTED" ? 200 : 409 });
});
