import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicKey } from "@solana/web3.js";
import type { OwnedVaultDeposit } from "../client/vaultPortfolio";
import VaultDepositList from "./VaultDepositList";

// Isolated render fixtures, never imported by the running product.
const item = {
  round: { address: PublicKey.default, assetId: 0, phase: "redeemable", fundingClose: 100,
    totalShares: 1_000_000n, finalBalance: 900_000n },
  deposit: { address: PublicKey.default, shares: 1_000_000n, redeemed: false, redemptionAmount: 0n },
} as OwnedVaultDeposit;
describe("vault deposit journey", () => {
  it("shows only the selected history and highlights a linked round", () => {
    const html = renderToStaticMarkup(<VaultDepositList deposits={[item]} view="active" target={PublicKey.default.toBase58()} />);
    expect(html).toContain("position-highlighted");
    expect(html).toContain("Review withdrawal");
    expect(html).not.toContain("Fund a vault");
    const history = renderToStaticMarkup(<VaultDepositList deposits={[item]} view="history" />);
    expect(history).toContain("No withdrawn deposits yet.");
    expect(history).not.toContain("Review withdrawal");
  });
  it("does not call a confirmed deposit absent while its account loads", () => {
    const html = renderToStaticMarkup(<VaultDepositList deposits={[]} view="active" target={PublicKey.default.toBase58()} />);
    expect(html).toContain("Deposit data hasn’t loaded yet.");
    expect(html).toContain("Refresh deposits");
    expect(html).not.toContain("No active vault deposits.");
  });
  it("links final results to the exact withdrawable round", () => {
    const html = renderToStaticMarkup(<VaultDepositList deposits={[item]} />);
    expect(html).toContain("Review withdrawal");
    expect(html).toContain(`round=${PublicKey.default.toBase58()}`);
    expect(html).toContain("0.90 oUSD");
    expect(html).toContain("test activity");
  });
  it("keeps redeemed deposits in collapsed history without withdrawal actions", () => {
    const html = renderToStaticMarkup(<VaultDepositList deposits={[{ ...item,
      deposit: { ...item.deposit, redeemed: true, redemptionAmount: 900_000n } }]} />);
    expect(html).toContain("Withdrawn deposits (1)");
    expect(html).toContain("No outstanding vault deposits.");
    expect(html).not.toContain("Review withdrawal");
    expect(html).not.toContain("<details open");
  });
});
