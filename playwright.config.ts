import { defineConfig } from "@playwright/test";

// Judge-scenario smoke tests (PLAN §8). BASE_URL=https://<service>.onrender.com runs them against the hosted app.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/report" }]],
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
});
