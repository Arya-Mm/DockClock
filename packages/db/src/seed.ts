// Loads packages/core fixtures into Postgres. Idempotent (upserts). All rows are synthetic (D10).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { FACILITIES, DEMO_CONTRACT, type LedgerRow } from "@dockclock/core";
import { prisma, stateForAction, sha256Json } from "./index";

const require = createRequire(import.meta.url);
const ledger: LedgerRow[] = JSON.parse(readFileSync(require.resolve("@dockclock/core/fixtures/ledger.json"), "utf8"));

// Synthetic facility coordinates (city-level), used by the geofence simulator.
const COORDS: Record<string, [number, number]> = {
  "F-CHI-01": [41.525, -88.0817], "F-ATL-02": [33.749, -84.388], "F-DAL-03": [32.7668, -96.5992], "F-LAX-04": [33.8317, -118.2817],
  "F-NJ-05": [40.5187, -74.4121], "F-MEM-06": [35.1495, -90.049], "F-SEA-07": [47.3809, -122.2348], "F-PHX-08": [33.4342, -112.257],
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function main() {
  const c = DEMO_CONTRACT;
  await prisma.contractVersion.upsert({
    where: { id: c.contractVersionId }, update: {},
    create: { id: c.contractVersionId, fingerprint: sha256Json(c), terms: { ...c }, shipperConfirmed: true, carrierConfirmed: true },
  });
  for (const f of FACILITIES) {
    const [lat, lng] = COORDS[f.id] ?? [0, 0];
    await prisma.facility.upsert({ where: { id: f.id }, update: {}, create: { id: f.id, name: f.name, ianaZone: f.tz, lat, lng, radiusM: 300 } });
  }
  const carriers = [...new Set(ledger.map((r) => r.carrierName))];
  for (const name of carriers) {
    const id = `C-${slug(name)}`;
    await prisma.carrierProfile.upsert({
      where: { id }, update: {},
      create: { id, name, usdot: String(1000000 + carriers.indexOf(name)), verifiedPayeeEmail: `${slug(name)}@carrier.example.com` },
    });
  }
  // Batched: one round trip per table instead of one per row (remote DB is ~2s away from dev machines).
  await prisma.load.createMany({
    skipDuplicates: true,
    data: ledger.map((r) => ({
      id: r.loadId, facilityId: r.facilityId, carrierId: `C-${slug(r.carrierName)}`, contractVersionId: c.contractVersionId,
      appointmentAt: new Date(r.appointmentIso), state: stateForAction(r.action),
    })),
  });
  await prisma.plan.createMany({
    skipDuplicates: true, // unique (loadId, version)
    data: ledger.map((r) => ({ loadId: r.loadId, version: 1, hash: sha256Json(r), body: { ...r } })),
  });
  console.log(`seeded ${FACILITIES.length} facilities, ${carriers.length} carriers, ${ledger.length} loads`);
}

main().finally(() => prisma.$disconnect());
