import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ProtectionMechanism from "./ProtectionMechanism";
import { toFixed } from "../engine";

// Test fixtures only: never imported by the running product.
const render = (reference: number, quantity = 1) => renderToStaticMarkup(<ProtectionMechanism
  symbol="NVDAx" quantity={toFixed(quantity)} floor={toFixed(215)}
  reference={toFixed(reference)} premium={toFixed(2)} />);

describe("Selected protection mechanism", () => {
  it("uses the contractual payoff below the floor", () => {
    const html = render(200);
    expect(html).toContain("15.00 oUSD");
    expect(html).toContain("13.00 oUSD");
    expect(html).toContain("215.00 oUSD");
    expect(html).toContain("Hypothetical reference");
    expect(html).toContain("not a quote or settlement");
  });
  it("never implies negative gross payouts above the floor", () => {
    const html = render(230);
    expect(html).toContain("protection pays zero");
    expect(html).toContain("scaleX(0)");
  });
  it("updates the payout and maximum for fractional quantities", () => {
    const html = render(200, 0.5);
    expect(html).toContain("7.50 oUSD");
    expect(html).toContain("107.50 oUSD");
  });
  it("reaches the contractual maximum only at a zero reference", () => {
    expect(render(0)).toContain("scaleX(1)");
  });
});
