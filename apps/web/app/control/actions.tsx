"use client";
// Control-room actions: the mandate kill switch, re-issue, safe demo reset and a 10 s live refresh.
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

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
    <button type="button" className="cr-chip" aria-pressed={on} onClick={() => setOn((v) => !v)} title={`Reloads every figure from the database every ${seconds} seconds`}>
      <i className={on ? "cr-dot cr-dot-on" : "cr-dot"} />{on ? `Live, every ${seconds}s` : "Paused"}
    </button>
  );
}

function ActionButton({ label, busyLabel, url, confirmText, tone, tip }: { label: string; busyLabel: string; url: string; confirmText: string; tone: "danger" | "plain"; tip: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="cr-act">
      <button type="button" className={tone === "danger" ? "cr-btn cr-btn-danger" : "cr-btn"} disabled={pending} title={tip}
        onClick={() => { if (!window.confirm(confirmText)) return; start(async () => { try { await post(url); setMsg(null); router.refresh(); } catch (e) { setMsg((e as Error).message); } }); }}>
        {pending ? busyLabel : label}
      </button>
      {msg && <span className="cr-err" role="alert">{msg}</span>}
    </span>
  );
}

export const KillSwitch = ({ id, agent }: { id: string; agent: string }) => (
  <ActionButton label="Revoke" busyLabel="Revoking…" url={`/api/mandates/${encodeURIComponent(id)}/revoke`} tone="danger"
    confirmText={`Revoke the ${agent} mandate? The agent is refused at accept and again at execution until a new mandate is issued.`}
    tip="Kill switch: stops this agent from spending immediately" />
);
export const Reissue = ({ id, agent }: { id: string; agent: string }) => (
  <ActionButton label="Re-issue" busyLabel="Issuing…" url={`/api/mandates/${encodeURIComponent(id)}/reissue`} tone="plain"
    confirmText={`Issue a fresh ${agent} mandate with the same limits? The revoked one stays in the audit trail.`}
    tip="Restores the agent with the same caps; the revoked mandate stays on record" />
);
export const ResetDemo = () => (
  <ActionButton label="Reset demo" busyLabel="Resetting…" url="/api/control/reset" tone="plain"
    confirmText="Expire all open offers? No load, PayPal call, webhook, receipt or ledger row is changed."
    tip="Safe reset: expires open offers only, so a scenario can be run again. Money records are never touched." />
);
