import { z } from "zod";
import { handle, parseBody, requireOps } from "@/lib/server/http";
import { getLoad, sizeHold } from "@/lib/server/loads";
import { startHold } from "@/lib/server/holds";

/** Preview the engine hold size and its plain-English explanation. No money moves. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/loads/[id]/hold">) => {
  const { id } = await ctx.params;
  return Response.json({ data: await sizeHold(await getLoad(id)) });
});

const Body = z.object({ useVault: z.boolean().optional() });

/** Create the dock-time hold: vaulted (server-side) or an order the payer approves in JS SDK v6. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/hold">) => {
  const denied = requireOps(req); // money write: ops only once the app is public
  if (denied) return denied;
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  if (b instanceof Response) return b;
  return Response.json({ data: await startHold(id, b) }, { status: 201 });
});
