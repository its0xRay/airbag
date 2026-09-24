import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ProtectionWalkthrough from "./ProtectionWalkthrough";

describe("responsive two-sided walkthrough", () => {
  it("retains desktop diagrams with a three-step mobile summary", () => {
    const html = renderToStaticMarkup(<ProtectionWalkthrough />);
    expect(html).toContain("walkthrough-visual");
    expect(html).toContain("walkthrough-mobile");
    expect(html).toContain("See the mechanics");
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).not.toContain("walkthrough-inline");
    expect(html).toContain("covered quantity");
  });
  it("explains depositor mechanics without repeated warnings", () => {
    const html = renderToStaticMarkup(<ProtectionWalkthrough side="vault" vaultsEnabled />);
    expect(html).toContain("Deposit. Back payouts. Withdraw.");
    expect(html).not.toContain("can lose value");
    expect(html).not.toContain("not guaranteed profit");
    expect(html).not.toContain("no real value");
    expect(html).toContain("funds stay locked until settlement completes");
    expect(html).toContain("after every obligation resolves");
    expect(html).toContain("Ownership share × remaining balance");
    expect(html).not.toContain("Keep holding");
  });
});
