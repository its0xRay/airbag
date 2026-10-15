import { afterEach, describe, expect, it, vi } from "vitest";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { getAccount, getMint } from "@solana/spl-token";
import { OptketClient } from "../src/client/optketProgram";
import { VaultClient, type VaultRoundAccount } from "../src/client/vaultProgram";
import { DEVNET_FUNDING, devnetFundingPlan, publishFundedDevnetRounds } from "./devnetFunding";
import { PublicationSchedule } from "./publicationSchedule";
vi.mock("@solana/spl-token", () => ({ getAccount: vi.fn(), getMint: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); });
const now = DEVNET_FUNDING.start + 3600;
function setup() {
  const admin = Keypair.generate(), mint = Keypair.generate().publicKey;
  const conn = new Connection("https://example.test");
  vi.spyOn(conn, "getGenesisHash").mockResolvedValue("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  vi.spyOn(conn, "getSlot").mockResolvedValue(1);
  vi.spyOn(conn, "getBlockTime").mockResolvedValue(now);
  vi.spyOn(conn, "getBalance").mockResolvedValue(2e9);
  vi.spyOn(conn, "getLatestBlockhash").mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 });
  const sent = vi.spyOn(conn, "sendRawTransaction").mockResolvedValue("signature");
  const client = new VaultClient(conn);
  vi.spyOn(client, "getRound").mockResolvedValue(null);
  vi.spyOn(client, "rounds").mockResolvedValue([]);
  vi.spyOn(OptketClient.prototype, "getConfig").mockResolvedValue({ admin: admin.publicKey, demoMint: mint, pausedPurchases: false } as never);
  vi.spyOn(OptketClient.prototype, "getAsset").mockImplementation(async id => ({ active: true, referenceVersion: id === 0 ? 2 : 1 }) as never);
  vi.mocked(getMint).mockResolvedValue({ decimals: 6, mintAuthority: admin.publicKey } as never);
  vi.mocked(getAccount).mockResolvedValue({ amount: 30_000_000_000n } as never);
  const reference = vi.fn(async () => ({ available: true, spot: 200_000_000n }));
  return { admin, conn, client, sent, reference };
}
describe("finite Devnet funding campaign", () => {
  it("has at most 15 stable daily IDs per asset and a 300,000 test-oUSD total ceiling", () => {
    const ids = new Set<bigint>();
    for (let day = 0; day < 20; day++) {
      const plan = devnetFundingPlan(now + day * 86400, 0);
      if (plan) { ids.add(plan.id); expect(plan.seed).toBe(10_000_000_000n); }
    }
    expect(ids.size).toBe(15);
    expect(BigInt(ids.size * 2) * DEVNET_FUNDING.perAssetRound).toBe(300_000_000_000n);
    expect(devnetFundingPlan(now, 0)!.id).toBe(devnetFundingPlan(now + 100, 0)!.id);
    expect(devnetFundingPlan(DEVNET_FUNDING.stop, 0)).toBeNull();
    expect(devnetFundingPlan(DEVNET_FUNDING.start - 1, 0)).toBeNull();
    expect(devnetFundingPlan(now, 2)).toBeNull();
  });
  it("restores in five minutes, then uses daily funding windows and normal weekly expiries", () => {
    expect(devnetFundingPlan(now, 0)!.terms.fundingClose).toBe(now + 300);
    const next = devnetFundingPlan(now + 86400, 1)!;
    expect(next.terms.fundingClose % 86400).toBe(0);
    expect(next.terms.latestExpiry - next.terms.fundingClose).toBe(604800);
  });
  it("creates and deposits atomically, then defers background checks", async () => {
    const s = setup(), schedule = new PublicationSchedule();
    await publishFundedDevnetRounds(s.client, s.admin, s.reference, schedule);
    expect(s.sent).toHaveBeenCalledTimes(2);
    for (const [raw] of s.sent.mock.calls) {
      const tx = Transaction.from(raw);
      expect(tx.instructions).toHaveLength(2);
      expect(tx.instructions[1].data.readBigUInt64LE(8)).toBe(DEVNET_FUNDING.perAssetRound);
      expect(tx.verifySignatures()).toBe(true);
    }
    await publishFundedDevnetRounds(s.client, s.admin, s.reference, schedule);
    expect(s.sent).toHaveBeenCalledTimes(2);
    expect(s.conn.getGenesisHash).toHaveBeenCalledTimes(1);
  });
  it("does not fund existing round IDs after restart or cancellation", async () => {
    const s = setup();
    vi.mocked(s.client.getRound).mockResolvedValue({ totalShares: 0n } as VaultRoundAccount);
    await publishFundedDevnetRounds(s.client, s.admin, s.reference, new PublicationSchedule());
    expect(s.sent).not.toHaveBeenCalled();
    expect(s.reference).not.toHaveBeenCalled();
  });
  it.each(["network", "authority", "paused", "balance", "sol", "mint", "backlog", "reference", "deadline"])("fails closed for %s without sending", async failure => {
    const s = setup();
    if (failure === "network") vi.mocked(s.conn.getGenesisHash).mockResolvedValue("mainnet");
    if (failure === "authority") vi.mocked(OptketClient.prototype.getConfig).mockResolvedValue({ admin: Keypair.generate().publicKey } as never);
    if (failure === "paused") vi.mocked(OptketClient.prototype.getConfig).mockResolvedValue({ admin: s.admin.publicKey, pausedPurchases: true } as never);
    if (failure === "balance") vi.mocked(getAccount).mockResolvedValue({ amount: 1n } as never);
    if (failure === "sol") vi.mocked(s.conn.getBalance).mockResolvedValue(0);
    if (failure === "mint") vi.mocked(getMint).mockResolvedValue({ decimals: 9 } as never);
    if (failure === "backlog") vi.mocked(s.client.rounds).mockResolvedValue([0, 1].flatMap(assetId => Array.from({ length: 10 }, () => ({ assetId, phase: "active" }) as VaultRoundAccount)));
    if (failure === "reference") s.reference.mockResolvedValue({ available: false, spot: 0n });
    if (failure === "deadline") vi.mocked(s.conn.getBlockTime).mockResolvedValueOnce(now).mockResolvedValue(DEVNET_FUNDING.stop);
    await expect(publishFundedDevnetRounds(s.client, s.admin, s.reference, new PublicationSchedule())).rejects.toThrow();
    expect(s.sent).not.toHaveBeenCalled();
  });
  it("reconciles an uncertain send against the durable round before another attempt", async () => {
    const s = setup(), schedule = new PublicationSchedule();
    s.sent.mockRejectedValueOnce(new Error("confirmation uncertain"));
    await expect(publishFundedDevnetRounds(s.client, s.admin, s.reference, schedule)).rejects.toThrow();
    vi.mocked(s.client.getRound).mockResolvedValue({} as VaultRoundAccount);
    await publishFundedDevnetRounds(s.client, s.admin, s.reference, schedule);
    expect(s.sent).toHaveBeenCalledTimes(2);
  });
  it("does not let one unavailable reference block the other asset", async () => {
    const s = setup();
    s.reference.mockResolvedValueOnce({ available: false, spot: 0n });
    await expect(publishFundedDevnetRounds(s.client, s.admin, s.reference, new PublicationSchedule())).rejects.toThrow("asset(s): 0");
    expect(s.sent).toHaveBeenCalledTimes(1);
  });
});
