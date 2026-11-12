// Review-queue demo: a real vaulted hold whose only evidence is paper (BOL), so the engine refuses to move money
// (T7) and the load lands in the cockpit review queue. Approving it there captures for real.
// pnpm demo:review
import { prisma } from "@dockclock/db";
import { DEMO_CONTRACT } from "@dockclock/core";
import { startHold } from "../lib/server/holds";
import { moveState } from "../lib/server/loads";
import { settleLoad } from "../lib/server/settle";

async function main() {
  const now = Date.now();
  const id = `REV-${new Date(now).toISOString().slice(5, 19).replace(/[-:T]/g, "")}`;
  await prisma.load.create({ data: { id, facilityId: "F-CHI-01", carrierId: "C-blue-mesa-freight", contractVersionId: DEMO_CONTRACT.contractVersionId, appointmentAt: new Date(now - 200 * 60_000), synthetic: false } });
  const hold = await startHold(id);
  for (const [kind, minAgo] of [["ARRIVAL", 195], ["DEPARTURE", 30]] as const) {
    await prisma.evidenceEvent.create({ data: { loadId: id, source: "BOL_AI_EXTRACTED", kind, utcAt: new Date(now - minAgo * 60_000), confidence: 0.6, citation: "BOL photo (paper only, no ELD/gate)" } });
  }
  await moveState(id, "AUTHORIZED", "AT_FACILITY");
  await moveState(id, "AT_FACILITY", "DEPARTED");
  const r = await settleLoad(id, now);
  console.log(JSON.stringify({ loadId: id, hold: { authorizationId: hold.authorizationId, debugId: hold.debugId }, action: r.plan.action, state: (await prisma.load.findUnique({ where: { id }, select: { state: true } }))?.state }, null, 1));
}
main().finally(() => prisma.$disconnect());
