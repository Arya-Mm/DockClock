import "server-only";
import { prisma, sha256Json, type Prisma } from "@dockclock/db";

type Tx = Prisma.TransactionClient;
export const GENESIS = "0".repeat(64);
const CHAIN_LOCK = 4_242_001; // pg advisory lock id: serialises appends so two writers never share a prevHash

export interface ActionInput {
  agent: "CARRIER" | "FACILITY" | "SHIPPER_TREASURY";
  action: string;
  offerId?: string | null;
  mandateId?: string | null;
  verdict: "ALLOWED" | "BLOCKED" | "ESCALATED";
  reasons?: string[];
  promptHash?: string | null;
  payload: Record<string, unknown>;
}

/** The hashed body. createdAt is set by us (not the DB default) so the hash can be recomputed exactly. */
function body(prevHash: string, a: ActionInput, createdAt: Date) {
  return {
    prevHash, agent: a.agent, action: a.action, offerId: a.offerId ?? null, mandateId: a.mandateId ?? null,
    verdict: a.verdict, reasons: a.reasons ?? [], promptHash: a.promptHash ?? null, payload: a.payload, createdAt: createdAt.toISOString(),
  };
}

/** Append one agent_action row to the hash chain (append-only table; DB trigger blocks UPDATE/DELETE). */
export async function appendAction(a: ActionInput, tx?: Tx) {
  const run = async (t: Tx) => {
    await t.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`;
    const last = await t.agentAction.findFirst({ orderBy: { seq: "desc" }, select: { hash: true } });
    const prevHash = last?.hash ?? GENESIS;
    const createdAt = new Date();
    const b = body(prevHash, a, createdAt);
    return t.agentAction.create({
      data: { agent: a.agent, action: a.action, offerId: b.offerId, mandateId: b.mandateId, verdict: a.verdict, reasons: b.reasons, promptHash: b.promptHash,
        payload: a.payload as Prisma.InputJsonValue, prevHash, hash: sha256Json(b), createdAt },
    });
  };
  return tx ? run(tx) : prisma.$transaction(run, { maxWait: 15_000, timeout: 30_000 });
}

/** verifyChain is O(rows); reuse the verdict while the chain head has not moved. */
let cached: { headSeq: number; check: ChainCheck } | null = null;
export async function verifyChainCached(): Promise<ChainCheck> {
  const head = await prisma.agentAction.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
  const headSeq = head?.seq ?? 0;
  if (cached && cached.headSeq === headSeq) return cached.check;
  const check = await verifyChain();
  cached = { headSeq, check };
  return check;
}

export interface ChainCheck { ok: boolean; rows: number; brokenAtSeq: number | null; reason: string | null; headHash: string }

/** Recompute every hash from genesis. Any edited, deleted or reordered row breaks the chain at that seq. */
export async function verifyChain(): Promise<ChainCheck> {
  const rows = await prisma.agentAction.findMany({ orderBy: { seq: "asc" } });
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prevHash !== prev) return { ok: false, rows: rows.length, brokenAtSeq: r.seq, reason: "prevHash does not match previous row", headHash: prev };
    const h = sha256Json(body(prev, { agent: r.agent, action: r.action, offerId: r.offerId, mandateId: r.mandateId, verdict: r.verdict, reasons: r.reasons, promptHash: r.promptHash, payload: r.payload as Record<string, unknown> }, r.createdAt));
    if (h !== r.hash) return { ok: false, rows: rows.length, brokenAtSeq: r.seq, reason: "row content does not match its hash", headHash: prev };
    prev = r.hash;
  }
  return { ok: true, rows: rows.length, brokenAtSeq: null, reason: null, headHash: prev };
}
