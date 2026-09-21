// Anchor integration test for the Optket program (PRD §22).
//
// Requires the Solana + Anchor toolchain. Run with:
//   anchor test
//
// It exercises the happy path (init → fund → series → purchase → early
// exercise → settle) plus the replay-protection guarantee. Reference data is
// submitted by the publisher authority, matching the on-chain trust model.

import anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
const { BN } = anchor;
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { assert } from "chai";
import { Optket } from "../target/types/optket";

const price = (n: number) => new BN(Math.round(n * 1_000_000));
const qty = (n: number) => new BN(Math.round(n * 1_000_000));

// Borsh layout mirror of QuotePayload (95 bytes) — see src/engine/quote.ts.
function serializeQuote(q: any, buyer: PublicKey): Buffer {
  const b = Buffer.alloc(95);
  let o = 0;
  buyer.toBuffer().copy(b, o); o += 32;
  b.writeUInt8(q.assetId, o); o += 1;
  b.writeUInt16LE(q.seriesId, o); o += 2;
  q.quantity.toArrayLike(Buffer, "le", 8).copy(b, o); o += 8;
  q.strike.toArrayLike(Buffer, "le", 8).copy(b, o); o += 8;
  new BN(q.expiryTs).toArrayLike(Buffer, "le", 8).copy(b, o); o += 8;
  b.writeUInt32LE(q.referenceVersion, o); o += 4;
  q.premium.toArrayLike(Buffer, "le", 8).copy(b, o); o += 8;
  q.fees.toArrayLike(Buffer, "le", 8).copy(b, o); o += 8;
  q.quoteId.toArrayLike(Buffer, "le", 8).copy(b, o); o += 8;
  new BN(q.quoteExpiryTs).toArrayLike(Buffer, "le", 8).copy(b, o); o += 8;
  return b;
}

