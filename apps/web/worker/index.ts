// Standalone worker loop: pnpm worker (a Render Background Worker on a paid plan, or any always-on box).
// The free deploy runs the same jobs inside the web service instead (instrumentation.ts) plus a cron ping.
import { prisma } from "@dockclock/db";
import { tick } from "../lib/server/jobs";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 15_000);

if (process.argv.includes("--once")) {
  tick().then(() => prisma.$disconnect());
} else {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg: "worker started", tickMs: TICK_MS }));
  void tick();
  setInterval(() => void tick(), TICK_MS);
}
