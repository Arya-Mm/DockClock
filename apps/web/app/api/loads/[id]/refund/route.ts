import { z } from "zod";
import { prisma } from "@dockclock/db";
import { paypalRequestId } from "@dockclock/core";
import { refundCapture } from "@dockclock/paypal";
import { handle, parseBody, DomainError, requireOps } from "@/lib/server/http";
import { getLoad } from "@/lib/server/loads";
import { recorded } from "@/lib/server/ops";
import { notify } from "@/lib/server/executor";

const Body = z.object({ reason: z.enum(["DISPUTE_LOST", "GOODWILL"]).default("DISPUTE_LOST") });

/** M15: refund after a lost dispute. Full refund of the capture; the PayPalOp row is the ledger reversal record. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/refund">) => {
  const denied = requireOps(req); // money write: ops only once the app is public
  if (denied) return denied;
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  if (b instanceof Response) return b;
  const load = await getLoad(id);
  if (!load.captureId) throw new DomainError("no_capture", "nothing captured on this load");
  const captureId = load.captureId;
  const stage = b.reason.toLowerCase();
  const r = await recorded({ loadId: id, operation: "REFUND", requestId: paypalRequestId(id, "REFUND", stage) }, () => refundCapture(id, captureId, null, stage));
  await notify(id, "OPS", "NOTIFY", `refund ${r.data.id} (${b.reason}) on capture ${captureId}`);
  const ops = await prisma.payPalOp.count({ where: { loadId: id } });
  return Response.json({ data: { refundId: r.data.id, status: r.data.status, debugId: r.debugId, replayed: r.replayed, opsOnLoad: ops } });
});
