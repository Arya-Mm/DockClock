import type { Metadata } from "next";
import { FACILITIES } from "@dockclock/core";
import { DispatchConsole } from "./dispatch-console";

export const metadata: Metadata = { title: "Dispatch | DockClock" };

export default function DispatchPage() {
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Dispatch: dock-time hold</h1>
        <p className="text-sm text-neutral-500">PayPal sandbox. Hold size comes from the engine; the payer approves once, later holds come from the vault.</p>
      </header>
      <DispatchConsole facilities={FACILITIES.map((f) => ({ id: f.id, name: f.name }))} />
    </main>
  );
}