describe("optket", () => {
  const provider = anchor.AnchorProvider.env();
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(provider.connection.rpcEndpoint)) throw new Error("Fixture tests are local-validator only");
  anchor.setProvider(provider);
  const program = anchor.workspace.Optket as Program<Optket>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const quoteAuthority = Keypair.generate();
  const publisher = Keypair.generate();
  const buyer = admin; // buyer == wallet for simplicity

  let demoMint: PublicKey;
  let buyerToken: PublicKey;
  const assetId = 0;
  const seriesId = 0;

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const [assetPda] = PublicKey.findProgramAddressSync([Buffer.from("asset"), Buffer.from([assetId])], program.programId);
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool"), Buffer.from([assetId])], program.programId);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), Buffer.from([assetId])], program.programId);
  const seriesIdBuf = Buffer.alloc(2); seriesIdBuf.writeUInt16LE(seriesId);
  const [seriesPda] = PublicKey.findProgramAddressSync([Buffer.from("series"), Buffer.from([assetId]), seriesIdBuf], program.programId);

  const now = () => Math.floor(Date.now() / 1000);

  it("initializes config, asset, pool and series", async () => {
    demoMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    const ata = await getOrCreateAssociatedTokenAccount(provider.connection, admin, demoMint, buyer.publicKey);
    buyerToken = ata.address;
    await mintTo(provider.connection, admin, demoMint, buyerToken, admin, 1_000_000_000_000);

    await program.methods
      .initializeConfig(quoteAuthority.publicKey, publisher.publicKey, new BN(0))
      .accounts({ admin: admin.publicKey, config: configPda, demoMint, systemProgram: SystemProgram.programId })
      .rpc();

    await program.methods
      .initAsset(assetId, { equityToken: {} }, demoMint, 1, 1, price(50_000_000), true)
      .accounts({
        admin: admin.publicKey, config: configPda, asset: assetPda, pool: poolPda, vault: vaultPda,
        demoMint, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .rpc();

    // fund the pool
    await program.methods
      .fundPool(assetId, price(500_000))
      .accounts({ admin: admin.publicKey, config: configPda, pool: poolPda, vault: vaultPda, adminToken: buyerToken, demoMint, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();

    const expiry = now() + 7 * 24 * 3600;
    await program.methods
      .createSeries(assetId, seriesId, price(170), new BN(expiry), new BN(expiry - 900), new BN(expiry - 300), qty(500))
      .accounts({ admin: admin.publicKey, config: configPda, asset: assetPda, series: seriesPda, systemProgram: SystemProgram.programId })
      .rpc();

    const pool = await program.account.pool.fetch(poolPda);
    assert.ok(pool.availableCapital.eq(price(500_000)));
  });

  async function purchase(quoteId: number, paymentAccount: PublicKey = buyerToken, id = seriesId) {
    const sid = Buffer.alloc(2); sid.writeUInt16LE(id);
    const selectedPda = PublicKey.findProgramAddressSync([Buffer.from("series"), Buffer.from([assetId]), sid], program.programId)[0];
    const series = await program.account.series.fetch(selectedPda);
    const q = {
      buyer: buyer.publicKey,
      assetId,
      seriesId: id,
      quantity: qty(10),
      strike: series.strike,
      expiryTs: series.expiryTs.toNumber(),
      referenceVersion: series.referenceVersion,
      premium: price(50),
      fees: new BN(0),
      quoteId: new BN(quoteId),
      quoteExpiryTs: now() + 60,
    };
    const message = serializeQuote(q, buyer.publicKey);
    const signature = nacl.sign.detached(message, quoteAuthority.secretKey);
    const edIx = Ed25519Program.createInstructionWithPublicKey({
      publicKey: quoteAuthority.publicKey.toBytes(),
      message,
      signature,
    });

    const quoteIdBuf = q.quoteId.toArrayLike(Buffer, "le", 8);
    const [markerPda] = PublicKey.findProgramAddressSync([Buffer.from("quote"), quoteIdBuf], program.programId);
    const [contractPda] = PublicKey.findProgramAddressSync([Buffer.from("contract"), quoteIdBuf], program.programId);

    const purchaseIx = await program.methods
      .purchase(
        {
          buyer: q.buyer, assetId: q.assetId, seriesId: q.seriesId, quantity: q.quantity, strike: q.strike,
          expiryTs: new BN(q.expiryTs), referenceVersion: q.referenceVersion, premium: q.premium, fees: q.fees,
          quoteId: q.quoteId, quoteExpiryTs: new BN(q.quoteExpiryTs),
        },
        0, // ed25519 instruction index within the tx
      )
      .accounts({
        buyer: buyer.publicKey, payer: buyer.publicKey, config: configPda, asset: assetPda,
        series: selectedPda, pool: poolPda, vault: vaultPda,
        buyerToken: paymentAccount, demoMint, quoteMarker: markerPda, contract: contractPda,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction().add(edIx).add(purchaseIx);
    await provider.sendAndConfirm(tx, [buyer]);
    return contractPda;
  }

  it("purchases protection with a signed quote and reserves liability", async () => {
    const contractPda = await purchase(1);
    const c = await program.account.contract.fetch(contractPda);
    assert.equal(c.remainingQuantity.toString(), qty(10).toString());
    // reserved = ceil(10 * 170) = 1700 tokens
    assert.equal(c.reservedCollateral.toString(), price(1700).toString());
  });

  let legacyExpiryContract: PublicKey;
  let tokenContract: PublicKey;
  let shortExpiry: number;

  it("creates legacy expiry terms, migrates metadata, and creates v2 without editing old terms", async () => {
    shortExpiry = now() + 30;
    const create = async (id: number) => {
      const sid = Buffer.alloc(2); sid.writeUInt16LE(id);
      const pda = PublicKey.findProgramAddressSync([Buffer.from("series"), Buffer.from([assetId]), sid], program.programId)[0];
      await program.methods.createSeries(assetId, id, price(170), new BN(shortExpiry), new BN(shortExpiry - 5), new BN(shortExpiry - 5), qty(100))
        .accounts({ admin: admin.publicKey, config: configPda, asset: assetPda, series: pda, systemProgram: SystemProgram.programId }).rpc();
    };
    await create(5);
    legacyExpiryContract = await purchase(5, buyerToken, 5);
    await program.methods.setAssetMetadata(0, null, 2, null)
      .accounts({ admin: admin.publicKey, config: configPda, asset: assetPda }).rpc();
    await create(6);
    tokenContract = await purchase(6, buyerToken, 6);
    assert.equal((await program.account.contract.fetch(legacyExpiryContract)).referenceVersion, 1);
    assert.equal((await program.account.contract.fetch(tokenContract)).referenceVersion, 2);
  });

  it("rejects both wrong expiry paths at the instruction boundary", async () => {
    const accounts = (contract: PublicKey) => ({ publisher: publisher.publicKey, config: configPda, contract, asset: assetPda, pool: poolPda, vault: vaultPda, buyerToken, demoMint, tokenProgram: TOKEN_PROGRAM_ID });
    const obs = { slot: new BN(1), sourceTs: new BN(shortExpiry), collectedTs: new BN(shortExpiry), price: price(150) };
    for (const invoke of [
      () => program.methods.settleExpiryPrestocks([obs, obs, obs]).accounts(accounts(legacyExpiryContract)).signers([publisher]).rpc(),
      () => program.methods.settleExpiryEquity(obs).accounts(accounts(tokenContract)).signers([publisher]).rpc(),
    ]) {
      let rejected = false;
      try { await invoke(); } catch (e) { assert.match(String(e), /WrongReferencePath/); rejected = true; }
      assert.isTrue(rejected, "wrong path must reject");
    }
  });

  it("requests and settles v2 partial exercise with the token median", async () => {
    const reqPda = PublicKey.findProgramAddressSync([Buffer.from("exercise"), tokenContract.toBuffer(), Buffer.alloc(4)], program.programId)[0];
    await program.methods.requestExercise(qty(1)).accounts({ buyer: buyer.publicKey, contract: tokenContract, asset: assetPda, pool: poolPda, request: reqPda, payer: buyer.publicKey, systemProgram: SystemProgram.programId }).rpc();
    const req = await program.account.exerciseRequest.fetch(reqPda);
    assert.property(req.kind, "preStocks");
    const observations = [1, 2, 3].map((n) => ({ slot: new BN(n), sourceTs: req.requestTs.addn(n), collectedTs: req.requestTs.addn(n), price: price(150) }));
    await program.methods.settleExercisePrestocks(observations).accounts({ publisher: publisher.publicKey, config: configPda, contract: tokenContract, asset: assetPda, pool: poolPda, vault: vaultPda, request: reqPda, buyerToken, demoMint, tokenProgram: TOKEN_PROGRAM_ID }).signers([publisher]).rpc();
    assert.equal((await program.account.exerciseRequest.fetch(reqPda)).payout.toString(), price(20).toString());
  });

  it("rejects a replayed quote id (PRD §22)", async () => {
    try {
      await purchase(1);
      assert.fail("expected replay rejection");
    } catch (e) {
      assert.match(String(e), /already been used|custom program error|0x0/i);
    }
  });

  it("partial early exercise settles on a qualifying observation", async () => {
    const contractPda = await purchase(2);
    const c0 = await program.account.contract.fetch(contractPda);
    const nonceBuf = Buffer.alloc(4); nonceBuf.writeUInt32LE(c0.nextRequestNonce);
    const [reqPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("exercise"), contractPda.toBuffer(), nonceBuf],
      program.programId,
    );

    await program.methods
      .requestExercise(qty(4))
      .accounts({ buyer: buyer.publicKey, contract: contractPda, asset: assetPda, pool: poolPda, request: reqPda, payer: buyer.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    const req = await program.account.exerciseRequest.fetch(reqPda);
    const t = req.requestTs.toNumber() + 30;
    const obs = { slot: new BN(1), sourceTs: new BN(t), collectedTs: new BN(t + 5), price: price(150) };

    await program.methods
      .settleExerciseEquity(obs)
      .accounts({
        publisher: publisher.publicKey, config: configPda, contract: contractPda, asset: assetPda, pool: poolPda,
        vault: vaultPda, request: reqPda, buyerToken, demoMint, tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([publisher])
      .rpc();

    const c = await program.account.contract.fetch(contractPda);
    assert.equal(c.remainingQuantity.toString(), qty(6).toString(), "remaining preserved");
    assert.equal(c.pendingQuantity.toString(), "0");
    const req2 = await program.account.exerciseRequest.fetch(reqPda);
    // 4 * (170-150) = 80 tokens paid
    assert.equal(req2.payout.toString(), price(80).toString());
  });

  it("settles legacy benchmark and v2 median expiry after migration", async () => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, shortExpiry - now() + 2) * 1000));
    const accounts = (contract: PublicKey) => ({ publisher: publisher.publicKey, config: configPda, contract, asset: assetPda, pool: poolPda, vault: vaultPda, buyerToken, demoMint, tokenProgram: TOKEN_PROGRAM_ID });
    const obs = { slot: new BN(1), sourceTs: new BN(shortExpiry), collectedTs: new BN(shortExpiry), price: price(150) };
    await program.methods.settleExpiryEquity(obs).accounts(accounts(legacyExpiryContract)).signers([publisher]).rpc();
    const observations = [1, 2, 3].map((n) => ({ ...obs, slot: new BN(n), sourceTs: new BN(shortExpiry - 4 + n) }));
    await program.methods.settleExpiryPrestocks(observations).accounts(accounts(tokenContract)).signers([publisher]).rpc();
    for (const address of [legacyExpiryContract, tokenContract]) {
      const c = await program.account.contract.fetch(address);
      assert.property(c.status, "expired");
      assert.equal(c.reservedCollateral.toString(), "0");
    }
  });

  it("rejects a purchase paid with a non-demo mint (real-USDC guard, PRD §22)", async () => {
    const otherMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    const otherAta = await getOrCreateAssociatedTokenAccount(provider.connection, admin, otherMint, buyer.publicKey);
    try {
      await purchase(3, otherAta.address);
      assert.fail("expected wrong-mint purchase rejection");
    } catch (e) {
      assert.match(String(e), /ConstraintTokenMint|token mint|custom program error|0x7d3/i);
    }
  });
});
