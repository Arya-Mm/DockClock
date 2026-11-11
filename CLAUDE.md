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
5. Before each phase, read SKILLS.md, install any skill listed for that phase that isn't installed yet, and read its SKILL.md before writing code.
6. Finish with the PHASE REPORT (format below) and STOP. Do not begin the next phase until I say so.

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
- Skills used: <skill> → <effect>; skill instructions ignored + why
- Risks / decisions I need from you (max 3)
- Next phase: first 3 tasks

## Never
- Commit after Nov 13 01:00 IST.
- Commit secrets, real customer data, or third-party copyrighted media.
- Show unverified statistics. Only the stats in PLAN §1 are allowed in the UI or README.
