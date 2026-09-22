import { maxLiability, payout, fromFixed } from "../engine";
import { fmtOusd, fmtPrice } from "../format";

/** Illustrates selected contract terms. Never supplies a quote or a settlement price. */
export default function ProtectionMechanism({ symbol, quantity, floor, reference, premium }: {
  symbol: string; quantity: bigint; floor: bigint; reference: bigint; premium: bigint;
}) {
  const gross = payout(quantity, floor, reference);
  const maximum = maxLiability(quantity, floor);
  const fraction = maximum > 0n ? Math.min(1, fromFixed(gross) / fromFixed(maximum)) : 0;
  const units = fromFixed(quantity).toLocaleString(undefined, { maximumFractionDigits: 6 });
  return <div className="protection-mechanism" aria-label="Hypothetical protection payout">
    <div className="mechanism-ownership"><span>Your tokens stay in your wallet</span><strong className="mono">{units} {symbol} protected</strong></div>
    <div className="mechanism-equation">
      <div><span>Your floor</span><strong className="mono">{fmtPrice(floor)}</strong></div>
      <span className="mechanism-minus" aria-hidden="true">−</span>
      <div><span>Hypothetical reference</span><strong className="mono">{fmtPrice(reference)}</strong></div>
    </div>
    <p className="mechanism-rule">{reference < floor ? "The difference below your floor × protected quantity." : "At or above your floor, the protection pays zero."}</p>
    <div className="mechanism-payout"><span>Hypothetical payout</span><strong className="mono">{fmtOusd(fromFixed(gross))}</strong></div>
    <div className="mechanism-capacity" aria-hidden="true"><span style={{ transform: `scaleX(${fraction})` }} /></div>
    <div className="mechanism-range"><span>0 oUSD</span><span>Maximum {fmtOusd(fromFixed(maximum))}</span></div>
    <div className="mechanism-cost"><span>Estimated premium <strong className="mono">{fmtOusd(fromFixed(premium))}</strong></span><span>Payout − premium <strong className="mono">{fmtOusd(fromFixed(gross - premium))}</strong></span></div>
    <p className="mechanism-disclosure">Illustration, not a quote or settlement. oUSD has no real value.</p>
  </div>;
}
