import { z } from "zod";
import { handle, fail, requireOps } from "@/lib/server/http";
import { llmAllowed } from "@/lib/server/llm-budget";

/**
 * One AG Studio agent turn on Gemini (generateContent: https://ai.google.dev/api/generate-content, function calling:
 * https://ai.google.dev/gemini-api/docs/function-calling). Maps Studio's AgLlmRequest to Gemini and Gemini's reply back to
 * Studio output items. Gemini 3 needs each function call's thought signature replayed, so it rides on the call's item id.
 * Studio only builds reports here: no tool can move money (prime directive).
 */
const MAX_BODY = 2_000_000;
const Req = z.object({
  input: z.array(z.record(z.string(), z.unknown())).max(400),
  instructions: z.string().max(200_000).optional(),
  tools: z.array(z.object({ name: z.string(), description: z.string().default(""), parameters: z.unknown() }).passthrough()).max(200).optional(),
  toolChoice: z.union([z.enum(["auto", "none", "required"]), z.object({ name: z.string() })]).optional(),
  responseFormat: z.object({ type: z.enum(["text", "json"]), schema: z.unknown().optional() }).passthrough(),
}).passthrough();

type Part = { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name: string; args?: unknown }; functionResponse?: { name: string; response: unknown } };
type Content = { role: "user" | "model"; parts: Part[] };
const SIG = "|sig:";
// Gemini 3 thought signatures, keyed by the tool callId Studio preserves across turns (it does not keep our item ids).
// shortcut: in-process map; on a multi-instance deploy, move this to a shared store (Redis/DB) keyed the same way.
const signatures = new Map<string, string>();
const SKIP_SIGNATURE = "skip_thought_signature_validator"; // documented placeholder when a signature is unavailable

function toGemini(items: Record<string, unknown>[]) {
  const contents: Content[] = [], system: string[] = [];
  const callNames = new Map<string, string>();
  const answered = new Set<string>();
  const push = (role: Content["role"], part: Part) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(part); else contents.push({ role, parts: [part] });
  };
  const textOf = (c: unknown) => (Array.isArray(c) ? c.map((x) => (x && typeof x === "object" && "text" in x ? String((x as { text: unknown }).text) : "")).join("\n") : "");
  for (const it of items) {
    if (it.type === "message" && it.role === "system") system.push(textOf(it.content));
    else if (it.type === "message" && it.role === "user") push("user", { text: textOf(it.content) || " " });
    else if (it.type === "message" && it.role === "assistant") { const t = textOf(it.content); if (t) push("model", { text: t }); }
    else if (it.type === "function_call") {
      const name = String(it.name), callId = String(it.callId), id = String(it.id ?? "");
      callNames.set(callId, name);
      let args: unknown = {};
      try { args = JSON.parse(String(it.arguments ?? "{}")); } catch { args = {}; }
      const sig = signatures.get(callId) ?? (id.includes(SIG) ? id.slice(id.indexOf(SIG) + SIG.length) : undefined) ?? SKIP_SIGNATURE;
      push("model", { functionCall: { name, args }, thoughtSignature: sig });
      // Studio 3.1 may carry the tool result on the call item itself (AgAiToolCall.result) instead of a separate
      // function_call_output; without this Gemini never sees results and re-calls the same tool forever.
      if (typeof it.result === "string") { push("user", { functionResponse: { name, response: { output: it.result } } }); answered.add(callId); }
    } else if (it.type === "function_call_output") {
      if (answered.has(String(it.callId))) continue;
      const name = callNames.get(String(it.callId)) ?? "tool";
      push("user", { functionResponse: { name, response: { output: String(it.output ?? "") } } });
    }
  }
  return { contents, system };
}

export const POST = handle(async (req: Request) => {
  const denied = requireOps(req);
  if (denied) return denied;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return fail(413, "too_large", "AI request too large");
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail(503, "ai_unavailable", "GEMINI_API_KEY not configured");
  if (!(await llmAllowed())) return fail(429, "ai_budget", "LLM daily spend cap reached (F4)");
  const parsed = Req.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(422, "validation_error", "bad AI request");
  const r = parsed.data;
  const { contents, system } = toGemini(r.input);
  if (process.env.NODE_ENV !== "production") console.log(`[ai/gemini] in: ${r.input.map((i) => `${i.type}${i.role ? `/${i.role}` : ""}${i.type === "function_call" ? `(${i.name}${"result" in i ? ",result" : ""})` : ""}${i.type === "function_call_output" ? `(${String(i.output ?? "").length}b)` : ""}`).join(" ")} | gemini roles: ${contents.map((c) => c.role[0] + c.parts.length).join(",")}`);
  const model = process.env.GEMINI_STUDIO_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
  const tc = r.toolChoice;
  const sys = [r.instructions ?? "", ...system].filter(Boolean).join("\n\n");
  const body = {
    contents: contents.length ? contents : [{ role: "user", parts: [{ text: " " }] }],
    ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
    ...(r.tools?.length ? {
      tools: [{ functionDeclarations: r.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters ?? { type: "object" } })) }],
      toolConfig: { functionCallingConfig: tc === "none" ? { mode: "NONE" } : tc === "required" ? { mode: "ANY" } : typeof tc === "object" ? { mode: "ANY", allowedFunctionNames: [tc.name] } : { mode: "AUTO" } },
    } : {}),
    generationConfig: { temperature: 0.2, ...(r.responseFormat.type === "json" ? { responseMimeType: "application/json", ...(r.responseFormat.schema ? { responseJsonSchema: r.responseFormat.schema } : {}) } : {}) },
  };
  const call = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000), // multi-tool Studio turns on flash can exceed 60 s
  });
  let res = await call();
  // Free-tier Gemini returns 429/503 under load: one retry after a short pause, then fail closed.
  if (res.status === 429 || res.status >= 500) { await new Promise((ok) => setTimeout(ok, 1_500)); res = await call(); }
  const j = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: Part[] } }[]; error?: { message?: string } };
  if (!res.ok) {
    console.warn(`[ai/gemini] ${model} ${res.status}: ${(j.error?.message ?? "").slice(0, 300)}`);
    return fail(502, "gemini_error", `Gemini ${res.status}: ${(j.error?.message ?? "").slice(0, 200)}`);
  }
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  const stamp = Date.now().toString(36);
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  const output: unknown[] = [];
  if (text) output.push({ id: `msg_${stamp}`, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
  parts.filter((p) => p.functionCall).forEach((p, i) => {
    const callId = `call_${stamp}_${i}`;
    if (p.thoughtSignature) { signatures.set(callId, p.thoughtSignature); if (signatures.size > 5_000) signatures.delete(signatures.keys().next().value!); }
    output.push({ id: `fc_${stamp}_${i}${p.thoughtSignature ? SIG + p.thoughtSignature : ""}`, kind: "output", type: "function_call", callId, name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}), status: "completed" });
  });
  if (process.env.NODE_ENV !== "production") console.log(`[ai/gemini] ${model} format=${r.responseFormat.type} tools=${r.tools?.length ?? 0} choice=${typeof tc === "object" ? tc.name : tc ?? "auto"} offered=[${(r.tools ?? []).map((t) => t.name).join(",")}] -> text=${text.length} called=[${parts.filter((p) => p.functionCall).map((p) => p.functionCall!.name).join(",")}]${!output.length ? ` finish=${JSON.stringify((j as { candidates?: { finishReason?: string }[] }).candidates?.[0]?.finishReason)}` : ""}`);
  return Response.json({ output, model });
});
