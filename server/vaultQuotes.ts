import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PublicKey, type Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { VaultClient, vaultQuoteMessage } from "../src/client/vaultProgram";
import { ASSUMPTIONS, quotePremium } from "../src/engine/pricing";
import { serializeQuotePayload } from "../src/engine/quote";
import { maxLiability } from "../src/engine/fixed";
import { ACTIVE_REFERENCE_VERSION } from "../src/data/referencePolicy";

/** Commit to executable model + assumptions, not just a display version label. */
const pricingSource = ["pricing.ts", "fixed.ts"].map(name =>
  readFileSync(new URL(`../src/engine/${name}`, import.meta.url), "utf8")).join("\n");
export function vaultPolicyHash(assetId: number) {
  if (!ASSUMPTIONS[assetId]) throw new Error("Unsupported vault asset.");
  return createHash("sha256").update("airbag-vault-pricing-v1\n")
    .update(pricingSource).update(JSON.stringify(ASSUMPTIONS[assetId])).digest();
}
export async function signedVaultQuote(client: VaultClient, signer: Keypair,
  reference: (asset: number, version: number) => Promise<{ available: boolean; spot?: bigint; reason?: string }>,
  input: { buyer: string; round: string; quantity: string; strike: string }) {
  const round = await client.getRound(new PublicKey(input.round));
  if (!round) throw new Error("Vault round not found.");
  if (!round.quoteAuthority.equals(signer.publicKey)) throw new Error("Vault quote authority unavailable.");
  if (!Buffer.from(round.pricingPolicy).equals(vaultPolicyHash(round.assetId))) throw new Error("This round's pricing policy is unavailable; no replacement policy will be used.");
  if (round.referenceVersion !== ACTIVE_REFERENCE_VERSION[round.assetId]) throw new Error("Unsupported vault reference version.");
  const now = Math.floor(Date.now() / 1000);
  if (round.phase !== "active" || now >= round.salesClose || round.latestExpiry - now < 300) throw new Error("This round is not issuing new positions.");
  const quantity = BigInt(input.quantity), strike = BigInt(input.strike);
  if (quantity <= 0n || quantity > round.maxQuantity || strike < round.minStrike || strike > round.maxStrike) throw new Error("Position exceeds this round's terms.");
  const liability = maxLiability(quantity, strike);
  if (liability > round.principalAvailable || round.reserved + liability > round.exposureCap) throw new Error("Vault capacity is insufficient for this position.");
  const r = await reference(round.assetId, round.referenceVersion);
  if (!r.available || r.spot == null) throw new Error(r.reason || "A qualifying market reference is unavailable.");
  const premium = quotePremium(round.assetId, quantity, strike, r.spot, round.latestExpiry - now).premium;
  const quote = { buyer: new PublicKey(input.buyer).toBase58(), assetId: round.assetId, seriesId: 0,
    quantity, strike, expiryTs: round.latestExpiry, referenceVersion: round.referenceVersion, premium, fees: 0n,
    quoteId: randomBytes(8).readBigUInt64LE(), quoteExpiryTs: Math.min(now + 60, round.salesClose - 1) };
  const payload = serializeQuotePayload(quote, new PublicKey(quote.buyer).toBytes());
  const message = vaultQuoteMessage(round.address, payload);
  return { round: round.address.toBase58(), payload: Buffer.from(payload).toString("base64"),
    message: Buffer.from(message).toString("base64"), signature: Buffer.from(nacl.sign.detached(message, signer.secretKey)).toString("base64"),
    quoteAuthority: signer.publicKey.toBase58(), quoteId: quote.quoteId.toString(), premium: premium.toString(),
    expiryTs: quote.expiryTs, quoteExpiryTs: quote.quoteExpiryTs };
}
