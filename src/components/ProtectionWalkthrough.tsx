import { useEffect, useRef, useState } from "react";
import AssetLogo from "./AssetLogo";
import { VERIFIED_ASSETS } from "../data/assets";
import "./ProtectionWalkthrough.css";
import { walkthroughStep } from "../client/walkthroughStep";
import { fromFixed, payout, maxLiability } from "../engine";
import { fmtOusd, fmtUsd, fmtClock } from "../format";

export type WalkthroughExample = { assetId: number; quantity: bigint; floor: bigint; expiry: number; premium: bigint; reference: bigint };

const buyerSteps = [
  { title: "Choose", heading: "Set your floor.", body: "Choose your token, floor and expiry." },
  { title: "Pay once", heading: "One premium upfront.", body: "Review the premium and confirm." },
  { title: "Keep holding", heading: "Your tokens stay with you.", body: "Your tokens stay in your wallet." },
  { title: "Settle", heading: "Below your floor? The contract pays the difference.", body: "Below the floor? Receive the difference for your covered quantity." },
] as const;
const vaultSteps = [
  { title: "Deposit", heading: "Choose the risk you fund.", body: "Pick an asset vault and deposit during its funding window. You can cancel before it closes." },
  { title: "Back payouts", heading: "Your capital goes to work.", body: "Capital locks while the round backs positions. Premiums add to the balance; payouts and refunds reduce it." },
  { title: "Withdraw", heading: "Your share, after settlement.", body: "Withdraw your share of the remaining balance after every obligation resolves." },
] as const;
const mobileBuyerSteps = [
  { title: "Choose", body: "Choose your token, floor and expiry." },
  { title: "Pay once", body: "Review the premium. Your tokens stay with you." },
  { title: "Settle", body: "Below the floor? Receive the difference for your covered quantity." },
] as const;

const mobileVaultSteps = [
  { title: "Deposit", body: "Choose a vault and deposit before funding closes." },
  { title: "Back payouts", body: "Locked capital funds payouts." },
  { title: "Withdraw", body: "Withdraw your remaining share after settlement." },
] as const;

function Mechanism({ step, side = "buyer", example }: { step: number; side?: "buyer" | "vault"; example?: WalkthroughExample | null }) {
  if (side === "vault") return <div className="mechanism">
    <div className="mechanism-flow"><span>{step === 0 ? "Your test oUSD" : step === 1 ? "Asset-specific vault" : "Round obligations settled"}</span><span className="mechanism-arrow" aria-hidden="true">↓</span><strong>{step === 0 ? "Deposit into a funding round" : step === 1 ? "Capital reserved for buyer payouts" : "Withdraw your share"}</strong></div>
    <div className="mechanism-reserve"><span className="mechanism-label">{step === 0 ? "Before funding closes" : step === 1 ? "Round balance" : "Withdrawal value"}</span><strong>{step === 0 ? "Add or cancel your deposit" : step === 1 ? "Deposits + premiums − payouts − refunds" : "Ownership share × remaining balance"}</strong></div>
  </div>;
  if (!example) return <div className="mechanism"><p>Choose available terms above to explore the mechanics.</p></div>;
  const asset = VERIFIED_ASSETS[example.assetId];
  const label = example.assetId === 0 ? "NVDAx" : "Anthropic PreStocks";
  const quantity = fromFixed(example.quantity);
  const floor = fmtUsd(fromFixed(example.floor));
  const gross = payout(example.quantity, example.floor, example.reference);
  return <div className="mechanism">
    {step === 0 && <>
      <div className="mechanism-assets"><span><AssetLogo asset={asset} />{label}</span></div>
      <div className="mechanism-contract"><span className="mechanism-label">Selected terms</span><div className="mechanism-terms"><span>Asset<strong>{label}</strong></span><span>Quantity<strong>{quantity} tokens</strong></span><span>Price floor<strong>{floor}</strong></span><span>Expiry<strong>{fmtClock(example.expiry)}</strong></span></div></div>
      <p>Choose what to protect. Define the floor.</p>
    </>}
    {step === 1 && <>
      <div className="mechanism-flow"><span>Estimated premium · {fmtOusd(fromFixed(example.premium))}</span><span className="mechanism-arrow" aria-hidden="true">↓</span><strong>Protection contract</strong></div>
      <div className="mechanism-reserve"><span className="mechanism-label">Collateral reserved at purchase</span><strong>{fmtOusd(fromFixed(maxLiability(example.quantity, example.floor)))}</strong><div className="mechanism-reserve-line" aria-hidden="true" /></div>
      <p>The pool supplies the reserve. No buyer margin.</p>
    </>}
    {step === 2 && <>
      <div className="mechanism-hold"><div className="mechanism-wallet"><span className="mechanism-label">Your wallet</span><div className="mechanism-assets"><AssetLogo asset={asset} /></div><strong>Your tokens</strong></div><span className="mechanism-plus" aria-hidden="true">+</span><div className="mechanism-separate"><span className="mechanism-label">Selected coverage</span><strong>{quantity} {label} · {floor} floor</strong></div></div>
      <p>No underlying deposit into Airbag.</p>
    </>}
    {step === 3 && <>
      <div className="mechanism-flow"><span>Hypothetical settlement reference · {fmtUsd(fromFixed(example.reference))}</span><span className="mechanism-arrow" aria-hidden="true">↓</span><div className="mechanism-formula"><span className="mechanism-label">Payout</span><strong>{quantity} × max({floor} − {fmtUsd(fromFixed(example.reference))}, 0) = {fmtOusd(fromFixed(gross))}</strong></div><span className="mechanism-arrow" aria-hidden="true">↓</span><span>Payout minus premium: {fmtOusd(fromFixed(gross - example.premium))}</span></div>
    </>}
  </div>;
}

