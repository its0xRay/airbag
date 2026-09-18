import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { readFileSync } from "node:fs"; import { homedir } from "node:os";
import { OptketClient } from "../src/client/optketProgram";
const conn = new Connection("http://127.0.0.1:8899", "confirmed");
const client = new OptketClient(conn);
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));
async function main() {
  const cfg = await client.getConfig();
  const resp = await (await fetch("http://127.0.0.1:8787/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ buyer: payer.publicKey.toBase58(), assetId: 1, seriesId: 0, quantity: "10000000" }) })).json();
  if (resp.error) throw new Error(resp.error);
  console.log(`quote #${resp.quote.quoteId}: preSPX premium ${resp.premiumTokens} oUSD`);
  const q = { message: b64(resp.message), signature: b64(resp.signature), quoteAuthority: new PublicKey(resp.quoteAuthority), quoteId: BigInt(resp.quote.quoteId) };
  await sendAndConfirmTransaction(conn, client.purchaseTx(payer.publicKey, 1, 0, cfg!.demoMint, q), [payer], { commitment: "confirmed" });
  const contract = await client.getContract(q.quoteId);
  console.log(`bought preSPX contract #${contract!.contractId}, requesting exercise of full ${Number(contract!.remainingQuantity)/1e6}…`);
  const ix = client.requestExerciseIx(payer.publicKey, new PublicKey(contract!.address), 1, contract!.nextRequestNonce, contract!.remainingQuantity);
  await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer], { commitment: "confirmed" });
  console.log("✓ exercise requested — keeper should settle via live Jupiter next tick");
}
main();
