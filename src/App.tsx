import { useEffect, useRef, useState } from "react";
import { useChain } from "./onchain/store";
import Landing from "./components/Landing";
import ProtectTab from "./components/ProtectTab";
import type { RepeatPosition } from "./client/repeatPosition";
import PortfolioTab from "./components/PortfolioTab";
import CompareTab from "./components/CompareTab";
import UnderwriterTab from "./components/UnderwriterTab";
import HistoryTab from "./components/HistoryTab";
import VaultsTab from "./components/VaultsTab";
import WalletBar, { NETWORK } from "./components/WalletBar";
import TransactionProgress from "./components/TransactionProgress";
import { loadTransaction } from "./onchain/transactionRecovery";

type Tab = "home" | "protect" | "portfolio" | "compare" | "underwriter" | "history" | "vaults";
const VAULTS_ENABLED = import.meta.env.VITE_VAULTS_ENABLED === "true";
const ROUTES: Record<string, Tab> = { protect: "protect", positions: "portfolio", markets: "compare", pools: "underwriter", onchain: "history", ...(VAULTS_ENABLED ? { vaults: "vaults" as const } : {}) };
const tabFromUrl = (): Tab => ROUTES[new URLSearchParams(window.location.search).get("view") ?? ""] ?? "home";

export interface ProtectDraft {
  assetId: number;
  seriesId?: number;
  quantity?: number;
  quantityText?: string;
  tenor?: "short" | "weekly";
}
export interface PositionTarget { assetId: number; address?: string }

const TABS: [Tab, string][] = [
  ["protect", "Open position"],
  ["portfolio", "Positions"],
  ["compare", "Markets"],
  ["underwriter", "Pools"],
  ["history", "Onchain"],
];

