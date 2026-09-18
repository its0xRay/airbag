import { useEffect, useState } from "react";
import { useChain, seriesKey, explorerUrl } from "../onchain/store";
import { ASSETS, fromFixed } from "../engine";
import { fmtPrice, fmtQty, fmtUsd } from "../format";

const NETWORK = /devnet/.test(import.meta.env.VITE_RPC_URL || "") ? "devnet" : "localnet";

const tok = (v: bigint | number) => (typeof v === "bigint" ? Number(v) / 1e6 : v);

export default function OnchainTab() {
  const c = useChain();
  const [assetId, setAssetId] = useState(0);
  const [seriesId, setSeriesId] = useState(0);
  const [qty, setQty] = useState("5");

  useEffect(() => {
    if (c.connected) {
      const t = setInterval(() => c.refresh().catch(() => {}), 8000);
      return () => clearInterval(t);
    }
  }, [c.connected]);

  const asset = ASSETS[assetId];
  const s0 = c.series[seriesKey(assetId, 0)];
  const s1 = c.series[seriesKey(assetId, 1)];
  const list = [s0, s1];

  if (!c.connected) {
    return (
      <div className="card">
        <div className="between">
          <div className="card-title" style={{ margin: 0 }}>On-chain mode — {NETWORK}</div>
          <a className="pill blue" href={explorerUrl("address", "Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky")} target="_blank" rel="noreferrer">program ↗</a>
        </div>
        <div className="disclosure" style={{ margin: "12px 0 14px" }}>
          This talks to the <strong>deployed Optket program</strong> on {NETWORK}. Connecting creates a throwaway burner wallet in your browser and funds it with SOL (from the capped §19 trial budget) and demo oUSD. Premiums are signed by the quote service and verified on-chain (ed25519); purchases, exercises and settlements are real transactions.
        </div>
        <button className="btn primary" disabled={c.busy} onClick={() => c.connect()}>
          {c.busy ? c.status || "Connecting…" : "Connect burner wallet"}
        </button>
        {c.error && <div className="callout warn" style={{ marginTop: 14 }}>{c.error}</div>}
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="between">
          <div>
            <div className="card-title" style={{ margin: 0 }}>Burner wallet ({NETWORK})</div>
            <div className="mono faint" style={{ fontSize: 12, marginTop: 4 }}>
              <a href={explorerUrl("address", c.address || "")} target="_blank" rel="noreferrer">{c.address} ↗</a>
            </div>
          </div>
          <div className="row">
            <span className="pill blue mono">{c.solBalance.toFixed(3)} SOL</span>
            <span className="pill green mono">{c.tokenBalance.toLocaleString()} oUSD</span>
            <button className="btn ghost sm" disabled={c.busy} onClick={() => c.refresh()}>Refresh</button>
          </div>
        </div>
        {c.trial && (
          <>
            <div className="hr" />
            <div className="between">
              <div className="faint" style={{ fontSize: 12 }}>
                Trial budget (§19) — SOL for fees granted from a capped fund, separate from collateral
              </div>
              <div className="row">
                <span className={"pill " + (c.trial.active ? "green" : "red")}>{c.trial.active ? "active" : "closed (cap reached)"}</span>
                <span className="pill gray mono">{c.trial.remainingSol.toFixed(2)} / {c.trial.capSol} SOL left</span>
                <span className="pill gray mono">{c.trial.grants} grants</span>
              </div>
            </div>
          </>
        )}
      </div>

      {c.status && <div className="callout" style={{ marginTop: 12 }}>{c.status}</div>}
      {c.error && <div className="callout warn" style={{ marginTop: 12 }}>{c.error}</div>}
      {c.lastTx && (
        <div className="callout" style={{ marginTop: 12 }}>
          ✓ Confirmed on {NETWORK}: <a href={explorerUrl("tx", c.lastTx)} target="_blank" rel="noreferrer" className="mono">{c.lastTx.slice(0, 20)}… ↗</a>
        </div>
      )}

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="card-title">Buy protection (on-chain)</div>
          <div className="row" style={{ marginBottom: 12 }}>
            {ASSETS.map((a) => (
              <button key={a.assetId} className={"btn sm " + (a.assetId === assetId ? "primary" : "ghost")} onClick={() => { setAssetId(a.assetId); setSeriesId(0); }}>{a.symbol}</button>
            ))}
          </div>
          <div className="grid cols-2">
            {list.map((s, i) => (
              <div key={i} className={"strike-option" + (seriesId === i ? " active" : "")} onClick={() => setSeriesId(i)}>
                <div className="between"><strong className="mono">{s ? fmtPrice(s.strike) : "—"}</strong><span className="pill gray">strike {i + 1}</span></div>
                <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>max {s ? fmtQty(s.maxContractSize, 0) : "—"}</div>
              </div>
            ))}
          </div>
          <label className="field" style={{ marginTop: 12 }}>
            <span className="lbl">Quantity ({asset.symbol})</span>
            <input className="input" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <button
            className="btn primary"
            style={{ marginTop: 12 }}
            disabled={c.busy || !(parseFloat(qty) > 0)}
            onClick={() => c.buy(assetId, seriesId, parseFloat(qty)).catch(() => {})}
          >
            {c.busy ? "Working…" : "Get quote & buy on-chain"}
          </button>
          <div className="disclosure" style={{ marginTop: 10 }}>
            Premium is priced and signed by the quote service, then verified by the program (ed25519). This sends a real transaction on localnet.
          </div>
        </div>

        <div className="card">
          <div className="card-title">Live pool — {asset.symbol}</div>
          {c.pools[assetId] ? (
            <>
              <div className="kv"><span className="k">Available capital</span><span className="v mono">{fmtUsd(tok(c.pools[assetId]!.availableCapital), 0)}</span></div>
              <div className="kv"><span className="k">Reserved</span><span className="v mono">{fmtUsd(tok(c.pools[assetId]!.reserved), 0)}</span></div>
              <div className="kv"><span className="k">Pending exercise</span><span className="v mono">{fmtUsd(tok(c.pools[assetId]!.pendingExercise), 0)}</span></div>
              <div className="kv"><span className="k">Premium receipts</span><span className="v mono">{fmtUsd(tok(c.pools[assetId]!.premiumReceipts))}</span></div>
              <div className="kv"><span className="k">Total payouts</span><span className="v mono">{fmtUsd(tok(c.pools[assetId]!.totalPayouts))}</span></div>
              <div className="kv"><span className="k">Total refunds</span><span className="v mono">{fmtUsd(tok(c.pools[assetId]!.totalRefunds))}</span></div>
            </>
          ) : <div className="empty">Pool not initialized for this asset.</div>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title">Your on-chain contracts ({c.contracts.length})</div>
        {c.contracts.length === 0 ? (
          <div className="empty">No contracts yet — buy protection above.</div>
        ) : (
          <table className="log">
            <thead><tr><th>#</th><th>Asset</th><th>Strike</th><th>Remaining</th><th>Pending</th><th>Premium</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {c.contracts.map((k) => {
                const sym = ASSETS[k.assetId]?.symbol || k.assetId;
                const open = k.status === "Active" || k.status === "PartiallySettled";
                return (
                  <tr key={k.address}>
                    <td className="mono">{k.contractId.toString()}</td>
                    <td>{sym}</td>
                    <td className="mono">{fmtPrice(k.strike)}</td>
                    <td className="mono">{fmtQty(k.remainingQuantity)}</td>
                    <td className="mono">{fmtQty(k.pendingQuantity)}</td>
                    <td className="mono">{fromFixed(k.premiumPaid).toFixed(2)}</td>
                    <td><span className={"pill " + (open ? "green" : "gray")}>{k.status}</span></td>
                    <td>
                      {open && k.remainingQuantity > 0n && (
                        <button className="btn ghost sm" disabled={c.busy}
                          onClick={() => c.requestExercise(k.address, k.assetId, k.nextRequestNonce, fromFixed(k.remainingQuantity)).catch(() => {})}>
                          Request exercise
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="disclosure" style={{ marginTop: 10 }}>
          Read live from the program via <code>getProgramAccounts</code> and decoded client-side. Settlement of requests is done by the keeper/publisher (see the keeper stub).
        </div>
      </div>
    </>
  );
}
