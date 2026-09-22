import { fmtUsd } from "../format";

/** One coordinate space for the curve, markers and axis labels. */
export default function PayoffChart({ points, min, max, floor, breakeven, price, net, scale }: {
  points: { value: number; net: number }[]; min: number; max: number;
  floor: number; breakeven: number; price: number; net: number; scale: number;
}) {
  const x = (value: number) => 36 + Math.max(0, Math.min(1, (value - min) / Math.max(0.01, max - min))) * 528;
  const y = (value: number) => 116 - value / scale * 76;
  return <div className="payoff-chart unified-payoff"><svg viewBox="0 0 600 270" role="img" aria-label="Protection payout minus premium in oUSD, across settlement prices in USD">
    <title>Protection contract only; excludes changes in token holdings</title>
    <line className="zero" x1="36" x2="564" y1="116" y2="116" />
    <text x="28" y="120" textAnchor="end">0</text>
    <text x="36" y="16">Net · oUSD</text>
    <line className="marker floor" x1={x(floor)} x2={x(floor)} y1="30" y2="198" />
    <line className="marker breakeven" x1={x(breakeven)} x2={x(breakeven)} y1="30" y2="198" />
    <text x={x(floor)} y="26" textAnchor="middle">Floor</text>
    <text x={x(breakeven)} y="212" textAnchor="middle">Breakeven</text>
    <polyline points={points.map(p => `${x(p.value)},${y(p.net)}`).join(" ")} />
    <circle cx={x(price)} cy={y(net)} r="4" fill="var(--text)" />
    <text x="36" y="258">{fmtUsd(min)}</text><text x="564" y="258" textAnchor="end">{fmtUsd(max)}</text>
  </svg></div>;
}
