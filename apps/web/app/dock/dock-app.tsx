"use client";
// Dock board shell: live SSE feed, legend, and the drag re-price panel. Money numbers come from the engine (server).
import "./dock.css";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { DockBoard } from "@/lib/server/dock";

const Board = dynamic(() => import("./board"), { ssr: false, loading: () => <div className="dk-loading">Loading dock board…</div> });
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const LEGEND = [["#D98E04", "At the door"], ["#2F6FB2", "Hold placed"], ["#C2410C", "Needs review"], ["#0F766E", "Captured"], ["#00573F", "Paid out"], ["#6B7280", "Voided"]] as const;

interface Preview { loadId: string; dwellMinBefore: number; dwellMinAfter: number; chargeCentsBefore: number; chargeCentsAfter: number; deltaCents: number; breakEvenMin: number; tonuCents: number; overBreakEven: boolean }

export function DockApp({ initial }: { initial: DockBoard }) {
  const [board, setBoard] = useState(initial);
  const [live, setLive] = useState<"live" | "reconnecting">("live");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [frozenId, setFrozenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const es = new EventSource(`/api/dock/stream?facility=${encodeURIComponent(initial.facilityId)}`);
    es.onmessage = (m) => { setLive("live"); try { setBoard(JSON.parse(m.data) as DockBoard); } catch { /* ignore a torn frame */ } };
    es.onerror = () => setLive("reconnecting"); // EventSource retries on its own
    return () => es.close();
  }, [initial.facilityId]);

  const revert = () => { setPreview(null); setFrozenId(null); };
  const onDrop = async (loadId: string, endMs: number) => {
    setFrozenId(loadId); setMsg(null);
    const r = await fetch("/api/dock/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loadId, endMs: Math.round(endMs) }) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.data) { revert(); setMsg(`Preview failed: ${j?.error?.message ?? r.status}. The bar went back.`); return; }
    setPreview(j.data as Preview);
  };
  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    // Confirm = offer the driver a slot swap. The engine prices it; the driver's agent accepts or declines. Nothing is captured here.
    const r = await fetch(`/api/loads/${encodeURIComponent(preview.loadId)}/offers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "SLOT_SWAP_WITH_CREDIT" }) });
    const j = await r.json().catch(() => null);
    setBusy(false); revert();
    const o = j?.data?.offer ?? j?.data;
    setMsg(r.ok ? `Swap offer sent to the driver${typeof o?.priceCents === "number" ? ` at ${usd(o.priceCents)}` : ""}. The bar moves to its new door when the driver accepts.` : `Not sent: ${j?.error?.message ?? r.status}`);
  };

  const atDock = board.events.filter((e) => e.atDock).length;
  return (
    <main className="dk-wrap">
      <header className="dk-head">
        <div>
          <h1>{board.facilityName}</h1>
          <p>{atDock} truck{atDock === 1 ? "" : "s"} at the doors, {board.events.length} on the board. <span className={live === "live" ? "dk-live" : "dk-reconnecting"}>{live === "live" ? "Live" : "Reconnecting"}</span></p>
        </div>
        <form className="dk-fac" method="get">
          <label htmlFor="facility">Facility</label>
          <select id="facility" name="facility" defaultValue={board.facilityId} onChange={(e) => e.currentTarget.form?.submit()}>
            {board.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </form>
      </header>
      <ul className="dk-legend" aria-label="Bar colour shows the settlement state">
        {LEGEND.map(([c, label]) => <li key={label}><i style={{ background: c }} />{label}</li>)}
        <li><i className="dk-be-key" />Break-even: detention equals the TONU fee</li>
      </ul>
      {msg && <p className="dk-msg" role="status">{msg}</p>}
      {preview && (
        <section className="dk-preview" aria-live="polite">
          <h2>Re-price preview for {preview.loadId}</h2>
          <p>Dwell {preview.dwellMinBefore} to {preview.dwellMinAfter} min. Detention {usd(preview.chargeCentsBefore)} to <b>{usd(preview.chargeCentsAfter)}</b> ({preview.deltaCents >= 0 ? "+" : "−"}{usd(Math.abs(preview.deltaCents))}).</p>
          {preview.overBreakEven && <p className="dk-warn">Past break-even ({preview.breakEvenMin} min): releasing the truck for TONU ({usd(preview.tonuCents)}) costs less.</p>}
          <p className="dk-note">Nothing is saved and no money moves until you send the offer.</p>
          <div className="dk-actions">
            <button type="button" onClick={confirm} disabled={busy}>{busy ? "Sending…" : "Send swap offer to driver"}</button>
            <button type="button" className="dk-secondary" onClick={revert} disabled={busy}>Put it back</button>
          </div>
        </section>
      )}
      <div className="dk-board"><Board board={board} frozenId={frozenId} onDrop={onDrop} /></div>
    </main>
  );
}
