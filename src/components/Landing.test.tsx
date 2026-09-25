import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Landing from "./Landing";

vi.mock("./ProtectTab", () => ({ default: () => <div data-testid="actual-protect-workspace" /> }));
vi.mock("./VaultsTab", () => ({ default: () => <div data-testid="actual-vault-workspace" /> }));
vi.mock("./ProtectionWalkthrough", () => ({ default: () => <section>Buyer walkthrough</section> }));
vi.mock("../onchain/store", () => ({ explorerUrl: (_kind: string, address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet` }));
const render = (enabled?: boolean) => renderToStaticMarkup(<Landing vaultsEnabled={enabled}
  onLaunch={() => {}} onViewPosition={() => {}} onConnected={() => {}} />);
afterEach(() => vi.unstubAllGlobals());

describe("two-sided landing release", () => {
  it("keeps execution and markets dark while grouping explanatory light surfaces", () => {
    const html = render(true);
    expect(html).toContain('class="lp-section lp-light why-one"');
    expect(html).toContain('class="lp-section lp-verification lp-light"');
    expect(html).toContain('class="lp-hero lp-product-hero"');
    expect(html).toContain('data-hero="one"');
    expect(html).toContain('class="lp-section" id="assets"');
  });
  it("keeps unreleased vault claims and entry points out of the default page", () => {
    const html = render();
    expect(html).not.toContain("Fund a vault");
    expect(html).not.toContain("How do vault deposits work?");
    expect(html).toContain("Cash-settled puts on tokenized equities.");
  });
  it("introduces both sides without replacing the buyer workflow", () => {
    const html = render(true);
    expect(html).toContain("Cash-settled puts on tokenized equities, underwritten by isolated vaults.");
    expect(html).toContain('id="protection"');
    expect(html).toContain('aria-label="Choose your Airbag flow"');
    expect(html).toContain("Fund a vault");
    expect(html).toContain("actual-protect-workspace");
    expect(html).toContain("Buyer walkthrough");
    expect(html.match(/>Set your floor<\/button>/g)).toHaveLength(1);
    expect(html.match(/>Fund a vault<\/button>/g)).toHaveLength(1);
    expect(html).not.toContain('aria-label="Choose your side"');
  });
  it("explains capital flow without repeated warnings or invented yields", () => {
    const html = render(true);
    for (const copy of ["A price drop shouldn’t force your exit.", "Isolated vault", "Contract payout", "Administrator deposits follow the same", "Upfront premium. Cover ends at expiry.", "Withdrawal after settlement"]) expect(html).toContain(copy);
    expect(html).not.toContain("APY");
    expect(html).not.toContain("Deposits can lose value.");
    expect(html).not.toContain("Premiums are not guaranteed profit.");
    expect(html).toContain("oUSD is a test token with no real value or redemption promise.");
    expect(html.match(/id="why-protect"/g)).toHaveLength(1);
    expect(html).not.toContain("Your protection should be too.");
  });
  it("mounts only the selected workspace and keeps migration history out of the landing", () => {
    const html = render(true);
    expect(html).not.toContain("actual-vault-workspace");
    expect(html).not.toContain("Existing NVDAx v1");
    expect(html).not.toContain("What happens to older NVDAx");
  });
  it("supports a vault deep link without mounting the buyer or starting a transaction", () => {
    vi.stubGlobal("window", { location: { search: "?side=vault" } });
    const html = render(true);
    expect(html).toContain("actual-vault-workspace");
    expect(html).toContain('data-hero="one"');
    expect(html).not.toContain("actual-protect-workspace");
    expect(render(false)).not.toContain("actual-vault-workspace");
  });
});
