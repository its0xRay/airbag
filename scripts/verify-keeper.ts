import { Connection, PublicKey } from "@solana/web3.js";
import { OptketClient, associatedTokenAddress } from "../src/client/optketProgram";
const conn = new Connection("http://127.0.0.1:8899", "confirmed");
const client = new OptketClient(conn);
const burner = new PublicKey("Ff6cxBFonde2H9BY5wmMozgNJ2ftfzsQhYuewaX8rrox");
const f = (v: bigint) => Number(v) / 1e6;
async function main() {
  const pool = await client.getPool(0);
  console.log("pool 0 — totalPayouts:", f(pool!.totalPayouts), " reserved:", f(pool!.reserved), " pending:", f(pool!.pendingExercise));
  const cfg = await client.getConfig();
  const contracts = await client.getContractsForBuyer(burner);
  for (const c of contracts) console.log(`contract #${c.contractId}: ${c.status}, remaining ${f(c.remainingQuantity)}, pending ${f(c.pendingQuantity)}`);
  try { const bal = await conn.getTokenAccountBalance(associatedTokenAddress(cfg!.demoMint, burner)); console.log("burner oUSD balance:", bal.value.uiAmount); } catch (e) { console.log("bal err", String(e)); }
}
main();
