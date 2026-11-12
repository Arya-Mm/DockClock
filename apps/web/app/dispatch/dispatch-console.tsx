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
  // Step status: done once the load has moved past it, current when its button is live.
  const ORDER = ["DISPATCHED", "AWAITING_PAYER", "AUTHORIZED", "AT_FACILITY", "DEPARTED", "SETTLING", "CAPTURED", "PAID_OUT", "VOIDED", "INVOICED_SPILLOVER", "NEEDS_REVIEW", "DISPUTED"];
  const at = state ? ORDER.indexOf(state) : -1;
  const stepState = (doneFrom: number, live: boolean) => (at >= doneFrom ? "done" : live ? "current" : "locked");
  const steps = [
    { n: 1, t: "Dispatch load", d: "Create the load at the chosen dock.", s: stepState(0, !state),
      btn: <button className="op-btn op-btn-primary" disabled={busy} onClick={dispatch} title="Creates a real load for this facility">1. Dispatch load</button> },
    { n: 2, t: "Place the hold", d: "Engine sizes it; PayPal authorizes from the vault, or the payer approves once.", s: stepState(2, state === "DISPATCHED" || state === "AWAITING_PAYER"),
      btn: <>
        <button className="op-btn op-btn-primary" disabled={busy || state !== "DISPATCHED"} onClick={createHold} title="Places the PayPal authorization hold sized by the engine">2. Create hold</button>
        {orderId && <button className="op-btn op-btn-paypal" disabled={!sessionReady} onClick={approve} title="Opens PayPal so the payer approves the hold once">Approve with PayPal</button>}
      </> },
    { n: 3, t: "Truck waits", d: "Geofence and gate system report arrival and departure.", s: stepState(4, state === "AUTHORIZED"),
      btn: <>
        <label className="op-field" title="Simulated time between arrival and departure">Dwell <input type="number" min={0} max={720} value={dwell} onChange={(e) => setDwell(Number(e.target.value))} /> min</label>
        <button className="op-btn op-btn-primary" disabled={busy || state !== "AUTHORIZED"} onClick={evidence} title="Posts ELD + gate arrival and departure evidence">3. Arrive + depart</button>
        <button className="op-btn" disabled={busy || state !== "AUTHORIZED"} onClick={voidIt} title="Releases the hold: nothing is owed">Void hold</button>
      </> },
    { n: 4, t: "Settle", d: "Capture, pay the driver, invoice any spillover.", s: stepState(6, state === "DEPARTED"),
      btn: <button className="op-btn op-btn-primary" disabled={busy || state !== "DEPARTED"} onClick={settle} title="Runs the settlement plan against PayPal">4. Settle</button> },
  ];
  return (
    <div className="op-stack">
      <section className="op-card op-row">
        <label className="op-field" title="Dock where the truck is booked">Facility
          <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        {view && <span className="op-meta">Load <code>{view.load.id}</code> <span className={`op-tag op-s-${view.load.state}`}>{view.load.state.replaceAll("_", " ").toLowerCase()}</span>{busy && <span className="op-spin" aria-label="Working" />}</span>}
      </section>

      <ol className="op-steps">
        {steps.map((s) => (
          <li key={s.n} className={`op-step op-step-${s.s}`} aria-current={s.s === "current" ? "step" : undefined}>
            <div className="op-step-head"><span className="op-step-n" aria-hidden="true">{s.s === "done" ? "✓" : s.n}</span><div><b>{s.t}</b><p>{s.d}</p></div></div>
            <div className="op-step-act">{s.btn}</div>
          </li>
        ))}
      </ol>

      {hold && (
        <section className="op-card">
          <h2>Engine hold <span className="op-big">{usd(hold.holdCents)}</span></h2>
          <p className="op-mute">P90 dwell {hold.predictedP90DwellMin} min. {hold.explanation}</p>
        </section>
      )}

      {view && (
        <section className="op-card">
          <h2>PayPal calls for this load</h2>
          <p className="op-mute">{view.load.authorizationId && <>Authorization <code>{view.load.authorizationId}</code> </>}{view.load.vaultId && <>· vault <code>{view.load.vaultId}</code></>}</p>
          <table className="op-table">
            <thead><tr><th>Call</th><th>Status</th><th className="op-num">Amount</th><th>PayPal id</th><th>debug_id</th></tr></thead>
            <tbody>
              {view.ops.length === 0 && <tr><td colSpan={5} className="op-mute">No PayPal calls yet. Place the hold to start.</td></tr>}
              {view.ops.map((o) => (
                <tr key={o.requestId}>
                  <td>{o.operation}</td><td><span className={`op-tag op-t-${o.status}`}>{o.status.toLowerCase()}</span></td>
                  <td className="op-num">{o.amountCents != null ? usd(o.amountCents) : ""}</td><td><code>{o.paypalId}</code></td><td><code>{o.debugId}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="op-card">
        <h2>Event log</h2>
        <pre className="op-log" aria-live="polite">{log.length ? log.join("\n") : "Nothing yet. Dispatch a load to begin."}</pre>
      </section>
    </div>
  );
}
