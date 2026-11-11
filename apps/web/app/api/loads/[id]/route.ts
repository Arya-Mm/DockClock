import { prisma } from "@dockclock/db";
import { handle } from "@/lib/server/http";
import { getLoad } from "@/lib/server/loads";

/** Load + its PayPal ops (with debug ids) + plan versions: the audit drawer. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/loads/[id]">) => {
  const { id } = await ctx.params;
  const load = await getLoad(id);
  const [ops, plans] = await Promise.all([
    prisma.payPalOp.findMany({ where: { loadId: id }, orderBy: { createdAt: "asc" } }),
    prisma.plan.findMany({ where: { loadId: id }, orderBy: { version: "asc" } }),
  ]);
  return Response.json({ data: { load, ops, plans } });
});
