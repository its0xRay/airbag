// On-chain client bridge (PRD §8). Signs a quote with the quote-authority
// ed25519 key and builds the paired native Ed25519 verify instruction that the
// program checks via the instructions sysvar. Pair this with the Anchor
// `purchase` instruction in the SAME transaction, with `edIxIndex` pointing at
// the Ed25519 instruction's position.
//
// This module builds the quote verification instruction used by the live
// Solana client. The pure builder is also used by tests.

import { serializeQuotePayload } from "../engine/quote";
import type { QuotePayload } from "../engine/types";

// Minimal structural types so this file compiles without the solana deps
// present. Swap for the real imports when wiring on-chain:
//   import { Ed25519Program, PublicKey, TransactionInstruction } from "@solana/web3.js";
//   import nacl from "tweetnacl";
export interface Ed25519InstructionLike {
  programId: unknown;
  keys: unknown[];
  data: Uint8Array;
}

export interface SignedQuote {
  quote: QuotePayload;
  message: Uint8Array;
  signature: Uint8Array; // 64 bytes
  quoteAuthorityPubkey: Uint8Array; // 32 bytes
}

/**
 * Sign a quote off-chain. `signFn` is `nacl.sign.detached(message, secretKey)`
 * in production; injected here to keep this module dependency-free.
 */
export function signQuote(
  quote: QuotePayload,
  buyerBytes: Uint8Array,
  quoteAuthorityPubkey: Uint8Array,
  signFn: (message: Uint8Array) => Uint8Array,
): SignedQuote {
  const message = serializeQuotePayload(quote, buyerBytes);
  const signature = signFn(message);
  if (signature.length !== 64) throw new Error("ed25519 signature must be 64 bytes");
  return { quote, message, signature, quoteAuthorityPubkey };
}

/**
 * Build the native Ed25519 verify instruction data for a single signature over
 * `message`. Layout matches programs/optket/src/quote.rs exactly:
 *   header(16) | pubkey(32) | signature(64) | message(N)
 * In production prefer `Ed25519Program.createInstructionWithPublicKey(...)`;
 * this explicit builder documents the byte layout the program parses.
 */
export function buildEd25519InstructionData(signed: SignedQuote): Uint8Array {
  const { quoteAuthorityPubkey, signature, message } = signed;
  const HEADER = 16;
  const pubkeyOffset = HEADER;
  const sigOffset = HEADER + 32;
  const msgOffset = HEADER + 32 + 64;
  const total = msgOffset + message.length;

  const data = new Uint8Array(total);
  const view = new DataView(data.buffer);
  data[0] = 1; // num signatures
  data[1] = 0; // padding
  view.setUint16(2, sigOffset, true); // signature_offset
  view.setUint16(4, 0xffff, true); // signature_instruction_index = current
  view.setUint16(6, pubkeyOffset, true); // public_key_offset
  view.setUint16(8, 0xffff, true); // public_key_instruction_index = current
  view.setUint16(10, msgOffset, true); // message_data_offset
  view.setUint16(12, message.length, true); // message_data_size
  view.setUint16(14, 0xffff, true); // message_instruction_index = current

  data.set(quoteAuthorityPubkey, pubkeyOffset);
  data.set(signature, sigOffset);
  data.set(message, msgOffset);
  return data;
}
