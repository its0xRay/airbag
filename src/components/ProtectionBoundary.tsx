import { fromFixed } from "../engine";
import { fmtPrice } from "../format";

/** Contract terms, not a price chart. A scenario marker is only shown when explicitly supplied. */
export default function ProtectionBoundary({ floor, reference, compact = false }: {
  floor: bigint; reference?: bigint; compact?: boolean;
}) {
  const ceiling = Math.max(fromFixed(floor) * 1.5, reference === undefined ? 0 : fromFixed(reference) * 1.1, 1);
  const x = (value: bigint) => 16 + Math.max(0, Math.min(1, fromFixed(value) / ceiling)) * 568;
  const floorX = x(floor);
  return <div className={"protection-boundary" + (compact ? " boundary-compact" : "")}>
    <div className="boundary-caption"><span>Contract price floor</span><strong className="mono">{fmtPrice(floor)}</strong></div>
    {!compact && <svg viewBox="0 0 600 84" role="img" aria-label={`Settlement reference axis starts at zero. Below the ${fmtPrice(floor)} floor, payout increases as the reference falls. At or above it, payout is zero.${reference === undefined ? " No settlement reference shown." : ` Hypothetical reference ${fmtPrice(reference)}.`}`}>
      <rect className="boundary-region" x="16" y="28" width={floorX - 16} height="40" rx="4" />
      <path className="boundary-axis" d="M16 68H584" />
      <path className="boundary-floor" d={`M${floorX} 12V84`} />
      {reference !== undefined && <>
        {reference < floor && <path className="boundary-gap" d={`M${x(reference)} 48H${floorX}`} />}
        <circle className="boundary-reference" cx={x(reference)} cy="68" r="6" />
      </>}
    </svg>}
    <div className="boundary-zones"><span>Below floor · difference × quantity</span><span>At or above · zero payout</span></div>
  </div>;
}
