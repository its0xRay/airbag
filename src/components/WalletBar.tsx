import { useChain, explorerUrl } from "../onchain/store";

const NETWORK = /devnet/.test(import.meta.env.VITE_RPC_URL || "") ? "devnet" : "localnet";
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
      <span className="pill green mono hide-sm">{c.tokenBalance.toLocaleString()} oUSD</span>
      <a
        className="pill blue mono"
        href={explorerUrl("address", c.address || "")}
        target="_blank"
        rel="noreferrer"
        title={c.address || ""}
      >
        {c.address ? truncate(c.address) : ""} ↗
      </a>
      <button className="btn ghost sm" disabled={c.busy} onClick={() => c.refresh()} aria-label="Refresh on-chain data">
        {c.busy ? "…" : "↻"}
      </button>
    </div>
  );
}

export { NETWORK };
