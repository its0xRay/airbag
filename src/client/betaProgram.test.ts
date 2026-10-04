import { describe, it, expect, vi } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { Buffer } from "buffer";
import { VaultClient, vaultPdas, vaultPdasFor, vaultQuoteMessage } from "./vaultProgram";
import { USDC_MINT, betaPdas, withBetaAccounts, initializeBetaPolicyIx, seedVaultIx, readBetaPolicy, BETA_TESTER_LIMIT, BETA_SEED_LIMIT } from "./betaProgram";
import { OPTKET_PROGRAM_ID } from "./optketProgram";
describe("isolated beta bindings",()=>{
  it("derives all vault addresses and quote domains using the configured program",()=>{
    const program=Keypair.generate().publicKey, owner=Keypair.generate().publicKey;
    const client=new VaultClient(new Connection("http://127.0.0.1:8899"),program),p=client.pdas;
    const round=p.round(0,1n);
    expect(round.equals(vaultPdas.round(0,1n))).toBe(false);
    const ix=withBetaAccounts(client.depositIx({address:round,custody:p.custody(round),mint:USDC_MINT},owner,owner,1n),owner);
    expect(ix.programId.equals(program)).toBe(true);
    expect(ix.keys[2].pubkey.equals(p.config())).toBe(true);
    expect(ix.keys[4].pubkey.equals(p.deposit(round,owner))).toBe(true);
    expect(ix.keys.at(-2)?.pubkey.equals(betaPdas(program).policy)).toBe(true);
    expect(ix.keys.at(-1)?.pubkey.equals(betaPdas(program).access(owner))).toBe(true);
    const payload=new Uint8Array(95);
    expect(vaultQuoteMessage(round,payload,program)).not.toEqual(vaultQuoteMessage(round,payload));
    expect(vaultPdasFor(OPTKET_PROGRAM_ID).round(0,1n)).toEqual(vaultPdas.round(0,1n));
  });
  it("requires explicit nonzero global allowance",()=>{
    const p=Keypair.generate().publicKey;
    expect(()=>initializeBetaPolicyIx(p,p,p,0n)).toThrow();
    expect(()=>initializeBetaPolicyIx(p,p,p,BETA_TESTER_LIMIT+1n)).toThrow();
    expect(initializeBetaPolicyIx(p,p,p,10_000_000n).data.length).toBe(48);
  });
  it("uses a distinct seed instruction with the same custody and access checks",()=>{
    const program=Keypair.generate().publicKey,owner=Keypair.generate().publicKey;
    const client=new VaultClient(new Connection("http://127.0.0.1:8899"),program);
    const address=client.pdas.round(0,1n),round={address,custody:client.pdas.custody(address),mint:USDC_MINT};
    const seed=seedVaultIx(client,round,owner,BETA_SEED_LIMIT);
    const deposit=withBetaAccounts(client.depositIx(round,owner,owner,BETA_SEED_LIMIT),owner);
    expect(seed.keys).toEqual(deposit.keys);
    expect([...seed.data.subarray(0,8)]).toEqual([181,183,221,107,162,110,142,222]);
    expect(seed.data.subarray(0,8)).not.toEqual(deposit.data.subarray(0,8));
    expect(seed.data.subarray(8)).toEqual(deposit.data.subarray(8));
    expect(()=>seedVaultIx(client,round,owner,0n)).toThrow();
    expect(()=>seedVaultIx(client,round,owner,BETA_SEED_LIMIT+1n)).toThrow();
  });
  it("decodes separate budgets and rejects older or excessive policy states",async()=>{
    const program=Keypair.generate().publicKey,authority=Keypair.generate().publicKey;
    const data=Buffer.alloc(64);data.set([8,136,151,20,70,236,17,160]);data.set(authority.toBytes(),8);
    const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
    view.setBigUint64(40,BETA_TESTER_LIMIT,true);view.setBigUint64(48,10_000_000n,true);view.setBigUint64(56,BETA_SEED_LIMIT,true);
    const getAccountInfo=vi.fn().mockResolvedValue({owner:program,data});
    const conn={getAccountInfo} as unknown as Connection;
    expect(await readBetaPolicy(conn,program)).toEqual({authority,limit:BETA_TESTER_LIMIT,used:10_000_000n,seedUsed:BETA_SEED_LIMIT,seedLimit:BETA_SEED_LIMIT});
    view.setBigUint64(56,BETA_SEED_LIMIT+1n,true);
    await expect(readBetaPolicy(conn,program)).rejects.toThrow();
    getAccountInfo.mockResolvedValue({owner:program,data:data.subarray(0,56)});
    await expect(readBetaPolicy(conn,program)).rejects.toThrow();
  });
});
