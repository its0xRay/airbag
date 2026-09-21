import { describe, expect, it } from "vitest";
import { fmtAge, fmtOusd, fmtUsd } from "./format";

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

describe("relative timestamps", () => {
  const now = 2_000_000;

  it("keeps recent activity readable without losing precision", () => {
    expect(fmtAge(now - 3, now)).toBe("updated just now");
    expect(fmtAge(now - 42, now)).toBe("updated 42s ago");
    expect(fmtAge(now - 5 * 60, now)).toBe("updated 5m ago");
  });

  it("summarizes older activity by hour or day", () => {
    expect(fmtAge(now - 3 * 60 * 60, now)).toBe("updated 3h ago");
    expect(fmtAge(now - 2 * 24 * 60 * 60, now)).toBe("updated 2d ago");
  });
});
