import { contractReferenceLabel } from "../data/referencePolicy";
import AssetLogo from "./AssetLogo";
import ProtectionBoundary from "./ProtectionBoundary";
import { useEffect, useRef, useState } from "react";
import type { PositionTarget } from "../App";
import { useChain, explorerUrl } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import type { ContractAcct } from "../client/optketProgram";
import { fmtPrice, fmtDuration, fmtClock, fmtOusd } from "../format";
import { positionOutcome } from "../client/positionOutcome";
import HoldingsCard from "./HoldingsCard";
import { pendingTransaction } from "../onchain/transactionRecovery";
import RemindersPanel from "./RemindersPanel";
import { useNowSeconds } from "../useNowSeconds";
import VaultDepositList from "./VaultDepositList";
import { repeatPosition, type SimilarTerms } from "../client/repeatPosition";
import { preferredPositionKind, type PositionKind } from "../client/positionNavigation";

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
export default function PortfolioTab({ onRenew, onProtect, target }: { onRenew: (assetId: number, quantity: number, terms?: SimilarTerms) => void; onProtect: (assetId: number, quantity?: number) => void; target?: PositionTarget | null }) {
  const c = useChain();
  const vaultsEnabled = import.meta.env.VITE_VAULTS_ENABLED === "true";
  const [kindChoice, setKind] = useState<PositionKind | null>(() => {
    if (target || !vaultsEnabled) return "floors";
    const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
    if (params.has("deposit")) return "vaults";
    const choice = params.get("positions");
    return choice === "vaults" || choice === "floors" ? choice : null;
  });
  const depositTarget = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("deposit") : null;
  const deposits = c.vaultDeposits ?? [];
  const kind = kindChoice ?? preferredPositionKind(c.contracts, deposits);
  function chooseKind(next: "floors" | "vaults") {
    setKind(next); setView(null); setAssetId(-1);
    const url = new URL(window.location.href);
    url.searchParams.set("positions", next); url.searchParams.delete("deposit");
    window.history.replaceState(null, "", url);
  }
  const [assetId, setAssetId] = useState(() => target?.assetId ?? -1);
  const [viewChoice, setView] = useState<"active" | "history" | null>(null);
  const targetedPosition = c.contracts.find(k => k.address === target?.address);
  const targetedDeposit = deposits.find(d => d.round.address.toBase58() === depositTarget);
  const hasOpenFloors = c.contracts.some(k => k.status === "Active" || k.status === "PartiallySettled");
  const hasOpenDeposits = deposits.some(d => !d.deposit.redeemed);
  const view = viewChoice ?? (kind === "vaults"
    ? targetedDeposit ? targetedDeposit.deposit.redeemed ? "history" : "active" : hasOpenDeposits || !deposits.length ? "active" : "history"
    : targetedPosition ? targetedPosition.status === "Active" || targetedPosition.status === "PartiallySettled" ? "active" : "history" : hasOpenFloors || !c.contracts.length ? "active" : "history");
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
  const filteredDeposits = deposits.filter(d => assetId < 0 || d.round.assetId === assetId);
  const activeCount = kind === "floors" ? open.length : filteredDeposits.filter(d => !d.deposit.redeemed).length;
  const historyCount = kind === "floors" ? history.length : filteredDeposits.filter(d => d.deposit.redeemed).length;
  const visible = view === "active" ? open : history;
  const awaitingTarget = !!target?.address && !c.contracts.some(k => k.address === target.address);
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
        <div><h1>Your positions</h1></div>
        <div className="position-create-actions"><a className="btn ghost" href="/?side=buyer#protection">Set your floor</a>{vaultsEnabled && <a className="btn ghost" href="/?side=vault#protection">Fund a vault</a>}</div>
      </div>

      {vaultsEnabled && <div className="position-kind-switch" role="group" aria-label="Position type"><button aria-pressed={kind === "floors"} onClick={() => chooseKind("floors")}>Price floors <span>{c.contracts.length}</span></button><button aria-pressed={kind === "vaults"} onClick={() => chooseKind("vaults")}>Vault deposits <span>{deposits.length}</span></button></div>}

      <div className="position-toolbar">
        <div className="position-filters" role="group" aria-label="Position status"><button className="btn ghost" aria-pressed={view === "active"} onClick={() => setView("active")}>Active ({activeCount})</button><button className="btn ghost" aria-pressed={view === "history"} onClick={() => setView("history")}>History ({historyCount})</button></div>
        <details className="position-asset-filter" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary>{assetId < 0 ? "All assets" : asset.symbol}</summary><div className="position-assets" role="group" aria-label="Filter positions by asset" onClick={event => { const menu = event.currentTarget.closest("details"); if (menu) { menu.open = false; menu.querySelector("summary")?.focus(); } }}>
        <button className="btn ghost sm" aria-pressed={assetId < 0} onClick={() => setAssetId(-1)}>All assets</button>
        {VERIFIED_ASSETS.map((a, i) => (
          <button key={a.key} className="btn ghost sm" aria-pressed={i === assetId} onClick={() => setAssetId(i)}>
            {a.symbol}
          </button>
        ))}
        </div></details>
      </div>


      {kind === "vaults" ? <VaultDepositList deposits={filteredDeposits} view={view} target={assetId < 0 ? depositTarget : null} refreshing={c.refreshing} onRefresh={() => void c.refresh()} /> : <>
      <div className="position-list">
      {awaitingTarget || (c.refreshing && c.contracts.length === 0) ? (
        <div className="card empty" role="status" aria-busy={c.refreshing}><strong>{c.refreshing ? "Loading your position…" : "Position data hasn’t loaded yet."}</strong><p>Your transaction receipt remains available while we read the contract account.</p><button className="btn ghost" disabled={c.refreshing || c.busy} onClick={() => void c.refresh()}>{c.refreshing ? "Reading onchain data…" : "Refresh positions"}</button></div>
      ) : visible.length === 0 ? (
        <div className="card empty"><strong>{view === "active" ? `No active ${assetId < 0 ? "" : asset.symbol + " "}positions yet.` : `No completed ${assetId < 0 ? "" : asset.symbol + " "}positions yet.`}</strong><p>{view === "active" ? "Use Set your floor to open a position." : "Settled, expired and refunded positions appear here."}</p></div>
      ) : (
        [...visible].sort((a, b) => Number(b.address === target?.address) - Number(a.address === target?.address) || b.createdTs - a.createdTs).map((k) => <ContractCard key={k.address} contract={k} highlighted={k.address === target?.address} onSimilar={() => { const draft = repeatPosition(k); onRenew(draft.assetId, draft.quantity, { strike: k.strike, duration: draft.duration! }); }} />)
      )}
      </div>

      {c.contracts.length > 0 && <details className="secondary-tool position-context"><summary>Expiry reminders</summary><RemindersPanel onRenew={onRenew} /></details>}

      {hasCoverageData && <details className="secondary-tool position-context"><summary>Coverage and holdings comparison</summary><div className="card">
        <div className="card-title">Coverage tracker · {asset.symbol}</div>
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
          Informational only. The tracker never modifies contracts. Use the optional wallet inspector below to compare
          against real {asset.symbol} holdings.
        </div>
      </div></details>}

      <details className="secondary-tool position-context">
        <summary>Check your token holdings</summary>
        <HoldingsCard onProtect={onProtect} />
      </details>
      </>}
    </div>
  );
}

