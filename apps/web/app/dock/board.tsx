"use client";
// Bryntum Scheduler (Community tier, free): resources = dock doors, events = trucks. Client-only (Bryntum needs the DOM).
import "@bryntum/scheduler-community/scheduler.css";
import "@bryntum/scheduler-community/svalbard.css";
import { useEffect, useMemo, useRef } from "react";
import { BryntumScheduler } from "@bryntum/scheduler-react-community";
import type { EventModel } from "@bryntum/scheduler-community";
import type { DockBoard, DockEvent } from "@/lib/server/dock";

// Colour = settlement state (the legend in dock-app.tsx uses the same map).
export const STATE_COLOR: Record<string, string> = {
  DISPATCHED: "#8A9199", AWAITING_PAYER: "#8A9199", AUTHORIZED: "#2F6FB2", AT_FACILITY: "#D98E04", DEPARTED: "#6A4FB3",
  NEEDS_REVIEW: "#C2410C", SETTLING: "#0E7490", CAPTURED: "#0F766E", PAID_OUT: "#00573F", VOIDED: "#6B7280",
  INVOICED_SPILLOVER: "#9D174D", DISPUTED: "#B91C1C",
};
export const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Row = DockEvent & { eventColor: string; draggable: boolean; resizable: boolean };
const row = (e: DockEvent): Row => ({ ...e, eventColor: STATE_COLOR[e.state] ?? "#8A9199", draggable: e.atDock && !e.synthetic, resizable: false });

export default function Board({ board, frozenId, onDrop }: { board: DockBoard; frozenId: string | null; onDrop: (id: string, endMs: number) => void }) {
  const ref = useRef<BryntumScheduler>(null);
  // Axis and first data are fixed at mount; live updates move bars inside it.
  const axis = useMemo(() => ({ start: new Date(board.serverNowMs - 20 * 3_600_000), end: new Date(board.serverNowMs + 6 * 3_600_000), visible: { date: new Date(board.serverNowMs + 3_600_000), block: "end" as const } }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const initialEvents = useMemo(() => board.events.map(row), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live updates set fields in place, so Bryntum animates a door change (agent-accepted swap) instead of redrawing.
  // Clearing frozenId (revert) re-applies the server position to the dragged bar.
  useEffect(() => {
    const s = ref.current?.instance;
    if (!s || s.isDestroyed) return;
    const store = s.eventStore, seen = new Set<string>();
    for (const e of board.events) {
      seen.add(e.id);
      if (e.id === frozenId) continue; // the dragged bar waits for confirm or revert
      const rec = store.getById(e.id) as EventModel | undefined;
      const r = row(e);
      if (rec) rec.set({ ...r, startDate: new Date(e.startDate), endDate: new Date(e.endDate) });
      else store.add(r);
    }
    store.remove((store.records as EventModel[]).filter((r) => !seen.has(String(r.id))));
  }, [board, frozenId]);

  return (
    <BryntumScheduler
      ref={ref}
      startDate={axis.start}
      endDate={axis.end}
      viewPreset="hourAndDay"
      height="100%"
      visibleDate={axis.visible}
      rowHeight={56}
      barMargin={8}
      eventStyle="filled"
      columns={[{ text: "Door", field: "name", width: 110 }]}
      resources={board.doors}
      events={initialEvents}
      eventDragFeature={{ constrainDragToResource: false }}
      eventDragCreateFeature={false}
      eventEditFeature={false}
      eventMenuFeature={false}
      scheduleMenuFeature={false}
      eventTooltipFeature={{
        template: ({ eventRecord }: { eventRecord: EventModel }) => {
          const e = eventRecord as unknown as Row;
          return `<b>${escape(e.id)}</b> · ${escape(e.carrierName)}<br>${e.state}${e.synthetic ? " (synthetic)" : ""}<br>` +
            `Dwell ${e.dwellMin} min · detention ${usd(e.chargeCents)}<br>Break-even ${e.breakEvenMin} min (TONU ${usd(e.tonuCents)})` +
            (e.swapped ? "<br>Door assigned by an accepted swap" : "") + (e.draggable ? "<br>Drag to preview a new release time" : "");
        },
      }}
      eventRenderer={({ eventRecord }: { eventRecord: EventModel }) => {
        const e = eventRecord as unknown as Row;
        const children: object[] = [{ tag: "span", className: e.atDock ? "dk-ev-name dk-ev-live" : "dk-ev-name", text: `${e.carrierName} · ${usd(e.chargeCents)}` }];
        // Break-even line: the dwell where detention equals the TONU fee, as a share of this bar.
        if (e.dwellMin > 0 && e.breakEvenMin <= e.dwellMin) children.push({ tag: "i", className: "dk-be", style: { left: `${(e.breakEvenMin / e.dwellMin) * 100}%` } });
        if (e.synthetic) children.push({ tag: "span", className: "dk-syn", text: "synthetic" });
        return children;
      }}
      onAfterEventDrop={({ eventRecords, valid }: { eventRecords: EventModel[]; valid: boolean }) => {
        const r = eventRecords[0];
        if (valid && r?.endDate) onDrop(String(r.id), new Date(r.endDate as Date).getTime());
      }}
    />
  );
}
