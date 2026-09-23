/** Controlled fixtures, isolated validator ONLY. Never used by public services. */
import anchor from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram, Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { OPTKET_PROGRAM_ID, pdas } from "../src/client/optketProgram";
import { VaultClient, vaultPdas } from "../src/client/vaultProgram";

const RPC = process.env.VAULT_TEST_RPC || "http://127.0.0.1:8897";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(RPC)) throw new Error("Local validator required");
const conn = new Connection(RPC, "confirmed");
const vaultClient = new VaultClient(conn);
const refundMode = process.env.VAULT_TEST_REFUND === "true";
const admin = Keypair.generate(), user = Keypair.generate(), attacker = Keypair.generate();
const quoteKey = Keypair.generate(), publisher = Keypair.generate();
const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(admin), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync(new URL("../target/idl/optket.json", import.meta.url), "utf8"));
const program = new anchor.Program(idl, provider);
const U = 1_000_000n;
const bn = (n: number | bigint) => new anchor.BN(n.toString());
const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const pda = (...parts: Uint8Array[]) => PublicKey.findProgramAddressSync(parts, OPTKET_PROGRAM_ID)[0];
const seed = (s: string) => Buffer.from(s);
const roundPda = (asset: number, id: number) => pda(seed("underwriting-round"), Uint8Array.of(asset), u64(id));
const custodyPda = (round: PublicKey) => pda(seed("round-custody"), round.toBytes());
const depositPda = (round: PublicKey, owner: PublicKey) => pda(seed("round-deposit"), round.toBytes(), owner.toBytes());
const positionPda = (round: PublicKey, id: number) => pda(seed("round-position"), round.toBytes(), u64(id));
const policy = [...createHash("sha256").update("local-test-only").digest()];
let checks = 0;
async function ok(label: string, fn: () => Promise<void>) { await fn(); checks++; console.log(`PASS ${label}`); }
async function rejects(label: string, fn: () => Promise<unknown>, expected: string) {
  await ok(label, async () => {
    try { await fn(); } catch (e) {
      const s = String(e) + JSON.stringify((e as { logs?: string[] }).logs || []);
      assert.match(s, new RegExp(expected)); return;
    }
    assert.fail("Transaction unexpectedly succeeded");
  });
}
async function clock() { return (await conn.getBlockTime(await conn.getSlot()))!; }
async function until(ts: number) { while (await clock() < ts) await new Promise(r => setTimeout(r, 500)); }
async function send(ix: anchor.web3.TransactionInstruction, signers: Keypair[] = []) {
  return sendAndConfirmTransaction(conn, new Transaction().add(ix), [admin, ...signers], { commitment: "confirmed" });
}
for (const key of [admin, user, attacker]) {
  const signature = await conn.requestAirdrop(key.publicKey, 20_000_000_000);
  while (!(await conn.getSignatureStatus(signature)).value?.confirmationStatus) await new Promise(r => setTimeout(r, 200));
}
const mint = await createMint(conn, admin, admin.publicKey, null, 6);
const adminToken = (await getOrCreateAssociatedTokenAccount(conn, admin, mint, admin.publicKey)).address;
const userToken = (await getOrCreateAssociatedTokenAccount(conn, admin, mint, user.publicKey)).address;
const attackerToken = (await getOrCreateAssociatedTokenAccount(conn, admin, mint, attacker.publicKey)).address;
await mintTo(conn, admin, mint, adminToken, admin, 100_000n * U);
await mintTo(conn, admin, mint, userToken, admin, 100_000n * U);
await program.methods.initializeConfig(quoteKey.publicKey, publisher.publicKey, bn(0))
  .accountsStrict({ admin: admin.publicKey, config: pdas.config(), demoMint: mint, systemProgram: SystemProgram.programId }).rpc();
