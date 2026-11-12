// Free-tier worker: Render background workers and cron jobs are paid, so the web service runs the worker loop itself
// (same jobs as `pnpm worker`). A free scheduler (.github/workflows/cron.yml) also hits /api/cron/tick, which wakes a
// sleeping free instance and runs a tick. Turn off with RUN_WORKER_IN_WEB=0 when a real worker runs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.RUN_WORKER_IN_WEB === "0") return;
  if (process.env.NODE_ENV !== "production" && process.env.RUN_WORKER_IN_WEB !== "1") return; // dev: run `pnpm worker` yourself
  const { tick } = await import("./lib/server/jobs");
  const ms = Number(process.env.WORKER_TICK_MS ?? 15_000);
  const loop = () => void tick().catch((e: unknown) => console.error(JSON.stringify({ msg: "in-web worker tick failed", error: (e as Error).message })));
  setTimeout(loop, 5_000); // let the server finish booting first
  setInterval(loop, ms).unref();
  console.log(JSON.stringify({ msg: "in-web worker started", tickMs: ms }));
}
