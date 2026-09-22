import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "@solana/web3.js";
import { loadTransaction, saveTransaction, pendingTransaction, reconcileTransaction, rpcScope, type TrackedTransaction } from "./transactionRecovery";

const tx: TrackedTransaction = { signature: "original", buyer: "buyer", rpc: rpcScope("test"), blockhash: "hash", lastValidBlockHeight: 100, state: "checking" };
function connection(statuses: unknown[], height = 90) {
  const getSignatureStatuses = vi.fn();
  statuses.forEach(value => getSignatureStatuses.mockResolvedValueOnce({ value: [value] }));
  return { getSignatureStatuses, getBlockHeight: vi.fn().mockResolvedValue(height) } as unknown as Connection;
}
describe("transaction reconciliation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("restores the original signature after a refresh", () => {
    let saved = "";
    vi.stubGlobal("localStorage", { setItem: (_key: string, value: string) => { saved = value; }, getItem: () => saved });
    saveTransaction(tx);
    expect(loadTransaction()).toEqual(tx);
  });
  it("rejects malformed recovery records", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ ...tx, lastValidBlockHeight: -1 }) });
    expect(loadTransaction()).toBeNull();
  });
  it("blocks only the relevant wallet and endpoint", () => {
    expect(pendingTransaction(tx, "test", "buyer")).toBe(true);
    expect(pendingTransaction(tx, "other", "buyer")).toBe(false);
    expect(pendingTransaction(tx, "test", "other")).toBe(false);
  });
  it("keeps an absent but unexpired signature pending", async () => {
    expect((await reconcileTransaction(connection([null]), tx)).state).toBe("checking");
  });
  it("uses confirmed chain evidence", async () => {
    expect((await reconcileTransaction(connection([{ confirmationStatus: "confirmed", err: null }]), tx)).state).toBe("confirmed");
  });
  it("does not mistake a failed transaction for success", async () => {
    expect((await reconcileTransaction(connection([{ confirmationStatus: "confirmed", err: { InstructionError: [0, "error"] } }]), tx)).state).toBe("failed");
  });
  it("rechecks after finalized expiry before permitting a new submission", async () => {
    expect((await reconcileTransaction(connection([null, null], 101), tx)).state).toBe("expired");
    expect((await reconcileTransaction(connection([null, { confirmationStatus: "finalized", err: null }], 101), tx)).state).toBe("confirmed");
  });
  it("never infers failure from an RPC outage", async () => {
    const conn = connection([]);
    vi.mocked(conn.getSignatureStatuses).mockRejectedValue(new Error("offline"));
    await expect(reconcileTransaction(conn, tx)).rejects.toThrow("offline");
    expect(tx.state).toBe("checking");
  });
});
