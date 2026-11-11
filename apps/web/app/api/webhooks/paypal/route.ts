import { ingestWebhook } from "@/lib/server/webhooks";

// Raw body is required: verify-webhook-signature needs the exact bytes PayPal signed (F2).
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const r = await ingestWebhook(raw, req.headers);
    return Response.json(r, { status: r.status });
  } catch (e) {
    console.error("webhook error", e);
    return Response.json({ error: { code: "internal_error", message: "webhook processing failed" } }, { status: 500 });
  }
}
