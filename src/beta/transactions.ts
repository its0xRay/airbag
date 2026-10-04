import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { MAINNET_GENESIS } from "../client/betaProgram";
import type { ExternalWallet } from "./wallet";
import { betaApi } from "./api";
export type PendingBetaTransaction = { signature:string; lastValidBlockHeight:number; blockhash:string };
const key = (program:PublicKey,owner:PublicKey) => `airbag.beta.pending.${program.toBase58()}.${owner.toBase58()}`;
export function pendingBeta(program:PublicKey,owner:PublicKey): PendingBetaTransaction|null {
  const raw = localStorage.getItem(key(program,owner));
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (typeof parsed.signature !== "string" || !Number.isSafeInteger(parsed.lastValidBlockHeight)) throw new Error("Stored transaction needs manual verification.");
  return parsed;
}
export async function reconcileBeta(conn:Connection, program:PublicKey,owner:PublicKey) {
  const pending = pendingBeta(program,owner);
  if (!pending) return "none";
  const result = (await conn.getSignatureStatuses([pending.signature],{searchTransactionHistory:true})).value[0];
  if (result && (result.confirmationStatus === "confirmed" || result.confirmationStatus === "finalized")) {
    localStorage.removeItem(key(program,owner));
    return result.err ? "failed" : "confirmed";
  }
  // Only clear an absent signature after a FINALIZED block height has passed
  // its validity window, with a second historical status lookup.
  if (!result && await conn.getBlockHeight("finalized") > pending.lastValidBlockHeight) {
    const second = (await conn.getSignatureStatuses([pending.signature],{searchTransactionHistory:true})).value[0];
    if (!second) { localStorage.removeItem(key(program,owner)); return "expired"; }
  }
  return "pending";
}
export async function sendBeta(conn:Connection, program:PublicKey, wallet:ExternalWallet, owner:PublicKey, transaction:Transaction, token:string) {
  if (!navigator.locks) throw new Error("Use a browser with secure transaction coordination support.");
  return navigator.locks.request(key(program,owner),{ifAvailable:true},async lock => {
    if (!lock || pendingBeta(program,owner)) throw new Error("Check the pending transaction before submitting another.");
    if (!wallet.publicKey?.equals(owner)) throw new Error("Wallet changed. Reconnect before continuing.");
    if (await conn.getGenesisHash() !== MAINNET_GENESIS) throw new Error("Network verification failed.");
    const lifetime = await conn.getLatestBlockhash("confirmed");
    transaction.feePayer=owner; transaction.recentBlockhash=lifetime.blockhash;
    const original=transaction.serializeMessage();
    const signed=await wallet.signTransaction(transaction);
    if (!wallet.publicKey?.equals(owner) || !signed.serializeMessage().equals(original) || !signed.verifySignatures()) throw new Error("Signed transaction does not match your review.");
    const raw=signed.serialize();
    const simulation=await betaApi<{ok:boolean}>("/simulate",{transaction:Buffer.from(raw).toString("base64")},token);
    if (!simulation.ok) throw new Error("Transaction checks failed. Refresh the available terms and your balance.");
    const signature=bs58.encode(signed.signature!);
    localStorage.setItem(key(program,owner),JSON.stringify({...lifetime,signature}));
    // Persist BEFORE submission. A timeout must never permit an automatic retry.
    try { await conn.sendRawTransaction(raw,{skipPreflight:false,maxRetries:3}); }
    catch { throw new Error("Submission status is uncertain. Check the pending transaction before retrying."); }
    return signature;
  });
}
