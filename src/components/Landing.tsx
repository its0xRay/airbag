import { useState } from "react";
import ProtectTab from "./ProtectTab";
import AssetLogo from "./AssetLogo";
import { VERIFIED_ASSETS } from "../data/assets";
import { explorerUrl } from "../onchain/store";
import { OPTKET_PROGRAM_ID } from "../client/optketProgram";
import type { ProtectDraft } from "../App";

type AppTab = "protect" | "portfolio" | "compare" | "underwriter" | "history";
const steps = [
  ["Choose a floor", "Set your protection", "Choose an asset, quantity, price floor and expiry. Explore the payout before connecting your wallet."],
  ["Pay once", "One premium upfront", "Buy with a fresh signed quote. Your maximum contractual payout is reserved onchain when the position is issued."],
  ["Keep holding", "Your tokens stay with you", "The underlying never enters an Optket vault. Protection is a separate contract, without buyer margin or liquidation."],
  ["Exercise or settle", "Payout against the reference", "Request partial or full exercise before the cutoff, or let the keeper settle at expiry. Payout uses the verified reference and your contract’s floor."],
] as const;

export default function Landing({ onLaunch }: {
  onLaunch: (tab: AppTab, draft?: ProtectDraft) => void | Promise<void>;
  launching?: boolean;
  launchStatus?: string;
}) {
  const [step, setStep] = useState(0);
  return (
    <main className="lp">
      <section className="lp-hero lp-product-hero" id="product">
        <div className="lp-hero-copy">
          <span className="lp-eyebrow">Solana Devnet</span>
          <h1 className="lp-title">Protect the downside.<br /><span className="soft">Keep the upside.</span></h1>
          <p className="lp-sub">Downside protection for tokenized stocks and PreStocks—even without a listed-options market. Choose a floor. Pay once. Keep the token.</p>
          <div className="lp-meta"><span className="demo-label">oUSD <small>demo · no real value</small></span><span>Fees and rent sponsored</span></div>
        </div>
        <div id="protection"><ProtectTab embedded onViewPositions={() => onLaunch("portfolio")} /></div>
      </section>

      <section className="lp-section lp-thesis" id="why-protect">
        <div className="lp-thesis-copy">
          <div className="lp-kicker">Why Optket</div>
          <h2 className="lp-display">Hold the asset.<br />Limit the downside.</h2>
          <p className="lp-lede">Protection that settles beside your tokens.</p>
        </div>
        <div className="lp-thesis-points">
          {[
            ["Keep the token", "Your underlying stays in your wallet."],
            ["Fixed cost", "One premium. No buyer margin or liquidation."],
            ["Fully reserved", "Maximum contractual payout is reserved onchain."],
          ].map(([title, body], i) => <article className="lp-thesis-point" key={title}><span className="lp-row-number mono" aria-hidden="true">0{i + 1}</span><div><h3>{title}</h3><p>{body}</p></div></article>)}
        </div>
      </section>

      <section className="lp-section" id="how-it-works">
        <div className="lp-section-head"><div className="lp-kicker">How it works</div><h2 className="lp-h2">Choose, pay, hold, settle.</h2></div>
        <div className="lp-process">
          <div className="lp-process-steps" role="group" aria-label="Explore how protection works">
            {steps.map(([title], i) => <button key={title} type="button" aria-pressed={step === i} aria-controls="process-detail" onClick={() => setStep(i)}><span className="mono">0{i + 1}</span>{title}<span aria-hidden="true">↗</span></button>)}
          </div>
          <div className="lp-process-detail" id="process-detail" aria-live="polite"><span className="lp-kicker">How protection works · 0{step + 1}</span><h3>{steps[step][1]}</h3><p>{steps[step][2]}</p><a className="lp-text-link" href="#protection">Configure protection →</a></div>
        </div>
      </section>

      <section className="lp-section" id="assets">
        <div className="lp-section-head"><div className="lp-kicker">What determines the payout?</div><h2 className="lp-h2">The token’s market price.</h2><p className="lp-lede">Both assets use token-market observations. New NVDAx protection no longer depends on an open stock exchange.</p></div>
        <div className="lp-reference-cards">
          {[1, 0].map((id) => {
            const asset = VERIFIED_ASSETS[id];
            return <article className="lp-reference-card" key={asset.key}>
              <div className="lp-reference-card-head"><div className="row"><AssetLogo asset={asset} /><div><span className="lp-reference-kind">{id === 0 ? "xStock" : "PreStocks"}</span><h3>{asset.symbol}</h3></div></div></div>
              <p className="lp-reference-summary">{id === 0 ? "Protect NVDAx token-price downside, including a discount to the NVIDIA stock benchmark." : "Protect the traded token price—not the private company’s valuation."}</p>
            </article>;
          })}
        </div>
        <p className="lp-lede lp-shared-reference">Jupiter observations · 5-minute median · Fresh data and active series required</p>
        <div className="lp-note"><p className="disclosure">Existing NVDAx v1 contracts retain their stock-benchmark terms.</p><button className="btn ghost sm" onClick={() => onLaunch("compare")}>View markets</button></div>
      </section>

      <section className="lp-section" id="onchain-proof">
        <div className="lp-section-head"><div className="lp-kicker">The full lifecycle</div><h2 className="lp-h2">From purchase to payout.</h2></div>
        <div className="lp-proof-layout">
          <div className="lp-proof-list">
            {[
              ["Onchain program", "Solana Devnet transactions, verifiable in the explorer."],
              ["Per-asset collateral", "Each position’s maximum payout is reserved before issuance."],
              ["Partial or full exercise", "Choose how much to exercise before the cutoff."],
              ["Automatic expiry", "The reference keeper settles eligible positions."],
            ].map(([title, body]) => <article className="lp-proof-row" key={title}><h3>{title}</h3><p>{body}</p></article>)}
          </div>
          <div className="lp-faq">
            <details><summary>How is the reference verified?</summary><p>The authorized publisher submits external observations. The program checks timing, sample count and ordering, then calculates the median. The publisher remains a trust dependency.</p></details>
            <details><summary>What if a reference is unavailable?</summary><p>No price is invented. Failed exercise returns the requested quantity to coverage; invalid expiry follows the premium-refund rule.</p></details>
            <details><summary>What is real, and what is Devnet?</summary><p>Market references come from real tokens. Purchases, reserves and settlements are onchain. oUSD is a test token with no real value or redemption promise.</p></details>
            <details><summary>What happens to older NVDAx positions?</summary><p>Benchmark v1 contracts keep their original NVIDIA benchmark and equity-session rules. New v2 contracts protect the NVDAx token market. Each position identifies its reference.</p></details>
          </div>
        </div>
        <div className="lp-note"><a href={explorerUrl("address", OPTKET_PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">View deployed program ↗</a><button className="btn ghost sm" onClick={() => onLaunch("history")}>Onchain activity</button></div>
      </section>

      <section className="lp-section">
        <div className="lp-section-head"><div className="lp-kicker">Beyond the first position</div><h2 className="lp-h2">Manage the full picture.</h2></div>
        <div className="lp-product-links">
          {([["portfolio", "Positions", "Coverage and exercise"], ["compare", "Markets", "Prices and token details"], ["underwriter", "Pools", "Collateral and activity"], ["history", "Onchain", "Verifiable transactions"]] as const).map(([tab, title, body]) => <button key={tab} onClick={() => onLaunch(tab)}><strong>{title}</strong><span>{body}</span><span aria-hidden="true">↗</span></button>)}
        </div>
      </section>

      <section className="lp-section lp-final"><h2 className="lp-h2">Choose your protection.</h2><p className="lp-lede">Configure first. Connect when you’re ready.</p><a className="btn primary lg" href="#protection">Protect a position →</a></section>
    </main>
  );
}