for (const asset of [0, 1]) {
  await program.methods.initAsset(asset, asset === 0 ? { equityToken: {} } : { preStocks: {} },
    mint, asset === 0 ? 2 : 1, 1, bn(100_000n * U), true).accountsStrict({
    admin: admin.publicKey, config: pdas.config(), asset: pdas.asset(asset), pool: pdas.pool(asset),
    vault: pdas.vault(asset), demoMint: mint, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
}
const start = await clock();
const fundingClose = start + 60, salesClose = start + 90, expiry = start + 390;
const rounds = [roundPda(0, 1), roundPda(1, 1)];
const terms = (asset: number) => ({ assetId: asset, fundingClose: bn(fundingClose), salesClose: bn(salesClose),
  latestExpiry: bn(expiry), depositCap: bn(10_000n * U), exposureCap: bn(10_000n * U),
  minStrike: bn(U), maxStrike: bn(2_000n * U), maxQuantity: bn(10n * U) });
const withdraw = (round: PublicKey, owner: Keypair, ownerToken: PublicKey) => ({
  owner: owner.publicKey, round, deposit: depositPda(round, owner.publicKey), custody: custodyPda(round),
  ownerToken, mint, tokenProgram: TOKEN_PROGRAM_ID });
for (const asset of [0, 1]) {
  const round = rounds[asset];
  await ok(`asset ${asset}: create isolated round`, async () => {
    await program.methods.createVaultRound(bn(1), terms(asset), policy).accountsStrict({
      admin: admin.publicKey, config: pdas.config(), asset: pdas.asset(asset), round,
      custody: custodyPda(round), mint, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
  });
  for (const [owner, ownerToken, amount] of [[admin, adminToken, 600n * U], [user, userToken, 400n * U]] as const) {
    await ok(`asset ${asset}: ${owner === admin ? "admin" : "user"} deposit`, async () => {
      const ix = await program.methods.depositVault(bn(amount)).accountsStrict({
        ...withdraw(round, owner, ownerToken), payer: admin.publicKey, config: pdas.config(),
        systemProgram: SystemProgram.programId }).instruction();
      const decoded = (await vaultClient.getRound(round))!;
      const clientIx = vaultClient.depositIx(decoded, owner.publicKey, admin.publicKey, amount);
      assert.deepEqual(clientIx.data, ix.data);
      assert.deepEqual(clientIx.keys, ix.keys);
      await send(clientIx, owner === admin ? [] : [owner]);
    });
  }
  await rejects(`asset ${asset}: another user cannot cancel owner's deposit`, async () => {
    const ix = await program.methods.cancelVaultDeposit(bn(U)).accountsStrict({
      ...withdraw(round, attacker, attackerToken), deposit: depositPda(round, user.publicKey) }).instruction();
    return send(ix, [attacker]);
  }, "ConstraintSeeds|ConstraintHasOne");
  await rejects(`asset ${asset}: cannot redeem while funding`, () => program.methods.redeemVault()
    .accountsStrict(withdraw(round, admin, adminToken)).rpc(), "InvalidVaultPhase");
}
await rejects("cannot substitute another round's custody", () => program.methods.cancelVaultDeposit(bn(U))
  .accountsStrict({ ...withdraw(rounds[0], admin, adminToken), custody: custodyPda(rounds[1]) }).rpc(), "ConstraintHasOne");
await program.methods.setPause(true).accountsStrict({ admin: admin.publicKey, config: pdas.config() }).rpc();
await rejects("pause blocks new vault deposits", () => program.methods.depositVault(bn(U)).accountsStrict({
  ...withdraw(rounds[0], admin, adminToken), payer: admin.publicKey, config: pdas.config(), systemProgram: SystemProgram.programId }).rpc(), "PurchasesPaused");
await ok("funding cancellation remains available while paused", async () => {
  await program.methods.cancelVaultDeposit(bn(U)).accountsStrict(withdraw(rounds[0], admin, adminToken)).rpc();
});
await program.methods.setPause(false).accountsStrict({ admin: admin.publicKey, config: pdas.config() }).rpc();
await program.methods.depositVault(bn(U)).accountsStrict({ ...withdraw(rounds[0], admin, adminToken),
  payer: admin.publicKey, config: pdas.config(), systemProgram: SystemProgram.programId }).rpc();
await ok("cancel funding and re-deposit", async () => {
  await program.methods.cancelVaultDeposit(bn(100n * U)).accountsStrict(withdraw(rounds[0], admin, adminToken)).rpc();
  await program.methods.depositVault(bn(100n * U)).accountsStrict({
    ...withdraw(rounds[0], admin, adminToken), payer: admin.publicKey, config: pdas.config(), systemProgram: SystemProgram.programId }).rpc();
});
await until(fundingClose);
for (const round of rounds) await program.methods.activateVault().accountsStrict({
  cranker: admin.publicKey, config: pdas.config(), round, custody: custodyPda(round) }).rpc();
await rejects("new deposit rejected after activation", () => program.methods.depositVault(bn(U)).accountsStrict({
  ...withdraw(rounds[0], admin, adminToken), payer: admin.publicKey, config: pdas.config(), systemProgram: SystemProgram.programId }).rpc(), "VaultFundingClosed");
const positions: PublicKey[] = [];
for (const asset of [0, 1]) {
  const round = rounds[asset], position = positionPda(round, 100 + asset); positions.push(position);
  const q = { buyer: user.publicKey, assetId: asset, seriesId: 0, quantity: bn(U), strike: bn(100n * U),
    expiryTs: bn(expiry), referenceVersion: asset === 0 ? 2 : 1, premium: bn(10n * U), fees: bn(0),
    quoteId: bn(100 + asset), quoteExpiryTs: bn(await clock() + 60) };
  const encoded = program.coder.types.encode("quotePayload", q);
  const message = Buffer.concat([seed("airbag-vault-quote-v1"), OPTKET_PROGRAM_ID.toBuffer(), round.toBuffer(), encoded]);
  const sigIx = Ed25519Program.createInstructionWithPrivateKey({ privateKey: quoteKey.secretKey, message });
  const accounts = { buyer: user.publicKey, payer: admin.publicKey, config: pdas.config(), round,
    asset: pdas.asset(asset), position, custody: custodyPda(round), buyerToken: userToken, mint,
    instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId };
  await rejects(`asset ${asset}: max premium enforced`, async () => {
    const ix = await program.methods.purchaseVault(q, 0, bn(9n * U)).accountsStrict(accounts).instruction();
    return sendAndConfirmTransaction(conn, new Transaction().add(sigIx, ix), [admin, user]);
  }, "QuoteTermsMismatch");
  const ix = await program.methods.purchaseVault(q, 0, bn(10n * U)).accountsStrict(accounts).instruction();
  const clientIx = vaultClient.purchaseIx((await vaultClient.getRound(round))!, user.publicKey, admin.publicKey, encoded, BigInt(100 + asset), 0, 10n * U);
  assert.deepEqual(clientIx.data, ix.data); assert.deepEqual(clientIx.keys, ix.keys);
  await program.methods.setPause(true).accountsStrict({ admin: admin.publicKey, config: pdas.config() }).rpc();
  await rejects(`asset ${asset}: pause blocks new purchases`, () => sendAndConfirmTransaction(conn,
    new Transaction().add(sigIx, clientIx), [admin, user]), "PurchasesPaused");
  await program.methods.setPause(false).accountsStrict({ admin: admin.publicKey, config: pdas.config() }).rpc();
  await ok(`asset ${asset}: buyer purchase reserves depositor capital`, async () => {
    await sendAndConfirmTransaction(conn, new Transaction().add(sigIx, clientIx), [admin, user]);
    const state = await (program.account as any).vaultRound.fetch(round);
    assert.equal(state.ledger.reserved.toString(), (100n * U).toString());
    assert.equal(state.ledger.premiums.toString(), (10n * U).toString());
  });
  await rejects(`asset ${asset}: quote replay rejected`, () => sendAndConfirmTransaction(conn,
    new Transaction().add(sigIx, ix), [admin, user]), "already in use");
}
// Keep purchases paused through requests, payouts/refunds, finalization and redemption.
await program.methods.setPause(true).accountsStrict({ admin: admin.publicKey, config: pdas.config() }).rpc();
for (const asset of [0, 1]) {
  const p = (await vaultClient.positions()).find(p => p.address.equals(positions[asset]))!;
  await ok(`asset ${asset}: partial exercise request uses real client instruction`, async () => {
    await send(vaultClient.requestIx(p, admin.publicKey, 400_000n), [user]);
  });
  const r = (await vaultClient.requests()).find(r => r.position.equals(p.address))!;
  assert(r.address.equals(vaultPdas.request(p.address, 0)));
  const round = (await vaultClient.getRound(rounds[asset]))!;
  const observations = [1, 2, 3].map(slot => ({ slot: BigInt(slot), sourceTs: r.windowEnd - 3 + slot, collectedTs: r.windowEnd - 3 + slot, price: 80n * U }));
  await rejects(`asset ${asset}: future window cannot settle early`, () => send(vaultClient.settleIx(round, p, observations, r), [publisher]), "ObservationOutsideWindow");
}
await until(salesClose);
await rejects("outstanding contracts block finalization", () => program.methods.finalizeVault().accountsStrict({
  cranker: admin.publicKey, config: pdas.config(), round: rounds[0], custody: custodyPda(rounds[0]) }).rpc(), "VaultObligationsOutstanding");
console.log("Waiting for genuine local clock expiry; fixture references stay local.");
for (const asset of [0, 1]) {
  const p = (await vaultClient.positions()).find(p => p.address.equals(positions[asset]))!;
  const r = (await vaultClient.requests()).find(r => r.position.equals(p.address))!;
  await until(r.windowEnd);
  const round = (await vaultClient.getRound(rounds[asset]))!;
  const observations = [1, 2, 3].map(slot => ({ slot: BigInt(slot), sourceTs: r.windowEnd - 3 + slot, collectedTs: r.windowEnd - 3 + slot, price: 80n * U }));
  await ok(`asset ${asset}: partial exercise pays 8 oUSD and retains remaining reserve`, async () => {
    const before = (await getAccount(conn, userToken)).amount;
    await send(vaultClient.settleIx(round, p, observations, r), [publisher]);
    assert.equal((await getAccount(conn, userToken)).amount - before, 8n * U);
    assert.equal((await vaultClient.getRound(round.address))!.reserved, 60n * U);
  });
}
await until(expiry);
if (refundMode) {
  for (const asset of [0, 1]) {
    const round = (await vaultClient.getRound(rounds[asset]))!;
    const p = (await vaultClient.positions()).find(p => p.address.equals(positions[asset]))!;
    await rejects(`asset ${asset}: refunds wait for reference grace period`, () => send(vaultClient.settleIx(round, p, null), [publisher]), "ExpiryNotReached");
  }
  console.log("Waiting for genuine local reference-failure grace period; purchases remain paused.");
  await until(expiry + 301);
}
for (const asset of [0, 1]) {
  const round = rounds[asset];
  const observations = [1, 2, 3].map((slot, index) => ({ slot: bn(slot), sourceTs: bn(expiry - 3 + index),
    collectedTs: bn(expiry - 3 + index), price: bn(80n * U) }));
  const accounts = { publisher: publisher.publicKey, position: positions[asset], round, asset: pdas.asset(asset),
    custody: custodyPda(round), buyerToken: userToken, mint, tokenProgram: TOKEN_PROGRAM_ID };
  await rejects(`asset ${asset}: unauthorized publisher rejected`, async () => send(
    await program.methods.refundVaultExpiry().accountsStrict({ ...accounts, publisher: attacker.publicKey }).instruction(),
    [attacker]), "Unauthorized");
  await ok(`asset ${asset}: ${refundMode ? "remaining premium refund" : "expiry payout"} from matching vault while paused`, async () => {
    const before = (await getAccount(conn, userToken)).amount;
    const instruction = refundMode ? await program.methods.refundVaultExpiry().accountsStrict(accounts).instruction()
      : await program.methods.settleVaultExpiry(observations).accountsStrict(accounts).instruction();
    await send(instruction, [publisher]);
    assert.equal((await getAccount(conn, userToken)).amount - before, (refundMode ? 6n : 12n) * U);
    if (refundMode) await rejects(`asset ${asset}: duplicate refund rejected`, () => send(instruction, [publisher]), "ContractNotActive");
  });
  await program.methods.finalizeVault().accountsStrict({ cranker: admin.publicKey,
    config: pdas.config(), round, custody: custodyPda(round) }).rpc();
  for (const [owner, tokenAccount, amount] of [[admin, adminToken, refundMode ? 597_600_000n : 594n * U], [user, userToken, refundMode ? 398_400_000n : 396n * U]] as const) {
    await ok(`asset ${asset}: proportional ${owner === admin ? "admin" : "user"} redemption`, async () => {
      const before = (await getAccount(conn, tokenAccount)).amount;
      await send(await program.methods.redeemVault().accountsStrict(withdraw(round, owner, tokenAccount)).instruction(), owner === admin ? [] : [owner]);
      assert.equal((await getAccount(conn, tokenAccount)).amount - before, amount);
    });
  }
  await rejects(`asset ${asset}: repeat redemption rejected`, () => program.methods.redeemVault()
    .accountsStrict(withdraw(round, admin, adminToken)).rpc(), "InvalidVaultPhase");
  assert.equal((await getAccount(conn, custodyPda(round))).amount, 0n);
}
console.log(`PASS ${checks} isolated vault integration checks`);