function ContractCard({ contract: k, highlighted = false, onSimilar }: { contract: ContractAcct; highlighted?: boolean; onSimilar: () => void }) {
  const c = useChain();
  const asset = VERIFIED_ASSETS[k.assetId];
  const [exQty, setExQty] = useState("");
  const [exerciseTx, setExerciseTx] = useState<string | null>(null);
  const [reviewQuantity, setReviewQuantity] = useState<number | null>(null);
  const now = useNowSeconds();
  const open = k.status === "Active" || k.status === "PartiallySettled";
  const beforeCutoff = now <= k.exerciseCutoffTs;
  const expired = now >= k.expiryTs;
  const amount = Number(exQty);
  const valid = /^\d+(?:\.\d{1,6})?$/.test(exQty) && amount > 0 && amount <= tok(k.remainingQuantity);
  const requests = c.requests.filter((request) => request.contract.toBase58() === k.address);
  const outcome = positionOutcome(k, requests, c.expiryReceipts[k.contractId.toString()]);

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
    <div className={"card position-card" + (highlighted ? " position-highlighted" : "")} id={`position-${k.address}`} tabIndex={-1}>
      {highlighted && <span className="position-selected-label">Your selected position</span>}
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
      </div>

      {open && <><div className="position-overview">
        <div><span>Protected quantity</span><strong className="mono">{qty(k.remainingQuantity)} {asset.symbol}</strong></div>
        <div><span>Price floor</span><strong className="mono">{fmtPrice(k.strike, Math.max(2, (k.strike % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").length))}</strong></div>
        <div><span>Expiry</span><strong>{fmtClock(k.expiryTs)}</strong></div>
      </div>
      <ProtectionBoundary floor={k.strike} compact />
      <p className="position-reference">{contractReferenceLabel(k.assetId, k.referenceVersion)}</p></>}
      <details className="position-details" open={!open}><summary>{open ? "Receipts so far" : "Position outcome"}</summary>
        <div className="receipt-metrics">
          <div><span>Premium paid</span><strong className="mono">{fmtOusd(tok(k.premiumPaid))}</strong></div>
          <div><span>Payout received</span><strong className="mono">{outcome ? fmtOusd(tok(outcome.payout)) : "Not loaded"}</strong></div>
          <div><span>Premium refunded</span><strong className="mono">{outcome ? fmtOusd(tok(outcome.refund)) : "Not loaded"}</strong></div>
          {outcome?.closed && <div><span>Net contract result</span><strong className="mono">{fmtOusd(tok(outcome.payout + outcome.refund - k.premiumPaid - k.feesPaid))}</strong></div>}
        </div>
        <p className="disclosure">{outcome ? "Contract result only. Excludes holdings and network fees." : "Complete settlement records are not loaded. Refresh to reconcile the outcome."}</p>
        {!outcome && <button className="btn ghost" disabled={c.refreshing || c.busy} onClick={() => void c.refresh()}>Refresh receipts</button>}
      </details>
      {open && beforeCutoff && k.remainingQuantity > 0n && <p className="position-next-step">Hold to expiry or request early exercise.</p>}
      {k.pendingQuantity > 0n && (
        <div className="callout" style={{ marginTop: 12 }}>
          {qty(k.pendingQuantity)} awaiting settlement. Payout is calculated automatically
          from the next qualifying reference.
        </div>
      )}

      {open && beforeCutoff && k.remainingQuantity > 0n && (!k.vaultRound || k.pendingQuantity === 0n) && (
        <details className="position-exercise">
          <summary>Request early exercise <span className="faint">{fmtDuration(k.exerciseCutoffTs - now)} left</span></summary>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <label className="field" style={{ flex: "0 1 180px" }}>
              <span className="lbl">Quantity to exercise</span>
              <input className="input mono" value={exQty} onChange={(e) => { setExQty(e.target.value); setReviewQuantity(null); }} inputMode="decimal" autoComplete="off" aria-invalid={exQty !== "" && !valid} aria-describedby={exQty !== "" && !valid ? `exercise-help-${k.address}` : undefined} placeholder="0.0" disabled={c.busy} />
            </label>
            <button className="btn ghost sm" disabled={c.busy} style={{ alignSelf: "flex-end" }} onClick={() => { setExQty(String(tok(k.remainingQuantity))); setReviewQuantity(null); }}>Max</button>
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
          {exQty !== "" && !valid && <p id={`exercise-help-${k.address}`} className="field-error">Enter up to {qty(k.remainingQuantity)} tokens, with at most six decimal places.</p>}
          {reviewQuantity === amount && valid && <div className="purchase-review" role="status"><strong>Exercise {amount} {asset.symbol}</strong><p>{qty(k.remainingQuantity - BigInt(Math.round(amount * 1e6)))} units remain protected. Payout uses the reference after your request, not the current price.</p><button className="btn ghost sm" disabled={c.busy} onClick={() => setReviewQuantity(null)}>Cancel review</button></div>}
          <div className="disclosure" style={{ marginTop: 8 }}>
            Exercise cannot be cancelled and forfeits remaining time value.
          </div>
          {exerciseTx && (
            <div className="callout" role="status" style={{ marginTop: 10 }}>
              Exercise request confirmed onchain · <a className="mono" href={explorerUrl("tx", exerciseTx)} target="_blank" rel="noreferrer">{exerciseTx.slice(0, 16)}… ↗</a>. Track settlement in the execution receipt.
            </div>
          )}
        </details>
      )}

      {open && !expired && (!beforeCutoff || k.remainingQuantity === 0n) && (
        <div className="auto-settle-note"><span className="pill blue">automatic at expiry</span><span>Any remaining quantity is settled by the keeper; you do not need to submit an expiry transaction.</span></div>
      )}

      {open && expired && k.pendingQuantity === 0n && (
        <div className="disclosure" style={{ marginTop: 12 }}>
          Past expiry. The keeper settles remaining quantity automatically, or applies the contractual
          failed-reference refund if no qualifying reference exists.
        </div>
      )}
      <details className="position-details"><summary>Contract terms & execution receipt</summary>
      <p className="disclosure">{contractReferenceLabel(k.assetId, k.referenceVersion)} · Early exercise cutoff: {fmtClock(k.exerciseCutoffTs)}</p>
      <div className="grid cols-3">
        <div><div className="stat-label">Remaining protected</div><div className="stat-value sm mono">{qty(k.remainingQuantity)}</div></div>
        <div><div className="stat-label">Pending exercise</div><div className="stat-value sm mono">{qty(k.pendingQuantity)}</div></div>
        <div><div className="stat-label">Premium paid</div><div className="stat-value sm mono">{tok(k.premiumPaid).toFixed(2)} oUSD</div></div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div><div className="stat-label">Reserved now</div><div className="stat-value sm mono">{tok(k.reservedCollateral).toFixed(2)} oUSD</div></div>
        <div><div className="stat-label">Original quantity</div><div className="stat-value sm mono">{qty(k.originalQuantity)}</div></div>
      </div>

      {k.vaultRound && <div className="kv"><span>Backing vault</span><a href={explorerUrl("address", k.vaultRound)} target="_blank" rel="noreferrer">Inspect round ↗</a></div>}
      <div className="contract-lifecycle" aria-label={`Contract ${k.contractId.toString()} lifecycle`}>
        <div className="lifecycle-row">
          <span className="lifecycle-dot complete" aria-hidden="true" />
          <div><strong>Position opened</strong><span>{tok(k.premiumPaid).toFixed(2)} oUSD premium · {fmtClock(k.createdTs)}</span></div>
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
      {(() => {
        if (k.vaultRound) return null;
        const receipt = c.expiryReceipts[k.contractId.toString()];
        if (!receipt) return k.status === "Expired" || k.status === "Refunded" ? <p className="disclosure">Expiry details are not loaded. The confirmed settlement transaction remains the source of record.</p> : null;
        return <div className="lifecycle-request">
          <div className="lifecycle-row"><div><strong>{receipt.invalidReference ? "Expiry premium refunded" : "Expiry settled"}</strong><span>{qty(receipt.quantity)} units · {fmtClock(receipt.timestamp)}</span></div></div>
          <div className="lifecycle-result">
            <div><span>Settlement reference</span><strong className="mono">{receipt.invalidReference ? "No qualifying reference" : fmtPrice(receipt.settlementReference)}</strong></div>
            <div><span>{receipt.invalidReference ? "Premium refunded" : "Payout"}</span><strong className="mono">{tok(receipt.invalidReference ? receipt.refundedPremium : receipt.payout).toFixed(2)} oUSD</strong></div>
          </div>
          <a href={explorerUrl("tx", receipt.signature)} target="_blank" rel="noreferrer">Verify expiry settlement ↗</a>
        </div>;
      })()}
      <p className="disclosure">Contract status: {k.status}.</p>
      <div className="lifecycle-transactions">{c.history.filter(entry => entry.contractId === k.contractId && !requests.some(request => c.requestTransactions[request.address]?.some(transaction => transaction.signature === entry.signature))).map(entry => <a key={entry.signature} href={explorerUrl("tx", entry.signature)} target="_blank" rel="noreferrer">{entry.err ? "Failed transaction" : entry.action} · <span className="mono">{entry.signature.slice(0, 10)}…</span> ↗</a>)}</div>
      <a href={explorerUrl("address", k.address)} target="_blank" rel="noreferrer">Verify contract account ↗</a>
      </details>
      <div className="position-repeat"><button className="btn ghost" disabled={c.busy} onClick={onSimilar}>Open a similar position</button></div>
    </div>
  );
}
