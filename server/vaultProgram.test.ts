import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { VAULT_IX, decodeVaultRound, decodeVaultDeposit, decodeVaultPosition, decodeVaultRequest, vaultPdas, vaultQuoteMessage, roundStage } from "../src/client/vaultProgram";

const key = Keypair.generate().publicKey;
const round = vaultPdas.round(1, 7n);
const disc = (s: string) => createHash("sha256").update(`account:${s}`).digest().subarray(0, 8);
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const offset = (b: Buffer) => Buffer.concat([Buffer.alloc(19, 251), b, Buffer.alloc(7)]).subarray(19, 19 + b.length);
const roundBytes = Buffer.concat([disc("VaultRound"), u64(7n), ...Array(5).fill(key.toBuffer()), u32(1), Buffer.alloc(32, 1),
  Buffer.from([1]), u64(100n), u64(200n), u64(500n), ...[1000n, 900n, 50n, 100n, 2n].map(u64), Buffer.from([1]),
  ...[1000n, 0n, 900n, 100n, 10n, 0n, 0n, 1n, 0n, 0n].map(u64), Buffer.from([255])]);

describe("vault wire format", () => {
  it("matches Anchor instruction discriminators", () => {
    for (const [name, bytes] of Object.entries(VAULT_IX)) expect([...createHash("sha256").update(`global:${name}`).digest().subarray(0, 8)]).toEqual(bytes);
  });
  it.each([roundBytes, offset(roundBytes), Uint8Array.from(roundBytes)])("decodes round numeric fields from Buffer and offset views", data => {
    const r = decodeVaultRound(round, data);
    expect(r.roundId).toBe(7n); expect(r.assetId).toBe(1); expect(r.referenceVersion).toBe(1);
    expect(r.fundingClose).toBe(100); expect(r.latestExpiry).toBe(500);
    expect(r.totalShares).toBe(1000n); expect(r.reserved).toBe(100n); expect(r.premiums).toBe(10n);
    expect(roundStage(r, 199)).toBe("Active"); expect(roundStage(r, 200)).toBe("Settling");
  });
  it("rejects truncated and incorrectly addressed round accounts", () => {
    expect(() => decodeVaultRound(round, roundBytes.subarray(0, 300))).toThrow();
    expect(() => decodeVaultRound(key, roundBytes)).toThrow();
  });
  it("decodes ownership and redemption amounts without float conversion", () => {
    const bytes = Buffer.concat([disc("VaultDeposit"), round.toBuffer(), key.toBuffer(), u64(9007199254740993n), Buffer.from([1]), u64(17n)]);
    const d = decodeVaultDeposit(vaultPdas.deposit(round, key), offset(bytes));
    expect(d.shares).toBe(9007199254740993n); expect(d.redeemed).toBe(true); expect(d.redemptionAmount).toBe(17n);
  });
  it("decodes position and request fields at their exact offsets", () => {
    const address = vaultPdas.position(round, 9n);
    const bytes = Buffer.concat([disc("VaultPosition"), round.toBuffer(), key.toBuffer(), ...[9n, 500n, 110n, 10n, 6n, 100n, 7n, 600n, 2n].map(u64), u32(3), u64(40n), u64(0n)]);
    const p = decodeVaultPosition(address, offset(bytes));
    expect(p.quoteId).toBe(9n); expect(p.pendingQuantity).toBe(2n); expect(p.nextNonce).toBe(3); expect(p.totalPayout).toBe(40n);
    const request = Buffer.concat([disc("VaultRequest"), address.toBuffer(), u32(2), u64(2n), u64(120n), u64(420n), Buffer.from([1]), u64(80n), u64(40n)]);
    const r = decodeVaultRequest(vaultPdas.request(address, 2), offset(request));
    expect(r.nonce).toBe(2); expect(r.windowEnd).toBe(420); expect(r.reference).toBe(80n); expect(r.payout).toBe(40n);
  });
  it("binds the signed payload to its round and validates payload length", () => {
    const payload = new Uint8Array(95);
    expect(vaultQuoteMessage(round, payload)).not.toEqual(vaultQuoteMessage(vaultPdas.round(0, 7n), payload));
    expect(() => vaultQuoteMessage(round, new Uint8Array(94))).toThrow();
  });
});
