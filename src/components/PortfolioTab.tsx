import { useState } from "react";
import { useChain, explorerUrl } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import type { ContractAcct } from "../client/optketProgram";
import { fmtPrice, fmtDuration, fmtClock } from "../format";
import HoldingsCard from "./HoldingsCard";
import RemindersPanel from "./RemindersPanel";

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
export default function PortfolioTab({ onRenew }: { onRenew: (assetId: number, quantity: number) => void }) {
  const c = useChain();
  const [assetId, setAssetId] = useState(0);
  const asset = VERIFIED_ASSETS[assetId];

  if (!c.connected) {
    return <div className="card empty">Connect the demo wallet to see your on-chain positions.</div>;
  }

  const mine = c.contracts.filter((k) => k.assetId === assetId);
  const open = mine.filter((k) => k.status === "Active" || k.status === "PartiallySettled");
  const activeProtected = open.reduce((a, k) => a + k.remainingQuantity, 0n);
  const pending = mine.reduce((a, k) => a + k.pendingQuantity, 0n);
  const held = c.exposure[assetId] || 0;
  const protectedUnits = tok(activeProtected);
  const unprotected = Math.max(0, held - protectedUnits);
  const excess = Math.max(0, protectedUnits - held);

  return (
    <>
      <RemindersPanel onRenew={onRenew} />
      <HoldingsCard />

      <div className="row" style={{ marginBottom: 16 }}>
        {VERIFIED_ASSETS.map((a, i) => (
          <button key={a.key} className={"btn sm " + (i === assetId ? "primary" : "ghost")} onClick={() => setAssetId(i)}>
            {a.symbol}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-title">Coverage tracker — {asset.symbol}</div>
        <div className="grid cols-3">
          <div><div className="stat-label">Holdings (read-only)</div><div className="stat-value sm mono">{held ? held.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}</div></div>
          <div><div className="stat-label">Active protected</div><div className="stat-value sm mono pos">{qty(activeProtected)}</div></div>
          <div><div className="stat-label">Pending exercise</div><div className="stat-value sm mono">{qty(pending)}</div></div>
        </div>
        <div className="hr" />
        <div className="grid cols-2">
          <div><div className="stat-label">Unprotected holdings</div><div className={"stat-value sm mono " + (unprotected > 0 ? "neg" : "")}>{held ? unprotected.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}</div></div>
          <div><div className="stat-label">Protection beyond holdings</div><div className={"stat-value sm mono " + (excess > 0 ? "neg" : "")}>{excess.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div></div>
        </div>
        <div className="disclosure" style={{ marginTop: 10 }}>
          Informational only — the tracker never modifies contracts. Look up a wallet above to compare
          against real {asset.symbol} holdings.
        </div>
      </div>

      <div style={{ height: 14 }} />
      {mine.length === 0 ? (
        <div className="card empty">No {asset.symbol} contracts yet. Buy protection in the Protect tab.</div>
      ) : (
        mine.map((k) => <ContractCard key={k.address} contract={k} />)
      )}
    </>
  );
}

function ContractCard({ contract: k }: { contract: ContractAcct }) {
  const c = useChain();
  const asset = VERIFIED_ASSETS[k.assetId];
  const [exQty, setExQty] = useState("");
  const now = Math.floor(Date.now() / 1000);
  const open = k.status === "Active" || k.status === "PartiallySettled";
  const beforeCutoff = now <= k.exerciseCutoffTs;
  const expired = now >= k.expiryTs;
  const amount = parseFloat(exQty);
  const valid = amount > 0 && amount <= tok(k.remainingQuantity);

  return (
    <div className="card">
      <div className="between">
        <div className="row">
          <div className={"asset-icon " + (asset.kind === "EquityToken" ? "eq" : "pre")}>{asset.symbol.slice(0, 3)}</div>
          <div>
            <div className="row" style={{ gap: 8 }}>
              <strong>#{k.contractId.toString()} · {asset.symbol}</strong>
              <span className={"pill " + (STATUS_TONE[k.status] || "gray")}>{k.status}</span>
              {open && expired && <span className="pill amber">awaiting settlement</span>}
            </div>
            <div className="faint" style={{ fontSize: 12 }}>
              strike {fmtPrice(k.strike)} · expiry {fmtClock(k.expiryTs)} ·{" "}
              {expired ? "expired" : fmtDuration(k.expiryTs - now) + " left"}
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
              onClick={() => c.requestExercise(k.address, k.assetId, k.nextRequestNonce, amount).catch(() => {})}
            >
              Request exercise
            </button>
          </div>
          <div className="disclosure" style={{ marginTop: 8 }}>
            Irrevocable once submitted. Settles at intrinsic value against the next qualifying
            reference; remaining time value is forfeited and unrequested quantity stays protected.
          </div>
        </>
      )}

      {open && expired && k.pendingQuantity === 0n && (
        <div className="disclosure" style={{ marginTop: 12 }}>
          Past expiry — the keeper settles remaining quantity automatically, or applies the disclosed
          demo refund if no qualifying reference exists.
        </div>
      )}
    </div>
  );
}
