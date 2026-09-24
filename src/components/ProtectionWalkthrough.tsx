import { useEffect, useRef, useState } from "react";
import AssetLogo from "./AssetLogo";
import { VERIFIED_ASSETS } from "../data/assets";
import "./ProtectionWalkthrough.css";

const buyerSteps = [
  { title: "Choose", heading: "Set your floor.", body: "Choose an asset, quantity, floor and expiry. Explore payouts before connecting." },
  { title: "Pay once", heading: "One premium upfront.", body: "Review the cost. A fresh signed quote is checked before purchase, and the maximum payout is reserved." },
  { title: "Keep holding", heading: "Your tokens stay with you.", body: "Your position is a separate contract. No buyer margin calls or token deposit." },
  { title: "Settle", heading: "Below your floor? The contract pays the difference.", body: "Payout uses the settlement reference and covered quantity. Request early exercise before the cutoff, or settle automatically at expiry." },
] as const;
const vaultSteps = [
  { title: "Deposit", heading: "Choose the risk you fund.", body: "Pick an asset vault and deposit during its funding window. You can cancel before it closes." },
  { title: "Back payouts", heading: "Your capital goes to work.", body: "Capital locks while the round backs positions. Premiums add to the balance; payouts and refunds reduce it." },
  { title: "Withdraw", heading: "Your share, after settlement.", body: "Withdraw your share of the remaining balance after every obligation resolves. Your deposit can lose value; delays can extend the lock." },
] as const;
const mobileBuyerSteps = [
  { title: "Choose", body: "Pick an asset, quantity, floor and expiry." },
  { title: "Pay once", body: "Review the premium. Your tokens stay with you." },
  { title: "Settle", body: "Below the floor, payout is the reference-price difference × covered quantity. Early exercise is available before the cutoff." },
] as const;

function Mechanism({ step, side = "buyer" }: { step: number; side?: "buyer" | "vault" }) {
  if (side === "vault") return <div className="mechanism">
    <div className="mechanism-flow"><span>{step === 0 ? "Your test oUSD" : step === 1 ? "Asset-specific vault" : "Round obligations settled"}</span><span className="mechanism-arrow" aria-hidden="true">↓</span><strong>{step === 0 ? "Deposit into a funding round" : step === 1 ? "Capital reserved for buyer payouts" : "Withdraw your share"}</strong></div>
    <div className="mechanism-reserve"><span className="mechanism-label">{step === 0 ? "Before funding closes" : step === 1 ? "Round balance" : "Withdrawal value"}</span><strong>{step === 0 ? "Add or cancel your deposit" : step === 1 ? "Deposits + premiums − payouts − refunds" : "Ownership share × remaining balance"}</strong></div>
    <p>{step === 0 ? "oUSD has no real value." : step === 1 ? "Premiums are not guaranteed profit." : "Capital can lose value. Settlement delays can extend the lock."}</p>
  </div>;
  return <div className="mechanism">
    {step === 0 && <>
      <div className="mechanism-assets">{VERIFIED_ASSETS.map(asset => <span key={asset.key}><AssetLogo asset={asset} />{asset.symbol}</span>)}</div>
      <div className="mechanism-contract"><span className="mechanism-label">Your contract terms</span><div className="mechanism-terms"><span>Asset</span><span>Quantity</span><span>Price floor</span><span>Expiry</span></div></div>
      <p>Choose what to protect. Define the floor.</p>
    </>}
    {step === 1 && <>
      <div className="mechanism-flow"><span>One premium</span><span className="mechanism-arrow" aria-hidden="true">↓</span><strong>Protection contract</strong></div>
      <div className="mechanism-reserve"><span className="mechanism-label">Pool collateral</span><strong>Maximum payout reserved</strong><div className="mechanism-reserve-line" aria-hidden="true" /></div>
      <p>The pool supplies the reserve. No buyer margin.</p>
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

export default function ProtectionWalkthrough({ side = "buyer", vaultsEnabled = false, onSideChange }: { side?: "buyer" | "vault"; vaultsEnabled?: boolean; onSideChange?: (side: "buyer" | "vault") => void }) {
  const steps = side === "vault" ? vaultSteps : buyerSteps;
  const mobileSteps = side === "vault" ? vaultSteps : mobileBuyerSteps;
  const [active, setActive] = useState(0);
  const articles = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (window.innerWidth <= 800) return;
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
  }, [side]);
  const visibleActive = Math.min(active, steps.length - 1);

  return <section className="lp-section" id="how-it-works">
    <div className="lp-section-head"><div className="lp-eyebrow">How it works</div><h2 className="lp-h2">{side === "vault" ? "Deposit. Back payouts. Withdraw." : "Choose. Pay once. Keep holding."}</h2></div>
    {vaultsEnabled && <div className="walkthrough-sides" role="group" aria-label="Choose a walkthrough"><button className="btn ghost" aria-pressed={side === "buyer"} onClick={() => onSideChange?.("buyer")}>For holders</button><button className="btn ghost" aria-pressed={side === "vault"} onClick={() => onSideChange?.("vault")}>For depositors</button></div>}
    <div className="walkthrough-mobile"><ol>{mobileSteps.map((step, i) => <li key={step.title}><span className="mono" aria-hidden="true">0{i + 1}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>)}</ol><details className="secondary-tool" key={side}><summary>See the mechanics</summary><Mechanism step={side === "vault" ? 2 : 3} side={side} /></details></div>
    <div className="walkthrough">
      <div className="walkthrough-stories">
        {steps.map((step, i) => <article className="walkthrough-step" data-active={visibleActive === i} id={`protection-step-${i + 1}`} key={`${side}-${step.title}`} ref={element => { articles.current[i] = element; }}>
          <div className="walkthrough-step-label"><span className="mono">0{i + 1}</span><span>{step.title}</span></div>
          <h3>{step.heading}</h3><p>{step.body}</p>
        </article>)}
      </div>
      <aside className="walkthrough-visual" aria-label="Protection mechanism diagrams">
        <div className="walkthrough-visual-head"><span className="mono">0{visibleActive + 1} / 0{steps.length}</span></div>
        <div className="walkthrough-progress" aria-hidden="true"><span style={{ transform: `scaleX(${(visibleActive + 1) / steps.length})` }} /></div>
        <div className="walkthrough-stage">{steps.map((step, i) => <div className="walkthrough-scene" data-active={visibleActive === i} aria-hidden={visibleActive !== i} key={step.title}><Mechanism step={i} side={side} /></div>)}</div>
        <nav className="walkthrough-nav" aria-label="Jump to an explanation">{steps.map((step, i) => <a key={step.title} href={`#protection-step-${i + 1}`} aria-label={`${i + 1}. ${step.title}`} aria-current={visibleActive === i ? "step" : undefined}>0{i + 1}</a>)}</nav>
      </aside>
    </div>
  </section>;
}
