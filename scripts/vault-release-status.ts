/** Read-only Devnet release status. Never prints credential-bearing RPC URLs. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { OptketClient, OPTKET_PROGRAM_ID } from "../src/client/optketProgram";
import { VaultClient } from "../src/client/vaultProgram";
import { loadAdmin } from "../server/keys";

const rpc = process.env.RPC_URL || readFileSync(`${homedir()}/.config/solana/cli/config.yml`, "utf8").match(/^json_rpc_url: (.+)$/m)?.[1];
if (!rpc) throw new Error("RPC_URL required");
async function run() {
  const conn = new Connection(rpc!, "confirmed");
  if (await conn.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("Devnet only");
  const admin = loadAdmin();
  const program = await conn.getAccountInfo(OPTKET_PROGRAM_ID);
  if (!program?.executable) throw new Error("Program unavailable");
  const dataAddress = new PublicKey(program.data.subarray(4, 36));
  const data = await conn.getAccountInfo(dataAddress);
  if (!data || data.data.readUInt32LE(0) !== 3) throw new Error("Upgradeable program data unavailable");
  const binary = readFileSync(new URL("../target/deploy/optket.so", import.meta.url));
  const authority = data.data[12] === 1 ? new PublicKey(data.data.subarray(13, 45)) : null;
  const client = new OptketClient(conn);
  const config = await client.getConfig();
  const assets = await Promise.all([client.getAsset(0), client.getAsset(1)]);
  const rounds = await new VaultClient(conn).rounds();
  const bufferRent = await conn.getMinimumBalanceForRentExemption(binary.length + 37);
  const resizedRent = await conn.getMinimumBalanceForRentExemption(binary.length + 45);
  const resizeTopup = Math.max(0, resizedRent - data.lamports);
  console.log(JSON.stringify({ program: OPTKET_PROGRAM_ID.toBase58(), dataAddress: dataAddress.toBase58(),
    upgradeAuthority: authority?.toBase58(), adminMatchesUpgradeAuthority: !!(admin && authority && admin.publicKey.equals(authority)),
    adminMatchesConfig: !!(admin && config && admin.publicKey.equals(config.admin)),
    adminSol: admin ? (await conn.getBalance(admin.publicKey)) / 1e9 : null,
    deployedMatchesLocal: data.data.subarray(45, 45 + binary.length).equals(binary),
    binaryBytes: binary.length, allocatedProgramBytes: data.data.length - 45,
    temporaryBufferRentSol: bufferRent / 1e9, programResizeTopupSol: resizeTopup / 1e9,
    minimumUpgradeFundingBeforeFeesSol: (bufferRent + resizeTopup) / 1e9,
    binarySha256: createHash("sha256").update(binary).digest("hex"), paused: config?.pausedPurchases,
    assets: assets.map(a => a && ({ asset: a.assetId, active: a.active, referenceVersion: a.referenceVersion,
      exposure: a.outstandingExposure.toString(), cap: a.maxAggregateExposure.toString() })),
    rounds: rounds.map(r => ({ address:r.address.toBase58(), asset:r.assetId, phase:r.phase, shares:r.totalShares.toString(), open:r.openContracts.toString() })) }, null, 2));
}
run().catch(e => { console.error(String(e?.message ?? e).replaceAll(rpc!, "[RPC]")); process.exitCode = 1; });
