import { chargeForDwell } from "./holdSizer.js";
import { quantile } from "./holdSizer.js";
import type { AccessorialContract } from "./settlement.js";

/**
 * Live "keep waiting vs release the truck" decision for the dispatcher —
 * this is what the Bryntum timeline draws as the break-even line.
 * Conditional on having ALREADY waited w minutes, the remaining wait is
 * estimated from history of loads that also lasted past w (survival view),
 * not from the unconditional average — long waits predict longer waits.
 */
export interface TonuAdvice {
  waitedMin: number;
  breakEvenDwellMin: number;            // dwell at which detention == TONU fee
  expectedFinalDwellMin: number | null; // median of comparable loads still going at w
  expectedDetentionCents: number | null;
  tonuCents: number;
  recommendation: "KEEP_WAITING" | "RELEASE_FOR_TONU" | "INSUFFICIENT_HISTORY";
  rationale: string;
}

export function breakEvenDwellMin(c: AccessorialContract): number {
  const incs = Math.ceil(c.tonuFlatCents / c.ratePerIncrementCents);
  return c.freeTimeMin + incs * c.incrementMin;
}

export function tonuAdvice(waitedMin: number, historicalDwellsMin: number[], c: AccessorialContract): TonuAdvice {
  const be = breakEvenDwellMin(c);
  const survivors = historicalDwellsMin.filter((d) => d > waitedMin);
  if (survivors.length < 8) {
    return { waitedMin, breakEvenDwellMin: be, expectedFinalDwellMin: null, expectedDetentionCents: null, tonuCents: c.tonuFlatCents,
      recommendation: "INSUFFICIENT_HISTORY", rationale: `Only ${survivors.length} past loads waited this long — dispatcher decides` };
  }
  const expectedFinal = Math.round(quantile(survivors, 0.5));
  const expCharge = chargeForDwell(expectedFinal, c);
  // Releasing also burns the driver's next pickup; only advise release when the expected bill is clearly worse.
  const release = expCharge > c.tonuFlatCents * 1.1 || expCharge >= c.maxDetentionCents;
  return {
    waitedMin, breakEvenDwellMin: be, expectedFinalDwellMin: expectedFinal, expectedDetentionCents: expCharge, tonuCents: c.tonuFlatCents,
    recommendation: release ? "RELEASE_FOR_TONU" : "KEEP_WAITING",
    rationale: `Loads still waiting at ${waitedMin}m typically finish at ${expectedFinal}m → $${(expCharge / 100).toFixed(2)} detention vs $${(c.tonuFlatCents / 100).toFixed(2)} TONU (break-even ${be}m).`,
  };
}
