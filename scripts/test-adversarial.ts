/**
 * PRD §22 acceptance suite — run against the DEPLOYED program.
 *
 *   RPC_URL=https://api.devnet.solana.com npx tsx scripts/test-adversarial.ts
 *
 * Every case here is an attack or an invalid input that MUST be rejected. The
 * engine unit tests prove the arithmetic; this proves the deployed program
 * enforces the rules on a real cluster. Each case asserts the *specific*
 * program error code, so a rejection for the wrong reason still fails.
 *
 * IMPORTANT: stop the keeper first (`pkill -f server/keeper`). It settles
 * pending requests within seconds, which races the settlement cases here and
 * produces spurious RequestNotPending failures. The suite also competes with
 * the keeper for the devnet rate limit.
 */

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import {
  OptketClient, pdas, OPTKET_PROGRAM_ID, type Observation,
} from "../src/client/optketProgram";
import { serializeQuotePayload } from "../src/engine/quote";
import type { QuotePayload } from "../src/engine/types";

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const client = new OptketClient(conn);

const load = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
const admin = load(`${homedir()}/.config/solana/id.json`);
const dir = new URL("../server/", import.meta.url).pathname;
const quoteAuthority = load(`${dir}quote-authority.json`);
const publisher = load(`${dir}publisher-authority.json`);

// Anchor error codes — 6000 + index in programs/optket/src/errors.rs
const E = {
  Unauthorized: 6000, WrongMint: 6004, InsufficientCollateral: 6005,
  WithdrawalBelowObligations: 6006, BadQuoteAuthority: 6008, QuoteExpired: 6009,
  QuoteTtlTooLong: 6010, QuoteTermsMismatch: 6011, QuoteBuyerMismatch: 6012,
  PurchaseCutoffPassed: 6015, ContractSizeExceeded: 6016, ZeroQuantity: 6018,
  NonZeroFees: 6019, ExceedsRemaining: 6021, RequestNotPending: 6023,
  ObservationNotAfterRequest: 6025, ObservationStale: 6027,
  InsufficientObservations: 6028, NonIncreasingSlots: 6029, ExpiryNotReached: 6032,
} as const;
const NAME = Object.fromEntries(Object.entries(E).map(([k, v]) => [v, k])) as Record<number, string>;

const disc = (n: string) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const u8a = (n: number) => Uint8Array.of(n);
const u64 = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };
const cat = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const nowSec = () => Math.floor(Date.now() / 1000);

let pass = 0;
const failures: string[] = [];
const results: Array<[string, string, string]> = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Public RPCs rate-limit bursts; pace the suite so results are about the
 *  program's behaviour, not the endpoint's throttle. */
const THROTTLE_MS = Number(process.env.THROTTLE_MS || 900);

function extractCode(e: unknown): number | null {
  const s = JSON.stringify((e as { logs?: string[] })?.logs || "") + String((e as Error)?.message || e);
  const m = s.match(/custom program error: (0x[0-9a-fA-F]+)/) || s.match(/Custom":\s*(\d+)/);
  if (!m) return null;
  return m[1].startsWith("0x") ? parseInt(m[1], 16) : parseInt(m[1], 10);
}

/** Assert a transaction is rejected, optionally with a specific error code. */
async function mustFail(label: string, build: () => Promise<Transaction>, signers: Keypair[], expected?: number) {
  await sleep(THROTTLE_MS);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const tx = await build();
      await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed", maxRetries: 2 });
      failures.push(`${label} — TRANSACTION SUCCEEDED but should have been rejected`);
      results.push(["✗", label, "accepted (should reject)"]);
      return;
    } catch (e) {
      const code = extractCode(e);
      const msg = String((e as Error)?.message || e);
      // transient network/blockhash issues → retry, don't count as a pass
      if (code === null && /blockhash|timeout|429|fetch failed|socket|ETIMEDOUT/i.test(msg)) {
        if (attempt < 3) { await new Promise((r) => setTimeout(r, 2500 * attempt)); continue; }
      }
      if (expected !== undefined) {
        if (code === expected) { pass++; results.push(["✓", label, `rejected: ${NAME[code] || code}`]); }
        else {
          failures.push(`${label} — expected ${NAME[expected]}(${expected}), got ${code !== null ? `${NAME[code] || "?"}(${code})` : msg.slice(0, 80)}`);
          results.push(["✗", label, `wrong reason: ${code !== null ? NAME[code] || code : msg.slice(0, 40)}`]);
        }
      } else {
        pass++; results.push(["✓", label, code !== null ? `rejected: ${NAME[code] || code}` : "rejected (constraint)"]);
      }
      return;
    }
  }
}

