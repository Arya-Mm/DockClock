import type { Metadata } from "next";
import { FACILITIES } from "@dockclock/core";
import { DispatchConsole } from "./dispatch-console";
import { OpsShell } from "../ops-shell";

export const metadata: Metadata = { title: "Dispatch | DockClock" };

export default function DispatchPage() {
  return (
    <OpsShell active="/dispatch" title="Dispatch" sub="Book a load, place the PayPal hold, run the wait, settle. Every amount comes from the engine; PayPal sandbox only.">
      <DispatchConsole facilities={FACILITIES.map((f) => ({ id: f.id, name: f.name }))} />
    </OpsShell>
  );
}
