import { handle, parseBody, requireOps } from "@/lib/server/http";
import { requireDriver } from "@/lib/server/driver";
import { scanImage, damageFor, ScanBody } from "@/lib/server/vision";

/** Gate-cam / BOL photo -> typed evidence. Driver link or ops key. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/vision">) => {
  const { id } = await ctx.params;
  if (requireDriver(req, id) && requireOps(req)) return requireDriver(req, id)!;
  const b = await parseBody(req, ScanBody);
  if (b instanceof Response) return b;
  return Response.json({ data: await scanImage(id, b) }, { status: 201 });
});

/** Current gate-in vs gate-out damage diff and its tariff-priced line items. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/vision">) => {
  const { id } = await ctx.params;
  if (requireDriver(req, id) && requireOps(req)) return requireDriver(req, id)!;
  return Response.json({ data: await damageFor(id) });
});
