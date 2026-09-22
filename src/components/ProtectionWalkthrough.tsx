import { useEffect, useRef, useState } from "react";
import AssetLogo from "./AssetLogo";
import { VERIFIED_ASSETS } from "../data/assets";
import "./ProtectionWalkthrough.css";

const steps = [
  { title: "Choose a floor", heading: "Set your floor.", body: "Choose an asset, quantity, price floor and expiry. Explore the payout before connecting your wallet." },
  { title: "Pay once", heading: "One premium upfront.", body: "Buy with a fresh signed quote. The pool reserves your maximum contractual payout when the position is issued." },
  { title: "Keep holding", heading: "Your tokens stay with you.", body: "The underlying stays in your wallet. Protection is a separate contract, without buyer margin or liquidation." },
  { title: "Exercise or settle", heading: "A reference. A defined payout.", body: "Request partial or full exercise before the cutoff, or let the keeper settle at expiry. A separate contract pays when its settlement reference falls below your floor." },
] as const;

function Mechanism({ step }: { step: number }) {
  return <div className="mechanism">
    {step === 0 && <>
      <div className="mechanism-assets">{VERIFIED_ASSETS.map(asset => <span key={asset.key}><AssetLogo asset={asset} />{asset.symbol}</span>)}</div>
      <div className="mechanism-contract"><span className="mechanism-label">Your contract terms</span><div className="mechanism-terms"><span>Asset</span><span>Quantity</span><span>Price floor</span><span>Expiry</span></div></div>
      <p>Choose what to protect. Define the floor.</p>
    </>}
    {step === 1 && <>
      <div className="mechanism-flow"><span>One premium</span><span className="mechanism-arrow" aria-hidden="true">↓</span><strong>Protection contract</strong></div>
      <div className="mechanism-reserve"><span className="mechanism-label">Pool collateral</span><strong>Maximum payout reserved</strong><div className="mechanism-reserve-line" aria-hidden="true" /></div>
      <p>The pool funds the reserve—not buyer margin.</p>
    </>}
    {step === 2 && <>
      <div className="mechanism-hold"><div className="mechanism-wallet"><span className="mechanism-label">Your wallet</span><div className="mechanism-assets">{VERIFIED_ASSETS.map(asset => <AssetLogo key={asset.key} asset={asset} />)}</div><strong>Underlying tokens</strong></div><span className="mechanism-plus" aria-hidden="true">+</span><div className="mechanism-separate"><span className="mechanism-label">Alongside it</span><strong>Protection contract</strong></div></div>
      <p>No underlying deposit into Airbag.</p>
    </>}
    {step === 3 && <>
      <div className="mechanism-flow"><span>Verified settlement reference</span><span className="mechanism-arrow" aria-hidden="true">↓</span><div className="mechanism-formula"><span className="mechanism-label">Contract payout</span><strong>Quantity × max(floor − reference, 0)</strong></div><span className="mechanism-arrow" aria-hidden="true">↓</span><span>Onchain settlement in oUSD</span></div>
      <p>oUSD is a demo token with no real value.</p>
    </>}
  </div>;
}

export default function ProtectionWalkthrough() {
  const [active, setActive] = useState(0);
  const articles = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // Derive from current positions, including reverse scroll and anchor jumps.
      // Only the diagram changes; reading content stays in the normal document flow.
      const readingLine = window.innerHeight * 0.42;
      let next = 0;
      articles.current.forEach((article, index) => {
        if (article && article.getBoundingClientRect().top <= readingLine) next = index;
      });
      setActive(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <section className="lp-section" id="how-it-works">
    <div className="lp-section-head"><div className="lp-kicker">How it works</div><h2 className="lp-h2">Choose, pay, hold, settle.</h2></div>
    <div className="walkthrough">
      <div className="walkthrough-stories">
        {steps.map((step, i) => <article className="walkthrough-step" data-active={active === i} id={`protection-step-${i + 1}`} key={step.title} ref={element => { articles.current[i] = element; }}>
          <div className="walkthrough-step-label"><span className="mono">0{i + 1}</span><span>{step.title}</span></div>
          <h3>{step.heading}</h3><p>{step.body}</p>
          <div className="walkthrough-inline"><span className="mechanism-label">How it works · diagram</span><Mechanism step={i} /></div>
        </article>)}
      </div>
      <aside className="walkthrough-visual" aria-label="Protection mechanism diagrams">
        <div className="walkthrough-visual-head"><span className="mechanism-label">How it works · diagram</span><span className="mono">0{active + 1} / 04</span></div>
        <div className="walkthrough-progress" aria-hidden="true"><span style={{ transform: `scaleX(${(active + 1) / steps.length})` }} /></div>
        <div className="walkthrough-stage">{steps.map((step, i) => <div className="walkthrough-scene" data-active={active === i} aria-hidden={active !== i} key={step.title}><Mechanism step={i} /></div>)}</div>
        <nav className="walkthrough-nav" aria-label="Jump to an explanation">{steps.map((step, i) => <a key={step.title} href={`#protection-step-${i + 1}`} aria-label={`${i + 1}. ${step.title}`} aria-current={active === i ? "step" : undefined}>0{i + 1}</a>)}</nav>
      </aside>
    </div>
    <a className="lp-text-link" href="#protection">Set your floor →</a>
  </section>;
}
