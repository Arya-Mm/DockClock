import "server-only";
import { prisma } from "@dockclock/db";
import { paypalRequestId } from "@dockclock/core";
import { addOrderTracking, type Order } from "@dockclock/paypal";
import { recorded } from "./ops";
import { DomainError } from "./http";

/** Attach the load to its captured PayPal order as a shipment (tracking number = load id). Recorded like every PayPal call. */
export async function attachTracking(loadId: string) {
  const l = await prisma.load.findUnique({ where: { id: loadId }, select: { orderId: true, captureId: true, synthetic: true } });
  if (!l) throw new DomainError("not_found", `load ${loadId} not found`);
  if (l.synthetic) throw new DomainError("synthetic", "synthetic rows never call PayPal");
  if (!l.orderId || !l.captureId) throw new DomainError("state_conflict", "tracking needs a captured order");
  const r = await recorded<Order>({ loadId, operation: "TRACKING", requestId: paypalRequestId(loadId, "TRACKING", loadId) },
    () => addOrderTracking(loadId, l.orderId!, l.captureId!, loadId));
  return { orderId: l.orderId, captureId: l.captureId, debugId: r.debugId ?? null };
}
