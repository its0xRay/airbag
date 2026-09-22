export interface ExpiryEvent {
  contractId: bigint;
  quantity: bigint;
  settlementReference: bigint;
  payout: bigint;
  refundedPremium: bigint;
  invalidReference: boolean;
  timestamp: number;
}
const DISCRIMINATOR = [184, 63, 110, 38, 72, 43, 149, 107];

/** Only trust events logged while the expected program is executing. */
export function decodeExpiryEvents(logs: string[], program: string, transactionFailed: boolean): ExpiryEvent[] {
  if (transactionFailed) return [];
  const stack: string[] = [];
  const events: ExpiryEvent[] = [];
  for (const log of logs) {
    const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(log);
    if (invoke) {
      if (Number(invoke[2]) !== stack.length + 1) return [];
      stack.push(invoke[1]);
      continue;
    }
    const exit = /^Program (\w+) (success|failed:.*)$/.exec(log);
    if (exit) {
      if (stack.pop() !== exit[1]) return [];
      continue;
    }
    if (stack.at(-1) !== program || !log.startsWith("Program data: ")) continue;
    try {
      const bytes = Uint8Array.from(atob(log.slice(14)), c => c.charCodeAt(0));
      if (bytes.length !== 57 || DISCRIMINATOR.some((byte, i) => bytes[i] !== byte) || bytes[48] > 1) continue;
      const data = new DataView(bytes.buffer);
      const timestamp = Number(data.getBigInt64(49, true));
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) continue;
      events.push({ contractId: data.getBigUint64(8, true), quantity: data.getBigUint64(16, true),
        settlementReference: data.getBigUint64(24, true), payout: data.getBigUint64(32, true),
        refundedPremium: data.getBigUint64(40, true), invalidReference: bytes[48] === 1, timestamp });
    } catch { /* Unknown or truncated logs are not settlement evidence. */ }
  }
  return stack.length === 0 ? events : [];
}
