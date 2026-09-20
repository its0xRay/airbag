import { describe, expect, it } from "vitest";
import { fmtOusd, fmtUsd } from "./format";

describe("currency formatting", () => {
  it("keeps market references in USD", () => {
    expect(fmtUsd(982.6)).toBe("$982.60");
  });

  it("labels demo-token accounting as oUSD with one negative convention", () => {
    expect(fmtOusd(1250)).toBe("1,250.00 oUSD");
    expect(fmtOusd(-12.5)).toBe("−12.50 oUSD");
    expect(fmtOusd(-0.001, 2)).toBe("0.00 oUSD");
  });
});
