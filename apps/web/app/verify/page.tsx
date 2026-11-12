import { prisma } from "@dockclock/db";
import { verifyChain } from "@/lib/server/chain";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent ledger verify" };

const usd = (c: unknown) => (typeof c === "number" ? `$${(c / 100).toFixed(2)}` : "");

/** Public check of the hash-chained agent_action ledger. Every amount shown is engine output stored in the row. */
export default async function VerifyPage() {
  const [check, rows] = await Promise.all([verifyChain(), prisma.agentAction.findMany({ orderBy: { seq: "desc" }, take: 100 })]);
  return (
    <main className="mx-auto max-w-6xl p-4 font-mono text-sm">
      <h1 className="mb-2 text-xl font-bold">Agent action ledger</h1>
      <p className={`mb-4 rounded p-3 ${check.ok ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"}`}>
        {check.ok ? `Chain intact: ${check.rows} rows, head ${check.headHash.slice(0, 16)}…` : `Chain BROKEN at seq ${check.brokenAtSeq}: ${check.reason}`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr className="border-b text-left">{["seq", "agent", "action", "verdict", "offer", "amount", "reasons", "prompt", "hash"].map((h) => <th key={h} className="p-1">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const p = r.payload as { cents?: number; debugId?: string };
              return (
                <tr key={r.seq} className={`border-b ${r.verdict === "BLOCKED" ? "bg-red-50" : r.verdict === "ESCALATED" ? "bg-amber-50" : ""}`}>
                  <td className="p-1">{r.seq}</td><td className="p-1">{r.agent}</td><td className="p-1">{r.action}</td><td className="p-1">{r.verdict}</td>
                  <td className="p-1">{r.offerId ?? ""}</td><td className="p-1">{usd(p.cents)}</td><td className="p-1">{r.reasons.join("; ")}</td>
                  <td className="p-1" title={r.promptHash ?? ""}>{r.promptHash?.slice(0, 8) ?? ""}</td>
                  <td className="p-1" title={`prev ${r.prevHash}`}>{r.hash.slice(0, 12)}…{p.debugId ? ` debug_id ${p.debugId}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
