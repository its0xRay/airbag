// Key management for hosted services.
//
// In production (Railway/Render) keypairs come from environment secrets as
// JSON arrays (e.g. QUOTE_AUTHORITY_SECRET='[12,34,...]'). Locally they fall
// back to gitignored files so `npm run quote-service` / `npm run keeper` keep
// working with zero setup. NEVER commit the key files.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { Keypair } from "@solana/web3.js";

function parseSecret(raw: string, label: string): Keypair {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length !== 64) throw new Error("expected a 64-byte JSON array");
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch (e) {
    throw new Error(`invalid ${label}: ${(e as Error).message}`);
  }
}

/**
 * Load a keypair: env secret first, then file; optionally generate+persist the
 * file when neither exists (local dev convenience).
 */
export function loadKey(envName: string, filePath: string, generateIfMissing = true): Keypair {
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) return parseSecret(fromEnv, envName);
  if (existsSync(filePath)) return parseSecret(readFileSync(filePath, "utf8"), filePath);
  if (!generateIfMissing) throw new Error(`missing key: set ${envName} or provide ${filePath}`);
  const kp = Keypair.generate();
  writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

/** The admin/payer key (deployer wallet). Env ADMIN_SECRET, else ~/.config/solana/id.json. */
export function loadAdmin(): Keypair | null {
  const fromEnv = process.env.ADMIN_SECRET;
  if (fromEnv && fromEnv.trim()) return parseSecret(fromEnv, "ADMIN_SECRET");
  try {
    return parseSecret(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"), "id.json");
  } catch {
    return null;
  }
}
