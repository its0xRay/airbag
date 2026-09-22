// Signed-quote payload serialization (PRD §8). The byte layout MUST match the
// Rust `QuotePayload` in programs/optket/src/quote.rs so the same bytes are
// signed off-chain and reconstructed on-chain. Borsh, little-endian.

import type { QuotePayload } from "./types";

export const QUOTE_PAYLOAD_LEN = 95; // 32+1+2+8+8+8+4+8+8+8+8
export const MAX_QUOTE_TTL_SECS = 300;
export const QUOTE_VALIDITY_SECS = 60; // PRD §8.1 initial quote validity

/** Check the actual signed bytes, not the service's display-only price. */
export function checkPurchaseLimit(message: Uint8Array, maxPremium: bigint): bigint {
  if (message.length !== QUOTE_PAYLOAD_LEN || typeof maxPremium !== "bigint" || maxPremium < 0n) throw new Error("Invalid purchase approval.");
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const premium = view.getBigUint64(63, true);
  const fees = view.getBigUint64(71, true);
  if (premium + fees > maxPremium) throw new Error("The fresh quote exceeds your approved maximum. Review the updated cost and try again.");
  return premium;
}

function writeU64LE(view: DataView, offset: number, value: bigint) {
  view.setBigUint64(offset, value, true);
}
function writeI64LE(view: DataView, offset: number, value: bigint) {
  view.setBigInt64(offset, value, true);
}

/**
 * Serialize a quote to the exact borsh bytes the program verifies.
 * `buyerBytes` is the 32-byte buyer public key.
 */
export function serializeQuotePayload(q: QuotePayload, buyerBytes: Uint8Array): Uint8Array {
  if (buyerBytes.length !== 32) throw new Error("buyer must be 32 bytes");
  const buf = new Uint8Array(QUOTE_PAYLOAD_LEN);
  const view = new DataView(buf.buffer);
  let o = 0;
  buf.set(buyerBytes, o);
  o += 32;
  view.setUint8(o, q.assetId);
  o += 1;
  view.setUint16(o, q.seriesId, true);
  o += 2;
  writeU64LE(view, o, q.quantity);
  o += 8;
  writeU64LE(view, o, q.strike);
  o += 8;
  writeI64LE(view, o, BigInt(q.expiryTs));
  o += 8;
  view.setUint32(o, q.referenceVersion, true);
  o += 4;
  writeU64LE(view, o, q.premium);
  o += 8;
  writeU64LE(view, o, q.fees);
  o += 8;
  writeU64LE(view, o, q.quoteId);
  o += 8;
  writeI64LE(view, o, BigInt(q.quoteExpiryTs));
  o += 8;
  return buf;
}
