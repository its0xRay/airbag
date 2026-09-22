import { contractReferenceLabel } from "../data/referencePolicy";
import AssetLogo from "./AssetLogo";
import { useEffect, useRef, useState } from "react";
import type { PositionTarget } from "../App";
import { useChain, explorerUrl } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import type { ContractAcct } from "../client/optketProgram";
import { fmtPrice, fmtDuration, fmtClock } from "../format";
import HoldingsCard from "./HoldingsCard";
import { pendingTransaction } from "../onchain/transactionRecovery";
import RemindersPanel from "./RemindersPanel";
import { useNowSeconds } from "../useNowSeconds";

const tok = (v: bigint) => Number(v) / 1e6;
const qty = (v: bigint) => tok(v).toLocaleString(undefined, { maximumFractionDigits: 4 });

const STATUS_TONE: Record<string, string> = {
  Active: "green", PartiallySettled: "blue", Exercised: "gray",
  Expired: "gray", Refunded: "amber", Cancelled: "gray",
};

/**
 * Positions read straight from the program (PRD §13.5) plus the coverage
 * tracker (§16). Every action here is a real transaction.
 */
export default function PortfolioTab({ onRenew, onProtect, target }: { onRenew: (assetId: number, quantity: number) => void; onProtect: (assetId: number, quantity?: number) => void; target?: PositionTarget | null }) {
  const c = useChain();
  const [assetId, setAssetId] = useState(() => target?.assetId ?? -1);
  const [view, setView] = useState<"active" | "history">(() => {
    const position = c.contracts.find(k => k.address === target?.address);
    return position && position.status !== "Active" && position.status !== "PartiallySettled" ? "history" : "active";
  });
  const focused = useRef(false);
  useEffect(() => {
    if (!target?.address || focused.current) return;
    const card = document.getElementById(`position-${target.address}`);
    if (card) { card.scrollIntoView({ block: "start", behavior: "instant" }); card.focus({ preventScroll: true }); focused.current = true; }
  }, [target, c.contracts, view]);
  const asset = VERIFIED_ASSETS[assetId < 0 ? 1 : assetId];

  if (!c.connected) {
    return <div className="card empty">Connect the demo wallet to see your onchain positions.</div>;
  }

  const mine = c.contracts.filter((k) => assetId < 0 || k.assetId === assetId);
  const open = mine.filter((k) => k.status === "Active" || k.status === "PartiallySettled");
  const history = mine.filter(k => k.status !== "Active" && k.status !== "PartiallySettled");
  const visible = view === "active" ? open : history;
  const activeProtected = open.reduce((a, k) => a + k.remainingQuantity, 0n);
  const pending = mine.reduce((a, k) => a + k.pendingQuantity, 0n);
  const held = c.exposure[assetId] || 0;
  const protectedUnits = tok(activeProtected);
  const unprotected = Math.max(0, held - protectedUnits);
  const excess = Math.max(0, protectedUnits - held);
  const hasCoverageData = assetId >= 0 && (protectedUnits > 0 || held > 0 || pending > 0n);
  const trackerScale = Math.max(held, protectedUnits, 1);

  return (
    <div className="positions-page">
      <div className="app-page-head">
        <div><h1>Your positions</h1><p>Your active protection and completed contracts.</p></div>
        {visible.length > 0 && <button className="btn primary" onClick={() => onProtect(assetId < 0 ? 1 : assetId)}>New protection</button>}
      </div>

      <div className="position-toolbar">
        <div className="position-filters" role="group" aria-label="Position status"><button className="btn ghost" aria-pressed={view === "active"} onClick={() => setView("active")}>Active ({open.length})</button><button className="btn ghost" aria-pressed={view === "history"} onClick={() => setView("history")}>History ({history.length})</button></div>
        <div className="position-assets" role="group" aria-label="Filter positions by asset">
        <button className="btn ghost sm" aria-pressed={assetId < 0} onClick={() => setAssetId(-1)}>All assets</button>
        {VERIFIED_ASSETS.map((a, i) => (
          <button key={a.key} className="btn ghost sm" aria-pressed={i === assetId} onClick={() => setAssetId(i)}>
            {a.symbol}
          </button>
        ))}
        </div>
      </div>


      <div className="position-list">
      {visible.length === 0 ? (
        <div className="card empty"><strong>{view === "active" ? `No active ${assetId < 0 ? "" : asset.symbol + " "}protection.` : `No completed ${assetId < 0 ? "" : asset.symbol + " "}positions yet.`}</strong><br />{view === "active" ? "Choose a floor to start a new position." : "Settled, expired and refunded positions appear here."}{view === "active" && <div><button className="btn primary sm" style={{ marginTop: 14 }} onClick={() => onProtect(assetId < 0 ? 1 : assetId)}>Set up protection</button></div>}</div>
      ) : (
        visible.map((k) => <ContractCard key={k.address} contract={k} />)
      )}
      </div>

      {c.contracts.length > 0 && <details className="secondary-tool position-context"><summary>Renewals and reminders</summary><RemindersPanel onRenew={onRenew} /></details>}

      {hasCoverageData && <details className="secondary-tool position-context"><summary>Coverage and holdings comparison</summary><div className="card">
        <div className="card-title">Coverage tracker — {asset.symbol}</div>
        <div className="grid cols-3">
          <div><div className="stat-label">Holdings (read-only)</div><div className="stat-value sm mono">{held ? held.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}</div></div>
          <div><div className="stat-label">Active protected</div><div className="stat-value sm mono pos">{qty(activeProtected)}</div></div>
          <div><div className="stat-label">Pending exercise</div><div className="stat-value sm mono">{qty(pending)}</div></div>
        </div>
        <div className="hr" />
        <div className="coverage-track" aria-label={`${protectedUnits} protected units, ${unprotected} unprotected units, ${excess} protected beyond holdings`}>
          {held > 0 && <span className="coverage-unprotected" style={{ width: `${Math.min(100, (unprotected / trackerScale) * 100)}%` }} />}
          {held > 0 && protectedUnits > 0 && <span className="coverage-protected" style={{ width: `${Math.min(100, (Math.min(protectedUnits, held) / trackerScale) * 100)}%` }} />}
          {excess > 0 && <span className="coverage-excess" style={{ width: `${Math.min(100, (excess / trackerScale) * 100)}%` }} />}
        </div>
        <div className="coverage-legend"><span className="protected">Protected</span><span className="unprotected">Unprotected</span>{excess > 0 && <span className="excess">Protected more than held</span>}</div>
        <div className="hr" />
        <div className="grid cols-2">
          <div><div className="stat-label">Unprotected holdings</div><div className={"stat-value sm mono " + (unprotected > 0 ? "neg" : "")}>{held ? unprotected.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}</div></div>
          <div><div className="stat-label">Protected more than held</div><div className={"stat-value sm mono " + (excess > 0 ? "neg" : "")}>{excess.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div></div>
        </div>
        <div className="disclosure" style={{ marginTop: 10 }}>
          Informational only — the tracker never modifies contracts. Use the optional wallet inspector below to compare
          against real {asset.symbol} holdings.
        </div>
      </div></details>}

      <details className="secondary-tool position-context">
        <summary>Inspect mainnet token holdings</summary>
        <p>This optional read-only tool can inspect any Solana address. It is separate from the connected Devnet wallet and does not modify a position.</p>
        <HoldingsCard onProtect={onProtect} />
      </details>
    </div>
  );
}

function ContractCard({ contract: k }: { contract: ContractAcct }) {
  const c = useChain();
  const asset = VERIFIED_ASSETS[k.assetId];
  const [exQty, setExQty] = useState("");
  const [exerciseTx, setExerciseTx] = useState<string | null>(null);
  const [reviewQuantity, setReviewQuantity] = useState<number | null>(null);
  const now = useNowSeconds();
  const open = k.status === "Active" || k.status === "PartiallySettled";
  const beforeCutoff = now <= k.exerciseCutoffTs;
  const expired = now >= k.expiryTs;
  const amount = parseFloat(exQty);
  const valid = amount > 0 && amount <= tok(k.remainingQuantity);
  const requests = c.requests.filter((request) => request.contract.toBase58() === k.address);

  async function requestExercise() {
    if (!valid || reviewQuantity !== amount || !beforeCutoff || !open) return;
    setExerciseTx(null);
    try {
      await c.requestExercise(k.address, k.assetId, k.nextRequestNonce, amount);
      setExerciseTx(useChain.getState().lastTx);
      setExQty("");
    } catch { /* the shared error callout retains the entered quantity */ }
    finally { setReviewQuantity(null); }
  }

  return (
    <div className="card position-card" id={`position-${k.address}`} tabIndex={-1}>
      <div className="between">
        <div className="row">
          <AssetLogo asset={asset} />
          <div>
            <div className="row" style={{ gap: 8 }}>
              <strong>#{k.contractId.toString()} · {asset.symbol}</strong>
              <span className={"pill " + (STATUS_TONE[k.status] || "gray")}>{k.status === "PartiallySettled" ? "Partially settled" : k.status}</span>
              {open && expired && <span className="pill amber">awaiting settlement</span>}
            </div>
          </div>
        </div>
        <a className="pill blue" href={explorerUrl("address", k.address)} target="_blank" rel="noreferrer">account ↗</a>
      </div>

      <div className="position-overview">
        <div><span>Protected quantity</span><strong className="mono">{qty(k.remainingQuantity)} {asset.symbol}</strong></div>
        <div><span>Price floor</span><strong className="mono">{fmtPrice(k.strike)}</strong></div>
        <div><span>Expiry</span><strong>{fmtClock(k.expiryTs)}</strong></div>
      </div>
      {k.pendingQuantity > 0n && (
        <div className="callout" style={{ marginTop: 12 }}>
          {qty(k.pendingQuantity)} pending — the keeper settles it against the next qualifying
          reference and pays intrinsic value automatically.
        </div>
      )}

      {open && beforeCutoff && k.remainingQuantity > 0n && (
        <details className="position-exercise">
          <summary>Exercise protection <span className="faint">{fmtDuration(k.exerciseCutoffTs - now)} left</span></summary>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <label className="field" style={{ flex: "0 1 180px" }}>
              <span className="lbl">Quantity to exercise</span>
              <input className="input" value={exQty} onChange={(e) => { setExQty(e.target.value); setReviewQuantity(null); }} inputMode="decimal" placeholder="0.0" disabled={c.busy} />
            </label>
            <button className="btn ghost sm" style={{ alignSelf: "flex-end" }} onClick={() => setExQty(String(tok(k.remainingQuantity)))}>Max</button>
            <button
              className="btn"
              style={{ alignSelf: "flex-end" }}
              disabled={!valid || c.busy || pendingTransaction(c.transaction, c.conn.rpcEndpoint, c.address)}
              aria-busy={c.busy}
              onClick={() => reviewQuantity === amount ? requestExercise() : setReviewQuantity(amount)}
            >
              {c.busy ? "Submitting…" : reviewQuantity === amount ? "Confirm exercise" : "Review exercise"}
            </button>
          </div>
          {reviewQuantity === amount && valid && <div className="purchase-review" role="status"><strong>Exercise {amount} {asset.symbol}</strong><p>{qty(k.remainingQuantity - BigInt(Math.round(amount * 1e6)))} units remain protected. The requested quantity settles against a future qualifying reference, not the currently displayed price. The payout is not fixed now.</p><p>This request cannot be cancelled after submission. Remaining time value on the exercised quantity is forfeited.</p><button className="btn ghost sm" disabled={c.busy} onClick={() => setReviewQuantity(null)}>Cancel review</button></div>}
          <div className="disclosure" style={{ marginTop: 8 }}>
            Irrevocable once submitted. Settles at intrinsic value against the next qualifying
            reference; remaining time value is forfeited and unrequested quantity stays protected.
          </div>
          {exerciseTx && (
            <div className="callout" role="status" style={{ marginTop: 10 }}>
              Exercise request confirmed onchain · <a className="mono" href={explorerUrl("tx", exerciseTx)} target="_blank" rel="noreferrer">{exerciseTx.slice(0, 16)}… ↗</a>. Track settlement in the execution receipt.
            </div>
          )}
        </details>
      )}

      {open && !expired && (
        <div className="auto-settle-note"><span className="pill blue">automatic at expiry</span><span>Any remaining quantity is settled by the keeper; you do not need to submit an expiry transaction.</span></div>
      )}

      {open && expired && k.pendingQuantity === 0n && (
        <div className="disclosure" style={{ marginTop: 12 }}>
          Past expiry — the keeper settles remaining quantity automatically, or applies the contractual
          failed-reference refund if no qualifying reference exists.
        </div>
      )}
      <details className="position-details"><summary>Contract details and activity</summary>
      <p className="disclosure">{contractReferenceLabel(k.assetId, k.referenceVersion)} · Early exercise cutoff: {fmtClock(k.exerciseCutoffTs)}</p>
      <div className="grid cols-3">
        <div><div className="stat-label">Remaining protected</div><div className="stat-value sm mono">{qty(k.remainingQuantity)}</div></div>
        <div><div className="stat-label">Pending exercise</div><div className="stat-value sm mono">{qty(k.pendingQuantity)}</div></div>
        <div><div className="stat-label">Premium paid</div><div className="stat-value sm mono">{tok(k.premiumPaid).toFixed(2)} oUSD</div></div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div><div className="stat-label">Reserved collateral</div><div className="stat-value sm mono">{tok(k.reservedCollateral).toFixed(2)} oUSD</div></div>
        <div><div className="stat-label">Original quantity</div><div className="stat-value sm mono">{qty(k.originalQuantity)}</div></div>
      </div>

      </details>
      <details className="position-details"><summary>Execution receipt</summary>
      <p className="disclosure">Recorded on Devnet · oUSD has no real value.</p>
      <div className="contract-lifecycle" aria-label={`Contract ${k.contractId.toString()} lifecycle`}>
        <div className="lifecycle-row">
          <span className="lifecycle-dot complete" aria-hidden="true" />
          <div><strong>Protection purchased</strong><span>{tok(k.premiumPaid).toFixed(2)} oUSD premium · {fmtClock(k.createdTs)}</span></div>
        </div>
        {requests.map((request) => {
          const transactions = c.requestTransactions[request.address] ?? [];
          return (
            <div className="lifecycle-request" key={request.address}>
              <div className="lifecycle-row">
                <span className={"lifecycle-dot " + (request.status === "Pending" ? "pending" : "complete")} aria-hidden="true" />
                <div>
                  <strong>{request.status === "Pending" ? "Exercise awaiting reference" : request.status === "Settled" ? "Exercise settled" : "Reference window failed"}</strong>
                  <span>{qty(request.quantity)} requested · {fmtClock(request.requestTs)}</span>
                </div>
                <a className="pill blue" href={explorerUrl("address", request.address)} target="_blank" rel="noreferrer">request account ↗</a>
              </div>
              {request.status === "Settled" && (
                <div className="lifecycle-result">
                  <div><span>Settlement reference</span><strong className="mono">{fmtPrice(request.settlementReference)}</strong></div>
                  <div><span>Payout</span><strong className="mono pos">{tok(request.payout).toFixed(2)} oUSD</strong></div>
                </div>
              )}
              {request.status === "Failed" && <div className="disclosure">No qualifying reference arrived in the contractual window. The requested quantity returned to active coverage.</div>}
              {transactions.length > 0 && (
                <div className="lifecycle-transactions">
                  {transactions.map((transaction) => (
                    <a key={transaction.signature} href={explorerUrl("tx", transaction.signature)} target="_blank" rel="noreferrer">
                      {transaction.action} · <span className="mono">{transaction.signature.slice(0, 10)}…</span> ↗
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="disclosure">Contract status: {k.status}. Exercise payouts are recorded request outcomes, not projected returns. For expiry transfers, inspect the settlement transaction.</p>
      <div className="lifecycle-transactions">{c.history.filter(entry => entry.contractId === k.contractId && !requests.some(request => c.requestTransactions[request.address]?.some(transaction => transaction.signature === entry.signature))).map(entry => <a key={entry.signature} href={explorerUrl("tx", entry.signature)} target="_blank" rel="noreferrer">{entry.err ? "Failed transaction" : entry.action} · <span className="mono">{entry.signature.slice(0, 10)}…</span> ↗</a>)}</div>
      <a href={explorerUrl("address", k.address)} target="_blank" rel="noreferrer">Verify contract account ↗</a>
      </details>
    </div>
  );
}
