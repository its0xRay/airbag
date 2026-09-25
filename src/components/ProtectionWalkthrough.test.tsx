import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ProtectionWalkthrough from "./ProtectionWalkthrough";
import { toFixed } from "../engine";

describe("responsive two-sided walkthrough", () => {
  it("retains desktop diagrams with a three-step mobile summary", () => {
    const html = renderToStaticMarkup(<ProtectionWalkthrough />);
    expect(html).toContain("walkthrough-visual");
    expect(html).toContain("From choosing a floor to receiving a payout.");
    expect(html).toContain("walkthrough-mobile");
    expect(html).toContain("See the mechanics");
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).not.toContain("walkthrough-inline");
    expect(html).toContain("covered quantity");
  });
  it("explains depositor mechanics without repeated warnings", () => {
    const html = renderToStaticMarkup(<ProtectionWalkthrough side="vault" vaultsEnabled />);
    expect(html).toContain("From deposit to withdrawal.");
    expect(html).not.toContain("can lose value");
    expect(html).not.toContain("not guaranteed profit");
    expect(html).not.toContain("no real value");
    expect(html).toContain("funds stay locked until settlement completes");
    expect(html).toContain("after every obligation resolves");
    expect(html).toContain("Ownership share × remaining balance");
    expect(html).not.toContain("Keep holding");
  });
  it("labels the same numerical buyer example through the walkthrough", () => {
    const html = renderToStaticMarkup(<ProtectionWalkthrough example={{assetId: 1, quantity: toFixed(2), floor: toFixed(1000), reference: toFixed(900), premium: toFixed(50), expiry: 1790864940}} />);
    expect(html).not.toContain("Illustrative example · not an available quote");
    expect(html).toContain("2,000.00 oUSD");
    expect(html).toContain("2 × max($1,000.00 − $900.00, 0) = 200.00 oUSD");
    expect(html).toContain("Payout minus premium: 150.00 oUSD");
    expect(html).toContain("Anthropic PreStocks");
    expect(html).not.toContain("7 days");
  });
  it("does not invent terms when references or series are unavailable", () => {
    const html = renderToStaticMarkup(<ProtectionWalkthrough example={null} />);
    expect(html).toContain("Choose available terms above");
    expect(html).not.toContain("$200");
  });
});
