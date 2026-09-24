import { maxLiability, payout, fromFixed } from "../engine";
import { fmtOusd, fmtUsd } from "../format";
import PayoffChart from "./PayoffChart";

/** Illustrates selected contract terms. Never supplies a quote or a settlement price. */
export default function ProtectionMechanism({ symbol, quantity, floor, reference, premium }: {
  symbol: string; quantity: bigint; floor: bigint; reference: bigint; premium: bigint;
}) {
  const gross = payout(quantity, floor, reference);
  const maximum = maxLiability(quantity, floor);
  const units = fromFixed(quantity).toLocaleString(undefined, { maximumFractionDigits: 6 });
  const floorPrice = fromFixed(floor);
  const recoveryPrice = quantity > 0n ? floorPrice - fromFixed(premium) / fromFixed(quantity) : -1;
  const chartMax = Math.max(floorPrice * 1.25, fromFixed(reference) * 1.1, 1);
  const points = [
    { value: 0, net: fromFixed(maximum - premium) },
    { value: floorPrice, net: -fromFixed(premium) },
    { value: chartMax, net: -fromFixed(premium) },
  ];
  const scale = Math.max(1, ...points.map(point => Math.abs(point.net)));
  return <div className="protection-mechanism" aria-label={`Hypothetical protection payout for ${units} ${symbol}`}>
    <div className="scenario-gross"><span>Contract payout</span><strong className="mono">{fmtOusd(fromFixed(gross))}</strong></div>
    <div className="mechanism-outcomes"><div><span>Estimated premium</span><strong className="mono">{fmtOusd(fromFixed(premium))}</strong></div><div><span>Payout minus premium</span><strong className="mono">{fmtOusd(fromFixed(gross - premium))}</strong></div></div>
    <p className="premium-recovery">{recoveryPrice > 0 ? <>Payout covers premium below <strong className="mono">{fmtUsd(recoveryPrice)}</strong></> : recoveryPrice === 0 ? "Payout covers premium only at a zero reference." : "Premium exceeds the maximum contract payout."}</p>
    <PayoffChart points={points} min={0} max={chartMax} floor={floorPrice} breakeven={recoveryPrice} price={fromFixed(reference)} net={fromFixed(gross - premium)} scale={scale} />
    <div className="mechanism-range"><span>Maximum payout {fmtOusd(fromFixed(maximum))}</span></div>
    <p className="mechanism-disclosure">Payout scenario · not a quote</p>
  </div>;
}
