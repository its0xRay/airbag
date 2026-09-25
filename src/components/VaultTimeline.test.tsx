import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import VaultTimeline from "./VaultTimeline";
import type { VaultRoundAccount } from "../client/vaultProgram";

// Synthetic round fixtures for display tests only.
const render = (phase: VaultRoundAccount["phase"], now: number, fresh = true) => renderToStaticMarkup(<VaultTimeline round={{ phase, fundingClose: 100, salesClose: 200, latestExpiry: 300 } as VaultRoundAccount} now={now} fresh={fresh} />);
describe("Vault timeline", () => {
  it("marks funding only while the window is open", () => {
    expect(render("funding", 50)).toContain('aria-current="step"><strong>Funding');
    expect(render("funding", 150)).toContain('aria-current="step"><strong>Locked');
  });
  it("does not infer withdrawal readiness from an elapsed expiry", () => {
    expect(render("active", 400)).toContain('aria-current="step"><strong>Settling');
    expect(render("active", 400)).not.toContain("Withdrawable");
  });
  it("requires a fresh redeemable state to show Withdrawable", () => {
    expect(render("redeemable", 400)).toContain('aria-current="step"><strong>Withdrawable');
    expect(render("redeemable", 400, false)).not.toContain("Withdrawable");
    expect(render("redeemable", 400, false)).not.toContain('aria-current="step"');
  });
});