export default function App() {
  const connected = useChain((s) => s.connected);
  const connect = useChain((s) => s.connect);
  useEffect(() => {
    void connect(true);
    const syncTransaction = (event: StorageEvent) => {
      if (event.key !== "optket.transaction.v1") return;
      useChain.setState({ transaction: loadTransaction() });
      void useChain.getState().recoverTransaction();
    };
    window.addEventListener("storage", syncTransaction);
    return () => window.removeEventListener("storage", syncTransaction);
  }, [connect]);
  const busy = useChain((s) => s.busy);
  const status = useChain((s) => s.status);
  const refresh = useChain((s) => s.refresh);
  const chainError = useChain((s) => s.error);
  const clearError = useChain((s) => s.clearError);
  const [tab, updateTab] = useState<Tab>(tabFromUrl);
  const setTab = (next: Tab) => {
    const url = new URL(window.location.href);
    const route = Object.entries(ROUTES).find(([, value]) => value === next)?.[0];
    if (route) url.searchParams.set("view", route); else url.searchParams.delete("view");
    url.hash = "";
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    updateTab(next);
  };
  useEffect(() => { const restore = () => updateTab(tabFromUrl()); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore); }, []);
  useEffect(() => {
    if (tab !== "underwriter" && tab !== "history") return;
    void useChain.getState().refreshPublic();
    const timer = window.setInterval(() => { void useChain.getState().refreshPublic(); }, 30000);
    return () => window.clearInterval(timer);
  }, [tab]);
  const [positionTarget, setPositionTarget] = useState<PositionTarget | null>(null);
  const protocolMenu = useRef<HTMLDetailsElement>(null);
  const [protectDraft, setProtectDraft] = useState<ProtectDraft | null>(null);
  // A renewal jumps to Protect with the quantity prefilled — the quote itself
  // is always fresh, so no terms carry over from the old contract (§18).
  const [renewal, setRenewal] = useState<RepeatPosition | null>(null);
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
    if (nextTab === "portfolio" && !useChain.getState().connected) {
      await connect();
      if (!useChain.getState().connected) return;
    }
    setTab(nextTab);
  };

  // Keep onchain state fresh while the user is looking at it.
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => { const chain = useChain.getState(); if (!chain.busy && chain.transaction?.state !== "checking") refresh().catch(() => {}); }, 12000);
    return () => clearInterval(t);
  }, [connected, refresh]);

  return (
    <div className={"app" + (tab === "home" ? " home-mode" : "")}>
      <header className={"header" + (tab === "home" ? " public-header" : " app-header")}>
        <button className="logo" onClick={() => { setTab("home"); window.scrollTo({ top: 0, behavior: "instant" }); }} aria-label="Airbag home">
          <span className="dot" aria-hidden="true" /> Airbag
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
              <a href="#why-protect">Why Airbag</a>
              <a href="#how-it-works">How it works</a>
              <a href="#onchain-proof">Onchain proof</a>
              <a href="#assets">Assets</a>
              {VAULTS_ENABLED && <button className="text-action" onClick={() => goTo("vaults")}>Vaults</button>}
            </nav>
            <details className="public-section-menu" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}><summary className="btn ghost">Explore</summary><nav aria-label="Page sections" onClick={e => { if ((e.target as HTMLElement).closest("a,button")) e.currentTarget.closest("details")!.open = false; }}><a href="#why-protect">Why Airbag</a><a href="#how-it-works">How it works</a><a href="#assets">Assets</a><a href="#onchain-proof">Onchain proof</a>{VAULTS_ENABLED && <button className="text-action" onClick={() => goTo("vaults")}>Vaults</button>}</nav></details>
            {connected ? <button className="btn ghost" onClick={() => goTo(useChain.getState().contracts.length ? "portfolio" : "protect")}>Open app ↗</button> : <a className="btn ghost" href="#protection">Get started ↗</a>}
          </>
        ) : (
          <WalletBar />
        )}
      </header>
      <TransactionProgress showConfirmed={tab !== "home"} onViewPositions={() => void launch("portfolio")} onViewVaults={VAULTS_ENABLED ? () => void launch("vaults") : undefined} />

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
          {VAULTS_ENABLED && <button className={"tab" + (tab === "vaults" ? " active" : "")} aria-current={tab === "vaults" ? "page" : undefined} onClick={() => goTo("vaults")}>Vaults</button>}
          <details className="protocol-menu" ref={protocolMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary className={"tab" + (TABS.slice(2).some(([t]) => t === tab) ? " active" : "")}>Protocol <span aria-hidden="true">⌄</span></summary>
            <div className="protocol-options">{TABS.slice(2).map(([t, label]) => <button key={t} onClick={() => goTo(t)} aria-current={tab === t ? "page" : undefined}>{label}</button>)}</div>
          </details>
        </nav>
      )}

      {chainError && tab !== "protect" && tab !== "home" && (
        <div className="callout warn" role="alert" style={{ margin: "14px 16px" }}>
          <div className="between">
            <span>{chainError}</span>
            <button className="btn ghost sm" onClick={clearError}>Dismiss</button>
          </div>
        </div>
      )}

      {tab === "home" && <Landing vaultsEnabled={VAULTS_ENABLED} onLaunch={(t, draft) => launch(t, draft)} onViewPosition={viewPosition} onConnected={draft => { setProtectDraft(draft); setTab("protect"); }} launching={busy} launchStatus={status} />}
      {tab === "protect" && (
        <ProtectTab
          onViewPositions={viewPosition}
          renewal={renewal}
          onRenewalConsumed={() => setRenewal(null)}
          initialDraft={protectDraft}
          onInitialDraftConsumed={() => setProtectDraft(null)}
        />
      )}
      {tab === "portfolio" && <PortfolioTab key={positionTarget?.address ?? "positions"} target={positionTarget} onRenew={(assetId, quantity, terms) => { setProtectDraft(null); setRenewal({ assetId, quantity, ...terms }); setTab("protect"); }} onProtect={(assetId, quantity) => { setProtectDraft({ assetId, quantity }); setTab("protect"); }} />}
      {tab === "compare" && <CompareTab />}
      {tab === "underwriter" && <UnderwriterTab />}
      {tab === "vaults" && <VaultsTab onOpenPosition={assetId => { setProtectDraft({ assetId }); setTab("protect"); }} />}
      {tab === "history" && <HistoryTab onProtect={() => { setProtectDraft({ assetId: 1 }); setTab("protect"); }} />}
    </div>
  );
}
