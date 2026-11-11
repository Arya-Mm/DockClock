"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { centsToPayPal } from "@dockclock/core/ledger";

type Facility = { id: string; name: string };
type Hold = { holdCents: number; explanation: string; predictedP90DwellMin: number };
type Op = { operation: string; status: string; requestId: string; debugId: string | null; paypalId: string | null; amountCents: number | null };
type LoadView = { load: { id: string; state: string; authorizationId: string | null; vaultId: string | null; holdCents: number | null; appointmentAt: string }; ops: Op[] };
type SettleResult = {
  plan: { action: string; captureCents: number; releasedCents: number; invoiceCents: number };
  steps: Array<{ step: { do: string }; status: string; debugId?: string | null; paypalId?: string; replayed?: boolean }>;
};

// Every money number on screen is engine output formatted by the same helper PayPal requests use.
const usd = (c: number) => `$${centsToPayPal(c)}`;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } });
  const j = await r.json();
  if (!r.ok) throw new Error(`${j.error?.code ?? r.status}: ${j.error?.message ?? ""}${j.error?.debugId ? ` (debug_id=${j.error.debugId})` : ""}`);
  return (j.data ?? j) as T;
}

interface PayPalSession { start(o: { presentationMode: string }, p: Promise<{ orderId: string }>): Promise<void> }
interface PayPalSdk {
  findEligibleMethods(o?: { currencyCode: string }): Promise<{ isEligible(m: string): boolean }>;
  createPayPalOneTimePaymentSession(o: { savePayment?: boolean; commit?: boolean; onApprove(d: { orderId: string }): Promise<void>; onCancel(): void; onError(e: unknown): void }): Promise<PayPalSession>;
}
declare global {
  interface Window { paypal?: { createInstance(o: Record<string, unknown>): Promise<PayPalSdk> } }
}

function loadSdk(): Promise<void> {
  if (window.paypal) return Promise.resolve();
  return new Promise((ok, bad) => {
    const s = document.createElement("script");
    // Doc: developer.paypal.com/docsai/payments/methods/paypal/sdk/js/v6/paypal-checkout
    s.src = "https://www.sandbox.paypal.com/web-sdk/v6/core";
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => bad(new Error("PayPal SDK failed to load"));
    document.head.appendChild(s);
  });
}

