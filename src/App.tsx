import { useEffect, useRef, useState } from "react";
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
  quantityText?: string;
  tenor?: "short" | "weekly";
}
export interface PositionTarget { assetId: number; address?: string }

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
  const [tab, setTab] = useState<Tab>(() => useChain.getState().connected ? (useChain.getState().contracts.length ? "portfolio" : "protect") : "home");
  const [positionTarget, setPositionTarget] = useState<PositionTarget | null>(null);
  const protocolMenu = useRef<HTMLDetailsElement>(null);
  const [protectDraft, setProtectDraft] = useState<ProtectDraft | null>(null);
  // A renewal jumps to Protect with the quantity prefilled — the quote itself
  // is always fresh, so no terms carry over from the old contract (§18).
  const [renewal, setRenewal] = useState<{ assetId: number; quantity: number } | null>(null);
  const viewPosition = (assetId: number, address?: string) => {
    setPositionTarget({ assetId, address });
    setTab("portfolio");
  };
  useEffect(() => {
    if (tab !== "portfolio" || !positionTarget?.address) window.scrollTo({ top: 0, behavior: "instant" });
  }, [tab, positionTarget]);
  const goTo = (next: Tab) => {
    if (protocolMenu.current) protocolMenu.current.open = false;
    if (next === "portfolio") setPositionTarget(null);
    setTab(next);
  };
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = protocolMenu.current;
      if (menu && !menu.contains(event.target as Node)) menu.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

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
          {(tab !== "home" || connected) && (
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
            {connected ? <button className="btn ghost" onClick={() => goTo(useChain.getState().contracts.length ? "portfolio" : "protect")}>Open app ↗</button> : <a className="btn ghost" href="#protection">Get started ↗</a>}
          </>
        ) : (
          <WalletBar />
        )}
      </header>

      {tab !== "home" && (
        <nav className="tabs journey-tabs" aria-label="Application sections">
          {TABS.slice(0, 2).map(([t, label]) => (
            <button
              key={t}
              className={"tab" + (tab === t ? " active" : "")}
              onClick={() => goTo(t)}
              aria-current={tab === t ? "page" : undefined}
            >
              {label}
            </button>
          ))}
          <details className="protocol-menu" ref={protocolMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary className={"tab" + (TABS.slice(2).some(([t]) => t === tab) ? " active" : "")}>Protocol <span aria-hidden="true">⌄</span></summary>
            <div className="protocol-options">{TABS.slice(2).map(([t, label]) => <button key={t} onClick={() => goTo(t)} aria-current={tab === t ? "page" : undefined}>{label}</button>)}</div>
          </details>
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

      {tab === "home" && <Landing onLaunch={(t, draft) => launch(t as Exclude<Tab, "home">, draft)} onViewPosition={viewPosition} onConnected={draft => { setProtectDraft(draft); setTab("protect"); }} launching={busy} launchStatus={status} />}
      {tab === "protect" && (
        <ProtectTab
          onViewPositions={viewPosition}
          renewal={renewal}
          onRenewalConsumed={() => setRenewal(null)}
          initialDraft={protectDraft}
          onInitialDraftConsumed={() => setProtectDraft(null)}
        />
      )}
      {tab === "portfolio" && <PortfolioTab key={positionTarget?.address ?? "positions"} target={positionTarget} onRenew={(assetId, quantity) => { setRenewal({ assetId, quantity }); setTab("protect"); }} onProtect={(assetId) => { setProtectDraft({ assetId }); setTab("protect"); }} />}
      {tab === "compare" && <CompareTab />}
      {tab === "underwriter" && <UnderwriterTab />}
      {tab === "history" && <HistoryTab onProtect={() => { setProtectDraft({ assetId: 1 }); setTab("protect"); }} />}
    </div>
  );
}
