import { contractReferenceLabel } from "../data/referencePolicy";
import AssetLogo from "./AssetLogo";
import { useEffect, useRef, useState } from "react";
import type { PositionTarget } from "../App";
import { useChain, explorerUrl } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import type { ContractAcct } from "../client/optketProgram";
import { fmtPrice, fmtDuration, fmtClock } from "../format";
import HoldingsCard from "./HoldingsCard";
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
export default function PortfolioTab({ onRenew, onProtect, target }: { onRenew: (assetId: number, quantity: number) => void; onProtect: (assetId: number) => void; target?: PositionTarget | null }) {
  const c = useChain();
  const [assetId, setAssetId] = useState(() => target?.assetId ?? c.contracts.find(k => k.status === "Active" || k.status === "PartiallySettled")?.assetId ?? c.contracts[0]?.assetId ?? 1);
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
  const asset = VERIFIED_ASSETS[assetId];

  if (!c.connected) {
    return <div className="card empty">Connect the demo wallet to see your onchain positions.</div>;
  }

  const mine = c.contracts.filter((k) => k.assetId === assetId);
  const open = mine.filter((k) => k.status === "Active" || k.status === "PartiallySettled");
  const history = mine.filter(k => k.status !== "Active" && k.status !== "PartiallySettled");
  const visible = view === "active" ? open : history;
  const activeProtected = open.reduce((a, k) => a + k.remainingQuantity, 0n);
  const pending = mine.reduce((a, k) => a + k.pendingQuantity, 0n);
  const held = c.exposure[assetId] || 0;
  const protectedUnits = tok(activeProtected);
  const unprotected = Math.max(0, held - protectedUnits);
  const excess = Math.max(0, protectedUnits - held);
  const hasCoverageData = protectedUnits > 0 || held > 0 || pending > 0n;
  const trackerScale = Math.max(held, protectedUnits, 1);

  return (
    <>
      <div className="app-page-head">
        <div><h1>Positions</h1><p>Manage your protection, exercise coverage, or protect more.</p></div>
        <button className="btn primary" onClick={() => onProtect(assetId)}>Protect another asset</button>
        <span className="pill gray mono" title={c.address ?? undefined}>{c.address ? `${c.address.slice(0, 5)}…${c.address.slice(-4)}` : "Connected"}</span>
      </div>
      <RemindersPanel onRenew={onRenew} />

      <div className="row" style={{ marginBottom: 16 }}>
        {VERIFIED_ASSETS.map((a, i) => (
          <button key={a.key} className={"btn sm " + (i === assetId ? "primary" : "ghost")} onClick={() => setAssetId(i)}>
            {a.symbol}
          </button>
        ))}
      </div>

      {hasCoverageData && <div className="card">
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
      </div>}

      <div style={{ height: 14 }} />
      <div className="position-filters" role="group" aria-label="Position status"><button className="btn ghost" aria-pressed={view === "active"} onClick={() => setView("active")}>Active ({open.length})</button><button className="btn ghost" aria-pressed={view === "history"} onClick={() => setView("history")}>History ({history.length})</button></div>
      {visible.length === 0 ? (
        <div className="card empty"><strong>{view === "active" ? `No active ${asset.symbol} protection.` : `No completed ${asset.symbol} positions yet.`}</strong><br />{view === "active" ? "Choose a floor to start a new position." : "Settled, expired and refunded positions appear here."}{view === "active" && <div><button className="btn primary sm" style={{ marginTop: 14 }} onClick={() => onProtect(assetId)}>Protect {asset.symbol}</button></div>}</div>
      ) : (
        visible.map((k) => <ContractCard key={k.address} contract={k} />)
      )}

      <details className="secondary-tool">
        <summary>Inspect mainnet token holdings</summary>
        <p>This optional read-only tool can inspect any Solana address. It is separate from the connected Devnet wallet and does not modify a position.</p>
        <HoldingsCard />
      </details>
    </>
  );
}

