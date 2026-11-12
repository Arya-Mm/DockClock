"use client";
// Landing hero: a dock sign whose wait clock runs and re-prices live. The dollar figure is engine output
// (chargeForDwell on the demo contract), never a hard-coded number.
import { useEffect, useState } from "react";
import { chargeForDwell } from "@dockclock/core/holdSizer";
import type { AccessorialContract } from "@dockclock/core/settlement";

const START_MIN = 116; // just before free time ends, so billing visibly starts within seconds
const SIM_SEC_PER_TICK = 20; // simulated seconds per real second

export function WaitSign({ contract }: { contract: AccessorialContract }) {
  const [sec, setSec] = useState(START_MIN * 60);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setSec((s) => (s >= 6 * 3600 ? START_MIN * 60 : s + SIM_SEC_PER_TICK)), 1000);
    return () => clearInterval(t);
  }, []);
  const min = Math.floor(sec / 60);
  const cents = chargeForDwell(min, contract);
  const free = Math.max(0, contract.freeTimeMin - min);
  const hh = String(Math.floor(sec / 3600)), mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0"), ss = String(sec % 60).padStart(2, "0");
  return (
    <figure className="lp-sign" aria-label="Example dock wait clock">
      <div className="lp-sign-top"><span>Door 4</span><span>Joliet Grocery DC</span></div>
      <div className="lp-sign-clock">{hh}:{mm}<small>:{ss}</small></div>
      <div className="lp-sign-row">
        <span>{free > 0 ? `${free} min of free time left` : "Detention is running"}</span>
        <b>${(cents / 100).toFixed(2)}</b>
      </div>
      <div className="lp-sign-foot">Held on PayPal. Paid at the gate.</div>
      <figcaption className="lp-cap">Simulated clock. Priced by the settlement engine: ${(contract.ratePerIncrementCents / 100).toFixed(2)} per {contract.incrementMin} min after {contract.freeTimeMin / 60} h free.</figcaption>
    </figure>
  );
}
