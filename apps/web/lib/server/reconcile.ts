import "server-only";
import { prisma } from "@dockclock/db";
import { searchTransactions } from "@dockclock/paypal";

const LATENCY_MS = 3 * 3_600_000; // Transaction Search lags up to 3h (doc: transaction-search/v1/search-get)
const toCents = (v: string | undefined) => (v ? Math.round(Math.abs(Number(v)) * 100) : null);

/** Nightly: DockClock captures vs PayPal Transaction Search. Writes ReconcileMismatch rows; returns counts. */
export async function runReconcile(days = 3, nowMs = Date.now()) {
  const runAt = new Date(nowMs);
  const start = new Date(nowMs - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const paypal = new Map<string, number | null>();
  for (let page = 1; page <= 10; page++) {
    const r = await searchTransactions(iso(start), iso(runAt), page);
    for (const t of r.data.transaction_details ?? []) {
      const id = t.transaction_info?.transaction_id;
      if (id) paypal.set(id, toCents(t.transaction_info?.transaction_amount?.value));
    }
    if (!r.data.total_pages || page >= r.data.total_pages) break;
  }
  const ours = await prisma.payPalOp.findMany({ where: { operation: "CAPTURE", status: "SUCCEEDED", createdAt: { gte: start } } });
  const rows: { kind: string; loadId: string | null; paypalTxnId: string | null; ledgerCents: number | null; paypalCents: number | null }[] = [];
  for (const op of ours) {
    if (!op.paypalId) continue;
    if (!paypal.has(op.paypalId)) {
      if (nowMs - op.createdAt.getTime() > LATENCY_MS) rows.push({ kind: "MISSING_IN_PAYPAL", loadId: op.loadId, paypalTxnId: op.paypalId, ledgerCents: op.amountCents, paypalCents: null });
    } else if (op.amountCents != null && paypal.get(op.paypalId) !== op.amountCents) {
      rows.push({ kind: "AMOUNT_DIFF", loadId: op.loadId, paypalTxnId: op.paypalId, ledgerCents: op.amountCents, paypalCents: paypal.get(op.paypalId) ?? null });
    }
  }
  if (rows.length) await prisma.reconcileMismatch.createMany({ data: rows.map((r) => ({ ...r, runAt })) });
  return { runAt: runAt.toISOString(), paypalTransactions: paypal.size, ledgerCaptures: ours.length, mismatches: rows.length };
}
