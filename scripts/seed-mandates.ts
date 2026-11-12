// Seed the three demo agent mandates (synthetic). Run: npx tsx --env-file=.env scripts/seed-mandates.ts
// Re-running resets them (un-revokes, new expiry) so the demo can be replayed.
import { prisma } from "../packages/db/src/index";

const DAY = 86_400_000;
const expiresAt = new Date(Date.now() + 30 * DAY);
const mandates = [
  { id: "M-FACILITY", agent: "FACILITY", ownerId: "F-CHI-01", allowedActions: ["SLOT_SWAP_WITH_CREDIT", "WAIT_GUARANTEED", "RELEASE_TONU", "PRIORITY_SLOT_PURCHASE"], counterparties: ["*"], perActionCapCents: 5_000, dailyCapCents: 25_000 },
  { id: "M-SHIPPER", agent: "SHIPPER_TREASURY", ownerId: "SHIPPER-DEMO", allowedActions: ["WAIT_GUARANTEED", "RELEASE_TONU"], counterparties: ["*"], perActionCapCents: 30_000, dailyCapCents: 100_000 },
  { id: "M-CARRIER", agent: "CARRIER", ownerId: "C-blue-mesa-freight", allowedActions: ["PRIORITY_SLOT_PURCHASE", "PART_PURCHASE"], counterparties: ["*"], perActionCapCents: 15_000, dailyCapCents: 40_000 },
] as const;

for (const m of mandates) {
  const data = { ...m, allowedActions: [...m.allowedActions], counterparties: [...m.counterparties], expiresAt, revokedAt: null };
  await prisma.mandate.upsert({ where: { id: m.id }, create: data, update: data });
  console.log(`mandate ${m.id} ${m.agent}: ${m.allowedActions.join(",")} cap $${m.perActionCapCents / 100}/action $${m.dailyCapCents / 100}/day`);
}
await prisma.$disconnect();
