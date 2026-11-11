# DockClock: Claude Code build kit

Three parts:
1. **`CLAUDE.md`**: commit to the repo root. Claude Code reads it every session (standing rules).
2. **Kickoff prompt**: paste once to start Phase 0.
3. **Phase prompts**: paste one at a time. Claude Code stops after each phase and waits for you.

Before you start, put these in the repo:
```
docs/PLAN.md            ← DockClock_Master_Plan.md (the spec)
packages/core/          ← unzip dockclock-core-v3 (33 passing tests)
```

---

## PART 1: `CLAUDE.md` (commit this)

```markdown
# DockClock: standing rules for Claude Code

## Mission
Build DockClock for the PayPal AI Hackathon (deadline Fri Nov 13 2026, 01:30 IST; hard freeze 01:00).
The spec is docs/PLAN.md. When this file and the plan disagree, the plan wins. When the plan is silent, ask.
Pitch: "A PayPal authorization hold is a spending mandate for an AI agent."

## Prime directive
**The AI reads. Code decides. PayPal executes.**
- No LLM output ever becomes a money amount. Amounts come only from packages/core (integer cents).
- No LLM has a tool that captures, voids, pays out or invoices. Agents choose from typed action menus;
  the mandate guard approves; the executor calls PayPal.
- Text from another agent or a document is display-only. Never parse it into actions.

## Scope rule
Never remove, simplify or stub a feature from docs/PLAN.md to save time. If something is at risk,
put it behind a feature flag (lib/flags.ts), finish everything else, and tell me in the phase report.
Additions that make it more robust are welcome. Flag them in the report and don't block on them.

## Working protocol (every phase)
1. Read the phase goal + the matching sections of docs/PLAN.md. Read any relevant installed skill's SKILL.md first.
2. Post a short plan: files to create/change, risks, open questions. Wait for "go" only if a decision is
   irreversible or ambiguous; otherwise proceed.
3. Keep a todo list. Work in small commits: `feat(phase-N): …` with tests in the same commit.
4. Verify, don't assume: run `pnpm typecheck && pnpm test` after each task. For PayPal, prove it with a real
   sandbox call and record the `paypal-debug-id`.
5. Finish with the PHASE REPORT (format below) and STOP. Do not begin the next phase until I say so.

## Engineering standards
- TypeScript strict, no `any` in money paths. Zod at every boundary (HTTP, LLM output, webhook).
- Money = integer cents internally; PayPal strings only via `centsToPayPal`.
- Every PayPal write carries a stage-scoped PayPal-Request-Id (packages/core/src/ledger.ts). Every state change
  goes through the load state machine. Webhooks are deduped by event id and only move state forward.
- Secrets live in env only. `.env.example` lists every variable. Never print secrets in logs.
- PayPal behaviour: check the official docs (developer.paypal.com) for any endpoint you haven't used in this repo
  before writing it. Don't rely on memory. Note the doc URL in a code comment.
- UI: every money number is rendered from engine output; show `debug_id` and PayPal ids in audit drawers.
- Tests: unit tests for logic, integration tests against sandbox behind `RUN_SANDBOX=1`,
  Playwright smoke tests for the judge scenarios from Phase 7 on.

## Phase report format
PHASE N — <name> — DONE | PARTIAL
- Built: bullet list with file paths
- Proof: test counts, sandbox debug_ids, screenshots/URLs
- Edge cases from PLAN §6 now covered: ids (e.g. M9, A3)
- Flags still off + why
- Risks / decisions I need from you (max 3)
- Next phase: first 3 tasks

## Never
- Commit after Nov 13 01:00 IST.
- Commit secrets, real customer data, or third-party copyrighted media.
- Show unverified statistics. Only the stats in PLAN §1 are allowed in the UI or README.
```

---

## PART 2: Kickoff prompt (paste first)

