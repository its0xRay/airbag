import { describe, expect, it } from "vitest";
import { defaultFloor } from "./defaultFloor";

describe("default floor", () => {
  it("selects the nearest below-reference floor for either asset", () => {
    expect(defaultFloor([{ strike: 1100n }, { strike: 950n }], 1035n)?.strike).toBe(950n);
    expect(defaultFloor([{ strike: 205n }, { strike: 225n }, { strike: 215n }], 222n)?.strike).toBe(215n);
  });
  it("uses the lowest available floor when all floors are at or above reference", () => {
    expect(defaultFloor([{ strike: 1100n }, { strike: 950n }], 950n)?.strike).toBe(950n);
  });
  it("handles unavailable references and empty series without inventing terms", () => {
    expect(defaultFloor([{ strike: 1100n }, { strike: 950n }])?.strike).toBe(950n);
    expect(defaultFloor([], 1035n)).toBeUndefined();
  });
});
