import { prisma } from "@dockclock/db";
import { verifyChain } from "@/lib/server/chain";
import { AppShell } from "@/components/app-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent ledger verify" };

const usd = (c: unknown) => (typeof c === "number" ? `$${(c / 100).toFixed(2)}` : "");
const verdictVariant = (v: string) => (v === "BLOCKED" ? "destructive" : v === "ESCALATED" ? "secondary" : "outline") as "destructive" | "secondary" | "outline";

/** Public check of the hash-chained agent_action ledger. Every amount shown is engine output stored in the row. */
export default async function VerifyPage() {
  const [check, rows] = await Promise.all([verifyChain(), prisma.agentAction.findMany({ orderBy: { seq: "desc" }, take: 100 })]);
  return (
    <AppShell title="Verify receipt" sub="Every agent move is a row in an append-only ledger; each row's hash covers the previous one, so rewriting any row breaks the chain from that point on.">
      <Alert variant={check.ok ? "default" : "destructive"}>
        <AlertTitle>{check.ok ? "Chain intact" : `Chain broken at seq ${check.brokenAtSeq}`}</AlertTitle>
        <AlertDescription>{check.ok ? `${check.rows} rows verified. Head hash ${check.headHash.slice(0, 16)}…` : check.reason}</AlertDescription>
      </Alert>
      <Card>
        <CardHeader><CardTitle>Agent action ledger</CardTitle><CardDescription>Latest 100 rows. Hover a hash to see the previous hash it chains to.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>{["#", "Agent", "Action", "Verdict", "Offer", "Amount", "Reasons", "Prompt", "Hash"].map((h) => <TableHead key={h} className={h === "Amount" ? "text-right" : undefined}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{rows.map((r) => {
              const p = r.payload as { cents?: number; debugId?: string };
              return (
                <TableRow key={r.seq}>
                  <TableCell className="tabular-nums text-muted-foreground">{r.seq}</TableCell>
                  <TableCell className="capitalize">{r.agent.replaceAll("_", " ").toLowerCase()}</TableCell>
                  <TableCell>{r.action}</TableCell>
                  <TableCell><Badge variant={verdictVariant(r.verdict)}>{r.verdict.toLowerCase()}</Badge></TableCell>
                  <TableCell><code className="text-xs">{r.offerId ?? ""}</code></TableCell>
                  <TableCell className="text-right tabular-nums">{usd(p.cents)}</TableCell>
                  <TableCell className="max-w-[320px] whitespace-normal text-muted-foreground">{r.reasons.join("; ")}</TableCell>
                  <TableCell title={r.promptHash ?? ""}><code className="text-xs">{r.promptHash?.slice(0, 8) ?? ""}</code></TableCell>
                  <TableCell title={`prev ${r.prevHash}`}><code className="text-xs">{r.hash.slice(0, 12)}…</code>{p.debugId && <span className="ml-1 text-xs text-muted-foreground">debug_id {p.debugId}</span>}</TableCell>
                </TableRow>
              );
            })}</TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
