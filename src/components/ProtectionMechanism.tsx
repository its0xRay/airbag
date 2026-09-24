import { maxLiability, payout, fromFixed } from "../engine";
import { fmtOusd } from "../format";
import ProtectionBoundary from "./ProtectionBoundary";

/** Illustrates selected contract terms. Never supplies a quote or a settlement price. */
export default function ProtectionMechanism({ symbol, quantity, floor, reference, premium }: {
  symbol: string; quantity: bigint; floor: bigint; reference: bigint; premium: bigint;
}) {
  const gross = payout(quantity, floor, reference);
  const maximum = maxLiability(quantity, floor);
  const units = fromFixed(quantity).toLocaleString(undefined, { maximumFractionDigits: 6 });
  return <div className="protection-mechanism" aria-label={`Hypothetical protection payout for ${units} ${symbol}`}>
    <ProtectionBoundary floor={floor} reference={reference} />
    <div className="mechanism-payout"><span>Hypothetical payout</span><strong className="mono">{fmtOusd(fromFixed(gross))}</strong></div>
    <div className="mechanism-range"><span>Payout − premium <strong className="mono">{fmtOusd(fromFixed(gross - premium))}</strong></span><span>Maximum {fmtOusd(fromFixed(maximum))}</span></div>
    <p className="mechanism-disclosure">Illustrative payout. Not a quote.</p>
  </div>;
}
