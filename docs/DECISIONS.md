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

## Phase 1
20. **Database = Neon** (project rapid-pine-31151912, us-east-1) because local Docker Desktop fails to start. Pooled `DATABASE_URL` for the app, `DATABASE_URL_UNPOOLED` as Prisma `directUrl` for migrations. Neon skills + MCP installed project-scoped (OAuth, no API key in files).
21. **Vault during purchase works in sandbox** (vault `VAULTED` on first approval). M18 fallback not needed; kept documented.
22. **Relative imports are extensionless** in packages: Turbopack cannot map `./x.js` to `./x.ts`. tsc (Bundler) and tsx both resolve extensionless paths.
23. **Seed is batched** (`createMany`): about 2s per round trip from India to us-east-1 made per-row upserts take minutes.

## Phase 3 (agent layer)
24. **Who funds what.** WAIT_GUARANTEED and RELEASE_TONU are shipper-funded (captured from the PayPal hold at departure, approved by the Shipper Treasury Agent). SLOT_SWAP_WITH_CREDIT is facility-funded (paid to the carrier right away by Payout). PRIORITY_SLOT_PURCHASE and PART_PURCHASE are carrier-paid (a CAPTURE order the carrier approves in PayPal).
25. **Settle at departure, not at accept, for shipper-funded offers.** The state machine has no settlement before departure (T10). An accepted guarantee is locked and replaces metered detention in `settleLoad` (`applyAcceptedOffer`). Weak evidence still holds money for review.
26. **A guarantee pays even if the truck was late.** The agreed price replaces the meter, including a late-arrival waiver. That is the point of "guaranteed, no dispute later".
27. **planHash = sha256(load, kind, engine price, contract version, evidence count).** At accept, the engine re-prices the offer. If the price or the evidence moved, or a newer version exists, the accept is STALE. TTL is 120 s.
28. **Guard verdicts.** Per-action and daily cap failures are ESCALATED (a human may lift them); every other failure is BLOCKED. The Shipper Treasury LLM can only make a decision stricter (APPROVE or ESCALATE), never looser.
29. **The Facility Agent never proposes a shipper-funded offer above the hold's capture ceiling.** The guard would block it anyway.
30. **Hash chain.** Each agent_action hash is sha256(canonical JSON of prevHash plus row plus our own createdAt). Appends are serialised by a Postgres advisory lock. `/verify` and `GET /api/agents/verify` recompute the chain from genesis.
31. **Demo economics are synthetic.** Door-minute value $0.50, priority band $25–$60, swap lead 15 min, and the carrier HOS clock (`DEMO_CARRIER_CLOCK`). They are labelled as synthetic.
32. **LLM.** Gemini runs with an 8 s timeout. On a timeout, outage, bad JSON or an off-menu action, the deterministic default applies (A6). Prompt templates live in `packages/agents/src/prompts.ts`, and the full prompt is hashed into each row.

## Phase 4 (driver, vision, geofence)
33. **T13 multi-stop: one Load row per stop** (`stopSeq`; ids like `TRIP-S1`, `TRIP-S2`). Plans, PayPal request ids, evidence, receipts and payouts are all keyed by the stop row, so a 2-dock load produces two independent settlements. A tripId grouping is cockpit-only (Phase 5).
34. **T12 closed hours.** The contract's `pausedLocalWindows` are converted to UTC per day in the facility zone (DST-safe) and excluded from billable time. They are unioned with carrier delays, so an overlap is excluded once.
35. **Evidence uploads.** ELD pings and gate-cam images need the ops key (hardware or ops). The driver may upload only a BOL photo, which is weak evidence (confidence ≤0.6), so hardware wins (T6).
36. **Vision model `gemini-3.1-flash-lite`.** 3.8-flash was rate-limited (429/503) on the free tier. Boxes in pixels are rescaled; an inconsistent box makes the defect confidence 0 (review); there is one schema-retry round.
37. **Synthetic loads never consume a real mandate's daily budget** (red-team and seed data).
38. **Invoicing and refunds use raw REST, not the PayPal Agent Toolkit.** Every call has to go through `recorded()` with a stage-scoped PayPal-Request-Id; the toolkit hides the request id. Toolkit not added (BUILD_KIT Phase 2 allows "raw REST otherwise").
39. **A lost dispute is reversed by PayPal itself.** We record the reversal; recovering the carrier's share is a human step (notification).
