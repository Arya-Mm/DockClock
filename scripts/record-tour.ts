// Detailed 1080p walkthrough recordings, one .webm per page, for the demo video.
// Adds a visible cursor and renders native `title` tooltips on screen (headless video shows neither otherwise),
// then hovers every sidebar item, card, button and tooltip target, and uses each control.
// Usage: BASE_URL=http://localhost:3000 OPS_KEY=... npx tsx scripts/record-tour.ts [page]
// Money: only the dispatch tour moves sandbox money (one vaulted hold, captured). Revoke is shown and re-issued at once.
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, renameSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/video/tour";
const size = { width: 1920, height: 1080 };

// Injected on every page: a cursor dot that follows the mouse, a click pulse, and an on-screen copy of `title` tooltips.
const OVERLAY = `(() => {
  if (window.__tour) return; window.__tour = 1;
  const css = document.createElement('style');
  css.textContent = '#__c{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid #fff;background:rgba(34,197,94,.55);box-shadow:0 0 0 2px rgba(0,0,0,.5);pointer-events:none;transition:transform .12s}#__c.d{transform:scale(.7);background:rgba(34,197,94,.95)}#__t{position:fixed;z-index:2147483646;max-width:420px;padding:8px 12px;border-radius:8px;background:#0f172a;color:#f8fafc;font:500 15px/1.4 system-ui,sans-serif;border:1px solid #334155;box-shadow:0 10px 30px rgba(0,0,0,.45);pointer-events:none;display:none}';
  document.documentElement.appendChild(css);
  const c = document.createElement('div'); c.id = '__c'; const t = document.createElement('div'); t.id = '__t';
  document.documentElement.append(c, t);
  addEventListener('mousemove', (e) => {
    c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px';
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[title]');
    const txt = el && el.getAttribute('title');
    if (txt) { t.textContent = txt; t.style.display = 'block'; t.style.left = Math.min(e.clientX + 18, innerWidth - 440) + 'px'; t.style.top = Math.min(e.clientY + 22, innerHeight - 80) + 'px'; } else t.style.display = 'none';
  }, true);
  addEventListener('mousedown', () => c.classList.add('d'), true); addEventListener('mouseup', () => c.classList.remove('d'), true);
})()`;

const wait = (p: Page, ms: number) => p.waitForTimeout(ms);
async function hover(p: Page, sel: string, ms = 1600, max = 30) {
  const els = p.locator(sel);
  const n = Math.min(await els.count(), max);
  for (let i = 0; i < n; i++) {
    const el = els.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    const b = await el.boundingBox(); if (!b) continue;
    await p.mouse.move(b.x + Math.min(b.width / 2, 60), b.y + b.height / 2, { steps: 22 });
    await wait(p, ms);
  }
}
async function click(p: Page, sel: string, ms = 2500) {
  const el = p.locator(sel).first();
  if (!(await el.isVisible().catch(() => false))) return false;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const b = await el.boundingBox(); if (!b) return false;
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 }); await wait(p, 500);
  await p.mouse.down(); await p.mouse.up(); await wait(p, ms);
  return true;
}
const scrollBy = (p: Page, px: number, ms: number) => p.evaluate(`new Promise((done) => { const y0 = scrollY, t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / ${ms}); scrollTo(0, y0 + ${px} * (0.5 - Math.cos(Math.PI * k) / 2)); if (k < 1) requestAnimationFrame(step); else done(); };
  requestAnimationFrame(step); })`);
const sidebar = (p: Page) => hover(p, "[data-sidebar=menu-button]", 1300);

