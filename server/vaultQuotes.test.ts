import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { signedVaultQuote, vaultPolicyHash } from "./vaultQuotes";
import { vaultPdas, type VaultClient, type VaultRoundAccount } from "../src/client/vaultProgram";

const signer = Keypair.generate(), buyer = Keypair.generate().publicKey;
const U = 1_000_000n;
function fixture(assetId: number) {
  const round: VaultRoundAccount = { address: vaultPdas.round(assetId, 1n), assetId, quoteAuthority: signer.publicKey,
    roundId: 1n, mint: buyer, custody: buyer, publisherAuthority: signer.publicKey, administrator: buyer,
    fundingClose: 900, depositCap: 1000n * U, totalShares: 1000n * U, redeemedShares: 0n,
    premiums: 0n, payouts: 0n, refunds: 0n, openContracts: 0n, finalBalance: 0n, redeemedAmount: 0n,
    pricingPolicy: vaultPolicyHash(assetId), referenceVersion: assetId === 0 ? 2 : 1,
    phase: "active", salesClose: 1500, latestExpiry: 1800, maxQuantity: 10n * U,
    minStrike: 50n * U, maxStrike: 100n * U, principalAvailable: 1000n * U,
    reserved: 0n, exposureCap: 1000n * U };
  const client = { getRound: vi.fn(async () => round) } as unknown as VaultClient;
  const reference = vi.fn(async () => ({ available: true, spot: 100n * U }));
  const input = { buyer: buyer.toBase58(), round: round.address.toBase58(), quantity: U.toString(), strike: (100n * U).toString() };
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  return { round, client, reference, input };
}
afterEach(() => vi.restoreAllMocks());
describe("vault executable quotes", () => {
  it.each([0, 1])("signs a round-bound quote for asset %s", async asset => {
    const { client, reference, input } = fixture(asset);
    const q = await signedVaultQuote(client, signer, reference, input);
    expect(q.quoteExpiryTs).toBe(1060); expect(q.expiryTs).toBe(1800);
    expect(nacl.sign.detached.verify(Buffer.from(q.message, "base64"), Buffer.from(q.signature, "base64"), signer.publicKey.toBytes())).toBe(true);
    expect(Buffer.from(q.payload, "base64").length).toBe(95);
  });
  it("fails closed without a genuine qualifying reference", async () => {
    const { client, input } = fixture(0);
    await expect(signedVaultQuote(client, signer, async () => ({ available: false }), input)).rejects.toThrow("qualifying");
  });
  it("does not replace a frozen pricing policy", async () => {
    const { round, client, reference, input } = fixture(0); round.pricingPolicy = new Uint8Array(32);
    await expect(signedVaultQuote(client, signer, reference, input)).rejects.toThrow("pricing policy");
    expect(reference).not.toHaveBeenCalled();
  });
  it("does not issue from insufficient depositor principal", async () => {
    const { round, client, reference, input } = fixture(1); round.principalAvailable = 1n;
    await expect(signedVaultQuote(client, signer, reference, input)).rejects.toThrow("capacity");
  });
  it("rejects quantities and floors beyond the frozen terms", async () => {
    const { client, reference, input } = fixture(1);
    await expect(signedVaultQuote(client, signer, reference, { ...input, quantity: "0" })).rejects.toThrow("terms");
    await expect(signedVaultQuote(client, signer, reference, { ...input, strike: (101n * U).toString() })).rejects.toThrow("terms");
  });
  it("stops sales at the cutoff and during funding", async () => {
    const { round, client, reference, input } = fixture(1); round.salesClose = 1000;
    await expect(signedVaultQuote(client, signer, reference, input)).rejects.toThrow("not issuing");
    round.salesClose = 1500; round.phase = "funding";
    await expect(signedVaultQuote(client, signer, reference, input)).rejects.toThrow("not issuing");
  });
});