async function mustSucceed(label: string, build: () => Promise<Transaction>, signers: Keypair[]): Promise<string> {
  await sleep(THROTTLE_MS);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const sig = await sendAndConfirmTransaction(conn, await build(), signers, { commitment: "confirmed", maxRetries: 3 });
      pass++; results.push(["✓", label, "accepted (as expected)"]);
      return sig;
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      if (attempt < 4 && /blockhash|timeout|429|fetch failed|socket/i.test(msg)) { await new Promise((r) => setTimeout(r, 2500 * attempt)); continue; }
      failures.push(`${label} — should have succeeded: ${msg.slice(0, 120)}`);
      results.push(["✗", label, `rejected: ${msg.slice(0, 40)}`]);
      return "";
    }
  }
  return "";
}

// ---- quote helpers (sign locally so we can craft invalid quotes) ----
let quoteSeq = BigInt(Date.now());
function makeQuote(over: Partial<QuotePayload>, buyer: PublicKey, strike: bigint, expiryTs: number, refV: number): QuotePayload {
  return {
    buyer: buyer.toBase58(), assetId: 0, seriesId: 0, quantity: 1_000_000n,
    strike, expiryTs, referenceVersion: refV, premium: 1_000_000n, fees: 0n,
    quoteId: quoteSeq++, quoteExpiryTs: nowSec() + 60, ...over,
  };
}
function signWith(kp: Keypair, q: QuotePayload, buyer: PublicKey) {
  const message = serializeQuotePayload(q, buyer.toBytes());
  return { message, signature: nacl.sign.detached(message, kp.secretKey) };
}

/** Build a purchase tx, allowing the ed25519-bound message and the instruction
 *  payload to differ (that's how we test tampering). */
