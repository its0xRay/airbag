import { maxLiability, payout, fromFixed } from "../engine";
import { fmtOusd, fmtUsd } from "../format";
import PayoffChart from "./PayoffChart";

/** Illustrates selected contract terms. Never supplies a quote or a settlement price. */
export default function ProtectionMechanism({ symbol, quantity, floor, reference, premium, hidePremium = false, narrative = false, priceRange }: {
  symbol: string; quantity: bigint; floor: bigint; reference: bigint; premium: bigint; hidePremium?: boolean; narrative?: boolean; priceRange?: { min: number; max: number };
}) {
  const gross = payout(quantity, floor, reference);
  const maximum = maxLiability(quantity, floor);
  const units = fromFixed(quantity).toLocaleString(undefined, { maximumFractionDigits: 6 });
  const floorPrice = fromFixed(floor);
  const recoveryPrice = quantity > 0n ? floorPrice - fromFixed(premium) / fromFixed(quantity) : -1;
  const chartMax = priceRange?.max ?? Math.max(floorPrice * 1.25, fromFixed(reference) * 1.1, 1);
  const chartMin = priceRange?.min ?? Math.max(0, Math.min(floorPrice * .7, fromFixed(reference) * .9, recoveryPrice > 0 ? recoveryPrice * .9 : floorPrice * .7));
  const points = [
    { value: chartMin, net: fromFixed(quantity) * (floorPrice - chartMin) - fromFixed(premium) },
    { value: floorPrice, net: -fromFixed(premium) },
    { value: chartMax, net: -fromFixed(premium) },
  ];
  const scale = Math.max(1, ...points.map(point => Math.abs(point.net)));
  return <div className="protection-mechanism" aria-label={`Hypothetical protection payout for ${units} ${symbol}`}>
    {narrative ? <div className="scenario-narrative"><p>At a settlement reference of <strong className="mono">{fmtUsd(fromFixed(reference))}</strong>, your payout is <strong className="mono">{fmtOusd(fromFixed(gross))}</strong>.</p><span>Payout minus estimated premium: <strong className="mono">{fmtOusd(fromFixed(gross - premium))}</strong></span></div> : <><div className="scenario-gross"><span>Payout</span><strong className="mono">{fmtOusd(fromFixed(gross))}</strong></div>
    <div className="mechanism-outcomes">{!hidePremium && <div><span>Estimated premium</span><strong className="mono">{fmtOusd(fromFixed(premium))}</strong></div>}<div><span>Payout minus premium</span><strong className="mono">{fmtOusd(fromFixed(gross - premium))}</strong></div></div></>}
    <p className="premium-recovery">{recoveryPrice > 0 ? <>Break-even reference: <strong className="mono">{fmtUsd(recoveryPrice)}</strong></> : recoveryPrice === 0 ? "Payout covers premium only at a zero reference." : "Premium exceeds the maximum contract payout."}</p>
    <PayoffChart compact={narrative} points={points} min={chartMin} max={chartMax} floor={floorPrice} breakeven={recoveryPrice} price={fromFixed(reference)} net={fromFixed(gross - premium)} scale={scale} />
    <div className="mechanism-range"><span>Maximum payout {fmtOusd(fromFixed(maximum))}</span></div>
    <p className="mechanism-disclosure">Payout scenario · not a quote</p>
  </div>;
}
