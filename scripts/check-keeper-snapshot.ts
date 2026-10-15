// Read-only Devnet verification. No signing keys, transactions or account writes.
import assert from "node:assert/strict";
import { Connection } from "@solana/web3.js";
import { OptketClient, OPTKET_PROGRAM_ID } from "../src/client/optketProgram";
import { VaultClient } from "../src/client/vaultProgram";
import { readKeeperSnapshot } from "../server/keeperSnapshot";
import { createRpcTransport } from "../server/rpcTransport";

async function main() {
  const rpc = createRpcTransport("snapshot-check");
  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", {
    commitment: "confirmed", fetch: rpc.fetch, disableRetryOnRateLimit: true,
  });
  assert.equal(await conn.getGenesisHash(), "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", "Devnet only");
  const start = Date.now();
  const snapshot = await readKeeperSnapshot(conn, OPTKET_PROGRAM_ID, true);
  const snapshotMs = Date.now() - start;
  const legacy = new OptketClient(conn), vaults = new VaultClient(conn);
  const addressList = (accounts: Array<{ address: unknown }>) => accounts.map(a => String(a.address)).sort();
  // Separate scans may observe a later slot. A mismatch requires investigation,
  // not a fallback to stale data or a forced pass while state is changing.
  assert.deepEqual(addressList(snapshot.contracts), addressList(await legacy.getOpenContracts()));
  assert.deepEqual(addressList(snapshot.requests), addressList(await legacy.getPendingRequests()));
  assert.deepEqual(addressList(snapshot.vaults.rounds), addressList(await vaults.rounds()));
  assert.deepEqual(addressList(snapshot.vaults.positions), addressList((await vaults.positions()).filter(p => p.remainingQuantity > 0n)));
  assert.deepEqual(addressList(snapshot.vaults.requests), addressList((await vaults.requests()).filter(r => r.status === 0)));
  console.log(JSON.stringify({ ok: true, slot: snapshot.slot, snapshotMs, accountCount: snapshot.accountCount,
    dataBytes: snapshot.dataBytes, legacyContracts: snapshot.contracts.length, legacyRequests: snapshot.requests.length,
    vaultRounds: snapshot.vaults.rounds.length, activeVaultPositions: snapshot.vaults.positions.length,
    pendingVaultRequests: snapshot.vaults.requests.length }, null, 2));
}
main().catch(error => {
  console.error(String(error).replace(/https?:\/\/\S+/g, "[endpoint]"));
  process.exitCode = 1;
});
