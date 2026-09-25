import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ProtectionMechanism from "./ProtectionMechanism";
import ProtectionBoundary from "./ProtectionBoundary";
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
    expect(html).toContain("Payout scenario · not a quote");
    expect(html).toContain("Payout minus premium");
  });
  it("never implies negative gross payouts above the floor", () => {
    const html = render(230);
    expect(html).toContain("zero payout");
    expect(html).toContain("0.00 oUSD");
    expect(html).not.toContain('class="boundary-gap"');
  });
  it("updates the payout and maximum for fractional quantities", () => {
    const html = render(200, 0.5);
    expect(html).toContain("7.50 oUSD");
    expect(html).toContain("107.50 oUSD");
  });
  it("reaches the contractual maximum only at a zero reference", () => {
    expect(render(0)).toContain("215.00 oUSD");
    expect(render(0)).toContain("213.00 oUSD");
  });
  it("pays zero exactly at the floor", () => {
    expect(render(215)).toContain("0.00 oUSD");
    expect(render(215)).not.toContain('class="boundary-gap"');
  });
  it("keeps a negative result visible and does not invent premium recovery", () => {
    const html = renderToStaticMarkup(<ProtectionMechanism symbol="NVDAx" quantity={toFixed(1)} floor={toFixed(215)} reference={toFixed(200)} premium={toFixed(220)} />);
    expect(html).toContain("15.00 oUSD");
    expect(html).toContain("−205.00 oUSD");
    expect(html).toContain("Premium exceeds the maximum contract payout.");
    expect(html).not.toContain('class="marker breakeven"');
  });
  it("explains the premium recovery threshold without implying portfolio profit", () => {
    expect(render(200)).toContain("Break-even reference:");
    expect(render(200)).toContain("$213.00");
    expect(render(230)).toContain("−2.00 oUSD");
  });
  it("shows confirmed terms without inventing a reference or payout", () => {
    const html = renderToStaticMarkup(<ProtectionBoundary floor={toFixed(215)} compact />);
    expect(html).toContain("$215.00");
    expect(html).toContain("Contract price floor");
    expect(html).not.toContain("Hypothetical");
    expect(html).not.toContain("boundary-reference");
    expect(html).not.toContain("oUSD");
  });
});
