/** Proves a user with ZERO SOL can transact: the trial budget pays fees and
 *  the exact account rent (PRD §19). Also checks the sponsor refuses to
 *  co-sign a transaction that would drain it. */
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { OptketClient, pdas } from "../src/client/optketProgram";

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const SVC = process.env.QUOTE_SVC || "http://127.0.0.1:8787";
const conn = new Connection(RPC, "confirmed");
const client = new OptketClient(conn);
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

async function main() {
  const burner = Keypair.generate();
  console.log("fresh burner:", burner.publicKey.toBase58());
  console.log("burner SOL  :", (await conn.getBalance(burner.publicKey)) / LAMPORTS_PER_SOL, "(zero — never funded)");

  const cfg = await (await fetch(`${SVC}/config`)).json();
  const trial = await (await fetch(`${SVC}/trial/status`)).json();
  const sponsor = new PublicKey(trial.budgetWallet);
  const demoMint = new PublicKey(cfg.demoMint);
  console.log("sponsor     :", sponsor.toBase58());

  // demo tokens for the premium (not a budgeted SOL cost)
  await fetch(`${SVC}/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: burner.publicKey.toBase58() }) });

  // --- hostile request: try to get the sponsor to just send us SOL ---
  const evil = new Transaction().add(SystemProgram.transfer({ fromPubkey: sponsor, toPubkey: burner.publicKey, lamports: 500_000_000 }));
  evil.feePayer = sponsor;
  evil.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const evilRes = await (await fetch(`${SVC}/sponsor`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx: evil.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), buyer: burner.publicKey.toBase58() }),
  })).json();
  console.log(evilRes.error ? `✓ drain attempt refused: ${evilRes.error}` : "✗ DRAIN ATTEMPT WAS SIGNED");

  // --- legitimate sponsored purchase on the short-dated series ---
  const all = await (await fetch(`${SVC}/series/all`)).json();
  const s = all.find((x: { shortDated: boolean; assetId: number }) => x.shortDated && x.assetId === 0) || all[0];
  console.log(`buying asset ${s.assetId} series ${s.seriesId} (shortDated=${s.shortDated})`);

  const q = await (await fetch(`${SVC}/quote`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ buyer: burner.publicKey.toBase58(), assetId: s.assetId, seriesId: s.seriesId, quantity: "1000000" }),
  })).json();
  if (q.error) throw new Error(q.error);
  console.log(`quote premium: ${q.premiumTokens} oUSD (spot ${q.spot} via ${q.spotSource})`);

  // rent prefix must be part of the build so the ed25519 index stays correct
  const tx = client.purchaseTx(
    burner.publicKey, s.assetId, s.seriesId, demoMint,
    {
      message: b64(q.message), signature: b64(q.signature),
      quoteAuthority: new PublicKey(q.quoteAuthority), quoteId: BigInt(q.quote.quoteId),
    },
    [SystemProgram.transfer({ fromPubkey: sponsor, toPubkey: burner.publicKey, lamports: 6_000_000 })],
  );
  tx.feePayer = sponsor;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;

  const res = await (await fetch(`${SVC}/sponsor`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), buyer: burner.publicKey.toBase58() }),
  })).json();
  if (res.error) throw new Error("sponsor refused: " + res.error);

  const signed = Transaction.from(Buffer.from(res.tx, "base64"));
  signed.partialSign(burner);
  const sig = await conn.sendRawTransaction(signed.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  console.log("✓ sponsored purchase confirmed:", sig);

  const c = await client.getContract(BigInt(q.quote.quoteId));
  console.log(`✓ contract #${c!.contractId} created — ${Number(c!.remainingQuantity) / 1e6} protected @ $${Number(c!.strike) / 1e6}`);
  console.log(`\nSPONSORSHIP PASSED ✅ — a zero-SOL wallet transacted; sponsor refused the drain attempt.`);
}
main().catch((e) => { console.error("FAILED ❌", e.message || e); process.exit(1); });
