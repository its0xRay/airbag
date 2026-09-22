import { describe, expect, it } from "vitest";
import { decodeExpiryEvents } from "./expiryEvent";
const program = "OptketProgram";
function event(invalid = false) {
  const data = new Uint8Array(57);
  data.set([184, 63, 110, 38, 72, 43, 149, 107]);
  const view = new DataView(data.buffer);
  [32n, 60000n, 1038000000n, 3720000n, 0n].forEach((n, i) => view.setBigUint64(8 + i * 8, n, true));
  data[48] = invalid ? 1 : 0;
  view.setBigInt64(49, 1800000000n, true);
  return `Program data: ${btoa(String.fromCharCode(...data))}`;
}
describe("expiry receipt evidence", () => {
  it("decodes the actual Anchor layout", () => {
    expect(decodeExpiryEvents([`Program ${program} invoke [1]`, event(), `Program ${program} success`], program, false)[0])
      .toEqual({ contractId: 32n, quantity: 60000n, settlementReference: 1038000000n,
        payout: 3720000n, refundedPremium: 0n, invalidReference: false, timestamp: 1800000000 });
  });
  it("retains the invalid-reference flag", () => {
    expect(decodeExpiryEvents([`Program ${program} invoke [1]`, event(true), `Program ${program} success`], program, false)[0].invalidReference).toBe(true);
  });
  it("rejects failed transactions, foreign programs and nested spoofed logs", () => {
    const logs = [`Program ${program} invoke [1]`, event(), `Program ${program} success`];
    expect(decodeExpiryEvents(logs, program, true)).toEqual([]);
    expect(decodeExpiryEvents(logs, "OtherProgram", false)).toEqual([]);
    expect(decodeExpiryEvents([`Program ${program} invoke [1]`, "Program Foreign invoke [2]", event(), "Program Foreign success", `Program ${program} success`], program, false)).toEqual([]);
  });
  it("rejects truncated evidence and malformed binary data", () => {
    expect(decodeExpiryEvents([`Program ${program} invoke [1]`, event()], program, false)).toEqual([]);
    expect(decodeExpiryEvents([`Program ${program} invoke [1]`, "Program data: !!!", `Program ${program} success`], program, false)).toEqual([]);
  });
});
