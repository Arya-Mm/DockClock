import { dockBoard } from "@/lib/server/dock";
import { requireOpsPage } from "@/lib/server/ops-page";
import { DockApp } from "./dock-app";

export const dynamic = "force-dynamic";
export const metadata = { title: "DockClock dock board" };

/** Facility dock board (PLAN §7.2): Bryntum Scheduler, doors x trucks, live via SSE. */
export default async function DockPage({ searchParams }: { searchParams: Promise<{ facility?: string }> }) {
  await requireOpsPage("/dock");
  const { facility } = await searchParams;
  return <DockApp initial={await dockBoard(facility ?? null)} />;
}
