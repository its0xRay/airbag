/** Devnet only. Run AFTER deploying the version-aware program. No existing
 * series or contract is edited; metadata affects newly created series only. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { Connection, Keypair, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { OptketClient, pdas, OPTKET_PROGRAM_ID } from "../src/client/optketProgram";

const rpc = process.env.RPC_URL || readFileSync(`${homedir()}/.config/solana/cli/config.yml`, "utf8").match(/^json_rpc_url: (.+)$/m)?.[1];
if (!rpc) throw new Error("RPC_URL required");
const conn = new Connection(rpc, "confirmed");
if (await conn.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("Devnet only");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
const client = new OptketClient(conn);
const config = await client.getConfig();
if (!config?.admin.equals(admin.publicKey)) throw new Error("Admin mismatch");
const asset = await client.getAsset(0);
if (!asset || ![1, 2].includes(asset.referenceVersion)) throw new Error("Unexpected NVDAx reference version");
const disc = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const meta = (pubkey: typeof admin.publicKey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const u16 = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u64 = (v: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const tx = new Transaction();
if (asset.referenceVersion === 1) tx.add(new TransactionInstruction({
  programId: OPTKET_PROGRAM_ID,
  keys: [meta(admin.publicKey, true), meta(pdas.config()), meta(pdas.asset(0), false, true)],
  // asset 0, mint None, reference Some(2), conversion unchanged.
  data: Buffer.concat([disc("set_asset_metadata"), Buffer.from([0, 0, 1, 2, 0, 0, 0, 0])]),
}));
// Keep the published weekly expiry, but give token-market contracts new IDs.
for (const [seriesId, strike] of [[2, 215], [3, 205]]) {
  const existing = await client.getSeries(0, seriesId);
  if (existing) {
    if (existing.referenceVersion !== 2 || existing.strike !== BigInt(strike * 1e6)) throw new Error(`Series ${seriesId} conflicts`);
    continue;
  }
  const legacy = await client.getSeries(0, seriesId - 2);
  const expiry = legacy && legacy.expiryTs > Date.now() / 1000 + 3600
    ? legacy.expiryTs : Math.floor(Date.now() / 1000) + 7 * 86400;
  tx.add(new TransactionInstruction({
    programId: OPTKET_PROGRAM_ID,
    keys: [meta(admin.publicKey, true, true), meta(pdas.config()), meta(pdas.asset(0)), meta(pdas.series(0, seriesId), false, true), meta(SystemProgram.programId)],
    data: Buffer.concat([disc("create_series"), Buffer.from([0]), u16(seriesId), u64(strike * 1e6), u64(expiry), u64(expiry - 900), u64(expiry - 300), u64(100 * 1e6)]),
  }));
}
if (!process.argv.includes("--execute")) {
  console.log(`Dry run: ${tx.instructions.length} instructions. Deploy program first, then rerun with --execute.`);
} else if (tx.instructions.length) {
  const signature = await sendAndConfirmTransaction(conn, tx, [admin]);
  console.log(JSON.stringify({ signature, asset: await client.getAsset(0), series: await Promise.all([client.getSeries(0, 2), client.getSeries(0, 3)]) }, (_, v) => typeof v === "bigint" ? v.toString() : v));
} else console.log("Migration already applied.");
