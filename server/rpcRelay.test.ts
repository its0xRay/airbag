import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { createRpcRelay, validateRpcRequest } from "./rpcRelay";
const program = PublicKey.default.toBase58();
const request = (method: string, params: unknown[]) => ({ jsonrpc: "2.0", id: 1, method, params });
afterEach(() => vi.unstubAllGlobals());
describe("public RPC boundary", () => {
  it("shares concurrent reads without caching completed results or losing caller IDs", async () => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({ result: 123 })));
    vi.stubGlobal("fetch", upstream);
    const relay = createRpcRelay("https://provider.test/private", program);
    const replies = await Promise.all([relay(request("getGenesisHash", [])), relay({ ...request("getGenesisHash", []), id: 2 })]);
    expect(replies.map(r => r.id)).toEqual([1, 2]);
    expect(upstream).toHaveBeenCalledTimes(1);
    await relay(request("getGenesisHash", []));
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(relay.stats().sharedReads).toBe(1);
  });
  it("rejects batches and arbitrary RPC methods", () => {
    expect(() => validateRpcRequest([], program)).toThrow();
    expect(() => validateRpcRequest(request("requestAirdrop", [program, 100]), program)).toThrow();
    expect(() => validateRpcRequest(request("getBlock", [1]), program)).toThrow();
  });
  it("limits account reads to filtered Optket accounts", () => {
    expect(() => validateRpcRequest(request("getProgramAccounts", [program]), program)).toThrow();
    const result = validateRpcRequest(request("getProgramAccounts", [program, { filters: [{ memcmp: { offset: 16, bytes: program } }], encoding: "jsonParsed" }]), program);
    expect(result.params[1]).toMatchObject({ encoding: "base64", commitment: "confirmed" });
  });
  it("caps signature history and preserves finalized expiry checks", () => {
    expect(validateRpcRequest(request("getSignaturesForAddress", [program, { limit: 1000 }]), program).params[1]).toMatchObject({ limit: 30 });
    expect(validateRpcRequest(request("getBlockHeight", [{ commitment: "finalized" }]), program).params).toEqual([{ commitment: "finalized" }]);
  });
  it("rejects malformed or unsigned transactions", () => {
    expect(() => validateRpcRequest(request("sendTransaction", ["AAAA", { encoding: "base64", skipPreflight: true }]), program)).toThrow();
  });
  it("does not expose upstream errors or the private endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "secret-provider-key" } }))));
    const relay = createRpcRelay("https://provider.test/secret-provider-key", program);
    const response = await relay(request("getGenesisHash", []));
    expect(JSON.stringify(response)).not.toContain("secret-provider-key");
    expect(response).toHaveProperty("error");
    expect(response).toHaveProperty("error.message", "Could not refresh onchain data. Please retry shortly.");
    const confirmation = await relay(request("getBlockHeight", []));
    expect(confirmation).toHaveProperty("error.message", "Could not check transaction status. Do not resubmit until its status is known.");
  });
});
