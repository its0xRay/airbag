import { fromFixed } from "./engine";

export function fmtTokens(v: bigint, dp = 2): string {
  return fromFixed(v).toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp });
}

export function fmtQty(v: bigint, dp = 4): string {
  const n = fromFixed(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}

export function fmtPrice(v: bigint, dp = 2): string {
  return "$" + fromFixed(v).toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp });
}

export function fmtUsd(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "--";
  const clean = Math.abs(n) < 0.5 * 10 ** -dp ? 0 : n;
  return "$" + clean.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });
}

/** Demo settlement-token accounting. Never imply that oUSD is real USD. */
export function fmtOusd(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "--";
  const clean = Math.abs(n) < 0.5 * 10 ** -dp ? 0 : n;
  const sign = clean < 0 ? "−" : "";
  return `${sign}${Math.abs(clean).toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp })} oUSD`;
}

export function fmtPct(n: number, dp = 1): string {
  return (n * 100).toFixed(dp) + "%";
}

export function fmtDuration(secs: number): string {
  if (secs <= 0) return "expired";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtClock(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
