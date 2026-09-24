import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TransactionProgress from "./TransactionProgress";

const state = vi.hoisted(() => ({ transaction: { signature: "test-signature", state: "confirmed" }, conn: { rpcEndpoint: "test" }, busy: false }));
vi.mock("../onchain/store", () => ({ useChain: () => state, explorerUrl: () => "https://explorer.solana.com/?cluster=devnet" }));
vi.mock("../onchain/transactionRecovery", () => ({ matchesTransactionChain: () => true }));
describe("Homepage transaction feedback", () => {
  beforeEach(() => { state.transaction.state = "confirmed"; });
  it("keeps a past confirmation out of the hero", () => {
    expect(renderToStaticMarkup(<TransactionProgress showConfirmed={false} onViewPositions={() => {}} />)).toBe("");
  });
  it.each(["checking", "failed", "expired"])("still surfaces a %s transaction", stateName => {
    state.transaction.state = stateName;
    expect(renderToStaticMarkup(<TransactionProgress showConfirmed={false} onViewPositions={() => {}} />)).toContain("Transaction recovery");
  });
  it("retains confirmed transaction access inside the app", () => {
    const html = renderToStaticMarkup(<TransactionProgress onViewPositions={() => {}} />);
    expect(html).toContain("Last transaction confirmed");
    expect(html).toContain("View receipt");
    expect(html).not.toContain("<details open");
  });
});
