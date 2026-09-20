import { useState } from "react";
import { useChain, explorerUrl } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";

/**
 * Transaction history (PRD §13.7) read from the chain — every signature that
 * touched a contract this wallet owns. There is no local activity log; if it
 * isn't on-chain, it isn't here.
 */
export default function HistoryTab({ onProtect }: { onProtect: () => void }) {
  const c = useChain();
  const [scope, setScope] = useState<"program" | "wallet">("program");
  const [visible, setVisible] = useState(10);

  if (!c.connected) {
    return <div className="card empty">Connect the demo wallet to see your onchain history.</div>;
  }

  return (
    <>
    <div className="app-page-head">
      <div><div className="card-title">Verifiable activity</div><h1>Onchain</h1><p>Confirmed Devnet signatures from the deployed program and the connected wallet’s contracts. Every row comes from Solana RPC.</p></div>
    </div>
    <div className="row activity-scope" role="group" aria-label="Activity scope">
      <button className={"btn sm " + (scope === "program" ? "primary" : "ghost")} aria-pressed={scope === "program"} onClick={() => setScope("program")}>Program activity</button>
      <button className={"btn sm " + (scope === "wallet" ? "primary" : "ghost")} aria-pressed={scope === "wallet"} onClick={() => setScope("wallet")}>Your activity</button>
    </div>
    <div className="card">
      <div className="between" style={{ marginBottom: 4 }}>
        <div className="card-title" style={{ margin: 0 }}>{scope === "program" ? "Program-wide Devnet activity" : "Connected-wallet activity"}</div>
        <button className="btn ghost sm" disabled={c.busy} onClick={() => c.refresh()}>Refresh</button>
      </div>
      <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
        {scope === "program"
          ? "Confirmed transactions invoking the deployed Optket program, newest first."
          : "Signatures touching contracts owned by this wallet, newest first."} Every row opens in the explorer.
      </div>

      {scope === "program" ? c.programHistory.length === 0 ? (
        <div className="empty"><strong>No program activity returned.</strong><br />The Devnet RPC may be catching up. Refresh in a moment.</div>
      ) : (
        <>
          <div className="table-scroll"><table className="log">
            <thead><tr><th>When</th><th>Action</th><th>Status</th><th>Signature</th></tr></thead>
            <tbody>
              {c.programHistory.slice(0, visible).map((h) => (
                <tr key={h.signature}>
                  <td className="mono faint">{h.blockTime ? new Date(h.blockTime * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) : "—"}</td>
                  <td>{h.action}</td>
                  <td>{h.err ? <span className="pill red">failed</span> : <span className="pill green">confirmed</span>}</td>
                  <td><a className="mono" href={explorerUrl("tx", h.signature)} target="_blank" rel="noreferrer">{h.signature.slice(0, 16)}… ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {visible < c.programHistory.length && <button className="btn ghost sm load-more" onClick={() => setVisible((count) => count + 10)}>Load more</button>}
        </>
      ) : c.history.length === 0 ? (
        <div className="empty">
          <strong>No onchain activity yet.</strong><br />Create a position and its confirmed signature will appear here.<div><button className="btn primary sm" style={{ marginTop: 14 }} onClick={onProtect}>Buy protection</button></div>
        </div>
      ) : (
        <div className="table-scroll"><table className="log">
          <thead>
            <tr><th>When</th><th>Action</th><th>Asset</th><th>Contract</th><th>Status</th><th>Signature</th></tr>
          </thead>
          <tbody>
            {c.history.map((h) => (
              <tr key={h.signature}>
                <td className="mono faint">
                  {h.blockTime ? new Date(h.blockTime * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                </td>
                <td>{h.action}</td>
                <td>{VERIFIED_ASSETS[h.assetId]?.symbol ?? h.assetId}</td>
                <td className="mono">#{h.contractId.toString()}</td>
                <td>{h.err ? <span className="pill red">failed</span> : <span className="pill green">confirmed</span>}</td>
                <td>
                  <a className="mono" href={explorerUrl("tx", h.signature)} target="_blank" rel="noreferrer">
                    {h.signature.slice(0, 16)}… ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
    </>
  );
}
