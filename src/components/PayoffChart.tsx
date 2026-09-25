import { fmtUsd, fmtOusd } from "../format";

/** One coordinate space for the curve, markers and axis labels. */
export default function PayoffChart({ points, min, max, floor, breakeven, price, net, scale }: {
  points: { value: number; net: number }[]; min: number; max: number;
  floor: number; breakeven: number; price: number; net: number; scale: number;
}) {
  const x = (value: number) => 90 + Math.max(0, Math.min(1, (value - min) / Math.max(0.01, max - min))) * 440;
  const y = (value: number) => 116 - value / scale * 76;
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
