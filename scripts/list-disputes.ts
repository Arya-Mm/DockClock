import { listDisputes, getDispute } from "@dockclock/paypal";
const l = await listDisputes();
for (const d of l.data.items ?? []) {
  const g = await getDispute(d.dispute_id);
  console.log(JSON.stringify({ id: d.dispute_id, status: g.data.status, reason: d.reason, txns: g.data.disputed_transactions?.map((t) => t.seller_transaction_id), debugId: g.debugId }));
}
console.log(JSON.stringify({ count: l.data.items?.length ?? 0, debugId: l.debugId }));
