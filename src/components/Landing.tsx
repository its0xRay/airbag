import ProtectionWalkthrough from "./ProtectionWalkthrough";
import ProtectTab from "./ProtectTab";
import AssetLogo from "./AssetLogo";
import { VERIFIED_ASSETS } from "../data/assets";
import { explorerUrl } from "../onchain/store";
import { OPTKET_PROGRAM_ID } from "../client/optketProgram";
import type { ProtectDraft } from "../App";

type AppTab = "protect" | "portfolio" | "compare" | "underwriter" | "history" | "vaults";

export default function Landing({ onLaunch, onViewPosition, onConnected, vaultsEnabled = false }: {
  onLaunch: (tab: AppTab, draft?: ProtectDraft) => void | Promise<void>;
  onViewPosition: (assetId: number, address?: string) => void;
  onConnected: (draft: ProtectDraft) => void;
  launching?: boolean;
  launchStatus?: string;
  vaultsEnabled?: boolean;
}) {
  return (
    <main className="lp">
      <section className="lp-hero lp-product-hero" id="product">
        <div className="lp-hero-copy">
          <h1 className="lp-title"><span className="hero-accent">Risk management</span><br />for tokenized equities.</h1>
          <p className="lp-hero-tagline">{vaultsEnabled ? "Define your downside—or fund it and share in the premiums." : "Keep the upside. Define your downside."}</p>
          {vaultsEnabled && <nav className="lp-market-actions" aria-label="Choose your side">
            <a className="btn primary" href="#protection">Set your floor <span aria-hidden="true">↓</span></a>
            <button className="btn ghost" onClick={() => onLaunch("vaults")}>Fund a vault <span aria-hidden="true">↗</span></button>
          </nav>}
        </div>
        <div id="protection"><ProtectTab embedded onViewPositions={onViewPosition} onConnected={onConnected} /></div>
      </section>

      {vaultsEnabled ? <section className="lp-capital-market lp-section" id="why-protect" aria-labelledby="why-protect-title">
        <div className="lp-market-intro">
          <span className="lp-eyebrow">Why Airbag</span>
          <h2 className="lp-h2" id="why-protect-title">Your downside.<br /><span className="soft">Someone else’s commitment.</span></h2>
          <p className="lp-lede">Airbag connects people who want to reduce downside with people willing to fund it.</p>
        </div>
        <div className="lp-market-mechanism">
          <div className="lp-market-sides">
            <div><h3>Set your floor</h3><p>Pay one premium. Keep your tokens. No buyer margin calls.</p></div>
            <div><h3>Fund a vault</h3><p>Choose NVDAx or Anthropic. Share the premiums and the cost of buyer payouts.</p></div>
          </div>
          <ol className="lp-capital-flow" aria-label="How vault capital moves">
            <li><span className="lp-flow-number" aria-hidden="true">01</span><strong>Capital in</strong><p>Depositors fund an asset-specific round.</p></li>
            <li><span className="lp-flow-number" aria-hidden="true">02</span><strong>Premiums in</strong><p>Buyers pay for a floor. Maximum payouts are reserved.</p></li>
            <li><span className="lp-flow-number" aria-hidden="true">03</span><strong>Payouts out</strong><p>The vault funds payouts under each contract’s reference rules.</p></li>
            <li><span className="lp-flow-number" aria-hidden="true">04</span><strong>Redeem your share</strong><p>Once obligations settle, depositors redeem their share of the remaining balance.</p></li>
          </ol>
          <p className="lp-market-risk">Depositor capital can lose value. Premiums are not guaranteed profit.</p>
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

      <ProtectionWalkthrough />

      <section className="lp-section" id="assets">
        <div className="lp-section-head"><span className="lp-eyebrow">Two supported markets</span><h2 className="lp-h2">Public or private.<br /><span className="soft">{vaultsEnabled ? "Choose either side." : "One protection workflow."}</span></h2><p className="lp-lede">{vaultsEnabled ? "Token-market downside. Separate vaults for each asset." : "Protection follows the traded token price."}</p></div>
        <div className="lp-reference-cards">
          {[1, 0].map((id) => {
            const asset = VERIFIED_ASSETS[id];
            return <article className="lp-reference-card" key={asset.key}>
              <div className="lp-reference-card-head"><div className="row"><AssetLogo asset={asset} /><div><span className="lp-reference-kind">{id === 0 ? "xStock" : "PreStocks"}</span><h3>{asset.symbol}</h3></div></div></div>
              <p className="lp-reference-summary">{id === 0 ? "Protection against NVDAx token-price declines, including discounts to NVIDIA’s stock price." : "Protection for Anthropic PreStocks’ traded token price. Not direct ownership of Anthropic shares or protection of its private valuation."}</p>
            </article>;
          })}
        </div>
        <p className="lp-lede lp-shared-reference">Jupiter observations · 5-minute median · Fresh data and active series required</p>
        <div className="lp-note"><p className="disclosure">Existing NVDAx v1 contracts retain their stock-benchmark terms.</p><button className="btn ghost sm" onClick={() => onLaunch("compare")}>View markets</button></div>
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
            <details><summary>What happens to older NVDAx positions?</summary><p>Benchmark v1 contracts keep their original NVIDIA benchmark and equity-session rules. New v2 contracts protect the NVDAx token market. Each position identifies its reference.</p></details>
          </div>
        </div>
        <nav className="lp-proof-strip" aria-label="Protocol evidence">
          <a href={explorerUrl("address", OPTKET_PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer"><strong>Onchain program</strong><small>Inspect the deployment ↗</small></a>
          <button onClick={() => onLaunch(vaultsEnabled ? "vaults" : "underwriter")}><strong>{vaultsEnabled ? "Vault capital" : "Reserved collateral"}</strong><small>{vaultsEnabled ? "Inspect funding & ownership →" : "Inspect pool funding →"}</small></button>
          <a href="#reference-rules" onClick={() => { const rules = document.getElementById("reference-rules"); if (rules instanceof HTMLDetailsElement) rules.open = true; }}><strong>Reference rules</strong><small>Understand settlement ↑</small></a>
          <button onClick={() => onLaunch("history")}><strong>Transaction history</strong><small>Inspect actual activity →</small></button>
        </nav>
      </section>

      <footer className="lp-footer"><span>Airbag</span><span>Solana Devnet · oUSD has no real value</span><a href="#product">Back to top ↑</a></footer>
    </main>
  );
}
