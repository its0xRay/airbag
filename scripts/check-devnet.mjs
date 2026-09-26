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
const series = await read("/series/all?includeVaults=true&customFloors=true");
for (const asset of [0, 1]) {
  const reference = await read(`/reference?assetId=${asset}`);
  if (reference && !reference.available) failures.push(`Asset ${asset}: reference unavailable`);
  const terms = (series ?? []).find(s => s.assetId === asset && s.vaultRound && s.minStrike && s.maxStrike && s.purchaseCutoffTs > Date.now() / 1000 && s.expiryTs - Date.now() / 1000 >= 86400 && BigInt(s.availableCapacity ?? "0") > 0n);
  if (!terms) failures.push(`Asset ${asset}: no funded custom-floor expiry`);
}
const trial = await read("/trial/status");
if (trial && (!trial.active || trial.remainingSol < 0.25 || trial.walletBalanceSol < 0.25)) failures.push("Trial funding or spending-cap headroom below 0.25 Devnet SOL");
console.log(JSON.stringify({ ok: failures.length === 0, failures, trial: trial ? {
  walletBalanceSol: trial.walletBalanceSol, remainingCapSol: trial.remainingSol,
} : null, keeper: "Check keeper /health separately on its private network; this command does not verify it." }, null, 2));
process.exitCode = failures.length ? 1 : 0;
