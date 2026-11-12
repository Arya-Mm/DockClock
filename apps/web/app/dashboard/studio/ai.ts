// AG Studio Agent Framework wired to Gemini through this app's server route (key stays on the server, F4 spend cap applies).
import { createAiHarness, type AgAiHarnessSetup, type AgAiPromptStarter } from 'ag-studio';
import { geminiAdapter } from './gemini-adapter';

// PLAN §7.1: the two natural-language queries shown live.
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Facilities leaking money', prompt: 'Which facilities leak the most money this month?' },
  { label: 'Blocked agent actions', prompt: 'Show blocked agent actions by reason.' },
  { label: 'Summarise this page', prompt: 'Summarise what this page shows and what stands out.' },
];

export function buildAi(models: string[]): AgAiHarnessSetup {
  const adapter = geminiAdapter();
  // shortcut: 3.1 types the setup arg as the core API while createAiHarness wants the browser API; same object at runtime.
  return ({ api }) => createAiHarness(api as unknown as Parameters<typeof createAiHarness>[0], {
    adapter,
    promptStarters: PROMPT_STARTERS,
    models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
  });
}
