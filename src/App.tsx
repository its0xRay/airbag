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
  const [tab, setTab] = useState<Tab>("home");

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
        DEMO — collateral, premiums and payouts use free demo tokens with no redemption promise.
        Real USDC is rejected by the program. Everything else runs on-chain.
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

      {tab === "home" && <Landing onLaunch={(t) => setTab(t as Tab)} />}
      {tab === "protect" && <ProtectTab />}
      {tab === "portfolio" && <PortfolioTab />}
      {tab === "compare" && <CompareTab />}
      {tab === "calculator" && <CalculatorTab />}
      {tab === "underwriter" && <UnderwriterTab />}
      {tab === "history" && <HistoryTab />}
    </div>
  );
}
