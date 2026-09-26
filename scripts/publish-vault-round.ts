/** Explicit operator action. Dry-run by default; never mints or imports legacy capital. */
import { Connection, Transaction } from "@solana/web3.js";
import { getAccount, getMint } from "@solana/spl-token";
import { OptketClient, associatedTokenAddress } from "../src/client/optketProgram";
import { VaultClient, vaultPdas, type VaultTerms } from "../src/client/vaultProgram";
import { ACTIVE_REFERENCE_VERSION } from "../src/data/referencePolicy";
import { loadAdmin } from "../server/keys";
import { vaultPolicyHash } from "../server/vaultQuotes";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const cliConfig = `${homedir()}/.config/solana/cli/config.yml`;
const rpc = process.env.RPC_URL || (existsSync(cliConfig) ? readFileSync(cliConfig, "utf8").match(/^json_rpc_url: (.+)$/m)?.[1] : undefined) || "https://api.devnet.solana.com";
const conn = new Connection(rpc, "confirmed");
try {
if (await conn.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("This operator command supports Solana Devnet only.");
const admin = loadAdmin();
if (!admin) throw new Error("Administrator key unavailable.");
const config = await new OptketClient(conn).getConfig();
if (!config || !config.admin.equals(admin.publicKey) || config.pausedPurchases) throw new Error("Administrator/configuration unavailable or paused.");
const assetId = Number(process.env.VAULT_ASSET_ID);
if (assetId !== 0 && assetId !== 1) throw new Error("Set VAULT_ASSET_ID to 0 or 1.");
function amount(name: string) {
  const value = process.env[name];
  if (!value || !/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error(`Set ${name} explicitly, with at most six decimals.`);
  const [whole, fraction = ""] = value.split(".");
  const n = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (n > 18446744073709551615n) throw new Error(`${name} is too large.`);
  return n;
}
const idText = process.env.VAULT_ROUND_ID;
if (!idText || !/^\d+$/.test(idText)) throw new Error("Set a unique VAULT_ROUND_ID explicitly; reuse it when checking an uncertain submission.");
const id = BigInt(idText);
const client = new VaultClient(conn);
const address = vaultPdas.round(assetId, id);
if (await client.getRound(address)) throw new Error(`Round ${address.toBase58()} already exists. Inspect its deposit record; this command will not deposit twice.`);
const existing = (await client.rounds()).filter(r => r.assetId === assetId && r.phase !== "redeemable");
if (existing.length && !process.argv.includes("--allow-overlap")) throw new Error("An unresolved round exists. An explicit --allow-overlap is required to publish a separate mandate without altering it.");
if (existing.length >= 10) throw new Error("Resolve the outstanding round backlog before publishing.");
const asset = await new OptketClient(conn).getAsset(assetId);
if (!asset?.active || asset.referenceVersion !== ACTIVE_REFERENCE_VERSION[assetId]) throw new Error("Active token-market asset configuration required.");
const mint = await getMint(conn, config.demoMint);
if (mint.decimals !== 6) throw new Error("Expected six-decimal test oUSD.");
const seed = amount("VAULT_ADMIN_DEPOSIT");
const now = await conn.getBlockTime(await conn.getSlot("confirmed"));
if (now == null) throw new Error("Confirmed chain time unavailable.");
const terms: VaultTerms = { assetId, fundingClose: now + 300, salesClose: now + 300 + 6 * 86400, latestExpiry: now + 300 + 7 * 86400,
  depositCap: amount("VAULT_DEPOSIT_CAP"), exposureCap: amount("VAULT_EXPOSURE_CAP"),
  minStrike: amount("VAULT_MIN_STRIKE"), maxStrike: amount("VAULT_MAX_STRIKE"), maxQuantity: amount("VAULT_MAX_QUANTITY") };
if (terms.depositCap <= 0n || terms.exposureCap <= 0n || terms.exposureCap > terms.depositCap || seed > terms.depositCap
  || terms.minStrike <= 0n || terms.maxStrike < terms.minStrike || terms.maxQuantity <= 0n) throw new Error("Invalid round limits.");
if (seed > 0n && (await getAccount(conn, associatedTokenAddress(config.demoMint, admin.publicKey))).amount < seed) throw new Error("Insufficient administrator test oUSD. This command never mints funds.");
const policy = vaultPolicyHash(assetId);
console.log(JSON.stringify({ mode: process.argv.includes("--send") ? "submit" : "dry-run", round: address.toBase58(),
  administrator: admin.publicKey.toBase58(), mint: config.demoMint.toBase58(), terms, seed,
  pricingPolicy: policy.toString("hex") }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
if (process.argv.includes("--send")) {
  // Creation and optional seed deposit are atomic, with a PDA-backed retry guard.
  const tx = new Transaction().add(client.createIx(admin.publicKey, config.demoMint, id, terms, policy));
  if (seed > 0n) tx.add(client.depositIx({ address, custody: vaultPdas.custody(address), mint: config.demoMint }, admin.publicKey, admin.publicKey, seed));
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(admin);
  const signature = await conn.sendRawTransaction(tx.serialize());
  console.log("Submitted transaction:", signature);
  let confirmed = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = (await conn.getSignatureStatuses([signature])).value[0];
    if (state?.err) throw new Error(`Publication failed: ${JSON.stringify(state.err)}`);
    if (state?.confirmationStatus === "confirmed" || state?.confirmationStatus === "finalized") {
      confirmed = true; break;
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  if (!confirmed) throw new Error("Confirmation uncertain. Inspect the submitted signature and same round ID before retrying.");
  console.log("Confirmed transaction:", signature);
}
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error).replaceAll(rpc, "[RPC]"));
  process.exitCode = 1;
}
