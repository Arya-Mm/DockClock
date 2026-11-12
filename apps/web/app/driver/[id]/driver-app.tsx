"use client";
// Driver phone app. Every amount and time shown comes from the server snapshot (engine output) and is formatted by
// @dockclock/core/i18n, never by an LLM or a translation (A10). Voice only opens the confirmation card (A9).
import { useCallback, useEffect, useRef, useState } from "react";
import { t, fmtUsd, fmtInt, fmtClock, voiceIntent, LANGS, LANG_NAMES, SPEECH_TAGS, type Lang, type MsgKey } from "@dockclock/core/i18n";
import type { DriverSnapshot } from "@/lib/server/driver";

type Offer = NonNullable<DriverSnapshot["offer"]>;
interface SpeechRec { lang: string; interimResults: boolean; maxAlternatives: number; start(): void; stop(): void; onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null }
type SpeechCtor = new () => SpeechRec;

function readLang(): Lang {
  try { const v = localStorage.getItem("dc-lang"); return LANGS.includes(v as Lang) ? (v as Lang) : "en"; } catch { return "en"; }
}

export function DriverApp({ initial, driverKey }: { initial: DriverSnapshot; driverKey: string }) {
  const [s, setS] = useState(initial);
  const [lang, setLang] = useState<Lang>("en");
  const [offline, setOffline] = useState(false);
  const [confirming, setConfirming] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "warn" | "stop"; text: string } | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const q = `k=${encodeURIComponent(driverKey)}`;
  const base = `/api/driver/${encodeURIComponent(s.loadId)}`;

  useEffect(() => { setLang(readLang()); }, []);
  useEffect(() => {
    const es = new EventSource(`${base}/stream?${q}`);
    es.onmessage = (e) => { setOffline(false); setS(JSON.parse(e.data) as DriverSnapshot); };
    es.onerror = () => setOffline(true);
    return () => es.close();
  }, [base, q]);

  const L = useCallback((key: MsgKey, vars?: Record<string, string>) => t(key, lang, vars), [lang]);
  const changeLang = (l: Lang) => { setLang(l); try { localStorage.setItem("dc-lang", l); } catch { /* private mode */ } };

  async function post(path: string, body: unknown) {
    setBusy(true); setNotice(null);
    try {
      const r = await fetch(`${base}${path}?${q}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { data?: { status?: string; verdict?: { reasons?: string[] } }; error?: { message?: string } };
      if (!r.ok) setNotice({ tone: "stop", text: j.error?.message ?? j.data?.verdict?.reasons?.join("; ") ?? `Request failed (${r.status})` });
      return j.data;
    } catch { setNotice({ tone: "warn", text: L("offline") }); return undefined; }
    finally { setBusy(false); }
  }

  const checkIn = () => post("/checkin", { deviceAt: new Date().toISOString() });
  const decide = async (o: Offer, decision: "ACCEPT" | "DECLINE") => {
    setConfirming(null); setHeard(null);
    await post(`/offers/${encodeURIComponent(o.id)}`, { decision, version: o.version, planHash: o.planHash });
  };

  // Voice: the transcript only ever opens the confirmation card or declines; it never submits an accept (A9).
  function act(text: string, o: Offer) {
    setHeard(text);
    const intent = voiceIntent(text);
    if (intent === "ACCEPT") setConfirming(o);
    else if (intent === "DECLINE") void decide(o, "DECLINE");
    else setNotice({ tone: "warn", text: L("speak") });
  }
  function listen(o: Offer) {
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) { setNotice({ tone: "warn", text: L("typeInstead") }); return; }
    const rec = new Ctor();
    rec.lang = SPEECH_TAGS[lang]; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => act(e.results[0]?.[0].transcript ?? "", o);
    rec.onerror = () => setNotice({ tone: "warn", text: L("typeInstead") });
    rec.onend = () => setListening(false);
    recRef.current = rec; setListening(true); rec.start();
  }

  const zone = s.facility.zone;
  const atDock = s.state === "AT_FACILITY" || s.state === "AUTHORIZED";
  const settled = ["CAPTURED", "PAID_OUT", "INVOICED_SPILLOVER", "VOIDED"].includes(s.state);
  const freeLeft = s.freeTimeEndsMs === null ? null : Math.ceil((s.freeTimeEndsMs - s.serverNowMs) / 60_000);
  const o = s.offer;

  return (
    <main className="rd-wrap">
      <header className="rd-top">
        <span className="rd-brand">DockClock</span>
        <select className="rd-lang" value={lang} onChange={(e) => changeLang(e.target.value as Lang)} aria-label="Language">
          {LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
        </select>
      </header>

      {offline && <p className="rd-banner rd-banner-warn" role="status">{L("offline")}</p>}
      {notice && <p className={`rd-banner rd-banner-${notice.tone}`} role="alert">{notice.text}</p>}

      <section className="rd-sign" aria-live="polite">
        <div className="rd-sign-inner">
          <span className="rd-place">{L("waiting", { facility: s.facility.name })}</span>
          <div className="rd-clock">
            <span className="rd-clock-num">{s.waitedMin === null ? "--" : fmtInt(s.waitedMin)}</span>
            <span className="rd-clock-unit">{L("minutes")}</span>
          </div>
          {freeLeft !== null && freeLeft > 0 && !s.departureMs && <span className="rd-sign-line">{L("freeTimeLeft", { min: fmtInt(freeLeft) })}</span>}
          <span className="rd-sign-line">{L("earning", { amount: fmtUsd(s.detentionSoFarCents) })}</span>
          {s.holdCents !== null && <span className="rd-sign-line rd-muted">{L("holdReady", { amount: fmtUsd(s.holdCents) })}</span>}
        </div>
      </section>

      {s.state === "AUTHORIZED" && s.arrivalMs === null && (
        <button className="rd-btn rd-btn-go" onClick={checkIn} disabled={busy}>{L("checkIn")}</button>
      )}

      {o && atDock && (
        <section className="rd-offer" aria-label={L(`offerTitle_${o.kind}` as MsgKey)}>
          <h2>{L(`offerTitle_${o.kind}` as MsgKey)}</h2>
          <span className="rd-offer-amount">{L(o.carrierPays ? "youPay" : "youGet", { amount: fmtUsd(o.priceCents) })}</span>
          {o.door && o.slotStartMs !== null && <span className="rd-muted">{L("door", { door: o.door, time: fmtClock(o.slotStartMs, zone) })}</span>}
          <div className="rd-btn-row">
            <button className="rd-btn rd-btn-ghost" onClick={() => decide(o, "DECLINE")} disabled={busy}>{L("decline")}</button>
            <button className="rd-btn rd-btn-go" onClick={() => setConfirming(o)} disabled={busy}>{L("accept")}</button>
          </div>
          <div className="rd-voice">
            <button className="rd-btn rd-btn-ghost" onClick={() => listen(o)} disabled={busy || listening} aria-pressed={listening}>
              <MicIcon /> {L("speak")}
            </button>
            {heard && <span className="rd-muted">{L("heard", { text: heard })}</span>}
            <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { act(typed, o); setTyped(""); } }}>
              <label className="rd-muted" htmlFor="rd-typed">{L("typeInstead")}</label>
              <input id="rd-typed" className="rd-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" enterKeyHint="send" />
            </form>
          </div>
        </section>
      )}

      {s.departureMs !== null && !settled && <p className="rd-banner rd-banner-warn">{s.state === "NEEDS_REVIEW" ? L("review") : L("departed")}</p>}

      {settled && s.settlement && (
        <section className="rd-paid" aria-live="polite">
          {s.settlement.driverPayoutCents > 0 ? (
            <>
              <span className="rd-paid-amount">{fmtUsd(s.settlement.driverPayoutCents)}</span>
              <span>{s.payout.status === "PAID" ? L("paid", { amount: fmtUsd(s.settlement.driverPayoutCents) }) : L("paidPending", { amount: fmtUsd(s.settlement.driverPayoutCents) })}</span>
            </>
          ) : <span>{L("noDetention")}</span>}
          {s.receiptSlug && <a className="rd-link" href={`/r/${s.receiptSlug}`}>{L("receipt")}</a>}
        </section>
      )}

      {confirming && (
        <div className="rd-sheet-bg" role="dialog" aria-modal="true" aria-labelledby="rd-confirm-title" onClick={() => setConfirming(null)}>
          <div className="rd-sheet" onClick={(e) => e.stopPropagation()}>
            <h2 id="rd-confirm-title">{L("confirmTitle", { amount: fmtUsd(confirming.priceCents) })}</h2>
            <span>{L(`offerTitle_${confirming.kind}` as MsgKey)}</span>
            <button className="rd-btn rd-btn-go" onClick={() => decide(confirming, "ACCEPT")} disabled={busy} autoFocus>{L("confirmYes")}</button>
            <button className="rd-btn rd-btn-ghost" onClick={() => setConfirming(null)}>{L("confirmBack")}</button>
          </div>
        </div>
      )}
    </main>
  );
}

function MicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
