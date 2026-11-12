import { prisma } from "@dockclock/db";
import { controlData } from "@/lib/server/control";
import { requireOpsPage } from "@/lib/server/ops-page";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KillSwitch, LiveRefresh, OpsChart, Reissue, ResetDemo } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "DockClock control room" };

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ago = (iso: string | null, now: number) => { if (!iso) return "never"; const m = Math.round((now - Date.parse(iso)) / 60_000); return m < 1 ? "just now" : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16) + " UTC";

// Load lifecycle in order (core ledger state machine).
const PIPE: [string, string, string, string][] = [
  ["DISPATCHED", "Dispatched", "Load created, no hold yet", "bg-slate-500"], ["AWAITING_PAYER", "Awaiting payer", "Waiting for the shipper to approve the hold", "bg-slate-400"],
  ["AUTHORIZED", "Hold placed", "PayPal authorization in place", "bg-blue-500"], ["AT_FACILITY", "At the dock", "Arrived; wait clock running", "bg-amber-500"],
  ["DEPARTED", "Departed", "Left the geofence; settlement next", "bg-violet-500"], ["NEEDS_REVIEW", "Needs review", "A human decides before money moves", "bg-orange-600"],
  ["SETTLING", "Settling", "Executor is calling PayPal", "bg-cyan-600"], ["CAPTURED", "Captured", "Captured; payout pending", "bg-teal-600"],
  ["PAID_OUT", "Paid out", "Driver paid", "bg-emerald-500"], ["VOIDED", "Voided", "Nothing owed; hold released", "bg-zinc-500"],
  ["INVOICED_SPILLOVER", "Invoiced", "Above the hold: rest invoiced", "bg-pink-600"], ["DISPUTED", "Disputed", "Dispute open; evidence submitted", "bg-red-600"],
];
const statusVariant = (s: string) => (s === "SUCCEEDED" ? "default" : s === "FAILED" ? "destructive" : "secondary") as "default" | "destructive" | "secondary";

