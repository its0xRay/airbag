import ProtectionWalkthrough from "./ProtectionWalkthrough";
import ProtectTab from "./ProtectTab";
import AssetLogo from "./AssetLogo";
import { VERIFIED_ASSETS } from "../data/assets";
import { explorerUrl } from "../onchain/store";
import { OPTKET_PROGRAM_ID } from "../client/optketProgram";
import type { ProtectDraft } from "../App";
import { useEffect, useState } from "react";
import VaultsTab, { type VaultDraft } from "./VaultsTab";
import "./LandingWorkspace.css";

type AppTab = "protect" | "portfolio" | "compare" | "underwriter" | "history" | "vaults";

// Keep a mount-time draft: edits are remembered without rehydrating the form on every keystroke.
function BuyerPanel({ draft, remember, onViewPosition }: { draft: ProtectDraft | null; remember: (draft: ProtectDraft) => void; onViewPosition: (asset: number, address?: string) => void }) {
  const [initial] = useState(draft);
  return <ProtectTab embedded initialDraft={initial} onDraftChange={remember} onViewPositions={onViewPosition} />;
}

export default function Landing({ onLaunch, onViewPosition, launching = false, vaultsEnabled = false }: {
  onLaunch: (tab: AppTab, draft?: ProtectDraft) => void | Promise<void>;
  onViewPosition: (assetId: number, address?: string) => void;
  onConnected: (draft: ProtectDraft) => void;
  launching?: boolean;
  launchStatus?: string;
  vaultsEnabled?: boolean;
}) {
  const [side, setSide] = useState<"buyer" | "vault">(() => vaultsEnabled && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("side") === "vault" ? "vault" : "buyer");
  const [explanationSide, setExplanationSide] = useState(side);
  const [buyerDraft, setBuyerDraft] = useState<ProtectDraft | null>(null);
  const [vaultDraft, setVaultDraft] = useState<VaultDraft>({ asset: 0, amount: "100" });
  useEffect(() => {
    const restore = () => setSide(vaultsEnabled && new URLSearchParams(window.location.search).get("side") === "vault" ? "vault" : "buyer");
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [vaultsEnabled]);
  function chooseSide(next: "buyer" | "vault", scroll = false, assetId = side === "buyer" ? buyerDraft?.assetId ?? 1 : vaultDraft.asset) {
    if (launching) return;
    if (next === "vault") setVaultDraft(current => ({ ...current, asset: assetId }));
    else setBuyerDraft(current => current?.assetId === assetId ? current : { ...current, assetId, seriesId: undefined });
    setSide(next);
    setExplanationSide(next);
    const url = new URL(window.location.href);
    if (next === "vault") url.searchParams.set("side", "vault"); else url.searchParams.delete("side");
    url.searchParams.delete("round");
    if (scroll) url.hash = "protection";
    window.history.replaceState(null, "", url);
    if (scroll) document.getElementById("protection")?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  return (
    <main className="lp">
      <section className="lp-hero lp-product-hero" id="product">
        <div className="lp-hero-copy">
          <h1 className="lp-title"><span className="hero-accent">Risk management</span><br />for tokenized equities.</h1>
          <p className="lp-hero-tagline">{vaultsEnabled ? "Set a downside floor. Or fund payouts and share in premiums." : "Keep the upside. Define your downside."}</p>
        </div>
        <div id="protection" className="landing-workspace">
          {vaultsEnabled && <div className="workspace-modes" role="group" aria-label="Choose your Airbag flow">
            <button aria-pressed={side === "buyer"} disabled={launching} onClick={() => chooseSide("buyer")}>Set your floor</button>
            <button aria-pressed={side === "vault"} disabled={launching} onClick={() => chooseSide("vault")}>Fund a vault</button>
          </div>}
          {side === "vault" && vaultsEnabled ? <VaultsTab embedded initialDraft={vaultDraft} onDraftChange={setVaultDraft} onOpenPosition={assetId => { chooseSide("buyer", true, assetId); }} /> : <BuyerPanel draft={buyerDraft} remember={setBuyerDraft} onViewPosition={onViewPosition} />}
        </div>
      </section>

      {vaultsEnabled ? <section className="lp-capital-market lp-section" id="why-protect" aria-labelledby="why-protect-title">
        <div className="lp-market-intro">
          <span className="lp-eyebrow">Why Airbag</span>
          <h2 className="lp-h2" id="why-protect-title">A floor for holders.<br /><span className="soft">Premiums for funders.</span></h2>
        </div>
        <div className="lp-market-mechanism">
          <div className="risk-relationship" aria-label="Mechanism: holders pay premiums to a vault; the vault funds contractual payouts to holders.">
            <div className="risk-party"><span className="risk-party-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18v13H3zM3 7V4h15v3M16 12h5v4h-5z" /></svg></span><span className="lp-eyebrow">For holders</span><h3>Keep your tokens. <br />Set a floor.</h3><p>One premium. No buyer margin calls.</p></div>
            <div className="risk-exchange"><span>Premiums <b aria-hidden="true">→</b></span><span><b aria-hidden="true">←</b> Contract payouts</span></div>
            <div className="risk-party"><span className="risk-party-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="12" cy="12" r="4" /><path d="M12 8v8M8 12h8" /></svg></span><span className="lp-eyebrow">For depositors</span><h3>Back payouts. <br />Share in premiums.</h3><p>Separate vaults for each asset.</p></div>
          </div>
          <p className="lp-market-risk">Deposits can lose value. Premiums are not guaranteed profit.</p>
        </div>
      </section> : <section className="lp-why" id="why-protect" aria-labelledby="why-protect-title">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Why Airbag</span>
          <h2 className="lp-h2" id="why-protect-title">Your stocks are onchain.<br /><span className="soft">Your protection should be too.</span></h2>
        </div>
        <div className="lp-why-surface">
          <article className="lp-why-ownership">
            <div className="lp-ownership-art" role="img" aria-label="Ownership illustration: NVDAx and Anthropic tokens stay in your wallet; protection is a separate contract.">
              <div className="lp-ownership-tokens" aria-hidden="true">
                <div className="lp-ownership-logos"><AssetLogo asset={VERIFIED_ASSETS[0]} /><AssetLogo asset={VERIFIED_ASSETS[1]} /></div>
                <span>Your tokens</span>
              </div>
              <span className="lp-ownership-plus" aria-hidden="true">+</span>
              <div className="lp-ownership-cover" aria-hidden="true">
                <svg viewBox="0 0 64 64" width="64" height="64" fill="none"><path d="M16 12h24l8 8v32H16V12Z" stroke="currentColor" strokeWidth="1.5" /><path d="M40 12v8h8M24 30h16M24 38h10" stroke="currentColor" strokeWidth="1.5" /></svg>
                <span>Separate protection</span>
              </div>
            </div>
            <h3>Keep the token.</h3>
            <p>Your tokens stay in your wallet. You keep their upside.</p>
          </article>
          <div className="lp-why-support">
            <article><h3>One premium.</h3><p>Know your protection cost upfront.</p></article>
            <article><h3>No margin calls.</h3><p>No buyer collateral top-ups or liquidation.</p></article>
          </div>
        </div>
      </section>}

      <ProtectionWalkthrough side={explanationSide} vaultsEnabled={vaultsEnabled} onSideChange={setExplanationSide} />

      <section className="lp-section" id="assets">
        <div className="lp-section-head"><span className="lp-eyebrow">Supported markets</span><h2 className="lp-h2">Two assets.<br /><span className="soft">Two ways to participate.</span></h2><p className="lp-lede">{vaultsEnabled ? "Set a floor or fund a vault for either token." : "Protection follows the traded token price."}</p></div>
        <div className="lp-reference-cards">
          {[1, 0].map((id) => {
            const asset = VERIFIED_ASSETS[id];
            return <article className="lp-reference-card" key={asset.key}>
              <div className="lp-reference-card-head"><div className="row"><AssetLogo asset={asset} /><div><span className="lp-reference-kind">{id === 0 ? "xStock" : "PreStocks"}</span><h3>{asset.symbol}</h3></div></div></div>
              <p className="lp-reference-summary">{id === 0 ? "Protection against NVDAx token-price declines, including discounts to NVIDIA’s stock price." : "Protection for Anthropic PreStocks’ traded token price. Not direct ownership of Anthropic shares or protection of its private valuation."}</p>
            </article>;
          })}
        </div>
        <div className="lp-note"><button className="btn ghost sm" onClick={() => onLaunch("compare")}>View markets</button></div>
      </section>

      <section className="lp-section lp-verification" id="onchain-proof">
        <div className="lp-proof-layout">
          <div className="lp-evidence">
            <h2 className="lp-h2">Visible terms.<br /><span className="soft">Verifiable execution.</span></h2><p className="lp-lede">Inspect the terms, reserves and settlement records on Solana Devnet.</p>
          </div>
          <div className="lp-faq">
            <details><summary>How are payouts funded?</summary><p>Maximum contractual payout is fully reserved onchain when protection is purchased. Reserves are held in oUSD, a demo token with no real value.</p></details>
            {vaultsEnabled && <details><summary>How do vault deposits work?</summary><p>Deposit during a round’s funding window. After it closes, your ownership share is fixed and capital is locked until all obligations settle. Premiums increase the round’s balance; payouts and refunds reduce it. Administrator deposits follow the same proportional ownership and redemption rules.</p></details>}
            <details id="reference-rules"><summary>How is the reference verified?</summary><p>The authorized publisher submits external observations. The program checks timing, sample count and ordering, then calculates the median. The publisher remains a trust dependency.</p></details>
            <details><summary>What if a reference is unavailable?</summary><p>No price is invented. Failed exercise returns the requested quantity to coverage; invalid expiry follows the premium-refund rule.</p></details>
            <details><summary>What is real, and what is Devnet?</summary><p>Market references come from real tokens. Purchases, reserves and settlements are onchain. oUSD is a test token with no real value or redemption promise.</p></details>
          </div>
        </div>
        <nav className="lp-proof-strip" aria-label="Protocol evidence">
          <a href={explorerUrl("address", OPTKET_PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer"><strong>Onchain program</strong><small>Inspect the deployment ↗</small></a>
          <button onClick={() => onLaunch(vaultsEnabled ? "vaults" : "underwriter")}><strong>{vaultsEnabled ? "Vault capital" : "Reserved collateral"}</strong><small>{vaultsEnabled ? "View funding and ownership" : "View pool funding"}</small></button>
          <a href="#reference-rules" onClick={() => { const rules = document.getElementById("reference-rules"); if (rules instanceof HTMLDetailsElement) rules.open = true; }}><strong>Reference rules</strong><small>Understand settlement</small></a>
          <button onClick={() => onLaunch("history")}><strong>Transaction history</strong><small>View transactions</small></button>
        </nav>
      </section>

      <footer className="lp-footer"><span>Airbag</span><span>Solana Devnet · oUSD has no real value</span><a href="#product">Back to top</a></footer>
    </main>
  );
}
