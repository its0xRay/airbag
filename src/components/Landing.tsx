import ProtectionWalkthrough from "./ProtectionWalkthrough";
import ProtectTab from "./ProtectTab";
import AssetLogo from "./AssetLogo";
import { VERIFIED_ASSETS } from "../data/assets";
import { explorerUrl } from "../onchain/store";
import { OPTKET_PROGRAM_ID } from "../client/optketProgram";
import type { ProtectDraft } from "../App";

type AppTab = "protect" | "portfolio" | "compare" | "underwriter" | "history";

export default function Landing({ onLaunch, onViewPosition, onConnected }: {
  onLaunch: (tab: AppTab, draft?: ProtectDraft) => void | Promise<void>;
  onViewPosition: (assetId: number, address?: string) => void;
  onConnected: (draft: ProtectDraft) => void;
  launching?: boolean;
  launchStatus?: string;
}) {
  return (
    <main className="lp">
      <section className="lp-hero lp-product-hero" id="product">
        <div className="lp-hero-copy">
          <span className="lp-eyebrow">Solana Devnet</span>
          <h1 className="lp-title">Protect the downside.<br /><span className="soft">Keep the upside.</span></h1>
          <p className="lp-sub">Choose a price floor for your tokenized stocks. Pay once. Keep your tokens.</p>
          <p className="lp-asset-intro">For NVDAx and Anthropic PreStocks—even without a listed-options market.</p>
          <div className="lp-meta"><span className="demo-label">oUSD <small>demo · no real value</small></span><span>Fees and rent sponsored</span></div>
        </div>
        <div id="protection"><ProtectTab embedded onViewPositions={onViewPosition} onConnected={onConnected} /></div>
      </section>

      <section className="lp-why" id="why-protect" aria-labelledby="why-protect-title">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Why protect</span>
          <h2 className="lp-h2" id="why-protect-title">Keep your investment.<br /><span className="soft">Add downside protection.</span></h2>
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
      </section>

      <ProtectionWalkthrough />

      <section className="lp-section" id="assets">
        <div className="lp-section-head"><h2 className="lp-h2">Two assets. Protection for each.</h2><p className="lp-lede">Protection follows the token’s market price—not the company’s valuation.</p></div>
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

      <section className="lp-section lp-verification" id="onchain-proof">
        <div className="lp-proof-layout">
          <div className="lp-evidence">
            <h2 className="lp-h2">Check it onchain.</h2><p className="lp-lede">Purchases, collateral and payouts are recorded on Solana Devnet.</p>
            <a className="lp-text-link" href={explorerUrl("address", OPTKET_PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">View deployed program ↗</a><button className="btn ghost sm" onClick={() => onLaunch("history")}>Browse onchain activity</button>
          </div>
          <div className="lp-faq">
            <details><summary>How are payouts funded?</summary><p>Maximum contractual payout is fully reserved onchain when protection is purchased. Reserves are held in oUSD, a demo token with no real value.</p></details>
            <details><summary>How is the reference verified?</summary><p>The authorized publisher submits external observations. The program checks timing, sample count and ordering, then calculates the median. The publisher remains a trust dependency.</p></details>
            <details><summary>What if a reference is unavailable?</summary><p>No price is invented. Failed exercise returns the requested quantity to coverage; invalid expiry follows the premium-refund rule.</p></details>
            <details><summary>What is real, and what is Devnet?</summary><p>Market references come from real tokens. Purchases, reserves and settlements are onchain. oUSD is a test token with no real value or redemption promise.</p></details>
            <details><summary>What happens to older NVDAx positions?</summary><p>Benchmark v1 contracts keep their original NVIDIA benchmark and equity-session rules. New v2 contracts protect the NVDAx token market. Each position identifies its reference.</p></details>
          </div>
        </div>
      </section>

      <footer className="lp-footer"><span>Optket</span><span>Solana Devnet · oUSD has no real value</span><a href="#product">Back to top ↑</a></footer>
    </main>
  );
}
