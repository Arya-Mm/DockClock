// Records one 1920x1080 .webm per video shot (docs/SUBMISSION.md shot list) for editing.
// Usage: BASE_URL=http://localhost:3000 OPS_KEY=... npx tsx scripts/record-shots.ts [shotName]
// Read-only except 09-dispatch, which runs one real sandbox load end to end (vaulted hold, no PayPal popup).
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, renameSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/video/raw";
const size = { width: 1920, height: 1080 };
const pause = (p: Page, ms: number) => p.waitForTimeout(ms);
// Plain-string script: tsx would inject helpers into a function passed to evaluate().
const smoothScroll = (p: Page, px: number, ms: number) => p.evaluate(`new Promise((done) => { const y0 = scrollY, t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / ${ms}); scrollTo(0, y0 + ${px} * (0.5 - Math.cos(Math.PI * k) / 2)); if (k < 1) requestAnimationFrame(step); else done(); };
  requestAnimationFrame(step); })`);

const SHOTS: Record<string, (p: Page) => Promise<void>> = {
  "01-landing": async (p) => { await p.goto("/"); await pause(p, 9000); await smoothScroll(p, 1700, 6000); await pause(p, 1500); },
  "02-judge": async (p) => { await p.goto("/judge"); await pause(p, 2500); await smoothScroll(p, 2400, 12000); await pause(p, 1000); },
  "03-dock": async (p) => {
    await p.goto("/dock"); await p.waitForSelector(".b-sch-event", { timeout: 30000 }); await pause(p, 3000);
    const bar = p.locator(".b-sch-event").first(); await bar.hover(); await pause(p, 3500);
    const b = await bar.boundingBox();
    if (b) { // drag preview only: the panel appears, then "Put it back"
      await p.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2); await p.mouse.down();
      await p.mouse.move(b.x + b.width * 0.6 + 160, b.y + b.height / 2, { steps: 40 }); await p.mouse.up(); await pause(p, 4500);
      await p.getByRole("button", { name: "Put it back" }).click().catch(() => {}); await pause(p, 2000);
    }
  },
  "04-cockpit": async (p) => {
    await p.goto("/cockpit"); await pause(p, 4000);
    for (const tab of ["Review", "Agents", "Reconciliation", "Ledger"]) {
      await p.getByRole("tab", { name: new RegExp(tab, "i") }).or(p.getByRole("button", { name: new RegExp(`^${tab}`, "i") })).first().click({ timeout: 3000 }).catch(() => {});
      await pause(p, 3500);
    }
  },
  "05-dashboard": async (p) => { await p.goto("/dashboard"); await pause(p, 10000); },
  "06-redteam": async (p) => { await p.goto("/judge"); await pause(p, 1500); await p.locator("#rt").scrollIntoViewIfNeeded(); await pause(p, 7000); },
  "07-health": async (p) => { await p.goto("/health"); await pause(p, 5000); },
  "09-dispatch": async (p) => {
    await p.goto("/dispatch"); await pause(p, 3000);
    for (const name of ["1. Dispatch load", "2. Create hold", "3. Arrive + depart", "4. Settle"]) {
      const b = p.getByRole("button", { name }); await b.hover(); await pause(p, 1200);
      await b.click(); await p.waitForFunction((n) => ![...document.querySelectorAll("button")].find((x) => x.textContent === n && x.disabled === false && n === "1. Dispatch load") || true, name);
      await pause(p, name === "4. Settle" ? 9000 : 5000);
    }
    await smoothScroll(p, 700, 4000); await pause(p, 2000);
  },
  "08-control": async (p) => {
    await p.goto("/control"); await pause(p, 4000);
    for (const sel of [".cr-kpis > div:nth-child(1)", ".cr-kpis > div:nth-child(5)", ".cr-seg", "section[aria-labelledby=md] .cr-btn-danger"]) { await p.locator(sel).first().hover().catch(() => {}); await pause(p, 2200); }
    await smoothScroll(p, 900, 4000); await pause(p, 2000);
  },
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv[2];
  const browser = await chromium.launch();
  for (const [name, run] of Object.entries(SHOTS)) {
    if (only && name !== only) continue;
    const ctx = await browser.newContext({ baseURL: BASE, viewport: size, recordVideo: { dir: OUT, size } });
    if (process.env.OPS_KEY) await ctx.request.post(`${BASE}/api/ops/login`, { data: { key: process.env.OPS_KEY } }); // sets the dc_ops cookie
    const page = await ctx.newPage();
    try { await run(page); } catch (e) { console.error(name, (e as Error).message); }
    const video = page.video();
    await ctx.close();
    if (video) renameSync(await video.path(), `${OUT}/${name}.webm`);
    console.log("recorded", name);
  }
  await browser.close();
}
main();
