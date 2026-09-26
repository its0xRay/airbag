/** Exact six-decimal inputs. Never silently round or substitute a user's floor. */
export function parseContractAmount(text: string): bigint | null {
  if (!/^\d+(?:\.\d{0,6})?$/.test(text) || text.length > 24) return null;
  const [whole, fraction = ""] = text.split(".");
  const value = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return value > 0n && value <= 18_446_744_073_709_551_615n ? value : null;
}
export function contractAmountText(value: bigint): string {
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${value / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}
