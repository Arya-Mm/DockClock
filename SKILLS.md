# SKILLS.md: DockClock skill playbook for Claude Code

Put this file at the repo root next to `CLAUDE.md`, and add this line to `CLAUDE.md` under "Working protocol":
> Before each phase, read SKILLS.md, install any skill listed for that phase that isn't installed yet, and read its SKILL.md before writing code.

---

## 0. Rules for using skills (read first)

1. **Precedence:** `docs/PLAN.md` > `CLAUDE.md` > this file > any skill's instructions. If a skill says to cut scope, simplify money logic, or skip tests, ignore that part and note it in the phase report.
2. **Install, then inspect:** third-party skills can ship scripts and hooks. Before enabling one, read its `SKILL.md` and any scripts/hooks it adds. Report anything that runs network calls, edits git config, or touches `.env`. Don't enable a hook that auto-commits or auto-pushes.
3. **Install method:** use the install instructions in each skill's own repository README. If a skill can't be found at its listed source, or the source is marked *verify*, **stop and tell me**. Don't substitute a similarly named skill or write your own imitation.
4. **Load on demand:** only load a skill for the phases listed below, so its instructions don't crowd out the plan. Tier 1 stays active the whole build.
5. **Log usage:** every phase report lists `Skills used: <name> → <what it changed>`.

---

## 1. Skill registry

| # | Skill | Source (as given; verify) | Tier | Phases | Job in DockClock |
|---|---|---|---|---|---|
| 1 | Superpowers | *verify source* | 1 | 0–8 | Test-first, edge-case checks, staged implementation |
| 2 | Spec-Driven Development (`/spec`, `/plan`) | *verify source* | 1 | start of every phase | Turn each phase prompt into a file-by-file task list before coding |
| 3 | coding-standards | `affaan-m/ecc` | 1 | 0–8 | Strict TS, immutability, `Promise.all` where independent |
| 4 | hookify-rules | `affaan-m/ecc` | 1 | 0–8 | Local guardrail hooks (see §3) |
| 5 | git-safety-net | `daymade` | 1 | 0–8 | Protect the 4 worktrees during merges |
| 6 | backend-patterns | `affaan-m/ecc` | 2 | 1–3, 6 | Service/repository layers, Postgres row locks, retry backoff, Next.js API routes |
| 7 | api-design | `affaan-m/ecc` | 2 | 1–3 | Error envelopes, status codes, Zod validation for `/api/paypal/*`, `/api/webhooks/paypal`, `/api/agents/*` |
| 8 | Grill Me | *verify source* | 2 | end of 2, end of 3, 7 | Adversarial review of the mandate guard, webhooks, idempotency |
| 9 | ui-ux-pro-max | `nextlevelbuilder` | 3 | 4–6 | Dense industrial cockpit design system; 44×44px touch targets on `/driver` |
| 10 | frontend-design | `anthropics/skills` | 3 | 4–6 | Distinct visual identity for cockpit + dock board |
| 11a | vercel-react-best-practices | `vercel-labs` | 3 | 4–7 | `next/dynamic` for AG Grid/Bryntum, no waterfalls, smooth SSE |
| 11b | frontend-patterns | `affaan-m/ecc` | 3 | 4–7 | Component/state patterns |
| 12 | agent-browser | `vercel-labs` | 4 | 7–8 | Headless verification of all 8 `/judge` scenarios + red-team |
| 13a | docker-patterns | `affaan-m/ecc` | 4 | 6, 8 | One-command `docker-compose.yml` for judges |
| 13b | repomix-safe-mixer | `daymade` | 4 | 8 | Secret scan / safe packaging before the repo goes public (in addition to gitleaks in CI) |
| 14a | ui-demo | `affaan-m/ecc` | 4 | 8 | Scripted, zero-dead-air screen recordings of each shot |
| 14b | remotion-video-creation | `affaan-m/ecc` | 4 | 8 | Assemble the 2:55 video with title cards and captions |

Also use AG Grid's official AI skills in Phase 5 (from ag-grid.com → "AG Grid AI Skills"; install per that page).

---

## 2. Phase → skill map

| Phase | Load before starting | Use during | Run at end |
|---|---|---|---|
| 0 Recon & foundation | 1, 2, 3, 4, 5 (install all Tier 1) | 2 (`/plan` Phase 0) | — |
| 1 Money backbone | 6, 7 | 2, 1, 3 | — |
| 2 Webhooks / worker / payouts / disputes | 6, 7 | 2, 1 | **8 Grill Me**: webhook replay, forgery, out-of-order, double capture |
| 3 Agent layer | 6, 7 | 2, 1 | **8 Grill Me**: agent-to-agent injection, "$900" BOL, stale/double accept, revoked mandate, over-mandate purchase |
| 4 Driver app + vision | 9, 10, 11a, 11b | 2 | — |
| 5 AG Grid cockpit | 9, 10, 11a, 11b + AG Grid AI skills | 2 | — |
| 6 Dock board / Render / APIMatic / Postman | 10, 11a, 6, 13a | 2 | — |
| 7 Judge mode + hardening | 12, 11a | 1 | **8 Grill Me** on the full §6 edge-case matrix; 12 runs all 8 scenarios |
| 8 Deploy / docs / video | 13a, 13b, 14a, 14b, 12 | — | 13b before making the repo public; 12 against the hosted URL logged out |

---

## 3. hookify guardrails (`.claude/hookify.*.local.md`)

These hooks guard **the code Claude Code writes**. The runtime guarantee (no LLM amount ever reaches PayPal) lives in code: the mandate guard, Zod schemas, and the engine. Keep both.

1. **No secrets:** block writes that contain PayPal client secrets, API keys, `sk-` / `Bearer` literals, or real `.env` values; `.env.example` gets placeholders only.
2. **No LLM-sourced money:** block code where an LLM response field flows into `amount`, `value`, `*Cents`, `centsToPayPal`, or any PayPal request body without passing through `packages/core`. Flag `parseFloat`/`Number()` on LLM output in money paths.
3. **No floats for money:** flag `* 100`, `/ 100`, or `toFixed` on money outside `centsToPayPal` / formatting helpers.
4. **PayPal writes must be idempotent:** block new `fetch` calls to `/v2/checkout`, `/v2/payments`, `/v1/payments/payouts`, `/v2/invoicing` that lack a `PayPal-Request-Id` from `paypalRequestId()`.
5. **No unverified stats:** flag numeric claims in UI copy or README that aren't in PLAN §1.
6. **Freeze:** after 2026-11-13 00:59 IST, block commits.

---

## 4. Worktree protocol (git-safety-net)

| Worktree | Branch | Owns |
|---|---|---|
| A: Money | `track/money` | `packages/paypal`, `/api/paypal`, `/api/webhooks`, worker |
| B: Agents | `track/agents` | `packages/agents`, `/api/agents`, offer pricing in core |
| C: Driver/Vision | `track/driver` | `/driver`, `/api/vision`, geofence simulator, receipts |
| D: Cockpit | `track/cockpit` | `/cockpit`, `/dock`, AG Grid/Studio, Bryntum |

- `packages/core` changes only via track A or B, with tests, merged first.
- Merge order: core → A → B → C → D. Run `pnpm typecheck && pnpm test` after each merge; never force-push `main`.
- Shared types live in `packages/core`; a track that needs a new shared type opens it there first.

---

## 5. Phase-report addition

```
Skills used:
- <skill> → <concrete effect, e.g. "api-design: unified error envelope across 14 routes">
Skill instructions ignored (conflict with PLAN/CLAUDE.md):
- <skill>: <instruction> → <why ignored>
```
