// Checks each credential with a harmless real call and prints a pass/fail table. Never prints secret values.
import { Client } from "pg";

type Row = { check: string; ok: boolean | null; detail: string };
const env = process.env;
const has = (k: string) => Boolean(env[k]?.trim());

async function timed(check: string, fn: () => Promise<string>): Promise<Row> {
  try { return { check, ok: true, detail: await fn() }; }
  catch (e) { return { check, ok: false, detail: (e as Error).message.slice(0, 120) || (e as Error).name }; }
}
const skip = (check: string, why: string): Row => ({ check, ok: null, detail: why });

async function paypalToken(): Promise<string> {
  const base = env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const j = (await r.json()) as { access_token?: string; scope?: string };
  if (!r.ok || !j.access_token) throw new Error(`oauth ${r.status}`);
  return j.access_token;
}

async function main() {
  if (env.PAYPAL_ENV === "live") throw new Error("doctor refuses PAYPAL_ENV=live (sandbox only)");
  const base = "https://api-m.sandbox.paypal.com";
  const rows: Row[] = await Promise.all([
    has("PAYPAL_CLIENT_SECRET") ? timed("PayPal OAuth + balances", async () => {
      const t = await paypalToken();
      const r = await fetch(`${base}/v1/reporting/balances?currency_code=USD`, { headers: { Authorization: `Bearer ${t}` } });
      const dbg = r.headers.get("paypal-debug-id");
      if (!r.ok) throw new Error(`balances ${r.status} debug_id=${dbg}`);
      const j = (await r.json()) as { balances?: Array<{ available_balance?: { value: string } }> };
      return `USD available ${j.balances?.[0]?.available_balance?.value ?? "?"} (debug_id=${dbg})`;
    }) : skip("PayPal OAuth + balances", "PAYPAL_CLIENT_SECRET missing"),
    has("PAYPAL_WEBHOOK_ID") ? timed("PayPal webhook id", async () => "set") : skip("PayPal webhook id", "Phase 2 (needs public URL)"),
    has("GEMINI_API_KEY") ? timed(`LLM ping (${env.GEMINI_MODEL})`, async () => {
      const ping = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY!, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Reply OK" }] }] }),
      });
      let r = await ping();
      if (r.status === 503 || r.status === 429) { await new Promise((ok) => setTimeout(ok, 2000)); r = await ping(); } // transient overload
      if (!r.ok) throw new Error(`gemini ${r.status}`);
      return "200";
    }) : skip("LLM ping", "GEMINI_API_KEY missing"),
    has("CHANNEL3_API_KEY") ? timed("Channel3 search", async () => {
      // Spec: https://channel3.ai/docs/api-reference (POST /v1/search, x-api-key)
      const r = await fetch("https://api.trychannel3.com/v1/search", {
        method: "POST", headers: { "x-api-key": env.CHANNEL3_API_KEY!, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "ratchet strap e-track", limit: 1 }),
      });
      if (!r.ok) throw new Error(`channel3 ${r.status}`);
      return "200";
    }) : skip("Channel3 search", "CHANNEL3_API_KEY missing"),
    has("DATABASE_URL") ? timed("Postgres connect", async () => {
      const c = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 3000 });
      await c.connect();
      const r = await c.query("select count(*)::int as n from \"Load\"").catch(() => ({ rows: [{ n: "no tables (run db:migrate)" }] }));
      await c.end();
      return `loads=${r.rows[0].n}`;
    }) : skip("Postgres connect", "DATABASE_URL missing"),
    timed("AG Grid / Studio licence", async () => {
      const k = env.AG_STUDIO_LICENSE_KEY ?? "";
      if (!k) throw new Error("AG_STUDIO_LICENSE_KEY missing");
      const until = /deactivate_on_\{([^}]+)\}/.exec(k)?.[1] ?? "unknown";
      return `present, expires ${until}`;
    }),
    has("RENDER_API_KEY") ? timed("Render API key", async () => "set") : skip("Render API key", "Phase 6"),
  ]);
  console.table(rows.map((r) => ({ check: r.check, result: r.ok === null ? "SKIP" : r.ok ? "PASS" : "FAIL", detail: r.detail })));
  if (rows.some((r) => r.ok === false)) process.exitCode = 1;
}

main();