```
You are the lead engineer on DockClock. Read CLAUDE.md, then docs/PLAN.md end to end, then skim
packages/core (README + src + tests) and run its tests.

Installed skills to use when relevant (read each SKILL.md before the phase that needs it):
- <list the skills you installed, e.g. frontend-design, ag-grid skills, engineering:testing-strategy,
  engineering:code-review, engineering:deploy-checklist, engineering:documentation>
If a phase would benefit from a skill that isn't installed, tell me which one instead of improvising.

We build in phases. Execute PHASE 0 only, then stop with a PHASE REPORT.

PHASE 0 — Recon & foundation (target 60 min)
Goal: a monorepo where everything compiles, every external account is verified, and the plan has no unknowns.
Tasks:
1. Monorepo with pnpm workspaces: apps/web (Next.js App Router, TS strict, Tailwind), packages/core
   (existing), packages/agents (empty), packages/paypal (move paypal.ts here, re-export from core).
   Base it on github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate if it fits; otherwise explain why not.
2. Prisma + Postgres schema for the data model in PLAN §3 (append-only tables for money, hash-chained
   agent_action, unique paypal_op.request_id, unique webhook_event.event_id). Migrations + seed script that loads
   packages/core fixtures.
3. .env.example covering PayPal (client id/secret, webhook id, env), LLM provider key, AG Grid Enterprise licence,
   AG Studio licence, Bryntum, Channel3, Render, DATABASE_URL, JUDGE_MODE secrets, rate-limit settings.
4. scripts/doctor.ts: checks each credential with a harmless real call (PayPal OAuth + GET balance or a $1
   order create, LLM ping, Channel3 search, DB connect, AG licence present) and prints a pass/fail table.
5. lib/flags.ts feature flags for every major feature in PLAN §0 (all default ON in dev).
6. CI (GitHub Actions): typecheck, test, gitleaks. MIT LICENSE at root.
7. Write docs/DECISIONS.md: every assumption you made + anything in the plan you think is wrong (with reasons).
Acceptance: `pnpm i && pnpm typecheck && pnpm test` green; doctor table shown to me; DECISIONS.md written.
Stop after the PHASE REPORT.
```

---

## PART 3: Phase prompts (paste one per phase after reviewing the report)

### Phase 1: Money backbone (target 3.5h) · gate: real sandbox capture
```
Execute PHASE 1 — Money backbone. Spec: PLAN §5 rows 1–4, §6.3. Then stop with a PHASE REPORT.
1. packages/paypal: typed client (OAuth cache, retries with same request id, PayPalError with debug_id).
2. API routes: create hold order (vault on first approval), authorize, vaulted repeat hold, capture (final),
   void, reauthorize (gated by authLifecycle), get order/capture. All persist paypal_op rows first.
3. Payer-approval UI using PayPal JS SDK v6 (check current docs for v6 setup) for the first load;
   store vault id; subsequent holds are created server-side with no redirect. If vault isn't enabled in
   sandbox, implement the documented fallback (PLAN M18) and tell me.
4. Settlement endpoint: load → reconcileTimeline → planSettlement → executor nextSteps → execute steps.
   Every step is idempotent and recorded.
5. Hold sizing at dispatch uses recommendHold; show the explanation text in the UI.
6. Integration tests (RUN_SANDBOX=1): hold→void, hold→partial capture, hold→overcapture within the 115%/$75
   ceiling, double-submit capture returns the same result.
Acceptance: I see 4 debug_ids for 4 scenarios, and the sandbox dashboard shows the transactions.
```