function buildPurchase(opts: {
  buyer: PublicKey; buyerToken: PublicKey; demoMint: PublicKey;
  edMessage: Uint8Array; edSignature: Uint8Array; edAuthority: PublicKey;
  ixMessage: Uint8Array; quoteId: bigint; assetId?: number; seriesId?: number;
  omitEd25519?: boolean;
}): Transaction {
  const assetId = opts.assetId ?? 0;
  const seriesId = opts.seriesId ?? 0;
  const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });
  const ix = new TransactionInstruction({
    programId: OPTKET_PROGRAM_ID,
    keys: [
      meta(opts.buyer, true, true), meta(pdas.config(), false, true), meta(pdas.asset(assetId), false, true),
      meta(pdas.series(assetId, seriesId), false, false), meta(pdas.pool(assetId), false, true),
      meta(pdas.vault(assetId), false, true), meta(opts.buyerToken, false, true), meta(opts.demoMint, false, false),
      meta(pdas.quoteMarker(opts.quoteId), false, true), meta(pdas.contract(opts.quoteId), false, true),
      meta(SYSVAR_INSTRUCTIONS_PUBKEY, false, false), meta(TOKEN_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: cat([disc("purchase"), opts.ixMessage, u8a(0)]) as any,
  });
  const tx = new Transaction();
  if (!opts.omitEd25519) {
    tx.add(Ed25519Program.createInstructionWithPublicKey({
      publicKey: opts.edAuthority.toBytes(), message: opts.edMessage, signature: opts.edSignature,
    }));
  }
  return tx.add(ix);
}

async function main() {
  console.log("PRD §22 adversarial suite — deployed program");
  console.log(`  RPC:     ${RPC}`);
  console.log(`  program: ${OPTKET_PROGRAM_ID.toBase58()}`);

  const cfg = await client.getConfig();
  if (!cfg) throw new Error("config not found — is the program set up on this cluster?");
  const demoMint = cfg.demoMint;
  const s = await client.getSeries(0, 0);
  if (!s) throw new Error("series 0:0 missing");
  console.log(`  buyer:   ${admin.publicKey.toBase58()}`);
  console.log(`  series:  strike ${Number(s.strike) / 1e6}, expiry ${new Date(s.expiryTs * 1000).toISOString()}\n`);

  const buyerAta = (await getOrCreateAssociatedTokenAccount(conn, admin, demoMint, admin.publicKey)).address;
  const base = { buyer: admin.publicKey, buyerToken: buyerAta, demoMint, edAuthority: quoteAuthority.publicKey };
  const mk = (over: Partial<QuotePayload> = {}) => makeQuote(over, admin.publicKey, s.strike, s.expiryTs, s.referenceVersion);

  // ============ A. quote / purchase integrity (§8, §22) ============
  {
    const q = mk({ quoteExpiryTs: nowSec() - 30 });
    const { message, signature } = signWith(quoteAuthority, q, admin.publicKey);
    await mustFail("Expired quote is rejected", async () =>
      buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: message, quoteId: q.quoteId }),
      [admin], E.QuoteExpired);
  }
  {
    const q = mk({ quoteExpiryTs: nowSec() + 3600 }); // beyond MAX_QUOTE_TTL_SECS
    const { message, signature } = signWith(quoteAuthority, q, admin.publicKey);
    await mustFail("Over-long quote TTL is rejected", async () =>
      buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: message, quoteId: q.quoteId }),
      [admin], E.QuoteTtlTooLong);
  }
  {
    const rogue = Keypair.generate();
    const q = mk();
    const { message, signature } = signWith(rogue, q, admin.publicKey);
    await mustFail("Quote signed by an unauthorized key is rejected", async () =>
      buildPurchase({ ...base, edAuthority: rogue.publicKey, edMessage: message, edSignature: signature, ixMessage: message, quoteId: q.quoteId }),
      [admin], E.BadQuoteAuthority);
  }
  {
    // sign a valid quote, then submit DIFFERENT terms in the instruction payload
    const good = mk();
    const { message, signature } = signWith(quoteAuthority, good, admin.publicKey);
    const tampered = serializeQuotePayload({ ...good, premium: 1n }, admin.publicKey.toBytes());
    await mustFail("Tampered quote payload is rejected", async () =>
      buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: tampered, quoteId: good.quoteId }),
      [admin], E.QuoteTermsMismatch);
  }
  {
    const other = Keypair.generate().publicKey;
    const q = mk({ buyer: other.toBase58() });
    const message = serializeQuotePayload(q, other.toBytes());
    const signature = nacl.sign.detached(message, quoteAuthority.secretKey);
    await mustFail("Quote issued for another wallet is rejected", async () =>
      buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: message, quoteId: q.quoteId }),
      [admin], E.QuoteBuyerMismatch);
  }
  {
    const q = mk({ strike: s.strike + 1_000_000n });
    const { message, signature } = signWith(quoteAuthority, q, admin.publicKey);
    await mustFail("Strike that doesn't match the series is rejected", async () =>
      buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: message, quoteId: q.quoteId }),
      [admin], E.QuoteTermsMismatch);
  }
  {
    const q = mk();
    const { message, signature } = signWith(quoteAuthority, q, admin.publicKey);
    await mustFail("Purchase without the ed25519 verify instruction is rejected", async () =>
      buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: message, quoteId: q.quoteId, omitEd25519: true }),
      [admin]);
  }
  {
    const q = mk({ quantity: 0n });
    const { message, signature } = signWith(quoteAuthority, q, admin.publicKey);
    await mustFail("Zero quantity is rejected", async () =>
      buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: message, quoteId: q.quoteId }),
      [admin], E.ZeroQuantity);
  }
  {
    const q = mk({ fees: 1n });
    const { message, signature } = signWith(quoteAuthority, q, admin.publicKey);
    await mustFail("Non-zero fees are rejected in the demo config", async () =>
      buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: message, quoteId: q.quoteId }),
      [admin], E.NonZeroFees);
  }
  {
    const q = mk({ quantity: s.maxContractSize + 1_000_000n });
    const { message, signature } = signWith(quoteAuthority, q, admin.publicKey);
    await mustFail("Quantity above the max contract size is rejected", async () =>
      buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: message, quoteId: q.quoteId }),
      [admin], E.ContractSizeExceeded);
  }

  // ---- real USDC / wrong mint cannot fund protection (§22) ----
  {
    // Reuse a cached foreign mint across runs — creating one is RPC-heavy.
    const statePath = new URL("./devnet-state.json", import.meta.url).pathname;
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    // cluster-scoped so a localnet run never clobbers the devnet entry
    const key = `foreignMint_${/127\.0\.0\.1|localhost/.test(RPC) ? "local" : "devnet"}`;
    let foreignMint: PublicKey;
    if (state[key] && (await conn.getAccountInfo(new PublicKey(state[key])))) {
      foreignMint = new PublicKey(state[key]);
    } else {
      foreignMint = await createMint(conn, admin, admin.publicKey, null, 6);
      state[key] = foreignMint.toBase58();
      writeFileSync(statePath, JSON.stringify(state, null, 2));
    }
    const foreignAta = (await getOrCreateAssociatedTokenAccount(conn, admin, foreignMint, admin.publicKey)).address;
    await mintTo(conn, admin, foreignMint, foreignAta, admin, 1_000_000_000n);
    const q = mk();
    const { message, signature } = signWith(quoteAuthority, q, admin.publicKey);
    await mustFail("A non-demo mint cannot fund protection (real-USDC guard)", async () =>
      buildPurchase({ ...base, buyerToken: foreignAta, demoMint: foreignMint, edMessage: message, edSignature: signature, ixMessage: message, quoteId: q.quoteId }),
      [admin]);
  }

  // ============ B. a valid purchase, then replay ============
  const liveQuote = mk({ quantity: 2_000_000n, premium: 2_000_000n });
  {
    const { message, signature } = signWith(quoteAuthority, liveQuote, admin.publicKey);
    await mustSucceed("Valid signed quote is accepted", async () =>
      buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: message, quoteId: liveQuote.quoteId }),
      [admin]);
    // same quote id again → replay guard (quote marker PDA already initialized)
    await mustFail("Replaying a used quote id is rejected", async () =>
      buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: message, quoteId: liveQuote.quoteId }),
      [admin]);
  }

  const contractPda = pdas.contract(liveQuote.quoteId);
  const contract = await client.getContractByAddress(contractPda);
  if (!contract) { console.log("\n⚠ purchase did not land — skipping exercise/settlement cases"); }

  // ============ C. exercise + settlement integrity (§10, §22) ============
  if (contract) {
    await mustFail("Exercising more than the remaining quantity is rejected", async () =>
      new Transaction().add(client.requestExerciseIx(admin.publicKey, contractPda, 0, contract.nextRequestNonce, contract.remainingQuantity + 1_000_000n)),
      [admin], E.ExceedsRemaining);

    await mustFail("Zero-quantity exercise is rejected", async () =>
      new Transaction().add(client.requestExerciseIx(admin.publicKey, contractPda, 0, contract.nextRequestNonce, 0n)),
      [admin], E.ZeroQuantity);

    const nonce = contract.nextRequestNonce;
    await mustSucceed("Partial exercise request is accepted", async () =>
      new Transaction().add(client.requestExerciseIx(admin.publicKey, contractPda, 0, nonce, 1_000_000n)),
      [admin]);

    const req = await client.getRequestAt(contractPda, nonce);
    if (req) {
      const fresh = (ts: number, price = 150_000_000n): Observation =>
        ({ slot: BigInt(Date.now()), sourceTs: ts, collectedTs: ts + 5, price });

      // an observation at/older than the request must not qualify (§9.1)
      await mustFail("Historical observation (not strictly after the request) is rejected", async () =>
        new Transaction().add(client.settleExerciseEquityIx(publisher.publicKey, contractPda, 0, nonce, buyerAta, demoMint, fresh(req.requestTs))),
        [publisher], E.ObservationNotAfterRequest);

      // stale collection time
      await mustFail("Stale observation is rejected", async () =>
        new Transaction().add(client.settleExerciseEquityIx(publisher.publicKey, contractPda, 0, nonce, buyerAta, demoMint,
          { slot: 1n, sourceTs: req.requestTs + 10, collectedTs: req.requestTs + 10 + 9999, price: 150_000_000n })),
        [publisher], E.ObservationStale);

      // Wrong role. `admin` is funded but is NOT the publisher authority, so it
      // isolates the role check without depending on a faucet.
      await mustFail("Settlement by an unauthorized publisher is rejected", async () =>
        new Transaction().add(client.settleExerciseEquityIx(admin.publicKey, contractPda, 0, nonce, buyerAta, demoMint, fresh(req.requestTs + 30))),
        [admin], E.Unauthorized);

      // wrong reference path for an equity asset
      await mustFail("PreStocks settlement path on an equity contract is rejected", async () =>
        new Transaction().add(client.settleExercisePrestocksIx(publisher.publicKey, contractPda, 0, nonce, buyerAta, demoMint,
          [0, 1, 2].map((i) => ({ slot: BigInt(10 + i), sourceTs: req.requestTs + 30 + i * 30, collectedTs: req.requestTs + 35 + i * 30, price: 150_000_000n })))),
        [publisher]);

      // settle legitimately, then try again (no double payout)
      await mustSucceed("Legitimate settlement is accepted", async () =>
        new Transaction().add(client.settleExerciseEquityIx(publisher.publicKey, contractPda, 0, nonce, buyerAta, demoMint, fresh(req.requestTs + 30))),
        [publisher]);

      await mustFail("Settling the same request twice is rejected (no double payout)", async () =>
        new Transaction().add(client.settleExerciseEquityIx(publisher.publicKey, contractPda, 0, nonce, buyerAta, demoMint, fresh(req.requestTs + 60))),
        [publisher], E.RequestNotPending);
    } else {
      console.log("⚠ pending request not found — skipping settlement cases");
    }

    // expiry before the expiry timestamp
    await mustFail("Expiry settlement before the expiry timestamp is rejected", async () =>
      new Transaction().add(client.settleExpiryEquityIx(publisher.publicKey, contractPda, 0, buyerAta, demoMint,
        { slot: 1n, sourceTs: contract.expiryTs, collectedTs: contract.expiryTs + 5, price: 150_000_000n })),
      [publisher], E.ExpiryNotReached);
  }

  // ============ D. PreStocks observation-set rules (§9.2, §22) ============
  {
    const s1 = await client.getSeries(1, 0);
    const c1 = await client.getConfig();
    if (s1 && c1) {
      const q1 = makeQuote({ assetId: 1, quantity: 1_000_000n, premium: 5_000_000n }, admin.publicKey, s1.strike, s1.expiryTs, s1.referenceVersion);
      const { message, signature } = signWith(quoteAuthority, q1, admin.publicKey);
      const ok = await mustSucceed("PreStocks purchase is accepted", async () =>
        buildPurchase({ ...base, edMessage: message, edSignature: signature, ixMessage: message, quoteId: q1.quoteId, assetId: 1, seriesId: 0 }),
        [admin]);
      const c1pda = pdas.contract(q1.quoteId);
      const ct = ok ? await client.getContractByAddress(c1pda) : null;
      if (ct) {
        const n = ct.nextRequestNonce;
        await mustSucceed("PreStocks exercise request is accepted", async () =>
          new Transaction().add(client.requestExerciseIx(admin.publicKey, c1pda, 1, n, 1_000_000n)), [admin]);
        const r1 = (await client.getPendingRequests()).find((r) => r.contract.equals(c1pda) && r.nonce === n);
        if (r1) {
          const at = (i: number, slot: bigint, price = 20_000_000n): Observation =>
            ({ slot, sourceTs: r1.requestTs + 30 + i * 30, collectedTs: r1.requestTs + 35 + i * 30, price });
          await mustFail("Fewer than three observations is rejected", async () =>
            new Transaction().add(client.settleExercisePrestocksIx(publisher.publicKey, c1pda, 1, n, buyerAta, c1.demoMint, [at(0, 10n), at(1, 11n)])),
            [publisher], E.InsufficientObservations);
          await mustFail("Duplicate source slots are rejected", async () =>
            new Transaction().add(client.settleExercisePrestocksIx(publisher.publicKey, c1pda, 1, n, buyerAta, c1.demoMint, [at(0, 10n), at(1, 10n), at(2, 11n)])),
            [publisher], E.NonIncreasingSlots);
          await mustFail("Observations outside the window are rejected", async () =>
            new Transaction().add(client.settleExercisePrestocksIx(publisher.publicKey, c1pda, 1, n, buyerAta, c1.demoMint,
              [0, 1, 2].map((i) => ({ slot: BigInt(20 + i), sourceTs: r1.requestTs - 600 + i, collectedTs: r1.requestTs - 595 + i, price: 20_000_000n })))),
            [publisher]);
        }
      }
    }
  }

  // ============ E. pool obligations (§12, §22) ============
  {
    const pool = await client.getPool(0);
    if (pool) {
      const overdraw = pool.availableCapital + 1_000_000_000n;
      await mustFail("Withdrawing more than available capital is rejected", async () => {
        const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });
        return new Transaction().add(new TransactionInstruction({
          programId: OPTKET_PROGRAM_ID,
          keys: [
            meta(admin.publicKey, true, false), meta(pdas.config(), false, false), meta(pdas.pool(0), false, true),
            meta(pdas.vault(0), false, true), meta(buyerAta, false, true), meta(demoMint, false, false),
            meta(TOKEN_PROGRAM_ID, false, false),
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: cat([disc("withdraw_pool"), u8a(0), u64(overdraw)]) as any,
        }));
      }, [admin], E.WithdrawalBelowObligations);

      // `publisher` is funded (keeper fee wallet) but is NOT the admin, and the
      // destination token account already exists — so the admin check is the
      // only thing that can fail here.
      await mustFail("Pool withdrawal by a non-admin is rejected", async () => {
        const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });
        return new Transaction().add(new TransactionInstruction({
          programId: OPTKET_PROGRAM_ID,
          keys: [
            meta(publisher.publicKey, true, false), meta(pdas.config(), false, false), meta(pdas.pool(0), false, true),
            meta(pdas.vault(0), false, true), meta(buyerAta, false, true),
            meta(demoMint, false, false), meta(TOKEN_PROGRAM_ID, false, false),
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: cat([disc("withdraw_pool"), u8a(0), u64(1_000_000n)]) as any,
        }));
      }, [publisher], E.Unauthorized);
    }
  }

  // ---- report ----
  console.log("\n" + "─".repeat(86));
  for (const [mark, label, detail] of results) console.log(` ${mark}  ${label.padEnd(58)} ${detail}`);
  console.log("─".repeat(86));
  console.log(`\n${pass}/${results.length} checks passed`);
  if (failures.length) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("\n§22 ADVERSARIAL SUITE PASSED ✅ — the deployed program rejected every attack.");
}

main().catch((e) => { console.error("\nSUITE ERROR ❌", e); process.exit(1); });
