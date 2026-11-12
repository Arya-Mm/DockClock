// AG Studio Agent Framework adapter for Gemini (Studio 3.1 AgLlmAdapter: https://www.ag-grid.com/studio/react/ai-quickstart/).
// The browser never sees the key: each turn goes to this app's /api/ai/gemini route, which calls Gemini and returns
// Studio-shaped output items. The adapter then replays them as Studio's event stream.
import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from 'ag-studio';

export function geminiAdapter(endpoint = '/api/ai/gemini'): AgLlmAdapter {
  return {
    executeTurn(request: AgLlmRequest, options): AgLlmResponseHandler {
      const id = `resp_${Date.now().toString(36)}`;
      const done = fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: options?.signal })
        .then(async (r) => {
          const j = (await r.json().catch(() => ({}))) as { output?: AgAiOutputItem[]; model?: string; error?: { message?: string } };
          if (!r.ok || !j.output) throw new Error(j.error?.message ?? `AI request failed (${r.status})`);
          return j;
        });
      const complete: Promise<AgLlmResponse> = done.then(
        (j) => ({ id, createdAt: Date.now(), output: j.output!, status: 'completed' as const, model: j.model }),
        (e: Error) => ({ id, createdAt: Date.now(), output: [], status: 'failed' as const, error: { code: 'adapter_error', message: e.message } }),
      );
      async function* events(): AsyncGenerator<AgAiEvent> {
        const r = await complete;
        if (r.status === 'failed') { yield { type: 'RUN_ERROR', message: r.error?.message ?? 'AI request failed' }; return; }
        for (const item of r.output) {
          if (item.type === 'message') {
            yield { type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' };
            for (const c of item.content) if (c.type === 'text') yield { type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: c.text };
            yield { type: 'TEXT_MESSAGE_END', messageId: item.id };
          } else if (item.type === 'function_call') {
            yield { type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name };
            yield { type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments };
            yield { type: 'TOOL_CALL_END', toolCallId: item.callId };
          }
        }
      }
      return { stream: { [Symbol.asyncIterator]: () => events() }, complete };
    },
  };
}
