"use client";
// Control-room actions (shadcn/ui): mandate kill switch, re-issue, safe demo reset, live refresh, and the PayPal-calls chart.
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

async function post(url: string) {
  const r = await fetch(url, { method: "POST" });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
  return j?.data;
}

export function LiveRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => { if (!on) return; const t = setInterval(() => router.refresh(), seconds * 1000); return () => clearInterval(t); }, [on, seconds, router]);
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" size="sm" aria-pressed={on} onClick={() => setOn((v) => !v)} />}>
        <span className={`size-2 rounded-full ${on ? "bg-emerald-500" : "bg-muted-foreground"}`} />{on ? `Live · ${seconds}s` : "Paused"}
      </TooltipTrigger>
      <TooltipContent>Reloads every figure from the database every {seconds} seconds</TooltipContent>
    </Tooltip>
  );
}

function ActionButton({ label, busyLabel, url, confirmText, variant, tip }: { label: string; busyLabel: string; url: string; confirmText: string; variant: "destructive" | "outline"; tip: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger render={<Button variant={variant} size="sm" disabled={pending}
          onClick={() => { if (!window.confirm(confirmText)) return; start(async () => { try { await post(url); setMsg(null); router.refresh(); } catch (e) { setMsg((e as Error).message); } }); }} />}>
          {pending ? busyLabel : label}
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
      {msg && <span className="text-xs text-destructive" role="alert">{msg}</span>}
    </span>
  );
}

export const KillSwitch = ({ id, agent }: { id: string; agent: string }) => (
  <ActionButton label="Revoke" busyLabel="Revoking…" url={`/api/mandates/${encodeURIComponent(id)}/revoke`} variant="destructive"
    confirmText={`Revoke the ${agent} mandate? The agent is refused at accept and again at execution until a new mandate is issued.`}
    tip="Kill switch: stops this agent from spending immediately" />
);
export const Reissue = ({ id, agent }: { id: string; agent: string }) => (
  <ActionButton label="Re-issue" busyLabel="Issuing…" url={`/api/mandates/${encodeURIComponent(id)}/reissue`} variant="outline"
    confirmText={`Issue a fresh ${agent} mandate with the same limits? The revoked one stays in the audit trail.`}
    tip="Restores the agent with the same caps; the revoked mandate stays on record" />
);
export const ResetDemo = () => (
  <ActionButton label="Reset demo" busyLabel="Resetting…" url="/api/control/reset" variant="outline"
    confirmText="Expire all open offers? No load, PayPal call, webhook, receipt or ledger row is changed."
    tip="Safe reset: expires open offers only, so a scenario can be run again. Money records are never touched." />
);

const chartConfig = { count: { label: "Successful calls", color: "#10b981" } } satisfies ChartConfig;
export function OpsChart({ data }: { data: { op: string; count: number }[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full">
      <BarChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="op" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval={0} angle={-20} textAnchor="end" height={48} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
