import { describe, expect, it } from "vitest";
import { validAvailability, type AssetAvailability } from "./useAssetAvailability";
const response: AssetAvailability = { assetId: 1, checkedAt: 1000, canQuote: true, reason: null,
  exposureLimit: "15000000000", outstandingExposure: "9000000000", availableExposure: "6000000000", depositsPaused: false };
describe("availability response validation", () => {
  it("accepts explicit observed fields, including a legitimate zero capacity", () => {
    expect(validAvailability(response, 1)).toBe(true);
    expect(validAvailability({ ...response, availableExposure: "0", canQuote: false, reason: "Capacity reached" }, 1)).toBe(true);
  });
  it.each(["canQuote", "depositsPaused", "checkedAt", "availableExposure", "exposureLimit", "outstandingExposure"])("rejects missing %s instead of assuming availability", key => {
    expect(validAvailability({ ...response, [key]: undefined } as unknown as AssetAvailability, 1)).toBe(false);
  });
  it("rejects a different asset and malformed amounts", () => {
    expect(validAvailability(response, 0)).toBe(false);
    expect(validAvailability({ ...response, availableExposure: "-1" }, 1)).toBe(false);
  });
});
