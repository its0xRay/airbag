import { describe, expect, it, vi } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { ACCT_DISC, OPTKET_PROGRAM_ID } from "../src/client/optketProgram";
import { ACCOUNT, vaultPdas } from "../src/client/vaultProgram";
import { decodeKeeperSnapshot, readKeeperSnapshot } from "./keeperSnapshot";

const key = Keypair.generate().publicKey, round = vaultPdas.round(1, 7n);
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const entry = (data: Buffer, pubkey = key, owner = OPTKET_PROGRAM_ID) => ({ pubkey,
  account: { owner, data, executable: false, lamports: 1, rentEpoch: 0 } });
const roundBytes = Buffer.concat([Buffer.from(ACCOUNT.round), u64(7n), ...Array(5).fill(key.toBuffer()), u32(1), Buffer.alloc(32, 1),
  Buffer.from([1]), u64(100n), u64(200n), u64(500n), ...[1000n, 900n, 50n, 100n, 2n].map(u64), Buffer.from([1]),
  ...[1000n, 0n, 900n, 100n, 10n, 0n, 0n, 1n, 0n, 0n].map(u64)]);
const position = (remaining: bigint) => Buffer.concat([Buffer.from(ACCOUNT.position), round.toBuffer(), key.toBuffer(),
  ...[9n, 500n, 110n, 10n, remaining, 100n, 7n, 600n, 2n].map(u64), u32(3), u64(40n), u64(0n)]);
const request = (status: number) => Buffer.concat([Buffer.from(ACCOUNT.request), key.toBuffer(), u32(2),
  u64(2n), u64(120n), u64(420n), Buffer.from([status]), u64(80n), u64(40n)]);
const contract = (status: number) => Buffer.concat([Buffer.from(ACCT_DISC.Contract), u64(9n), key.toBuffer(), Buffer.from([1, 0, 0]),
  key.toBuffer(), u32(1), u32(1), ...Array(9).fill(u64(1n)), Buffer.from([status]), u64(1n), u32(0)]);
const legacyRequest = (status: number) => Buffer.concat([Buffer.from(ACCT_DISC.ExerciseRequest), key.toBuffer(), u32(1),
  ...[1n, 100n, 101n, 401n].map(u64), Buffer.from([1, status]), u64(1n), u64(1n), u64(1n)]);

describe("fresh unified keeper snapshot", () => {
  it("decodes both assets/legacy paths and excludes completed obligations", () => {
    const accounts = [entry(roundBytes, round), entry(position(1n)), entry(position(0n)), entry(request(0)), entry(request(1)),
      entry(contract(0)), entry(contract(1)), entry(contract(3)), entry(legacyRequest(0)), entry(legacyRequest(2)), entry(Buffer.alloc(8))];
    const snapshot = decodeKeeperSnapshot(accounts, OPTKET_PROGRAM_ID, true);
    expect(snapshot.contracts).toHaveLength(2);
    expect(snapshot.requests).toHaveLength(1);
    expect(snapshot.vaults.rounds).toHaveLength(1);
    expect(snapshot.vaults.positions).toHaveLength(1);
    expect(snapshot.vaults.requests).toHaveLength(1);
    expect(snapshot.accountCount).toBe(accounts.length);
    expect(snapshot.dataBytes).toBe(accounts.reduce((n, a) => n + a.account.data.length, 0));
    expect(decodeKeeperSnapshot(accounts, OPTKET_PROGRAM_ID, false).vaults.rounds).toEqual([]);
  });
  it("rejects bad owners and malformed known account types, rather than dropping obligations", () => {
    expect(() => decodeKeeperSnapshot([entry(position(1n), key, key)], OPTKET_PROGRAM_ID, true)).toThrow(/owner/);
    for (const disc of [ACCT_DISC.Contract, ACCT_DISC.ExerciseRequest, ACCOUNT.round, ACCOUNT.position, ACCOUNT.request]) {
      expect(() => decodeKeeperSnapshot([entry(Buffer.from(disc))], OPTKET_PROGRAM_ID, true)).toThrow();
    }
    expect(() => decodeKeeperSnapshot([entry(roundBytes)], OPTKET_PROGRAM_ID, true)).toThrow(/round/);
  });
  it("makes one fresh scan per cycle and discovers new exercise requests next cycle", async () => {
    const getProgramAccounts = vi.fn().mockResolvedValueOnce({ context: { slot: 10 }, value: [] })
      .mockResolvedValueOnce({ context: { slot: 11 }, value: [entry(request(0)), entry(position(1n))] })
      .mockRejectedValueOnce(new Error("RPC unavailable"))
      .mockResolvedValueOnce({ context: { slot: 12 }, value: [] });
    const conn = { getProgramAccounts } as unknown as Connection;
    expect((await readKeeperSnapshot(conn, OPTKET_PROGRAM_ID, true)).vaults.requests).toEqual([]);
    expect((await readKeeperSnapshot(conn, OPTKET_PROGRAM_ID, true)).vaults.requests).toHaveLength(1);
    await expect(readKeeperSnapshot(conn, OPTKET_PROGRAM_ID, true)).rejects.toThrow("RPC unavailable");
    expect((await readKeeperSnapshot(conn, OPTKET_PROGRAM_ID, true)).vaults.positions).toEqual([]);
    expect(getProgramAccounts).toHaveBeenCalledTimes(4);
    expect(getProgramAccounts).toHaveBeenCalledWith(OPTKET_PROGRAM_ID, { commitment: "confirmed", withContext: true });
  });
});