/** Control room: the whole system on one screen (shadcn/ui). Every number is a database or PayPal record. */
export default async function ControlPage() {
  await requireOpsPage("/control");
  const [d, opCounts] = await Promise.all([controlData(), prisma.payPalOp.groupBy({ by: ["operation"], where: { status: "SUCCEEDED" }, _count: true })]);
  const now = Date.now();
  const total = Object.values(d.pipeline).reduce((a, b) => a + b, 0);
  const blocked = (d.verdicts24h.BLOCKED ?? 0) + (d.verdicts24h.ESCALATED ?? 0);
  const chart = opCounts.map((o) => ({ op: o.operation.replaceAll("_", " ").toLowerCase(), count: o._count })).sort((a, b) => b.count - a.count);
  const kpis = [
    { t: "Captured", v: usd(d.kpi.capturedCents), s: `${d.kpi.captures} captures`, tip: "Sum of successful PayPal captures" },
    { t: "Paid to drivers", v: usd(d.kpi.paidOutCents), s: `${d.kpi.payouts} payouts`, tip: "Sum of successful PayPal payouts" },
    { t: "Holds placed", v: String(d.kpi.holdsPlaced), s: "authorizations", tip: "PayPal authorizations (payer-approved or vaulted)" },
    { t: "Queue depth", v: String(d.health.queue.total), s: `${d.health.queue.review} need review`, tip: "Loads with work waiting" },
    { t: "Guard refusals · 24 h", v: String(blocked), s: `${d.verdicts24h.ALLOWED ?? 0} allowed`, tip: "Agent actions refused or escalated", warn: blocked > 0 },
    { t: "Disputes defended", v: String(d.kpi.evidence), s: "evidence packs", tip: "Dispute evidence submitted to PayPal" },
  ];
  return (
    <AppShell title="Control room" aside={<>
      <Badge variant={d.chainOk ? "outline" : "destructive"} title="Hash chain over every agent action; a rewritten row breaks it">Ledger chain {d.chainOk ? "verified" : "broken"}</Badge>
      <LiveRefresh /><ResetDemo /></>}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.t} size="sm" title={k.tip}>
            <CardHeader><CardDescription>{k.t}</CardDescription>
              <CardTitle className={`text-2xl tabular-nums ${k.warn ? "text-amber-400" : ""}`}>{k.v}</CardTitle></CardHeader>
            <CardContent className="text-xs text-muted-foreground">{k.s}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Load pipeline</CardTitle><CardDescription>{total} real loads by state. Offers: {Object.entries(d.offers).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ") || "none"}.</CardDescription></CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Share of loads in each state">
            {PIPE.filter(([k]) => d.pipeline[k]).map(([k, l, tip, c]) => <span key={k} className={c} style={{ flexGrow: d.pipeline[k], flexBasis: 0 }} title={`${l}: ${d.pipeline[k]} (${tip})`} />)}
          </div>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4 xl:grid-cols-6">
            {PIPE.map(([k, l, tip, c]) => <li key={k} className="flex items-center gap-2 text-muted-foreground" title={tip}><span className={`size-2.5 rounded-sm ${c}`} />{l}<b className="ml-auto tabular-nums text-foreground">{d.pipeline[k] ?? 0}</b></li>)}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader><CardTitle>PayPal feed</CardTitle><CardDescription>Latest sandbox calls with their debug_id</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Call</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>debug_id</TableHead></TableRow></TableHeader>
              <TableBody>{d.ops.map((o) => (
                <TableRow key={o.at + o.op + o.paypalId}>
                  <TableCell className="text-muted-foreground">{hhmm(o.at)}</TableCell>
                  <TableCell title={o.paypalId ? `PayPal id ${o.paypalId}${o.loadId ? `, load ${o.loadId}` : ""}` : undefined}>{o.op}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.usd === null ? "" : `$${o.usd.toFixed(2)}`}</TableCell>
                  <TableCell><Badge variant={statusVariant(o.status)}>{o.status.toLowerCase()}</Badge></TableCell>
                  <TableCell><code className="text-xs text-muted-foreground">{o.debugId ?? ""}</code></TableCell>
                </TableRow>))}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="grid gap-4 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle>PayPal calls by type</CardTitle><CardDescription>All successful sandbox calls</CardDescription></CardHeader>
            <CardContent><OpsChart data={chart} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>System</CardTitle><CardDescription>Free-tier deploy: worker runs in the web service</CardDescription></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Worker</dt><dd title="Capture/payout polls, reauth watchdog, offer expiry, evidence retry">last tick {ago(d.health.worker.lastTickAt, now)}{d.health.worker.lastTickAt ? ` · ${d.health.worker.lastTickMs} ms` : ""}</dd>
                <dt className="text-muted-foreground">Worker error</dt><dd className={d.health.worker.lastError ? "text-amber-400" : ""}>{d.health.worker.lastError ?? "none"}</dd>
                <dt className="text-muted-foreground">Reconcile</dt><dd title="Nightly vs PayPal Transaction Search">{ago(d.health.cron.lastReconcileAt, now)}</dd>
                <dt className="text-muted-foreground">Last webhook</dt><dd title="Signature verified, deduped by event id">{ago(d.health.lastWebhookAt, now)}</dd>
                <dt className="text-muted-foreground">Database</dt><dd>{d.health.dbMs} ms round trip</dd>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader><CardTitle>Agent mandates</CardTitle><CardDescription>An agent can only spend inside its mandate. Revoke stops it at accept and again at execution; the newest mandate per agent is in force.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>Mandate</TableHead><TableHead className="text-right">Per action</TableHead><TableHead className="text-right">Per day</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{d.mandates.map((m) => (
                <TableRow key={m.id} className={m.revokedAt ? "text-muted-foreground" : undefined}>
                  <TableCell className="font-medium capitalize" title={m.actions}>{m.agent.replaceAll("_", " ").toLowerCase()}</TableCell>
                  <TableCell><code className="text-xs">{m.id}</code></TableCell>
                  <TableCell className="text-right tabular-nums">${m.perActionUsd.toFixed(2)}</TableCell><TableCell className="text-right tabular-nums">${m.dailyUsd.toFixed(2)}</TableCell>
                  <TableCell>{m.revokedAt ? <Badge variant="destructive" title={`Revoked ${ago(m.revokedAt, now)}`}>revoked</Badge> : m.expired ? <Badge variant="secondary">expired</Badge> : <Badge>active</Badge>}</TableCell>
                  <TableCell className="text-right">{m.revokedAt ? <Reissue id={m.id} agent={m.agent} /> : !m.expired && <KillSwitch id={m.id} agent={m.agent} />}</TableCell>
                </TableRow>))}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Recent loads</CardTitle><CardDescription>Real sandbox loads, newest first</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Load</TableHead><TableHead>State</TableHead><TableHead className="text-right">Hold</TableHead></TableRow></TableHeader>
              <TableBody>{d.loads.map((l) => (
                <TableRow key={l.id}>
                  <TableCell title={`${l.facility} · ${l.carrier} · updated ${ago(l.updatedAt, now)}`}><code className="text-xs">{l.id}</code></TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{l.state.replaceAll("_", " ").toLowerCase()}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{l.holdUsd ? `$${l.holdUsd.toFixed(2)}` : ""}</TableCell>
                </TableRow>))}</TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