const TOURS: Record<string, (p: Page) => Promise<void>> = {
  "01-landing": async (p) => {
    await p.goto("/"); await wait(p, 6000);
    await hover(p, ".lp-bar a, .lp-cta a", 1500); await hover(p, ".lp-sign", 6000, 1);
    for (let i = 0; i < 4; i++) { await scrollBy(p, 650, 2500); await wait(p, 1800); }
    await hover(p, ".lp-surfaces a", 1400);
  },
  "02-control": async (p) => {
    p.on("dialog", (d) => void d.accept());
    await p.goto("/control"); await wait(p, 4000);
    await sidebar(p);
    await hover(p, "main [data-slot=card][title]", 2200);
    await hover(p, "header [title], header button", 2000);
    await hover(p, "[role=img] span[title]", 1800, 8); await hover(p, "main ul li[title]", 1100, 12);
    await scrollBy(p, 600, 2500); await hover(p, "main table tbody tr td[title]", 1500, 6);
    await hover(p, "main .recharts-bar-rectangle", 1500, 6);
    await scrollBy(p, 700, 2500); await hover(p, "main button", 1700, 10);
    // Kill switch demo: revoke one mandate, then re-issue it (confirm dialogs accepted).
    if (await click(p, "button:has-text('Revoke')", 3500)) await click(p, "button:has-text('Re-issue')", 3500);
    await scrollBy(p, -2000, 3000); await click(p, "button:has-text('Reset demo')", 3000);
  },
  "03-dispatch": async (p) => {
    await p.goto("/dispatch"); await wait(p, 3000); await sidebar(p);
    await hover(p, "main [title]", 1500, 14);
    for (const name of ["1. Dispatch load", "2. Create hold", "3. Arrive + depart", "4. Settle"]) {
      await click(p, `button:has-text('${name}')`, name === "4. Settle" ? 9000 : 5500);
      await hover(p, ".op-step-current, .op-card table tbody tr", 900, 4);
    }
    await scrollBy(p, 900, 4000); await hover(p, ".op-table tbody tr", 1000, 8); await wait(p, 2000);
  },
  "04-dock": async (p) => {
    await p.goto("/dock"); await p.waitForSelector(".b-sch-event", { timeout: 30000 }); await wait(p, 3000);
    await hover(p, ".dk-legend li", 900); await hover(p, ".b-sch-event", 2600, 6);
    const b = await p.locator(".b-sch-event").first().boundingBox();
    if (b) {
      await p.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2, { steps: 20 }); await p.mouse.down();
      await p.mouse.move(b.x + b.width * 0.6 + 180, b.y + b.height / 2, { steps: 50 }); await p.mouse.up(); await wait(p, 5000);
      await hover(p, ".dk-preview button", 1800); await click(p, "button:has-text('Put it back')", 3000);
    }
    await p.selectOption("#facility", "F-SEA-07").catch(() => {}); await wait(p, 7000); await hover(p, ".b-sch-event", 2000, 4);
  },
  "05-cockpit": async (p) => {
    await p.goto("/cockpit"); await wait(p, 6000);
    for (const tab of ["Settlement ledger", "Review queue", "Agent actions", "Reconciliation", "Leakage pivot"]) {
      await click(p, `button:has-text('${tab}')`, 3500);
      await hover(p, ".ag-header-cell", 500, 8); await hover(p, ".ag-row .ag-cell", 700, 6);
    }
    await click(p, "button:has-text('Settlement ledger')", 2500); await click(p, ".ag-group-contracted", 3000); await hover(p, ".ag-row", 700, 8);
  },
  "06-analytics": async (p) => { await p.goto("/dashboard"); await wait(p, 12000); await hover(p, "button", 900, 12); await scrollBy(p, 800, 4000); await wait(p, 4000); },
  "07-judge": async (p) => {
    await p.goto("/judge"); await wait(p, 3000); await sidebar(p);
    const cards = p.locator("li.jg-card");
    for (let i = 0; i < (await cards.count()); i++) {
      const card = cards.nth(i); await card.scrollIntoViewIfNeeded(); await wait(p, 1200);
      const s = card.locator("summary"); if (await s.count()) { await s.first().click(); await wait(p, 2000); }
      const t = await card.locator(".jg-try").boundingBox(); if (t) { await p.mouse.move(t.x + 20, t.y + 10, { steps: 20 }); await wait(p, 1000); }
    }
    await p.locator("#rt").scrollIntoViewIfNeeded(); await wait(p, 4000);
  },
  "08-verify": async (p) => { await p.goto("/verify"); await wait(p, 3000); await hover(p, "main td[title]", 1400, 10); await scrollBy(p, 900, 4000); await wait(p, 2000); },
  "09-health": async (p) => { await p.goto("/health"); await wait(p, 3000); await hover(p, "main tr", 1100, 14); },
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv[2];
  const browser = await chromium.launch();
  for (const [name, run] of Object.entries(TOURS)) {
    if (only && name !== only) continue;
    const ctx = await browser.newContext({ baseURL: BASE, viewport: size, recordVideo: { dir: OUT, size } });
    await ctx.addInitScript(`addEventListener('DOMContentLoaded', () => { ${OVERLAY} })`);
    if (process.env.OPS_KEY) await ctx.request.post(`${BASE}/api/ops/login`, { data: { key: process.env.OPS_KEY } });
    const page = await ctx.newPage();
    try { await run(page); } catch (e) { console.error(name, (e as Error).message.split("\n")[0]); }
    const video = page.video();
    await ctx.close();
    if (video) renameSync(await video.path(), `${OUT}/${name}.webm`);
    console.log("recorded", name);
  }
  await browser.close();
}
main();
