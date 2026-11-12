import { requireDriver, snapshot } from "@/lib/server/driver";

export const dynamic = "force-dynamic";
const TICK_MS = 2_000;

/** Server-sent events: pushes the driver snapshot whenever it changes (payout status goes live without a reload). */
export async function GET(req: Request, ctx: RouteContext<"/api/driver/[id]/stream">) {
  const { id } = await ctx.params;
  const denied = requireDriver(req, id);
  if (denied) return denied;
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(ctrl) {
      let last = "";
      const tick = async () => {
        try {
          const s = await snapshot(id);
          const key = JSON.stringify({ ...s, serverNowMs: 0 });
          if (key !== last) { last = key; ctrl.enqueue(enc.encode(`data: ${JSON.stringify(s)}\n\n`)); }
          else ctrl.enqueue(enc.encode(": keep-alive\n\n"));
        } catch { ctrl.enqueue(enc.encode("event: error\ndata: {}\n\n")); }
      };
      void tick();
      timer = setInterval(() => void tick(), TICK_MS);
      req.signal.addEventListener("abort", () => { clearInterval(timer); try { ctrl.close(); } catch { /* already closed */ } });
    },
    cancel() { clearInterval(timer); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
