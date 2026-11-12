import { z } from "zod";
import { handle, parseBody } from "@/lib/server/http";
import { requireDriver } from "@/lib/server/driver";
import { partOptions, buyPart } from "@/lib/server/parts";

/** Missing-part options (only when the gate-cam diff shows a part missing, A11). */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/driver/[id]/parts">) => {
  const { id } = await ctx.params;
  const denied = requireDriver(req, id);
  if (denied) return denied;
  return Response.json({ data: await partOptions(id) });
});

// The driver names a product; price is re-fetched and set on the server.
const Body = z.object({ productId: z.string().min(1).max(64) }).strict();

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/driver/[id]/parts">) => {
  const { id } = await ctx.params;
  const denied = requireDriver(req, id);
  if (denied) return denied;
  const b = await parseBody(req, Body);
  if (b instanceof Response) return b;
  const r = await buyPart(id, b.productId);
  return Response.json({ data: r }, { status: r.result.status === "ACCEPTED" ? 201 : 409 });
});
