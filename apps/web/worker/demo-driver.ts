// Driver demo: new load with a real vaulted PayPal hold, appointment 3h ago, truck not yet checked in.
// pnpm demo:driver   -> prints the driver link (/driver/<id>?k=...) and the simulator link (/sim/<id>?k=...)
import { prisma } from "@dockclock/db";
import { DEMO_CONTRACT } from "@dockclock/core";
import { startHold } from "../lib/server/holds";
import { driverKey } from "../lib/server/driver";

async function main() {
  const now = Date.now();
  const id = `DRV-${new Date(now).toISOString().slice(5, 19).replace(/[-:T]/g, "")}`;
  await prisma.load.create({ data: { id, facilityId: "F-CHI-01", carrierId: "C-blue-mesa-freight", contractVersionId: DEMO_CONTRACT.contractVersionId, appointmentAt: new Date(now - 180 * 60_000), synthetic: false } });
  const hold = await startHold(id);
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const k = driverKey(id);
  console.log(JSON.stringify({ loadId: id, hold: { orderId: hold.orderId, authorizationId: hold.authorizationId, debugId: hold.debugId }, driver: `${base}/driver/${id}?k=${k}`, sim: `${base}/sim/${id}?k=${k}` }, null, 1));
}
main().finally(() => prisma.$disconnect());
