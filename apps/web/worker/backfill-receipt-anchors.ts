// One-time: anchor receipts issued before F5/F6 anchoring into the agent_action chain. Each row says it is a backfill.
// pnpm --filter @dockclock/web exec node --conditions=react-server --env-file-if-exists=.env.local --import tsx worker/backfill-receipt-anchors.ts
import { prisma, sha256Json } from "@dockclock/db";
import { appendAction } from "../lib/server/chain";

async function main() {
  for (const r of await prisma.receipt.findMany({ orderBy: { createdAt: "asc" } })) {
    const has = await prisma.agentAction.findFirst({ where: { action: "RECEIPT", payload: { path: ["slug"], equals: r.publicSlug } } });
    if (has) continue;
    if (sha256Json(r.body) !== r.auditHash) { console.log("NOT anchoring, body does not match hash:", r.publicSlug); continue; }
    await appendAction({ agent: "SHIPPER_TREASURY", action: "RECEIPT", verdict: "ALLOWED", payload: { loadId: r.loadId, auditHash: r.auditHash, slug: r.publicSlug, backfill: true, issuedAt: r.createdAt.toISOString() } });
    console.log("anchored", r.publicSlug);
  }
}
main().finally(() => prisma.$disconnect());
