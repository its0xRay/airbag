// Reference observation validation — mirrors programs/optket/src/references.rs
// (PRD §9). Enforces window membership, freshness, distinct/increasing slots
// and sample count, then computes a deterministic reference.

import { median } from "./fixed";
import type { Observation } from "./types";

export const PRESTOCKS_MIN_SAMPLES = 3;
export const PRESTOCKS_MAX_SAMPLE_AGE_SECS = 60;
export const PRESTOCKS_WINDOW_SECS = 300;
export const EQUITY_MAX_DELAY_SECS = 300;
export const EQUITY_MAX_SAMPLE_AGE_SECS = 120;
export const MAX_OBSERVATIONS = 16;

export class ReferenceError extends Error {}

/** Validate a single equity observation, return its price (PRD §9.1). */
export function validateEquity(
  obs: Observation,
  lo: number,
  hi: number,
  strictAfter: boolean,
  maxAge: number,
): bigint {
  if (strictAfter) {
    if (!(obs.sourceTs > lo)) throw new ReferenceError("observation not strictly after request");
  } else if (!(obs.sourceTs >= lo)) {
    throw new ReferenceError("reference before expiry");
  }
  if (!(obs.sourceTs <= hi)) throw new ReferenceError("observation outside window");
  if (!(obs.collectedTs >= obs.sourceTs && obs.collectedTs - obs.sourceTs <= maxAge))
    throw new ReferenceError("observation stale");
  if (!(obs.price > 0n)) throw new ReferenceError("invalid reference");
  return obs.price;
}

/** Validate a PreStocks observation set and return the median (PRD §9.2). */
export function validatePrestocksMedian(
  observations: Observation[],
  lo: number,
  hi: number,
  strictAfter: boolean,
): bigint {
  const n = observations.length;
  if (n < PRESTOCKS_MIN_SAMPLES) throw new ReferenceError("insufficient observations");
  if (n > MAX_OBSERVATIONS) throw new ReferenceError("too many observations");

  const prices: bigint[] = [];
  let prevSlot: bigint | null = null;
  let prevTs: number | null = null;

  for (const obs of observations) {
    if (strictAfter) {
      if (!(obs.sourceTs > lo)) throw new ReferenceError("observation not after request");
    } else if (!(obs.sourceTs >= lo)) {
      throw new ReferenceError("observation outside window");
    }
    if (!(obs.sourceTs <= hi)) throw new ReferenceError("observation outside window");

    if (!(obs.collectedTs >= obs.sourceTs && obs.collectedTs - obs.sourceTs <= PRESTOCKS_MAX_SAMPLE_AGE_SECS))
      throw new ReferenceError("observation stale");

    if (prevSlot !== null && !(obs.slot > prevSlot))
      throw new ReferenceError("non-increasing / duplicate slots");
    if (prevTs !== null && !(obs.sourceTs >= prevTs))
      throw new ReferenceError("non-increasing timestamps");
    prevSlot = obs.slot;
    prevTs = obs.sourceTs;

    if (!(obs.price > 0n)) throw new ReferenceError("invalid reference");
    prices.push(obs.price);
  }

  return median(prices);
}
