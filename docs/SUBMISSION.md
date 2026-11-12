# DockClock: submission kit

## Devpost draft

**Title:** DockClock

**Tagline:** A PayPal authorization hold is a spending mandate for an AI agent.

**Inspiration.** Drivers are detained at 39.3% of stops (ATRI 2024). 94.5% of fleets bill detention, but fewer than half of those invoices get paid. Detention is a small, disputed charge that arrives weeks late. We wanted the money held before the truck arrives, measured fairly, and paid before the driver leaves the gate.

**What it does.** At dispatch, DockClock sizes and places a PayPal authorization hold. At the dock it measures the wait from evidence: geofence, gate system, driver check-in and BOL photo. Agents negotiate fixes for a jam: slot swaps, facility credits, a guaranteed wait or a TONU release. The settlement engine then captures, pays the driver out, invoices anything above the hold, nets carrier-owed costs, and assembles a dispute defence pack. Every money number comes from code, not from a model.

**How we built it.**
- **Stack:** a Next.js 16 monorepo with a pure TypeScript settlement engine (integer cents) and Prisma on Neon Postgres. PayPal sandbox via REST for writes, with a stage-scoped PayPal-Request-Id on every call, and the APIMatic PayPal Server SDK for reads.
- **Agents:** Gemini free tier for the agents and vision, always behind a mandate guard and a hash-chained agent ledger.
- **Surfaces:** AG Grid Enterprise and AG Studio for the ops cockpit and analytics, a Bryntum Scheduler dock board, and Channel3 for parts search.
- **Hosting:** a free Render Blueprint.

**Challenges.**
- Keeping LLMs away from money while still letting agents act. Our answer: typed action menus, engine pricing, and guard verdicts logged in a hash chain.
- Webhooks that arrive late or twice: deduped by event id and only allowed to move state forward.
- Holds that outlive PayPal's 3-day honour period.
- Doing all of it on free tiers.

**Accomplishments.**
- Real sandbox captures, payouts and dispute evidence, each with its debug_id.
- A review cell in AG Grid whose approval fires a real capture.
- A red-team suite: injected "$900" text, stale or tampered offers, over-mandate purchases and revoked mandates are all blocked.
- Receipts anyone can verify against the ledger.

**What's next.** PayPal Multiparty with the carrier as payee of record, FMCSA carrier verification, real ELD integrations, facility appointment APIs, and an EU version without overcapture.

**Built with:**
- PayPal: Orders v2 (authorize, capture, vault), Payments v2 (capture, void, reauthorize, refund), Payouts v1, Invoicing v2, Disputes, Webhooks, Transaction Search, PayPal Server SDK (APIMatic).
- Sponsor tools and AI: AG Grid Enterprise, AG Charts, AG Studio, Bryntum Scheduler, Channel3, Render, Gemini.
- Core stack: Next.js, React, TypeScript, Prisma, Neon Postgres, Zod.

## Video shot list (2:55, record from judge mode)
Start every shot from `/judge`, signed in once at `/ops`. Captions on, no music.

| t | URL / action | Voiceover (about 150 wpm) |
|---|---|---|
| 0:00 | `/judge` header | "Drivers are detained at 39% of stops. Fewer than half of detention bills get paid." |
| 0:12 | Title card | "A PayPal hold is a mandate. Give it to an agent." |
| 0:18 | `/dispatch`: create a load, size the hold, approve in the sandbox popup | "The model sizes the hold from dwell history. The payer approves once." |
| 0:38 | `/dock`: hover a live bar, show the break-even line; drag a bar to show the re-price | "Agents negotiate a swap. Code sets every price." |
| 1:05 | `/dock`: send the swap offer; `/judge` scenario 7 shows the capture and payout `debug_id`s | "Accepted. Settled in seconds." |
| 1:20 | `/sim/<id>`: exit the geofence; `/driver/<id>` shows the paid amount and Proof-of-Wait | "Paid before the gate." |
| 1:35 | `/cockpit`: Review tab, approve a row (real capture); Agents tab; `/dashboard`: ask the analyst a question | "The operations view." |
| 2:05 | `/judge` red-team table: BLOCKED and ESCALATED rows | "It can't be tricked into spending." |
| 2:25 | `/judge` scenarios 3 and 6: overage and dispute evidence | "And it defends its own deals." |
| 2:45 | Architecture card: README diagram, "hosted, open source, judge mode" | — |

Thumbnail ideas: (1) a dock-board bar crossing the red break-even line; (2) a phone showing "Paid at the gate"; (3) the red-team table with BLOCKED in red.
