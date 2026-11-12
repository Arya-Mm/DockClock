// Tunnel supervisor: runs a Cloudflare quick tunnel to the dev server and, every time it (re)starts with a new
// public URL, repoints the PayPal webhook (PAYPAL_WEBHOOK_ID) at it. If cloudflared exits or never gets a URL,
// it restarts with backoff. Usage: pnpm tunnel   (needs tools/cloudflared.exe and the dev server on :3000)
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { updateWebhookUrl } from "@dockclock/paypal";

const BIN = process.env.CLOUDFLARED_BIN ?? "tools/cloudflared.exe";
const TARGET = process.env.TUNNEL_TARGET ?? "http://localhost:3000";
const URL_FILE = "tools/tunnel-url.txt";
const NO_URL_TIMEOUT_MS = 45_000;
// Tunnel hosts look like https://word-word-word.trycloudflare.com; api.trycloudflare.com is Cloudflare's own API.
const URL_RE = /https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/;

const webhookId = process.env.PAYPAL_WEBHOOK_ID;
if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID not set: register once with scripts/register-webhook.ts");
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

async function repoint(base: string) {
  const url = `${base}/api/webhooks/paypal`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await updateWebhookUrl(webhookId!, url);
      writeFileSync(URL_FILE, `${base}\n`);
      log("webhook repointed", { webhookId, url: r.data.url, debugId: r.debugId });
      return;
    } catch (e) {
      log("webhook repoint failed", { attempt, error: (e as Error).message });
      await new Promise((res) => setTimeout(res, 2_000 * attempt));
    }
  }
}

let backoffMs = 2_000;
let stopping = false;
let child: ChildProcess | null = null;

function start() {
  log("starting cloudflared", { target: TARGET });
  const c = spawn(BIN, ["tunnel", "--no-autoupdate", "--config", "tools/config.yml", "--url", TARGET], { stdio: ["ignore", "pipe", "pipe"] });
  child = c;
  let found = false;
  const noUrl = setTimeout(() => { if (!found) { log("no tunnel URL in time, restarting"); c.kill(); } }, NO_URL_TIMEOUT_MS);
  const onData = (buf: Buffer) => {
    const m = buf.toString().match(URL_RE);
    if (m && !found) {
      found = true;
      clearTimeout(noUrl);
      backoffMs = 2_000;
      log("tunnel up", { url: m[0] });
      void repoint(m[0]);
    }
  };
  c.stdout?.on("data", onData);
  c.stderr?.on("data", onData); // cloudflared logs to stderr
  c.on("exit", (code) => {
    clearTimeout(noUrl);
    if (stopping) return;
    log("cloudflared exited, restarting", { code, inMs: backoffMs });
    setTimeout(start, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 60_000);
  });
}

const stop = () => { stopping = true; child?.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
start();
