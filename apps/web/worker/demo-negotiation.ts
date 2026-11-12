// Phase 3 gate: a dock-jam negotiation runs end to end and settles on the PayPal sandbox.
// pnpm demo:negotiate            -> new load, vaulted hold, truck waiting 3h, negotiate (credit payout or locked guarantee)
// pnpm demo:negotiate --depart   -> also departs + settles
// pnpm demo:negotiate --priority          -> carrier-paid priority slot order (approve link printed)
// pnpm demo:negotiate --guarantee --depart -> locked WAIT_GUARANTEED captured from the hold at departure
import { prisma } from "@dockclock/db";
import { DEMO_CONTRACT } from "@dockclock/core";
import { startHold } from "../lib/server/holds";
import { moveState } from "../lib/server/loads";
import { negotiate, proposeOffer, acceptOffer } from "../lib/server/negotiation";
import { settleLoad } from "../lib/server/settle";

async function main() {
  const now = Date.now();
  const id = `NEG-${new Date(now).toISOString().slice(5, 19).replace(/[-:T]/g, "")}`;
  await prisma.load.create({ data: { id, facilityId: "F-CHI-01", carrierId: "C-blue-mesa-freight", contractVersionId: DEMO_CONTRACT.contractVersionId, appointmentAt: new Date(now - 190 * 60_000), synthetic: false } });
  const hold = await startHold(id);
  const waited = Number(process.argv[process.argv.indexOf("--waited") + 1]) || 185;
  const arrival = new Date(now - (process.argv.includes("--waited") ? waited : 185) * 60_000);
  await prisma.evidenceEvent.create({ data: { loadId: id, source: "ELD_GEOFENCE", kind: "ARRIVAL", utcAt: arrival, confidence: 1, citation: "demo ELD geofence entry" } });
  await moveState(id, "AUTHORIZED", "AT_FACILITY");
  // --guarantee: dispatcher proposes WAIT_GUARANTEED, carrier accepts (Shipper Treasury + guard), captured at departure.
  // --priority: carrier buys an earlier door; acceptance creates a carrier-paid PayPal order to approve in the browser.
  const pick = process.argv.includes("--guarantee") ? "WAIT_GUARANTEED" : process.argv.includes("--priority") ? "PRIORITY_SLOT_PURCHASE" : null;
  const neg = pick
    ? await proposeOffer(id, pick, now).then((o) => acceptOffer(o.id, { version: o.version, planHash: o.planHash }, "CARRIER", now))
    : await negotiate(id, now);
  console.log(JSON.stringify({ loadId: id, hold, negotiation: neg }, null, 1));
  if (process.argv.includes("--depart")) {
    await prisma.evidenceEvent.create({ data: { loadId: id, source: "ELD_GEOFENCE", kind: "DEPARTURE", utcAt: new Date(now), confidence: 1, citation: "demo ELD geofence exit" } });
    await moveState(id, "AT_FACILITY", "DEPARTED");
    console.log(JSON.stringify({ settle: await settleLoad(id, now + 1) }, null, 1));
  }
}
main().finally(() => prisma.$disconnect());
