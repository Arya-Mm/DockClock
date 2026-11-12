import { handle, parseBody, requireOps } from "@/lib/server/http";
import { requireDriver, simOrOps } from "@/lib/server/driver";
import { scanImage, damageFor, ScanBody } from "@/lib/server/vision";

/** Gate-cam / BOL photo -> typed evidence. Driver link or ops key. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/vision">) => {
  const { id } = await ctx.params;
  const b = await parseBody(req, ScanBody);
  if (b instanceof Response) return b;
  // Gate cams are facility hardware (ops). A driver may photograph only the BOL: weak evidence, hardware wins (T6).
  const denied = b.kind === "BOL" && !requireDriver(req, id) ? null : simOrOps(req, id);
  if (denied) return denied;
  return Response.json({ data: await scanImage(id, b) }, { status: 201 });
});

/** Current gate-in vs gate-out damage diff and its tariff-priced line items. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/vision">) => {
  const { id } = await ctx.params;
  if (requireDriver(req, id) && requireOps(req)) return requireDriver(req, id)!;
  return Response.json({ data: await damageFor(id) });
});
