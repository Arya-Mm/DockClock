import { z } from "zod";
import { OFFER_KINDS, type OfferKind } from "@dockclock/core";

export const AgentKind = z.enum(["CARRIER", "FACILITY", "SHIPPER_TREASURY"]);
export type AgentKind = z.infer<typeof AgentKind>;
export const OfferKindSchema = z.enum(OFFER_KINDS as [OfferKind, ...OfferKind[]]);

/** PLAN §4.2. priceCents is set by the engine (core offers.ts); rationale is LLM text, display only (A2). */
export const Offer = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  loadId: z.string().min(1),
  fromAgent: AgentKind,
  toAgent: AgentKind,
  kind: OfferKindSchema,
  priceCents: z.number().int().nonnegative(),
  slot: z.object({ doorId: z.string(), startMs: z.number().int() }).optional(),
  ttlMs: z.number().int().positive(),
  rationale: z.string().max(600),
  contractVersionId: z.string().min(1),
  planHash: z.string().length(64),
});
export type Offer = z.infer<typeof Offer>;

export const Mandate = z.object({
  id: z.string().min(1),
  agent: AgentKind,
  ownerId: z.string(),
  allowedActions: z.array(OfferKindSchema),
  counterparties: z.array(z.string()),
  perActionCapCents: z.number().int().nonnegative(),
  dailyCapCents: z.number().int().nonnegative(),
  expiresAtMs: z.number().int(),
  revokedAtMs: z.number().int().nullable(),
});
export type Mandate = z.infer<typeof Mandate>;

/**
 * What an LLM may return: an action id from the menu it was given, plus display text. Nothing else.
 * No amount field exists in this schema (A1); unknown keys are stripped.
 */
export const decisionSchema = <A extends string>(menu: readonly [A, ...A[]]) =>
  z.object({ action: z.enum(menu), rationale: z.string().max(600).catch("") });
