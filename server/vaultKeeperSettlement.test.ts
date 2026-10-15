import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, sendAndConfirmTransaction, TransactionInstruction } from "@solana/web3.js";
import type { VaultClient, VaultPositionAccount, VaultRequestAccount, VaultRoundAccount } from "../src/client/vaultProgram";
import type { VaultSnapshot } from "./keeperSnapshot";
import { tickVaults } from "./vaultKeeper";

vi.mock("@solana/web3.js", async importOriginal => ({ ...await importOriginal<typeof import("@solana/web3.js")>(), sendAndConfirmTransaction: vi.fn() }));
const publisher = Keypair.generate(), address = Keypair.generate().publicKey;
const instruction = () => new TransactionInstruction({ programId: PublicKey.default, keys: [], data: Buffer.alloc(0) });
const now = Math.floor(Date.now() / 1000);
const observations = [1n, 2n, 3n].map(slot => ({ slot, sourceTs: now - 10, collectedTs: now - 10, price: 100n }));
const makeRound = (props: Partial<VaultRoundAccount> = {}) => ({ address, publisherAuthority: publisher.publicKey, assetId: 0,
  phase: "active", fundingClose: now - 1000, salesClose: now - 10, totalShares: 100n, reserved: 100n, openContracts: 1n, ...props }) as VaultRoundAccount;
const makePosition = (props: Partial<VaultPositionAccount> = {}) => ({ address: Keypair.generate().publicKey, round: address,
  remainingQuantity: 1n, pendingQuantity: 0n, expiryTs: now - 1, ...props }) as VaultPositionAccount;
const clientFor = (fresh: VaultRoundAccount | null) => ({ conn: {}, getRound: vi.fn(async () => fresh),
  rounds: vi.fn(), positions: vi.fn(), requests: vi.fn(), settleIx: vi.fn(instruction), failRequestIx: vi.fn(instruction),
  advanceIx: vi.fn(instruction) }) as unknown as VaultClient;
beforeEach(() => { vi.mocked(sendAndConfirmTransaction).mockReset().mockResolvedValue("test-signature"); });

describe("settlement with shared discovery snapshot", () => {
  it.each([0, 1])("settles asset %s and only finalizes after a fresh zero-obligation read", async assetId => {
    const r = makeRound({ assetId }), p = makePosition(), samples = vi.fn(() => observations);
    const fresh = makeRound({ assetId, reserved: 0n, openContracts: 0n }), client = clientFor(fresh);
    expect(await tickVaults(client, publisher, samples, { rounds: [r], positions: [p], requests: [] })).toEqual([]);
    expect(client.settleIx).toHaveBeenCalledWith(r, p, observations);
    expect(samples).toHaveBeenCalledWith(assetId, p.expiryTs - 300, p.expiryTs);
    expect(client.getRound).toHaveBeenCalledTimes(1);
    expect(client.advanceIx).toHaveBeenCalledWith(fresh, publisher.publicKey, "finalize");
    expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(2);
  });
  it("does not finalize from a stale snapshot if fresh state still has obligations", async () => {
    const r = makeRound({ openContracts: 0n, reserved: 0n }), client = clientFor(makeRound());
    await tickVaults(client, publisher, () => [], { rounds: [r], positions: [], requests: [] });
    expect(client.getRound).toHaveBeenCalledTimes(1);
    expect(client.advanceIx).not.toHaveBeenCalled();
  });
  it("settles partial exercise against the post-request window, not expiry in the same tick", async () => {
    const r = makeRound(), p = makePosition({ pendingQuantity: 1n });
    const request = { position: p.address, status: 0, windowStart: now - 400, windowEnd: now - 100 } as VaultRequestAccount;
    const client = clientFor(r), samples = vi.fn(() => observations);
    await tickVaults(client, publisher, samples, { rounds: [r], positions: [p], requests: [request] });
    expect(samples).toHaveBeenCalledWith(0, request.windowStart + 1, request.windowEnd);
    expect(client.settleIx).toHaveBeenCalledExactlyOnceWith(r, p, observations, request);
    expect(client.advanceIx).not.toHaveBeenCalled();
  });
  it("preserves missing-reference grace periods and refund/failure paths", async () => {
    const r = makeRound({ salesClose: now + 100 }), p = makePosition({ expiryTs: now - 301 });
    const client = clientFor(r);
    await tickVaults(client, publisher, () => [], { rounds: [r], positions: [p], requests: [] });
    expect(client.settleIx).toHaveBeenCalledExactlyOnceWith(r, p, null);
    vi.mocked(client.settleIx).mockClear();
    await tickVaults(client, publisher, () => [], { rounds: [r], positions: [makePosition()], requests: [] });
    expect(client.settleIx).not.toHaveBeenCalled();
    const pending = makePosition({ pendingQuantity: 1n });
    const request = { position: pending.address, status: 0, windowStart: now - 1000, windowEnd: now - 301 } as VaultRequestAccount;
    await tickVaults(client, publisher, () => [], { rounds: [r], positions: [pending], requests: [request] });
    expect(client.failRequestIx).toHaveBeenCalledWith(pending, request, publisher.publicKey);
  });
  it("retries failed settlement next tick without prematurely releasing a round", async () => {
    const r = makeRound(), client = clientFor(r), p = makePosition();
    const snapshot: VaultSnapshot = { rounds: [r], positions: [p], requests: [] };
    vi.mocked(sendAndConfirmTransaction).mockRejectedValueOnce(new Error("RPC failed"));
    expect(await tickVaults(client, publisher, () => observations, snapshot)).toHaveLength(1);
    expect(client.advanceIx).not.toHaveBeenCalled();
    expect(await tickVaults(client, publisher, () => observations, snapshot)).toEqual([]);
    expect(client.settleIx).toHaveBeenCalledTimes(2);
  });
  it("freshly verifies funded activation while leaving other publishers untouched", async () => {
    const r = makeRound({ phase: "funding", salesClose: now + 100, totalShares: 1n });
    const client = clientFor(r);
    await tickVaults(client, publisher, () => [], { rounds: [r], positions: [], requests: [] });
    expect(client.advanceIx).toHaveBeenCalledWith(r, publisher.publicKey, "activate");
    const other = makeRound({ publisherAuthority: Keypair.generate().publicKey });
    await tickVaults(client, publisher, () => observations, { rounds: [other], positions: [makePosition()], requests: [] });
    expect(client.settleIx).not.toHaveBeenCalled();
  });
});
