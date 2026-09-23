import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Landing from "./Landing";

vi.mock("./ProtectTab", () => ({ default: () => <div data-testid="actual-protect-workspace" /> }));
vi.mock("./ProtectionWalkthrough", () => ({ default: () => <section>Buyer walkthrough</section> }));
vi.mock("../onchain/store", () => ({ explorerUrl: (_kind: string, address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet` }));
const render = (enabled?: boolean) => renderToStaticMarkup(<Landing vaultsEnabled={enabled}
  onLaunch={() => {}} onViewPosition={() => {}} onConnected={() => {}} />);

describe("two-sided landing release", () => {
  it("keeps unreleased vault claims and entry points out of the default page", () => {
    const html = render();
    expect(html).not.toContain("Fund a vault");
    expect(html).not.toContain("How do vault deposits work?");
    expect(html).toContain("Keep the upside. Define your downside.");
  });
  it("introduces both sides without replacing the buyer workflow", () => {
    const html = render(true);
    expect(html).toContain("Define your downside—or fund it and share in the premiums.");
    expect(html).toContain('href="#protection"');
    expect(html).toContain("Fund a vault");
    expect(html).toContain("actual-protect-workspace");
    expect(html).toContain("Buyer walkthrough");
  });
  it("explains capital flow and risk without invented yields or activity", () => {
    const html = render(true);
    for (const copy of ["Capital in", "Premiums in", "Payouts out", "Redeem your share", "Depositor capital can lose value.", "Premiums are not guaranteed profit.", "Administrator deposits follow the same"]) expect(html).toContain(copy);
    expect(html).not.toContain("APY");
    expect(html.match(/id="why-protect"/g)).toHaveLength(1);
    expect(html).not.toContain("Your protection should be too.");
  });
});