export default function ProtectionWalkthrough({ side = "buyer", vaultsEnabled = false, onSideChange, example }: { side?: "buyer" | "vault"; vaultsEnabled?: boolean; onSideChange?: (side: "buyer" | "vault") => void; example?: WalkthroughExample | null }) {
  const steps = side === "vault" ? vaultSteps : buyerSteps;
  const mobileSteps = side === "vault" ? mobileVaultSteps : mobileBuyerSteps;
  const [active, setActive] = useState(0);
  const articles = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (window.innerWidth <= 800) return;
      // Derive from current positions, including reverse scroll and anchor jumps.
      // Only the diagram changes; reading content stays in the normal document flow.
      setActive(walkthroughStep(articles.current.slice(0, steps.length).map(article => article?.getBoundingClientRect().top ?? Infinity), window.innerHeight));
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
  }, [side, steps.length]);
  const visibleActive = Math.min(active, steps.length - 1);

  return <section className="lp-section lp-light" id="how-it-works">
    <div className="lp-section-head"><div className="lp-eyebrow">How it works</div><h2 className="lp-h2">{side === "vault" ? "From deposit to withdrawal." : "From choosing a floor to receiving a payout."}</h2></div>
    {vaultsEnabled && <div className="walkthrough-sides" role="group" aria-label="Choose a walkthrough"><button className="btn ghost" aria-pressed={side === "buyer"} onClick={() => onSideChange?.("buyer")}>For holders</button><button className="btn ghost" aria-pressed={side === "vault"} onClick={() => onSideChange?.("vault")}>For depositors</button></div>}
    <div className="walkthrough-mobile"><ol>{mobileSteps.map((step, i) => <li key={step.title}><span className="mono" aria-hidden="true">0{i + 1}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>)}</ol><details className="secondary-tool" key={side}><summary>See the mechanics</summary><Mechanism step={side === "vault" ? 2 : 3} side={side} example={example} /><p>{side === "vault" ? "Cancel before funding closes. Afterward, funds stay locked until settlement completes." : "Early exercise must be requested before the cutoff. Settlement uses qualifying observations; unavailable references follow the contract’s recovery or refund rules."}</p></details></div>
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
        <div className="walkthrough-stage">{steps.map((step, i) => <div className="walkthrough-scene" data-active={visibleActive === i} aria-hidden={visibleActive !== i} key={step.title}><Mechanism step={i} side={side} example={example} /></div>)}</div>
        <nav className="walkthrough-nav" aria-label="Jump to an explanation">{steps.map((step, i) => <a key={step.title} href={`#protection-step-${i + 1}`} aria-label={`${i + 1}. ${step.title}`} aria-current={visibleActive === i ? "step" : undefined}>0{i + 1}</a>)}</nav>
      </aside>
    </div>
  </section>;
}
