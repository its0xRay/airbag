import { useChain, explorerUrl, NETWORK } from "../onchain/store";
const truncate = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

/**
 * Burner wallet control in the header. Three states — disconnected, connecting,
 * connected — so the user always knows where they stand.
 */
export default function WalletBar() {
  const c = useChain();

  if (!c.connected) {
    return (
      <button className="btn primary" disabled={c.busy} onClick={() => c.connect()}>
        {c.busy ? c.status || "Connecting…" : "Connect demo wallet"}
      </button>
    );
  }

  return (
    <div className="row">
      <span className="pill green mono demo-balance hide-sm">
        {c.tokenBalance.toLocaleString()} oUSD <small>demo</small>
      </span>
      <a
        className="pill blue mono"
        href={explorerUrl("address", c.address || "")}
        target="_blank"
        rel="noreferrer"
        title={c.address || ""}
      >
        {c.address ? truncate(c.address) : ""} ↗
      </a>
      <button className="btn ghost sm" disabled={c.busy} onClick={() => c.refresh()} aria-label="Refresh onchain data">
        {c.busy ? "…" : "↻"}
      </button>
      {c.tokenBalance === 0 && <button className="btn ghost sm" disabled={c.busy} onClick={() => c.connect()}>Get demo oUSD</button>}
    </div>
  );
}

export { NETWORK };
