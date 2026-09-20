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
  const [protectAssetId, setProtectAssetId] = useState<number | null>(null);
  // A renewal jumps to Protect with the quantity prefilled — the quote itself
  // is always fresh, so no terms carry over from the old contract (§18).
  const [renewal, setRenewal] = useState<{ assetId: number; quantity: number } | null>(null);

  // Keep onchain state fresh while the user is looking at it.
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => { refresh().catch(() => {}); }, 12000);
    return () => clearInterval(t);
  }, [connected, refresh]);

  return (
    <div className={"app" + (tab === "home" ? " home-mode" : "")}>
      <header className={"header" + (tab === "home" ? " public-header" : " app-header")}>
        <button className="logo" onClick={() => setTab("home")} aria-label="Optket home">
          <span className="dot" aria-hidden="true" /> Optket
          {tab !== "home" && (
            <span
              className="pill gray hide-sm"
              style={{ marginLeft: 6 }}
              title="Demo environment. oUSD has no real value."
            >
              {NETWORK} demo
            </span>
          )}
        </button>
        <div className="spacer" />
        {tab === "home" ? (
          <>
            <nav className="public-nav" aria-label="Product">
              <a href="#why-protect">Why protect</a>
              <a href="#how-it-works">How it works</a>
              <a href="#onchain-proof">Onchain proof</a>
              <a href="#assets">Assets</a>
            </nav>
            <button className="btn primary" onClick={() => setTab("protect")}>Try demo</button>
          </>
        ) : (
          <WalletBar />
        )}
      </header>

      {tab !== "home" && (
        <nav className="tabs" aria-label="Application sections">
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
      )}

      {tab !== "home" && chainError && (
        <div className="callout warn" role="alert" style={{ margin: "14px 16px" }}>
          <div className="between">
            <span>{chainError}</span>
            <button className="btn ghost sm" onClick={clearError}>Dismiss</button>
          </div>
        </div>
      )}

      {tab === "home" && <Landing onLaunch={(t, assetId) => {
        if (t === "protect") setProtectAssetId(assetId ?? null);
        setTab(t as Tab);
      }} />}
      {tab === "protect" && (
        <ProtectTab
          renewal={renewal}
          onRenewalConsumed={() => setRenewal(null)}
          initialAssetId={protectAssetId}
          onInitialAssetConsumed={() => setProtectAssetId(null)}
        />
      )}
      {tab === "portfolio" && <PortfolioTab onRenew={(assetId, quantity) => { setRenewal({ assetId, quantity }); setTab("protect"); }} />}
      {tab === "compare" && <CompareTab />}
      {tab === "calculator" && <CalculatorTab />}
      {tab === "underwriter" && <UnderwriterTab />}
      {tab === "history" && <HistoryTab />}
    </div>
  );
}
