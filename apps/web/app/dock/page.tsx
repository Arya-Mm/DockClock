import { dockBoard } from "@/lib/server/dock";
import { requireOpsPage } from "@/lib/server/ops-page";
import { DockApp } from "./dock-app";
import { OpsShell } from "../ops-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "DockClock dock board" };

/** Facility dock board (PLAN §7.2): Bryntum Scheduler, doors x trucks, live via SSE. */
export default async function DockPage({ searchParams }: { searchParams: Promise<{ facility?: string }> }) {
  await requireOpsPage("/dock");
  const { facility } = await searchParams;
  return <OpsShell active="/dock" title="Dock board" sub="Doors and trucks, live. Colour is the settlement state; the red line is where detention would equal the TONU fee. Drag a truck at the door to re-price it."><DockApp initial={await dockBoard(facility ?? null)} /></OpsShell>;
}
