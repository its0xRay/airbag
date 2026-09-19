import { useEffect, useState } from "react";
import { useChain } from "./onchain/store";
import Landing from "./components/Landing";
import ProtectTab from "./components/ProtectTab";
import PortfolioTab from "./components/PortfolioTab";
import CompareTab from "./components/CompareTab";
import CalculatorTab from "./components/CalculatorTab";
import UnderwriterTab from "./components/UnderwriterTab";
import HistoryTab from "./components/HistoryTab";
import WalletBar, { NETWORK } from "./components/WalletBar";

type Tab = "home" | "protect" | "portfolio" | "compare" | "calculator" | "underwriter" | "history";

const TABS: [Tab, string][] = [
  ["home", "Home"],
  ["protect", "Protect"],
  ["portfolio", "Portfolio"],
  ["compare", "Compare"],
  ["calculator", "Calculator"],
  ["underwriter", "Underwriter"],
  ["history", "History"],
];

export default function App() {
  const connected = useChain((s) => s.connected);
  const refresh = useChain((s) => s.refresh);
  const chainError = useChain((s) => s.error);
  const clearError = useChain((s) => s.clearError);
  const [tab, setTab] = useState<Tab>("home");
  // A renewal jumps to Protect with the quantity prefilled — the quote itself
  // is always fresh, so no terms carry over from the old contract (§18).
  const [renewal, setRenewal] = useState<{ assetId: number; quantity: number } | null>(null);

  // Keep on-chain state fresh while the user is looking at it.
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => { refresh().catch(() => {}); }, 12000);
    return () => clearInterval(t);
  }, [connected, refresh]);

  return (
    <div className="app">
      <header className="header">
        <button className="logo" onClick={() => setTab("home")} aria-label="Optket home">
          <span className="dot" aria-hidden="true" /> Optket
          <span className="pill gray hide-sm" style={{ marginLeft: 6 }}>{NETWORK}</span>
        </button>
        <div className="spacer" />
        <WalletBar />
      </header>

      <div className="simbanner">
        DEVNET — every action here is a real on-chain transaction. Collateral and payouts use
        oUSD, which has no monetary value (true of all devnet assets). Real USDC is rejected
        by the program; hedging is modelled, not executed.
      </div>

      <nav className="tabs" aria-label="Sections">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            className={"tab" + (tab === t ? " active" : "")}
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      {chainError && (
        <div className="callout warn" role="alert" style={{ margin: "14px 16px" }}>
          <div className="between">
            <span>{chainError}</span>
            <button className="btn ghost sm" onClick={clearError}>Dismiss</button>
          </div>
        </div>
      )}

      {tab === "home" && <Landing onLaunch={(t) => setTab(t as Tab)} />}
      {tab === "protect" && <ProtectTab renewal={renewal} onRenewalConsumed={() => setRenewal(null)} />}
      {tab === "portfolio" && <PortfolioTab onRenew={(assetId, quantity) => { setRenewal({ assetId, quantity }); setTab("protect"); }} />}
      {tab === "compare" && <CompareTab />}
      {tab === "calculator" && <CalculatorTab />}
      {tab === "underwriter" && <UnderwriterTab />}
      {tab === "history" && <HistoryTab />}
    </div>
  );
}
