// Read-only release/uptime check. Never signs, funds accounts, or changes caps.
const service = process.env.QUOTE_SERVICE_URL || "https://web-production-44d1a.up.railway.app";
const failures = [];
async function read(path) {
  try {
    const response = await fetch(`${service}${path}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { failures.push(`${path}: unavailable`); return null; }
}
const health = await read("/health");
if (health && !health.ok) failures.push("Quote service unhealthy");
if (health?.seriesRotation && (health.seriesRotation.error || Date.now() / 1000 - health.seriesRotation.lastSuccessAt > 300)) failures.push("Series rotation needs attention");
const series = await read("/series/all");
for (const asset of [0, 1]) {
  const reference = await read(`/reference?assetId=${asset}`);
  if (reference && !reference.available) failures.push(`Asset ${asset}: reference unavailable`);
  for (const short of [true, false]) {
    const floors = new Set((series ?? []).filter(s => s.assetId === asset && s.shortDated === short && s.purchaseCutoffTs > Date.now() / 1000).map(s => s.strike));
    if (floors.size < 2) failures.push(`Asset ${asset}: fewer than two ${short ? "short" : "weekly"} floors`);
  }
}
const trial = await read("/trial/status");
if (trial && (!trial.active || trial.remainingSol < 0.25 || trial.walletBalanceSol < 0.25)) failures.push("Trial funding or spending-cap headroom below 0.25 Devnet SOL");
console.log(JSON.stringify({ ok: failures.length === 0, failures, trial: trial ? {
  walletBalanceSol: trial.walletBalanceSol, remainingCapSol: trial.remainingSol,
} : null, keeper: "Check keeper /health separately on its private network; this command does not verify it." }, null, 2));
process.exitCode = failures.length ? 1 : 0;
