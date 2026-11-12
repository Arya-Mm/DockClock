import { test, expect, type Page } from "@playwright/test";

const SCENARIOS = ["Early driver + old dent", "Reefer wait + door-open spike", "Over the hold: overcapture + invoice", "Six-day customs delay",
  "Spoofed GPS + injected BOL", "Shipper disputes the charge", "Dock jam negotiation", "Carrier buys a missing strap (Channel3)"];
// What the engine must decide for scenarios 1-6 (money is never moved by this page).
const PLAN: Record<number, RegExp> = { 1: /Engine plan:\s*VOID/, 2: /Engine plan:\s*CAPTURE/, 3: /Engine plan:\s*CAPTURE_AND_INVOICE/, 4: /REAUTHORIZE/, 5: /HOLD_FOR_REVIEW|MANUAL_REVIEW/, 6: /Engine plan:/ };

const errorsOf = (page: Page) => { const errs: string[] = []; page.on("pageerror", (e) => errs.push(e.message)); return errs; };

test("judge mode loads without errors and lists all 8 scenarios", async ({ page }) => {
  const errs = errorsOf(page);
  await page.goto("/judge");
  await expect(page.getByRole("heading", { name: "DockClock judge mode" })).toBeVisible();
  for (const [i, title] of SCENARIOS.entries()) await expect(page.getByRole("heading", { name: `${i + 1}. ${title}` })).toBeVisible();
  expect(errs).toEqual([]);
});

for (const [i, title] of SCENARIOS.entries()) {
  const n = i + 1;
  test(`scenario ${n}: ${title}`, async ({ page }) => {
    await page.goto("/judge");
    const card = page.locator("li.jg-card").filter({ has: page.getByRole("heading", { name: `${n}. ${title}` }) });
    await expect(card).toBeVisible();
    if (PLAN[n]) await expect(card).toContainText(PLAN[n]);
    // Either real sandbox rows with a debug_id, or an honest note that this one has not run live.
    const live = card.locator(".jg-live");
    await expect(live).toContainText(/Latest real sandbox calls|Not run live|by design/);
    if (await live.locator("tbody tr").count()) await expect(live.locator("tbody tr").first().locator("code").last()).not.toBeEmpty();
    await expect(card.getByRole("link", { name: /Try it/ })).toHaveAttribute("href", /^\//);
  });
}

test("red-team panel shows refused agent actions", async ({ page }) => {
  await page.goto("/judge");
  const rt = page.locator("section").filter({ has: page.getByRole("heading", { name: /Red team/ }) });
  await expect(rt.locator("tbody tr").first()).toContainText(/BLOCKED|ESCALATED/);
});

test("health endpoint reports queue and worker", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(j.ok).toBe(true);
  expect(typeof j.queue.total).toBe("number");
});
