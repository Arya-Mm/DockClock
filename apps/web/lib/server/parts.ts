import "server-only";
import { z } from "zod";
import { priceOffer, type PricedOffer, type AccessorialContract } from "@dockclock/core";
import { getLoad } from "./loads";
import { createOffer, acceptOffer } from "./negotiation";
import { damageFor } from "./vision";
import { isOn } from "../flags";
import { DomainError } from "./http";

/**
 * Carrier Agent part purchase (PLAN §7.3, A11): only when the gate-cam diff shows the part is missing, Channel3 search,
 * three priced options (price + delivery <= the carrier's parts cap), then the same mandate-guarded accept and a
 * carrier-paid PayPal order. Prices are re-fetched on the server at purchase time; the client only names a product id.
 * Channel3 docs: https://channel3.ai/docs/api-reference (POST /v1/search, x-api-key header).
 */
const DELIVERY_CENTS = 1_200; // shortcut: flat courier-to-dock fee (synthetic); replace with a delivery quote API
const QUERY = "ratchet cargo strap e-track";
// priceOffer needs a contract only for detention kinds; PART_PURCHASE ignores it.
const NO_CONTRACT: AccessorialContract = { contractVersionId: "n/a", currency: "USD", freeTimeMin: 0, incrementMin: 1, ratePerIncrementCents: 0, rounding: "UP", maxDetentionCents: 0, lateGraceMin: 0, lateArrivalPolicy: "CLOCK_FROM_ARRIVAL", tonuFlatCents: 0, driverShareBps: 0 };

const C3 = z.object({
  products: z.array(z.object({
    id: z.string(), title: z.string(),
    offers: z.array(z.object({ url: z.string().url(), domain: z.string(), availability: z.string().optional(), price: z.object({ price: z.number().positive(), currency: z.string() }) })).default([]),
  })),
});

export interface PartOption { productId: string; title: string; merchant: string; url: string; priced: PricedOffer }

async function search(limit = 10) {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) throw new DomainError("not_configured", "CHANNEL3_API_KEY missing");
  const res = await fetch("https://api.trychannel3.com/v1/search", { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ query: QUERY, limit }), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new DomainError("upstream", `Channel3 search ${res.status}`);
  return C3.parse(await res.json()).products;
}

export async function partOptions(loadId: string): Promise<{ missing: number; options: PartOption[] }> {
  if (!isOn("PART_PURCHASE")) throw new DomainError("flag_off", "FLAG_PART_PURCHASE is off");
  const load = await getLoad(loadId);
  const { missingStraps } = await damageFor(loadId);
  // A11: never buy a part the gate-cam diff does not show as missing.
  if (missingStraps === 0) return { missing: 0, options: [] };
  const options: PartOption[] = [];
  for (const p of await search()) {
    const o = p.offers.find((x) => x.price.currency === "USD" && (x.availability ?? "InStock") === "InStock");
    if (!o) continue;
    // Trust boundary: Channel3 dollars -> integer cents once, here. The engine then prices the offer.
    const priced = priceOffer("PART_PURCHASE", { waitedMin: 0, historicalDwellsMin: [], partQuote: { priceCents: Math.round(o.price.price * 100) * missingStraps, deliveryCents: DELIVERY_CENTS, capCents: load.carrier.partsCapCents } }, NO_CONTRACT);
    if (priced) options.push({ productId: p.id, title: p.title, merchant: o.domain, url: o.url, priced });
  }
  options.sort((a, b) => a.priced.priceCents - b.priced.priceCents);
  return { missing: missingStraps, options: options.slice(0, 3) };
}

/** Buy one of the options: re-search server-side, create the PART_PURCHASE offer, accept through the Carrier mandate. */
export async function buyPart(loadId: string, productId: string) {
  const { options } = await partOptions(loadId);
  const pick = options.find((o) => o.productId === productId);
  if (!pick) throw new DomainError("not_offerable", `product ${productId} is not one of the current options`);
  const load = await getLoad(loadId);
  const offer = await createOffer(load, pick.priced, `Channel3 ${pick.productId}: ${pick.title} from ${pick.merchant}`.slice(0, 600), Date.now(), { source: "CHANNEL3" });
  const r = await acceptOffer(offer.id, { version: offer.version, planHash: offer.planHash }, "CARRIER");
  return { offerId: offer.id, option: pick, result: r };
}
