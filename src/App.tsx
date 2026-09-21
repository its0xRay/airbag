import { useEffect, useState } from "react";
import { useChain } from "./onchain/store";
import Landing from "./components/Landing";
import ProtectTab from "./components/ProtectTab";
import PortfolioTab from "./components/PortfolioTab";
import CompareTab from "./components/CompareTab";
import UnderwriterTab from "./components/UnderwriterTab";
import HistoryTab from "./components/HistoryTab";
import WalletBar, { NETWORK } from "./components/WalletBar";

type Tab = "home" | "protect" | "portfolio" | "compare" | "underwriter" | "history";

export interface ProtectDraft {
  assetId: number;
  seriesId?: number;
  quantity?: number;
}

const TABS: [Tab, string][] = [
  ["protect", "Protect"],
  ["portfolio", "Positions"],
  ["compare", "Markets"],
  ["underwriter", "Pools"],
  ["history", "Onchain"],
];

export default function App() {
  const connected = useChain((s) => s.connected);
  const connect = useChain((s) => s.connect);
  const busy = useChain((s) => s.busy);
  const status = useChain((s) => s.status);
  const refresh = useChain((s) => s.refresh);
  const chainError = useChain((s) => s.error);
  const clearError = useChain((s) => s.clearError);
  const [tab, setTab] = useState<Tab>("home");
  const [protectDraft, setProtectDraft] = useState<ProtectDraft | null>(null);
  // A renewal jumps to Protect with the quantity prefilled — the quote itself
  // is always fresh, so no terms carry over from the old contract (§18).
  const [renewal, setRenewal] = useState<{ assetId: number; quantity: number } | null>(null);

  const launch = async (nextTab: Exclude<Tab, "home">, draft?: ProtectDraft) => {
    if (busy) return;
    if (nextTab === "protect") setProtectDraft(draft ?? null);
    if (!useChain.getState().connected) {
      await connect();
      if (!useChain.getState().connected) return;
    }
    setTab(nextTab);
  };

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
            {connected ? <button className="btn primary" onClick={() => setTab("portfolio")}>My positions</button> : <a className="btn primary" href="#protection">Try protection</a>}
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
              className={"tab" + (t === "compare" ? " group-start" : "") + (tab === t ? " active" : "")}
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {chainError && (
        <div className="callout warn" role="alert" style={{ margin: "14px 16px" }}>
          <div className="between">
            <span>{chainError}</span>
            <button className="btn ghost sm" onClick={clearError}>Dismiss</button>
          </div>
        </div>
      )}

      {tab === "home" && <Landing onLaunch={(t, draft) => launch(t as Exclude<Tab, "home">, draft)} launching={busy} launchStatus={status} />}
      {tab === "protect" && (
        <ProtectTab
          onViewPositions={() => setTab("portfolio")}
          renewal={renewal}
          onRenewalConsumed={() => setRenewal(null)}
          initialDraft={protectDraft}
          onInitialDraftConsumed={() => setProtectDraft(null)}
        />
      )}
      {tab === "portfolio" && <PortfolioTab onRenew={(assetId, quantity) => { setRenewal({ assetId, quantity }); setTab("protect"); }} onProtect={(assetId) => { setProtectDraft({ assetId }); setTab("protect"); }} />}
      {tab === "compare" && <CompareTab />}
      {tab === "underwriter" && <UnderwriterTab />}
      {tab === "history" && <HistoryTab onProtect={() => { setProtectDraft({ assetId: 1 }); setTab("protect"); }} />}
    </div>
  );
}
