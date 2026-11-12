// AG Studio Agent Framework on the free Gemini tier. One analyst agent instead of Studio's five (no delegation
// round-trips), a turn cap, and answer-first instructions keep a question to a handful of model calls.
// The key stays on the server (/api/ai/gemini), which also paces calls under the free per-minute quota (F4 cap applies).
import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter } from 'ag-studio';
import { geminiAdapter } from './gemini-adapter';

// PLAN §7.1: the two natural-language queries shown live.
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Facilities leaking money', prompt: 'Which facilities leak the most money this month?' },
  { label: 'Blocked agent actions', prompt: 'Show blocked agent actions by reason.' },
];

const INSTRUCTIONS = `You are the DockClock analyst inside an AG Studio dashboard about truck detention paid through PayPal.
Data sources: ledger (one row per truck stop; leakageUsd = money claimed but not captured), facilities (scorecard),
agentActions (AI agent moves; verdict BLOCKED/ESCALATED with a reason).
Work in as few steps as possible (this runs on a small free quota):
1. Call view_schema only if you do not know the field ids. Field ids look like ledger.leakageUsd.
2. Answer with ONE execute_query. Grouping goes in "axes" (a top-level "dimensions" key is ignored and returns one total row).
   Leakage by facility:
   {"query":{"kind":"apiQuery","variant":"aggregation","axes":[{"dimensions":[{"field":{"id":"ledger.facilityName"}}]}],"measures":[{"field":{"id":"ledger.leakageUsd","aggregation":"sum"}}],"sort":[{"field":{"id":"ledger.leakageUsd","aggregation":"sum"},"direction":"desc"}],"limit":10}}
   Blocked agent actions by reason:
   {"query":{"kind":"apiQuery","variant":"aggregation","axes":[{"dimensions":[{"field":{"id":"agentActions.reason"}}]}],"measures":[{"field":{"id":"agentActions.seq","aggregation":"count"}}],"filter":{"field":{"id":"agentActions.verdict"},"operator":"equals","value":"BLOCKED"}}}
   "This month" = the latest month in ledger.appointment; if that filter is awkward, answer over all rows and say so.
3. Then reply in two or three short sentences with the top results and their amounts. Never invent numbers: quote query results only.`;

export function buildAi(models: string[]): AgAiHarnessSetup {
  const adapter = geminiAdapter();
  return ({ api }) => createAiHarness(api as unknown as Parameters<typeof createAiHarness>[0], ({ tools }) => ({
    agents: [directLlmRunner({
      id: 'analyst',
      name: 'DockClock analyst',
      description: 'Answers questions about the DockClock ledger, facilities and agent actions.',
      adapter,
      maxTurns: 8,
      instructions: () => INSTRUCTIONS,
      tools: () => [
        tools.studio.viewSchema(), tools.studio.viewReport(), tools.studio.viewPage(), tools.studio.executeQuery(),
        // No add/position widget: Studio's add_widget creates an unconfigured (empty) chart; the report already has the charts.
        tools.studio.createExpression(),
      ],
    })],
    primary: 'analyst',
    promptStarters: PROMPT_STARTERS,
    models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
  }));
}
