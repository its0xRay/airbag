import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { nextVaultTerms, publishAvailableVaultRounds } from "./vaultRotation";
import type { VaultClient, VaultRoundAccount } from "../src/client/vaultProgram";
import { PublicationSchedule } from "./publicationSchedule";
const now = 18000, spot = 200_000_000n;
const round = (props: Partial<VaultRoundAccount>) => ({ assetId: 0, roundId: 1n, phase: "active", fundingClose: now - 100, ...props }) as VaultRoundAccount;
describe("bounded automatic vault publication", () => {
  it("freezes bounded terms with no seed instruction and stable restart identity", () => {
    const a = nextVaultTerms([], 0, now, spot)!;
    expect(a.id).toBe(nextVaultTerms([], 0, now + 60, spot)!.id);
    expect(a.terms).toMatchObject({ fundingClose: 86400, salesClose: 604800, latestExpiry: 691200,
      minStrike: 10_000n, maxStrike: 10_000_000_000n, maxQuantity: 5_000_000n, exposureCap: 10_000_000_000n });
  });
  it("does not duplicate a current funding window or same slot", () => {
    expect(nextVaultTerms([round({ phase: "funding", fundingClose: now + 100 })], 0, now, spot)).toBeNull();
    expect(nextVaultTerms([round({ roundId: nextVaultTerms([], 0, now, spot)!.id, phase: "redeemable" })], 0, now, spot)).toBeNull();
  });
  it("stops accumulating rounds if the keeper has a backlog", () => {
    expect(nextVaultTerms(Array.from({ length: 10 }, () => round({})), 0, now, spot)).toBeNull();
    expect(nextVaultTerms(Array.from({ length: 8 }, () => round({})), 0, now, spot)).not.toBeNull();
    expect(nextVaultTerms([round({}), round({ phase: "redeemable" }), round({ assetId: 1 })], 0, now, spot)).not.toBeNull();
  });
  it("does not publish unusably short funding windows or invalid terms", () => {
    expect(nextVaultTerms([], 0, 86300, spot)).toBeNull();
    expect(nextVaultTerms([], 2, now, spot)).toBeNull();
    expect(nextVaultTerms([], 0, now, 0n)).toBeNull();
  });
  it("skips idle publication RPCs and reference checks, but reconciles within five minutes", async () => {
    let monotonic = 100;
    const schedule = new PublicationSchedule(() => ({ wall: 1000, monotonic }));
    const conn = { getGenesisHash: vi.fn(async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"),
      getSlot: vi.fn(async () => 10), getBlockTime: vi.fn(async () => now), getAccountInfo: vi.fn(), getBalance: vi.fn() };
    const rounds = vi.fn(async () => [0, 1].map(assetId => round({ assetId, phase: "funding", fundingClose: now + 86400 })));
    const client = { conn, rounds } as unknown as VaultClient, reference = vi.fn();
    const admin = Keypair.generate();
    await publishAvailableVaultRounds(client, admin, reference, schedule);
    for (let i = 1; i < 5; i++) {
      monotonic += 60_000;
      await publishAvailableVaultRounds(client, admin, reference, schedule);
    }
    expect(rounds).toHaveBeenCalledTimes(1);
    expect(conn.getAccountInfo).not.toHaveBeenCalled();
    expect(conn.getBalance).not.toHaveBeenCalled();
    expect(reference).not.toHaveBeenCalled();
    monotonic += 60_000;
    await publishAvailableVaultRounds(client, admin, reference, schedule);
    expect(rounds).toHaveBeenCalledTimes(2);
  });
  it("checks freshly at the funding deadline and does not reuse success after RPC errors", async () => {
    let monotonic = 0;
    const schedule = new PublicationSchedule(() => ({ wall: 1000, monotonic }));
    const conn = { getGenesisHash: vi.fn(async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"),
      getSlot: vi.fn(async () => 10), getBlockTime: vi.fn(async () => now) };
    const rounds = vi.fn().mockResolvedValueOnce([0, 1].map(assetId => round({ assetId, phase: "funding", fundingClose: now + 60 })))
      .mockRejectedValue(new Error("rpc"));
    const client = { conn, rounds } as unknown as VaultClient, admin = Keypair.generate();
    await publishAvailableVaultRounds(client, admin, vi.fn(), schedule);
    monotonic = 60_000;
    await expect(publishAvailableVaultRounds(client, admin, vi.fn(), schedule)).rejects.toThrow("rpc");
    await expect(publishAvailableVaultRounds(client, admin, vi.fn(), schedule)).rejects.toThrow("rpc");
    expect(rounds).toHaveBeenCalledTimes(3);
  });
});
