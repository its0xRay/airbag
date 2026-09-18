import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { readFileSync } from "node:fs"; import { homedir } from "node:os";
import { OptketClient } from "../src/client/optketProgram";
const conn = new Connection(process.env.RPC_URL || "http://127.0.0.1:8899", "confirmed");
const SVC = process.env.QUOTE_SVC || "http://127.0.0.1:8787";
const client = new OptketClient(conn);
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`,"utf8"))));
const b64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));
const A = Number(process.env.ASSET_ID || 0);
async function main(){
  const cfg = await client.getConfig();
  const resp = await (await fetch(SVC+"/quote",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({buyer:payer.publicKey.toBase58(),assetId:A,seriesId:0,quantity:"8000000"})})).json();
  if(resp.error) throw new Error(resp.error);
  const q={message:b64(resp.message),signature:b64(resp.signature),quoteAuthority:new PublicKey(resp.quoteAuthority),quoteId:BigInt(resp.quote.quoteId)};
  await sendAndConfirmTransaction(conn, client.purchaseTx(payer.publicKey,A,0,cfg.demoMint,q),[payer],{commitment:"confirmed"});
  const c=await client.getContract(q.quoteId);
  await sendAndConfirmTransaction(conn, new Transaction().add(client.requestExerciseIx(payer.publicKey,new PublicKey(c.address),A,c.nextRequestNonce,c.remainingQuantity)),[payer],{commitment:"confirmed"});
  console.log(`asset ${A}: bought+requested contract #${c.contractId} (8 units)`);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
