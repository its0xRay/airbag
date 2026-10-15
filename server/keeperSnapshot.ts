import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { ACCT_DISC, decodeContract, decodeRequest, type ContractAcct, type ExerciseRequestAcct } from "../src/client/optketProgram";
import { ACCOUNT, decodeVaultRound, decodeVaultPosition, decodeVaultRequest,
  type VaultRoundAccount, type VaultPositionAccount, type VaultRequestAccount } from "../src/client/vaultProgram";

export interface VaultSnapshot {
  rounds: VaultRoundAccount[];
  positions: VaultPositionAccount[];
  requests: VaultRequestAccount[];
}
export interface KeeperSnapshot {
  contracts: ContractAcct[];
  requests: ExerciseRequestAcct[];
  vaults: VaultSnapshot;
  accountCount: number;
  dataBytes: number;
}

/** One fresh confirmed snapshot replaces five separate discovery scans. No TTL
 * cache: new purchases and exercise requests remain visible on every tick.
 * Unknown account types (config, series, deposits, replay markers) are ignored.
 * A malformed recognized account fails the read, never becomes an empty list. */
export function decodeKeeperSnapshot(accounts: ReadonlyArray<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>,
  program: PublicKey, includeVaults: boolean): KeeperSnapshot {
  const snapshot: KeeperSnapshot = { contracts: [], requests: [], vaults: { rounds: [], positions: [], requests: [] },
    accountCount: accounts.length, dataBytes: 0 };
  for (const { pubkey, account } of accounts) {
    if (!account.owner.equals(program)) throw new Error("Unexpected keeper account owner");
    const data = account.data;
    snapshot.dataBytes += data.length;
    const is = (disc: readonly number[]) => disc.every((v, i) => data[i] === v);
    if (is(ACCT_DISC.Contract)) {
      const contract = decodeContract(pubkey.toBase58(), data);
      if (contract.status === "Active" || contract.status === "PartiallySettled") snapshot.contracts.push(contract);
    } else if (is(ACCT_DISC.ExerciseRequest)) {
      const request = decodeRequest(pubkey.toBase58(), data);
      if (request.status === "Pending") snapshot.requests.push(request);
    } else if (includeVaults && is(ACCOUNT.round)) {
      snapshot.vaults.rounds.push(decodeVaultRound(pubkey, data, program));
    } else if (includeVaults && is(ACCOUNT.position)) {
      const position = decodeVaultPosition(pubkey, data);
      if (position.remainingQuantity > 0n) snapshot.vaults.positions.push(position);
    } else if (includeVaults && is(ACCOUNT.request)) {
      const request = decodeVaultRequest(pubkey, data);
      if (request.status === 0) snapshot.vaults.requests.push(request);
    }
  }
  return snapshot;
}

export async function readKeeperSnapshot(conn: Connection, program: PublicKey, includeVaults: boolean) {
  const response = await conn.getProgramAccounts(program, { commitment: "confirmed", withContext: true });
  return { ...decodeKeeperSnapshot(response.value, program, includeVaults), slot: response.context.slot };
}
