import { browserClientToken } from "@dockclock/paypal";
import { handle } from "@/lib/server/http";

/** Browser-safe token for JS SDK v6 createInstance({ clientToken }). */
export const GET = handle(async () => {
  const t = await browserClientToken();
  return Response.json({ accessToken: t.accessToken, expiresIn: t.expiresIn }, { headers: { "Cache-Control": "no-store" } });
});
