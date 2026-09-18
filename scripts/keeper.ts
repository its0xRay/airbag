/**
 * Optket keeper / monitoring reference (PRD §21).
 *
 * The keeper settles ready requests, processes expiries and eligible refunds,
 * retries idempotently, and operates INDEPENDENTLY PER ASSET so one asset's
 * outage never stalls the other. Settlement triggering is permissionless; the
 * reference data itself is submitted by the publisher authority.
 *
 * This file is a documented skeleton — wire it to @coral-xyz/anchor and your
 * reference sources (Pyth for equity, Jupiter Price API for PreStocks) when
 * deploying. It intentionally has no side effects on its own.
 *
 * Operational target: submit settlement within TWO MINUTES of a qualifying
 * reference becoming available under normal conditions. Permissionless
 * triggering is a recovery mechanism, not a timeliness guarantee.
 */

export interface KeeperConfig {
  /** Poll cadence per asset (ms). */
  pollIntervalMs: number;
  /** Settlement SLA to alert on if missed (seconds). */
  settlementTargetSecs: number;
  /** Per-asset independence: a failure in one loop must not touch the other. */
  assetIds: number[];
}

export interface MonitorState {
  referenceFresh: Record<number, boolean>;
  pendingRequests: Record<number, number>;
  unsettledExpiries: Record<number, number>;
  reserveConsistent: Record<number, boolean>;
  txFailures: number;
  publisherActive: Record<number, boolean>;
  trialSpent: number;
  trialCap: number;
}

/** What the keeper checks every tick, per asset. */
export const MONITOR_TARGETS = [
  "reference freshness and availability",
  "pending exercise requests due for settlement",
  "unsettled expiries",
  "reserve consistency (vault == available + reserved + refund_obligations)",
  "transaction failures",
  "publisher activity",
  "trial spending vs cap",
] as const;

/**
 * Per-asset keeper loop (pseudocode-complete, side-effect free).
 * Replace the `TODO` seams with real RPC + reference reads.
 */
export async function runAssetKeeper(assetId: number, cfg: KeeperConfig): Promise<void> {
  // Independent loop per asset (PRD §21).
  for (;;) {
    try {
      // 1. Settle ready early-exercise requests whose window can be established.
      //    TODO: fetch Pending ExerciseRequests for `assetId`; for each, gather
      //    qualifying observations and call settle_exercise_{equity,prestocks};
      //    if the window elapsed with no reference, call fail_exercise.
      // 2. Process expiries: for open contracts past expiry with pending == 0,
      //    call settle_expiry_* or, on invalid reference, expire_refund.
      // 3. Reconcile reserves; alert if the vault invariant does not hold.
      // 4. Emit metrics; alert on missed settlementTargetSecs SLA.
    } catch (err) {
      // Isolate failures to this asset; never let it disable other assets.
      // TODO: structured log + retry with backoff (idempotent — safe to retry).
      void err;
    }
    await sleep(cfg.pollIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const DEFAULT_KEEPER_CONFIG: KeeperConfig = {
  pollIntervalMs: 15_000,
  settlementTargetSecs: 120,
  assetIds: [0, 1],
};
