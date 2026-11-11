# DECISIONS (Phase 0)

Assumptions made, and places where the plan is likely wrong. PLAN.md still wins; each item is open to override.

## Stack
1. **Boilerplate used.** `paypaldev/hackathon-paypal-ag-grid-boilerplate` (Next 16.3.6, React 19.2, AG Grid 36.2, AG Studio 3.0) is the base of `apps/web`. It fits PLAN §3 exactly. Its CLAUDE.md/AGENTS.md rules (read `node_modules/next/dist/docs` before writing Next code) are kept in `apps/web/AGENTS.md`.
2. **AG Grid Enterprise added** (`ag-grid-enterprise@36.2.0`). The boilerplate ships only Community; PLAN §7.1 needs row grouping, pivot, set filters, master/detail, sparklines.
3. **AG Studio 3.0 → 3.1 available.** The licence page lists 3.1.0. Upgrade in Phase 5 after reading AG Grid AI skills; not done now to keep the boilerplate green.
4. **Prisma 6, not 7.** Prisma 7 requires driver adapters + `prisma.config.ts`; under deadline the stable v6 path is lower risk. The `package.json#prisma` deprecation warning is expected.
5. **paypal.ts moved to `packages/paypal`;** `packages/core/src/paypal.ts` is a re-export shim (relative path, so no core→paypal package dependency cycle).
6. **Core exports TypeScript source** (`exports: ./src/*.ts`), compiled by Next `transpilePackages` and by `tsx` elsewhere. No build step.

## LLM
7. **Provider = Google Gemini free tier** (`LLM_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.8-flash`). `gemini-2.5-flash` is closed to new users (404). The plan names no provider. Agents must stay provider-agnostic (Phase 3) so Anthropic/OpenAI can be swapped by env.
8. **AG Studio assistant** in the boilerplate uses an OpenAI adapter. Gemini exposes an OpenAI-compatible endpoint; Phase 5 will try it before asking for an OpenAI key.
9. Gemini returned one transient 503 during setup → A6 (cached "replay" fallback) is load-bearing, not optional.

## PayPal
10. **Sandbox merchant must be US.** The first app was on an IN sandbox business account (no overcapture, INR rules). A new app `DockClock` was created on a US business account; the IN app must not be used.
11. **Webhook id deferred to Phase 2** (needs a public URL; plan: Render URL or a tunnel).

## Data
12. **Facility coordinates are synthetic, city-level** (`packages/db/src/seed.ts`). Core's `FACILITIES` has no lat/lng. All seeded rows carry `synthetic=true` (D10).
13. **Append-only enforced by DB triggers** (migration `20261111000100_append_only`) on EvidenceEvent, Plan, AgentAction; WebhookEvent may only set `processedAt` once (M9).
14. **Load.stopSeq** added now for T13 (multi-stop) though the plan key is `loadId:stopSeq`; ids stay per stop.

## Places the plan may be wrong
15. **§3 says "/judge six scenarios"; §8 says eight.** Building eight (§8 is more specific).
16. **§3 lists "Next.js 16" while PLAN §7.5 wants an APIMatic SDK for reads.** Two PayPal clients (REST for writes, SDK for reads) means two auth caches; acceptable but noted.
17. **Render free tier vs D1.** $50 credit covers a paid web instance + worker + Postgres to Dec 21 only if sized small (starter). Verify pricing in Phase 6.
18. **Skills with no verifiable source:** "Spec-Driven Development (/spec,/plan)" and "Grill Me". Not installed (SKILLS.md rule 3). Using `writing-plans` (Superpowers) for /plan and `requesting-code-review` + ecc `security-reviewer` for adversarial review instead. Needs your OK or real links.

## Environment
19. **Docker Desktop fails to start** (`dockerInference` socket file locked). Migrations are generated offline; DB connect/migrate/seed unverified until Docker works (reboot or `wsl --shutdown`).
