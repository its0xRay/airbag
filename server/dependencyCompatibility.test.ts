import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID, getMint, getAccount } from "@solana/spl-token";
import { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE } from "bigint-buffer";

const require = createRequire(import.meta.url);
describe("security dependency compatibility", () => {
  it("resolves SPL integer conversions to the audited local workspace", () => {
    const layoutRequire = createRequire(require.resolve("@solana/buffer-layout-utils"));
    expect(layoutRequire.resolve("bigint-buffer")).toBe(require.resolve("../vendor/bigint-buffer/index.cjs"));
  });
  it("round-trips unsigned Solana integer widths with exact byte order", () => {
    for (const width of [1, 2, 4, 8, 16, 24, 32]) {
      const max = (1n << BigInt(width * 8)) - 1n;
      for (const value of [0n, 1n, 255n, max / 2n, max]) {
        const le = toBufferLE(value, width), be = toBufferBE(value, width);
        expect(le).toHaveLength(width);
        expect(toBigIntLE(le)).toBe(value);
        expect(toBigIntBE(be)).toBe(value);
        expect(Buffer.from(le).reverse()).toEqual(be);
        if (width === 8) expect(le.readBigUInt64LE()).toBe(value);
      }
      for (let seed = 0; seed < 100; seed++) {
        const bytes = Buffer.from(Array.from({ length: width }, (_, index) => (seed * 37 + index * 131) % 256));
        const original = Buffer.from(bytes);
        expect(toBufferLE(toBigIntLE(bytes), width)).toEqual(original);
        expect(toBufferBE(toBigIntBE(bytes), width)).toEqual(original);
        expect(bytes).toEqual(original);
      }
    }
  });
  it("rejects unsafe writes without native code and accepts empty input", () => {
    expect(toBigIntLE(Buffer.alloc(0))).toBe(0n);
    expect(toBigIntBE(Buffer.alloc(0))).toBe(0n);
    expect(toBufferLE(0n, 0)).toEqual(Buffer.alloc(0));
    for (const width of [-1, 0.5, NaN, Infinity, 1048577]) expect(() => toBufferLE(1n, width)).toThrow();
    expect(() => toBufferLE(-1n, 8)).toThrow();
    expect(() => toBufferBE(256n, 1)).toThrow();
    expect(() => toBufferBE(1n, 0)).toThrow();
    // Larger-than-native-word input remains safe and exact.
    const large = Buffer.alloc(1024, 255);
    expect(toBufferBE(toBigIntLE(large), large.length)).toEqual(large);
  });
  it("retains SPL mint and account decoding above Number.MAX_SAFE_INTEGER", async () => {
    const amount = (1n << 64n) - 1n;
    const mint = Keypair.generate().publicKey, owner = Keypair.generate().publicKey;
    const mintData = Buffer.alloc(MintLayout.span), accountData = Buffer.alloc(AccountLayout.span);
    MintLayout.encode({ mintAuthorityOption: 1, mintAuthority: owner, supply: amount, decimals: 6,
      isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default,
      state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n,
      closeAuthorityOption: 0, closeAuthority: PublicKey.default }, accountData);
    const conn = { getAccountInfo: async (address: PublicKey) => ({ owner: TOKEN_PROGRAM_ID, data: address.equals(mint) ? mintData : accountData }) } as unknown as Connection;
    expect((await getMint(conn, mint)).supply).toBe(amount);
    expect((await getAccount(conn, owner)).amount).toBe(amount);
  });
  it("preserves web3 JSON-RPC calls and signed transaction serialization", async () => {
    const calls: string[] = [];
    const conn = new Connection("https://rpc.test", { fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(typeof request.id).toBe("string");
      calls.push(request.method);
      const result = request.method === "getBalance" ? { context: { slot: 1 }, value: 123 }
        : request.method === "getProgramAccounts" ? [] : 456;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    } });
    expect(await conn.getBalance(PublicKey.default)).toBe(123);
    expect(await conn.getProgramAccounts(PublicKey.default)).toEqual([]);
    expect(await conn.getBlockHeight()).toBe(456);
    expect(calls).toEqual(["getBalance", "getProgramAccounts", "getBlockHeight"]);
    const signer = Keypair.generate();
    const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: PublicKey.default.toBase58() })
      .add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: PublicKey.default, lamports: 1 }));
    tx.sign(signer);
    expect(Transaction.from(tx.serialize()).verifySignatures()).toBe(true);
  });
  it("keeps Anchor's TOML parser and Mocha's serializer callable", () => {
    const anchorRequire = createRequire(require.resolve("@coral-xyz/anchor"));
    const config = anchorRequire("toml").parse(readFileSync("Anchor.toml"));
    expect(config.toolchain.anchor_version).toBe("0.30.1");
    expect(typeof anchorRequire("@coral-xyz/anchor").Program).toBe("function");
    const mochaRequire = createRequire(require.resolve("mocha"));
    const serialize = mochaRequire("serialize-javascript");
    expect(serialize({ value: "</script>", count: 1 })).not.toContain("</script>");
    expect(serialize({ count: 1 })).toContain('"count":1');
  });
});
