import { fmtUsd, fmtOusd } from "../format";

/** One coordinate space for the curve, markers and axis labels. */
export default function PayoffChart({ points, min, max, floor, breakeven, price, net, scale, compact = false }: {
  points: { value: number; net: number }[]; min: number; max: number;
  floor: number; breakeven: number; price: number; net: number; scale: number; compact?: boolean;
}) {
  const x = (value: number) => 90 + Math.max(0, Math.min(1, (value - min) / Math.max(0.01, max - min))) * 440;
  const y = (value: number) => 116 - value / scale * 76;
  if (compact) {
    const cx = (v: number) => 8 + Math.max(0, Math.min(1, (v - min) / Math.max(.01, max - min))) * 544;
    const low = Math.min(...points.map(p => p.net), 0);
    const high = Math.max(...points.map(p => p.net), 1);
    const cy = (v: number) => 24 + (high - v) / (high - low) * 50;
    return <div className="payoff-chart hero-payoff"><svg viewBox="0 0 560 100" role="img" aria-label={`Contract payout minus premium. Floor ${fmtUsd(floor)}, break-even ${fmtUsd(breakeven)}. At ${fmtUsd(price)}: ${fmtOusd(net)}. Excludes token holdings.`}>
      <line className="zero" x1="8" x2="552" y1={cy(0)} y2={cy(0)} />
      <line className="marker floor" x1={cx(floor)} x2={cx(floor)} y1="20" y2="80" />
      <text x={cx(floor)} y="14" textAnchor="middle">Floor {fmtUsd(floor)}</text>
      <polyline points={points.map(p => `${cx(p.value)},${cy(p.net)}`).join(" ")} />
      <circle cx={cx(price)} cy={cy(net)} r="4" fill="var(--text)" />
      <text x="8" y="96">{fmtUsd(min)}</text><text x="280" y="96" textAnchor="middle">{breakeven >= 0 ? `Break-even ${fmtUsd(breakeven)}` : "Premium exceeds max payout"}</text><text x="552" y="96" textAnchor="end">{fmtUsd(max)}</text>
    </svg><div className="mobile-payoff-labels" aria-hidden="true"><span>Floor {fmtUsd(floor)}</span><span>{breakeven >= 0 ? `Break-even ${fmtUsd(breakeven)}` : "Premium exceeds max payout"}</span><span>{fmtUsd(min)}</span><span>{fmtUsd(max)}</span></div></div>;
  }
  return <div className="payoff-chart unified-payoff"><div className="payoff-axis-title">Payout minus premium · oUSD</div><svg viewBox="0 0 600 220" role="img" aria-label={`Payout minus premium across settlement references. Floor ${fmtUsd(floor)}. Hypothetical reference ${fmtUsd(price)}. At or above the floor: zero payout, minus the premium.`}>
    <title>Protection contract only; excludes changes in token holdings</title>
    <line className="zero" x1="90" x2="530" y1="116" y2="116" />
    <text x="82" y="120" textAnchor="end">0</text>
    <text x="82" y="44" textAnchor="end">{fmtOusd(scale).replace(" oUSD", "")}</text>
    <text x="82" y="196" textAnchor="end">{fmtOusd(-scale).replace(" oUSD", "")}</text>
    <line className="marker floor" x1={x(floor)} x2={x(floor)} y1="30" y2="198" />
    {breakeven >= min && breakeven <= max && <line className="marker breakeven" x1={x(breakeven)} x2={x(breakeven)} y1="30" y2="198" />}
    <text x={x(floor)} y="26" textAnchor="middle">Floor</text>
    {breakeven >= min && breakeven <= max && <text x={x(breakeven)} y="214" textAnchor="middle">Break-even</text>}
    <polyline points={points.map(p => `${x(p.value)},${y(p.net)}`).join(" ")} />
    <circle cx={x(price)} cy={y(net)} r="4" fill="var(--text)" />
  </svg><div className="payoff-axis-values mono"><span>{fmtUsd(min)}</span><span>{fmtUsd(max)}</span></div><div className="payoff-axis-title">Settlement reference · USD</div></div>;
}