function ContractCard({ contract: k }: { contract: ContractAcct }) {
  const c = useChain();
  const asset = VERIFIED_ASSETS[k.assetId];
  const [exQty, setExQty] = useState("");
  const [exerciseTx, setExerciseTx] = useState<string | null>(null);
  const now = useNowSeconds();
  const open = k.status === "Active" || k.status === "PartiallySettled";
  const beforeCutoff = now <= k.exerciseCutoffTs;
  const expired = now >= k.expiryTs;
  const amount = parseFloat(exQty);
  const valid = amount > 0 && amount <= tok(k.remainingQuantity);
  const requests = c.requests.filter((request) => request.contract.toBase58() === k.address);

  async function requestExercise() {
    setExerciseTx(null);
    try {
      await c.requestExercise(k.address, k.assetId, k.nextRequestNonce, amount);
      setExerciseTx(useChain.getState().lastTx);
      setExQty("");
    } catch { /* the shared error callout retains the entered quantity */ }
  }

  return (
    <div className="card position-card" id={`position-${k.address}`} tabIndex={-1}>
      <div className="between">
        <div className="row">
          <AssetLogo asset={asset} />
          <div>
            <div className="row" style={{ gap: 8 }}>
              <strong>#{k.contractId.toString()} · {asset.symbol}</strong>
              <span className={"pill " + (STATUS_TONE[k.status] || "gray")}>{k.status}</span>
              {open && expired && <span className="pill amber">awaiting settlement</span>}
            </div>
            <div className="faint" style={{ fontSize: 12 }}>
              {contractReferenceLabel(k.assetId, k.referenceVersion)} · floor {fmtPrice(k.strike)} · exercise cutoff {beforeCutoff ? `${fmtDuration(k.exerciseCutoffTs - now)} left` : "passed"} · expiry {fmtClock(k.expiryTs)}
            </div>
          </div>
        </div>
        <a className="pill blue" href={explorerUrl("address", k.address)} target="_blank" rel="noreferrer">account ↗</a>
      </div>

      <div className="hr" />
      <div className="grid cols-3">
        <div><div className="stat-label">Remaining protected</div><div className="stat-value sm mono">{qty(k.remainingQuantity)}</div></div>
        <div><div className="stat-label">Pending exercise</div><div className="stat-value sm mono">{qty(k.pendingQuantity)}</div></div>
        <div><div className="stat-label">Premium paid</div><div className="stat-value sm mono">{tok(k.premiumPaid).toFixed(2)} oUSD</div></div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div><div className="stat-label">Reserved collateral</div><div className="stat-value sm mono">{tok(k.reservedCollateral).toFixed(2)} oUSD</div></div>
        <div><div className="stat-label">Original quantity</div><div className="stat-value sm mono">{qty(k.originalQuantity)}</div></div>
      </div>

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

      {k.pendingQuantity > 0n && (
        <div className="callout" style={{ marginTop: 12 }}>
          {qty(k.pendingQuantity)} pending — the keeper settles it against the next qualifying
          reference and pays intrinsic value automatically.
        </div>
      )}

      {open && beforeCutoff && k.remainingQuantity > 0n && (
        <>
          <div className="hr" />
          <div className="row" style={{ flexWrap: "wrap" }}>
            <label className="field" style={{ flex: "0 1 180px" }}>
              <span className="lbl">Quantity to exercise</span>
              <input className="input" value={exQty} onChange={(e) => setExQty(e.target.value)} inputMode="decimal" placeholder="0.0" />
            </label>
            <button className="btn ghost sm" style={{ alignSelf: "flex-end" }} onClick={() => setExQty(String(tok(k.remainingQuantity)))}>Max</button>
            <button
              className="btn"
              style={{ alignSelf: "flex-end" }}
              disabled={!valid || c.busy}
              onClick={requestExercise}
            >
              Request exercise
            </button>
          </div>
          <div className="disclosure" style={{ marginTop: 8 }}>
            Irrevocable once submitted. Settles at intrinsic value against the next qualifying
            reference; remaining time value is forfeited and unrequested quantity stays protected.
          </div>
          {exerciseTx && (
            <div className="callout" role="status" style={{ marginTop: 10 }}>
              Exercise request confirmed onchain · <a className="mono" href={explorerUrl("tx", exerciseTx)} target="_blank" rel="noreferrer">{exerciseTx.slice(0, 16)}… ↗</a>. Waiting for the next qualifying reference.
            </div>
          )}
        </>
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
    </div>
  );
}
