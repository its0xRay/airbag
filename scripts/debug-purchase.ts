import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, SendTransactionError } from "@solana/web3.js";
import { readFileSync } from "node:fs"; import { homedir } from "node:os";
import { OptketClient } from "../src/client/optketProgram";
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const client = new OptketClient(conn);
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`,"utf8"))));
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));
async function main(){
  const cfg = await client.getConfig();
  const resp = await (await fetch("http://127.0.0.1:8787/quote",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({buyer:payer.publicKey.toBase58(),assetId:1,seriesId:0,quantity:"8000000"})})).json();
  if (resp.error) { console.log("service error:", resp.error); return; }
  const q = { message: b64(resp.message), signature: b64(resp.signature), quoteAuthority: new PublicKey(resp.quoteAuthority), quoteId: BigInt(resp.quote.quoteId) };
  console.log("msg len:", q.message.length, "sig len:", q.signature.length, "quoteId:", resp.quote.quoteId);
  const tx = client.purchaseTx(payer.publicKey, 1, 0, cfg!.demoMint, q);
  try {
    const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
    console.log("SENT OK:", sig);
  } catch (e) {
    if (e instanceof SendTransactionError) { console.log("=== send logs ==="); const logs = await e.getLogs(conn).catch(()=>e.logs); for (const l of (logs||[])) console.log(" ", l); }
    else console.log("err:", (e as Error).message);
  }
}
main();
