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
  } catch {
    throw new Error(`invalid ${label}: expected a valid 64-byte keypair JSON array`);
  }
}

/**
 * True when running on a PaaS rather than a developer machine. Generating a
 * key there is never right: the container has no gitignored key files, so a
 * missing secret would mint a brand-new authority that holds no on-chain role
 * and no SOL — a service that boots and looks healthy but can sign nothing.
 * Better to fail loudly at startup naming the variable that is missing.
 */
function isHosted(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID ||
    process.env.RENDER || process.env.FLY_APP_NAME || process.env.VERCEL,
  );
}

/**
 * Load a keypair: env secret first, then file; optionally generate+persist the
 * file when neither exists (local dev convenience only — see isHosted).
 */
export function loadKey(envName: string, filePath: string, generateIfMissing = true): Keypair {
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) return parseSecret(fromEnv, envName);
  if (existsSync(filePath)) return parseSecret(readFileSync(filePath, "utf8"), filePath);
  if (isHosted()) {
    throw new Error(
      `${envName} is not set. Add it to this service's variables as a 64-byte ` +
      `JSON array (the value is in DEPLOY-SECRETS.local.md). Refusing to ` +
      `generate a throwaway key, which would have no on-chain authority.`,
    );
  }
  if (!generateIfMissing) throw new Error(`missing key: set ${envName} or provide ${filePath}`);
  const kp = Keypair.generate();
  writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
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
