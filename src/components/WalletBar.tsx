import { useEffect, useRef, useState } from "react";
import { useChain, explorerUrl, NETWORK } from "../onchain/store";
import "./WalletBar.css";

export default function WalletBar() {
  const c = useChain();
  const details = useRef<HTMLDetailsElement>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node)) details.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const mainnetEntry = <a className="btn ghost wallet-mainnet" href="/?beta=1"><span>Connect wallet</span><small>Mainnet beta</small></a>;

  if (!c.connected) return (
    <div className="wallet-controls">
      <button className="btn primary wallet-demo" disabled={c.busy} aria-busy={c.busy} onClick={() => c.connect()}>
        {c.busy ? "Connecting…" : "Try demo"}
      </button>
      {mainnetEntry}
    </div>
  );

  return (
    <div className="wallet-controls">
      <details className="wallet-details" ref={details} onToggle={() => setNotice("")}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }}
        onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary className="btn ghost wallet-demo">Demo wallet</summary>
        <div className="wallet-popover">
          <strong>Demo wallet</strong>
          <span className="wallet-balance mono">{c.tokenBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })} oUSD</span>
          <p>Test tokens, no monetary value.</p>
          {c.address && <>
            <span className="wallet-address mono">{c.address}</span>
            <div className="wallet-detail-actions">
              <button className="btn ghost" onClick={async () => {
                try { await navigator.clipboard.writeText(c.address!); setNotice("Address copied."); }
                catch { setNotice("Could not copy. Select the address above to copy it."); }
              }}>Copy address</button>
              <a className="btn ghost" href={explorerUrl("address", c.address)} target="_blank" rel="noreferrer">View on Explorer</a>
            </div>
          </>}
          <button className="btn ghost" disabled={c.busy || c.refreshing} aria-busy={c.refreshing} onClick={async () => {
            setNotice("");
            try { await c.refresh(); setNotice("Wallet refreshed."); }
            catch { setNotice("Could not refresh. Please try again."); }
          }}>{c.refreshing ? "Refreshing…" : "Refresh wallet"}</button>
          {c.tokenBalance === 0 && <button className="btn ghost" disabled={c.busy} onClick={() => c.connect()}>Get demo oUSD</button>}
          <span className="wallet-notice" role="status">{notice}</span>
        </div>
      </details>
      {mainnetEntry}
    </div>
  );
}

export { NETWORK };
