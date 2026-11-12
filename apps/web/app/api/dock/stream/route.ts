import { requireOps } from "@/lib/server/http";
import { dockBoard } from "@/lib/server/dock";

export const dynamic = "force-dynamic";
const TICK_MS = 2_000;

/** Server-sent events for the Bryntum dock board: pushes the board whenever it changes (agent swaps move bars live). */
export async function GET(req: Request) {
  const denied = requireOps(req);
  if (denied) return denied;
  const facilityId = new URL(req.url).searchParams.get("facility");
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(ctrl) {
      let last = "", closed = false, busy = false;
      const send = (s: string) => { if (closed) return; try { ctrl.enqueue(enc.encode(s)); } catch { closed = true; } };
      const tick = async () => {
        if (closed || busy) return;
        busy = true; // a slow DB tick never overlaps the next one
        try {
          const b = await dockBoard(facilityId);
          const key = JSON.stringify({ ...b, serverNowMs: 0, events: b.events.map((e) => ({ ...e, endDate: e.atDock ? "" : e.endDate, dwellMin: e.atDock ? 0 : e.dwellMin, chargeCents: e.atDock ? 0 : e.chargeCents })) });
          if (key !== last) { last = key; send(`data: ${JSON.stringify(b)}\n\n`); } else send(": keep-alive\n\n");
        } catch { send("event: error\ndata: {}\n\n"); } finally { busy = false; }
      };
      void tick();
      timer = setInterval(() => void tick(), TICK_MS);
      req.signal.addEventListener("abort", () => { closed = true; clearInterval(timer); try { ctrl.close(); } catch { /* already closed */ } });
    },
    cancel() { clearInterval(timer); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
