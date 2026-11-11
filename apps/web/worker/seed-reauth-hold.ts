// Run on Nov 12 (PLAN A4): creates a real vaulted hold that leaves the honor period about Nov 15 and stays valid
// until about Dec 11, so a judge can trigger a REAL reauthorization between Dec 1 and Dec 11.
import { prisma } from "@dockclock/db";
import { DEMO_CONTRACT } from "@dockclock/core";
import { startHold } from "../lib/server/holds";

async function main() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const id = `REAUTH-DEMO-${day}`;
  const carrier = await prisma.carrierProfile.findFirstOrThrow({ orderBy: { id: "asc" } });
  await prisma.load.upsert({
    where: { id }, update: {},
    create: { id, facilityId: "F-CHI-01", carrierId: carrier.id, contractVersionId: DEMO_CONTRACT.contractVersionId, appointmentAt: new Date(Date.now() + 20 * 86_400_000), synthetic: false },
  });
  const r = await startHold(id);
  console.log(JSON.stringify({ loadId: id, ...r, honorEnds: new Date(Date.now() + 3 * 86_400_000).toISOString(), validUntil: new Date(Date.now() + 29 * 86_400_000).toISOString() }));
}
main().finally(() => prisma.$disconnect());