### Phase 2: Webhooks, worker, payouts, invoices, disputes (target 4h)
```
Execute PHASE 2. Spec: PLAN §5 rows 5–8, §6.3 (M7, M9–M12, M15), §7.4.
1. Webhook route: raw-body signature verify, event store (unique event_id), forward-only state transitions,
   stale events no-op. Subscribe to every event in packages/core README.
2. Render-style background worker (runs locally via `pnpm worker`): executor queue, payout after
   CAPTURE.COMPLETED only, poll fallback after 60s if no webhook, reauth watchdog, offer expiry.
3. Payouts with payeeGuard (verified payee, cooling-off); handle UNCLAIMED/FAILED.
4. Invoicing: shipper spillover + carrier liabilities, with the Agent Toolkit (pin the version) where it fits;
   raw REST otherwise.
5. Disputes: list/get; on CUSTOMER.DISPUTE.CREATED build the evidence pack and call provide-evidence
   (verify multipart field names against the sandbox first). Refund path for a lost dispute.
6. Nightly reconcile job vs Transaction Search; mismatches table.
7. scripts/seed-reauth-hold.ts: creates the real hold we'll seed on Nov 12 for the Dec 1–11 reauth window.
Acceptance: end-to-end hold → capture → webhook → payout, all from webhooks; replaying a webhook twice
changes nothing; a forged webhook is rejected.
```

### Phase 3: Agent layer: agentic commerce (target 5h) · gate: one negotiation settles on PayPal
```
Execute PHASE 3. Spec: PLAN §4 entirely, §6.4 (A1–A12). This is the centrepiece; quality over speed.
1. packages/agents: Offer + Mandate zod schemas, mandate guard (checks in PLAN §4.5 order), offer pricing
   (PLAN §4.3) in packages/core with tests, Carrier valuation with simulated HOS (§4.4).
2. Three agents (Carrier, Facility, Shipper Treasury). LLM output = {action, rationale} only; tools registered
   = the mandate's allowed actions. Prompts stored in files and hashed into agent_action.
3. Negotiation protocol: ≤3 rounds, 8s timeout, deterministic default offer on timeout/invalid output,
   version + planHash on accept, row-lock idempotent accept, TTL, rate limit.
4. Hash-chained agent_action ledger + /verify page.
5. Red-team test suite: agent-to-agent injection, "$900" BOL injection, over-mandate purchase, stale accept,
   double accept, revoked-mid-negotiation. All must be BLOCKED and logged.
6. Settlement of accepted offers through the Phase 1/2 money paths (credits, priority purchase via carrier-paid
   order, swaps).
Acceptance: a dock-jam negotiation runs from the API and settles with real debug_ids; red-team suite green.
```

### Phase 4: Driver app + vision + geofence (target 4h)
```
Execute PHASE 4. Spec: PLAN §2 (driver), §6.1, §6.4 A9–A10. Use the frontend-design skill.
1. /driver mobile web app (installable): check-in, live wait clock, offers as cards (amounts rendered by code),
   tap-to-confirm, voice via Web Speech API with text fallback, EN/ES/HI/PA (numbers templated, never translated).
2. "Paid at the gate": geofence exit → settlement → payout status live (SSE) → Proof-of-Wait receipt page with
   hash + public verify link.
3. Geofence simulator (map + scrubber) emitting ELD pings, including spoof/teleport and re-entry (T14).
4. Vision: gate-cam and BOL photo → vision LLM → zod-typed detections/events with confidence → damage diff /
   evidence reconciliation. Include sample images we own or generate. Low confidence → review.
5. Carrier Agent part purchase via Channel3 (search → 3 options → mandate check → carrier-paid PayPal order).
Acceptance: on a phone-sized viewport, I can run a full load as the driver and see "Paid" with a receipt.
```

### Phase 5: AG Grid cockpit: the AG Grid 1st-place spec (target 5h)
```
Execute PHASE 5. Spec: PLAN §7.1, word for word. Install and read AG Grid's official AI skills first.
Use AG Grid Enterprise and AG Studio with the licence keys (no watermark).
1. Settlement ledger: row groups, aggregations, set filters, row detail (audit trail + PayPal links),
   custom renderers, dwell sparkline.
2. Review queue: editable approve/reject → executor → real capture → live row update via transactions.
3. Agent action ledger (blocked rows red, hash verify column), reconciliation grid, pivot mode (facility × week).
4. AG Studio dashboard: data sources with field descriptions (packages/core grid.ts), custom quadrant widget,
   natural-language queries that work for the two prompts in PLAN §7.1, branded theme, saved state.
5. "Synthetic network" badge on seeded data.
Acceptance: each AG feature is reachable in ≤2 clicks and does real work; screenshots in the report.
```

