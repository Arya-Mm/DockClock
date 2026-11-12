import { z } from "zod";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/server/http";
import { negotiate } from "@/lib/server/negotiation";

const Body = z.object({ loadId: z.string().min(1).max(64) });

/** Run a dock-jam negotiation (Facility vs Carrier, Shipper Treasury on accept). Prices come from the engine only. */
export const POST = handle(async (req: Request) => {
  const b = await parseBody(req, Body);
  if (b instanceof NextResponse) return b;
  return Response.json({ data: await negotiate(b.loadId) });
});