export function DispatchConsole({ facilities }: { facilities: Facility[] }) {
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [loadId, setLoadId] = useState<string | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [view, setView] = useState<LoadView | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [dwell, setDwell] = useState(195);
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<PayPalSession | null>(null);

  const say = useCallback((m: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 40)), []);
  const refresh = useCallback(async (id: string) => setView(await api<LoadView>(`/api/loads/${id}`)), []);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try { await fn(); } catch (e) { say(`ERROR ${(e as Error).message}`); } finally { setBusy(false); }
  };

  const dispatch = run(async () => {
    const appt = new Date(Date.now() - 6 * 3_600_000).toISOString(); // past appointment so simulated evidence fits
    const l = await api<{ id: string }>("/api/loads", { method: "POST", body: JSON.stringify({ facilityId, appointmentAt: appt }) });
    setLoadId(l.id);
    setOrderId(null);
    const h = await api<Hold>(`/api/loads/${l.id}/hold`);
    setHold(h);
    say(`dispatched ${l.id}; engine hold ${usd(h.holdCents)}`);
    await refresh(l.id);
  });

  const createHold = run(async () => {
    if (!loadId) return;
    const r = await api<{ mode: string; orderId: string; authorizationId?: string; debugId: string | null }>(`/api/loads/${loadId}/hold`, { method: "POST", body: "{}" });
    say(`${r.mode} order ${r.orderId} debug_id=${r.debugId}${r.authorizationId ? ` auth=${r.authorizationId}` : ""}`);
    if (r.mode === "APPROVAL") setOrderId(r.orderId);
    await refresh(loadId);
  });

  // JS SDK v6: the payer approves the AUTHORIZE order once; approval vaults their wallet.
  useEffect(() => {
    if (!orderId || !loadId) return;
    let cancelled = false;
    setSessionReady(false);
    (async () => {
      await loadSdk();
      const { accessToken } = (await fetch("/api/paypal/client-token").then((r) => r.json())) as { accessToken: string };
      const sdk = await window.paypal!.createInstance({ clientToken: accessToken, components: ["paypal-payments"], pageType: "checkout" });
      // Doc: developer.paypal.com/docsai/sdk/js/v6 "Set up JavaScript SDK v6" (findEligibleMethods({ currencyCode }))
      const elig = await sdk.findEligibleMethods({ currencyCode: "USD" });
      if (!elig.isEligible("paypal")) { say("PayPal not eligible in this browser"); return; }
      // Doc: developer.paypal.com/sdk/js/reference: savePayment=true vaults during purchase; commit=false shows
      // "Continue" because this is an AUTHORIZE hold, not an immediate payment.
      sessionRef.current = await sdk.createPayPalOneTimePaymentSession({
        savePayment: true,
        commit: false,
        onApprove: async ({ orderId: approved }) => {
          const a = await api<{ authorizationId: string; vaultId: string | null; vaultStatus: string | null; debugId: string | null }>(
            `/api/paypal/orders/${approved}/authorize`, { method: "POST", body: JSON.stringify({ loadId }) });
          say(`AUTHORIZED ${a.authorizationId} debug_id=${a.debugId} vault=${a.vaultId ?? a.vaultStatus ?? "none"}`);
          setOrderId(null);
          await refresh(loadId);
        },
        onCancel: () => say("payer cancelled"),
        onError: (e) => say(`SDK error ${String(e)}`),
      });
      if (!cancelled) { setSessionReady(true); say("PayPal button ready"); }
    })().catch((e) => say(`ERROR ${(e as Error).message}`));
    return () => { cancelled = true; };
  }, [orderId, loadId, refresh, say]);

  const approve = () => {
    if (!sessionRef.current || !orderId) return;
    // Do not await before start(): the SDK needs the click as transient user activation.
    sessionRef.current.start({ presentationMode: "auto" }, Promise.resolve({ orderId })).catch((e) => say(`ERROR ${String(e)}`));
  };

  const evidence = run(async () => {
    if (!loadId || !view) return;
    const appt = Date.parse(view.load.appointmentAt);
    for (const [kind, off] of [["ARRIVAL", 0], ["DEPARTURE", dwell]] as const) {
      await api(`/api/loads/${loadId}/evidence`, { method: "POST", body: JSON.stringify({
        source: "ELD_GEOFENCE", kind, utcAt: new Date(appt + off * 60_000).toISOString(), confidence: 1, citation: `sim ELD ${kind}` }) });
    }
    say(`evidence: arrival at appointment, departure +${dwell}m (simulated clock)`);
    await refresh(loadId);
  });

  const settle = run(async () => {
    if (!loadId) return;
    const r = await api<SettleResult>(`/api/loads/${loadId}/settle`, { method: "POST" });
    say(`plan ${r.plan.action}: capture ${usd(r.plan.captureCents)}, release ${usd(r.plan.releasedCents)}, invoice ${usd(r.plan.invoiceCents)}`);
    for (const s of r.steps) say(`  ${s.step.do} ${s.status}${s.paypalId ? ` id=${s.paypalId}` : ""}${s.debugId ? ` debug_id=${s.debugId}` : ""}${s.replayed ? " (replayed)" : ""}`);
    await refresh(loadId);
  });

  const voidIt = run(async () => {
    if (!loadId) return;
    const r = await api<{ debugId: string | null }>(`/api/loads/${loadId}/void`, { method: "POST" });
    say(`VOID debug_id=${r.debugId}`);
    await refresh(loadId);
  });

  const state = view?.load.state;
  const btn = "rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-40";
  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Facility
          <select className="ml-2 rounded border px-2 py-1" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <button className={btn} disabled={busy} onClick={dispatch}>1. Dispatch load</button>
        <button className={btn} disabled={busy || state !== "DISPATCHED"} onClick={createHold}>2. Create hold</button>
        {orderId && <button className="rounded bg-[#ffc439] px-3 py-2 text-sm font-semibold disabled:opacity-40" disabled={!sessionReady} onClick={approve}>Approve with PayPal</button>}
      </section>

      {hold && (
        <section className="rounded border p-3 text-sm">
          <div className="font-medium">Engine hold: {usd(hold.holdCents)} (P90 dwell {hold.predictedP90DwellMin}m)</div>
          <p className="text-neutral-600">{hold.explanation}</p>
        </section>
      )}

      <section className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Simulated dwell (min)
          <input type="number" className="ml-2 w-20 rounded border px-2 py-1" value={dwell} onChange={(e) => setDwell(Number(e.target.value))} />
        </label>
        <button className={btn} disabled={busy || state !== "AUTHORIZED"} onClick={evidence}>3. Arrive + depart</button>
        <button className={btn} disabled={busy || state !== "DEPARTED"} onClick={settle}>4. Settle</button>
        <button className={btn} disabled={busy || state !== "AUTHORIZED"} onClick={voidIt}>Void hold</button>
      </section>

      {view && (
        <section className="rounded border p-3 text-sm">
          <div>Load <b>{view.load.id}</b> state <b>{view.load.state}</b>
            {view.load.authorizationId && <> · auth {view.load.authorizationId}</>}
            {view.load.vaultId && <> · vault {view.load.vaultId}</>}
          </div>
          <table className="mt-2 w-full text-xs">
            <thead><tr className="text-left"><th>op</th><th>status</th><th>amount</th><th>paypal id</th><th>debug_id</th></tr></thead>
            <tbody>
              {view.ops.map((o) => (
                <tr key={o.requestId}>
                  <td>{o.operation}</td><td>{o.status}</td><td>{o.amountCents != null ? usd(o.amountCents) : ""}</td>
                  <td>{o.paypalId}</td><td className="font-mono">{o.debugId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <pre className="h-64 overflow-auto rounded bg-neutral-950 p-3 text-xs text-green-300">{log.join("\n")}</pre>
    </div>
  );
}
