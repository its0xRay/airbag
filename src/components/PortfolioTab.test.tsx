import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicKey } from "@solana/web3.js";
import type { ContractAcct } from "../client/optketProgram";
import PortfolioTab from "./PortfolioTab";

// Test-only onchain account fixtures; no mock data is imported by the app.
const state = vi.hoisted(() => ({ connected: true, contracts: [] as ContractAcct[], requests: [], requestTransactions: {}, history: [], expiryReceipts: {}, exposure: {}, busy: false, transaction: null, conn: { rpcEndpoint: "test" } }));
vi.mock("../onchain/store", () => ({ useChain: () => state, explorerUrl: (_kind: string, address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet` }));
vi.mock("./HoldingsCard", () => ({ default: () => <p>Holdings inspector</p> }));
vi.mock("./RemindersPanel", () => ({ default: () => <p>Renewal reminders</p> }));
const now = Math.floor(Date.now() / 1000);
const account: ContractAcct = {
  address: PublicKey.default.toBase58(), contractId: 1n, buyer: PublicKey.default,
  mint: PublicKey.default, assetId: 1, seriesId: 1, conversionVersion: 1, referenceVersion: 1,
  originalQuantity: 1_000_000n, remainingQuantity: 1_000_000n, pendingQuantity: 0n,
  strike: 1_100_000_000n, expiryTs: now + 3600, exerciseCutoffTs: now + 3000,
  premiumPaid: 80_000_000n, feesPaid: 0n, reservedCollateral: 1_100_000_000n,
  status: "Active", createdTs: now - 100, nextRequestNonce: 0,
};
const render = () => renderToStaticMarkup(<PortfolioTab onRenew={() => {}} onProtect={() => {}} />);

describe("Positions presentation", () => {
  beforeEach(() => { state.contracts = []; });
  it("has one purchase CTA in the active empty state", () => {
    const html = render();
    expect(html).toContain("No active positions yet.");
    expect(html).not.toContain("Protect another asset");
  });
  it("does not call a confirmed position absent while its account is loading", () => {
    const html = renderToStaticMarkup(<PortfolioTab target={{ assetId: 1, address: account.address }} onRenew={() => {}} onProtect={() => {}} />);
    expect(html).toContain("Position data hasn’t loaded yet.");
    expect(html).toContain("Refresh positions");
    expect(html).not.toContain("No active");
  });
  it("opens a completed target in history", () => {
    state.contracts = [{ ...account, status: "Expired", remainingQuantity: 0n, reservedCollateral: 0n }];
    const html = renderToStaticMarkup(<PortfolioTab target={{ assetId: 1, address: account.address }} onRenew={() => {}} onProtect={() => {}} />);
    expect(html).toContain("#1 · ANTHROPIC");
    expect(html).toContain("Expired");
    expect(html).not.toContain("No active");
  });
  it("places the position before optional context and collapses exercise and technical detail", () => {
    state.contracts = [account];
    const html = render();
    expect(html.indexOf('class="position-list"')).toBeLessThan(html.indexOf("Expiry reminders"));
    expect(html).toContain('<details class="position-exercise">');
    expect(html).toContain('<details class="position-details">');
    expect(html).toContain("Protected quantity");
    expect(html).toContain("Contract price floor");
    expect(html).toContain("Contract terms &amp; execution receipt");
    expect(html).toContain("Reserved now");
    expect(html).not.toContain("Hypothetical reference");
    expect(html).toContain("Position opened");
    expect(html).toContain("Verify contract account");
  });
  it("shows pending settlement guidance without an exercise action when no quantity remains", () => {
    state.contracts = [{ ...account, remainingQuantity: 0n, pendingQuantity: 1_000_000n }];
    const html = render();
    expect(html).toContain("pending — the keeper settles");
    expect(html).not.toContain('<details class="position-exercise">');
  });
  it("shows positions from both assets by default", () => {
    state.contracts = [account, { ...account, assetId: 0, address: "second-position", contractId: 2n }];
    const html = render();
    expect(html).toContain("All assets");
    expect(html).toContain("#1 · ANTHROPIC");
    expect(html).toContain("#2 · NVDAx");
    expect(html).toContain("Review exercise");
    expect(html).not.toContain("Confirm exercise");
  });
  it("highlights and leads with the position selected after purchase", () => {
    state.contracts = [{ ...account, address: "another", contractId: 2n, createdTs: now }, account];
    const html = renderToStaticMarkup(<PortfolioTab target={{ assetId: 1, address: account.address }} onRenew={() => {}} onProtect={() => {}} />);
    expect(html).toContain("Your selected position");
    expect(html.indexOf("#1 · ANTHROPIC")).toBeLessThan(html.indexOf("#2 · ANTHROPIC"));
    expect(html).toContain("Hold to expiry or request early exercise.");
  });
  it("offers a fresh position and does not invent missing settlement amounts", () => {
    state.contracts = [{ ...account, status: "Expired", remainingQuantity: 0n }];
    const html = renderToStaticMarkup(<PortfolioTab target={{ assetId: 1, address: account.address }} onRenew={() => {}} onProtect={() => {}} />);
    expect(html).toContain("Open a similar position");
    expect(html).toContain("Position outcome");
    expect(html).toContain("Not loaded");
    expect(html).not.toContain("Net contract result");
  });
});