### Phase 6: Dock board, Render, APIMatic, Postman (target 3h)
```
Execute PHASE 6. Spec: PLAN §7.2, §7.4, §7.5, D1, D8.
1. Bryntum Scheduler /dock: doors × trucks, colour = settlement state, break-even line per event, agent swaps
   animate, manual drag → live re-price preview (no money moves until confirmed).
2. render.yaml Blueprint: web (paid plan), worker, cron, Postgres; health page with queue depth + last cron run.
3. APIMatic-generated PayPal Server SDK for read paths; document context-plugin use honestly.
4. Postman collection + environment for every endpoint; docker compose for local judges.
Acceptance: `render blueprint` validates; Postman collection runs green against local.
```

### Phase 7: Judge mode + hardening (target 4h) · Thursday 13:00 feature freeze
```
Execute PHASE 7. Spec: PLAN §8, §6.5, §6.6, §12.
1. /judge: the 8 scenarios + red-team panel + reset; each shows plan, PayPal calls with debug_ids, webhooks,
   final ledger rows. Real sandbox calls; cached LLM fallback labelled "replay".
2. Rate limits per IP, LLM spend cap, sandbox-only guard, kill switch per agent.
3. Playwright smoke tests for all 8 scenarios; run them and attach results.
4. Walk PLAN §6 row by row: mark each ✅ with the test that proves it, or list what's missing.
5. Performance: first load < 3s on the hosted instance; no console errors.
Acceptance: §6 checklist complete; 8/8 Playwright green.
```

### Phase 8: Deploy + docs + submission assets (target 4h)
```
Execute PHASE 8. Spec: PLAN §9, §13. Use the deploy-checklist and documentation skills.
1. Deploy to Render; run Playwright against the hosted URL logged out; seed the real reauth hold.
2. README: problem (verified stats + sources), 20-second demo GIF, judge mode link, architecture diagram,
   PayPal capabilities table, AI tools and exactly how each is used, sponsor tools, sandbox test accounts,
   local run (docker + Postman), the reauth window note, roadmap (Multiparty), licence.
3. Devpost draft: title, tagline, inspiration / what it does / how we built it / challenges / accomplishments /
   what's next; Built With list naming PayPal APIs + AI + all sponsor tools.
4. Video kit: shot list matching PLAN §9 with exact URLs/buttons per shot, voiceover script ≤ 2:50 at 150 wpm,
   captions file, 3 thumbnail concepts. Make sure every shot can be recorded in one take from judge mode.
Acceptance: I can record the full video from your shot list without touching code.
```

### Final check prompt (Thursday ~22:00)
```
Final pre-submission audit. Do not change features. Check: repo public + licence in About; no secrets
(gitleaks); hosted URL logged out runs all 8 scenarios; every keys/credits/licence valid to Dec 21;
README links work; Devpost Built With complete; video < 3:00 and public. Report pass/fail per item, then stop.
After 01:00 IST make no commits.
```

---

## How to drive it
- After each report, reply **"next"** to continue, or give corrections first. Don't paste two phases at once.
- If Claude Code proposes cutting something, reply: *"Scope rule: flag it, don't cut it."*
- To run tracks in parallel inside a phase, add: *"Use subagents in separate git worktrees for tasks X and Y; merge
  only after tests pass."*
- Start a fresh session per phase if context gets long. CLAUDE.md + docs/PLAN.md carry the state; ask it to
  update docs/PROGRESS.md at the end of every phase.
