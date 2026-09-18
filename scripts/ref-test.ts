import { PythEquityAdapter, JupiterPreStocksAdapter } from "../server/references";
const f = (v: bigint) => Number(v) / 1e6;
async function main() {
  console.log("=== Pyth equity (asset 0) ===");
  const eq = await new PythEquityAdapter(0).observe();
  console.log(eq.available ? `available: $${f(eq.price)} @ ${new Date(eq.sourceTs*1000).toISOString()} [${eq.verification}]` : `unavailable: ${eq.reason} [${eq.sourceId}]`);

  console.log("\n=== Jupiter PreStocks (asset 1) — 3-sample window ===");
  const obs = await new JupiterPreStocksAdapter(1).observe(3);
  for (const o of obs) console.log(o.available ? `  $${f(o.price)}  slot ${o.slot}  ts ${o.sourceTs}` : `  unavailable: ${o.reason}`);
  const prices = obs.filter(o=>o.available).map(o=>o.price).sort((a,b)=>a<b?-1:1);
  if (prices.length) console.log(`  median: $${f(prices[Math.floor(prices.length/2)])}  (${prices.length} qualifying samples, distinct increasing slots)`);
}
main();
