import { describe, expect, it } from "vitest";
import { betaObservationWindow } from "./betaObservations";

describe("beta observation windows", () => {
  it("preserves real observations, ordered by timestamp and strictly increasing slot", () => {
    const first = { price: 5n, sourceTs: 100, collectedTs: 102, slot: 10n };
    const second = { price: 7n, sourceTs: 101, collectedTs: 102, slot: 11n };
    const samples = [second, first, { ...second, sourceTs: 102 },
      { ...second, sourceTs: 103, collectedTs: 164, slot: 12n }];
    expect(betaObservationWindow(samples, 100, 103)).toEqual([first, second]);
    expect(samples[0]).toBe(second);
    expect(betaObservationWindow(samples, 102, 102)).toEqual([{ ...second, sourceTs: 102 }]);
  });
  it("selects the first eight qualifying observations without rewriting their prices or times", () => {
    const samples = Array.from({ length: 12 }, (_, i) => ({ price: BigInt(i + 1),
      slot: BigInt(i + 1), sourceTs: 100 + i, collectedTs: 100 + i }));
    expect(betaObservationWindow(samples, 100, 111)).toEqual(samples.slice(0, 8));
  });
});
