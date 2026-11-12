import { z } from "zod";
import { handle, parseBody } from "@/lib/server/http";
import { requireDriver, checkIn } from "@/lib/server/driver";

const Body = z.object({ deviceAt: z.iso.datetime().optional() }).strict();

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/driver/[id]/checkin">) => {
  const { id } = await ctx.params;
  const denied = requireDriver(req, id);
  if (denied) return denied;
  const b = await parseBody(req, Body);
  if (b instanceof Response) return b;
  return Response.json({ data: await checkIn(id, b.deviceAt) });
});
