import { describe, expect, it } from "vitest";
import { checkPurchaseLimit, QUOTE_PAYLOAD_LEN, serializeQuotePayload } from "../quote";

describe("signed purchase approval", () => {
  const message = (premium: bigint, fees = 0n) => {
    const bytes = new Uint8Array(QUOTE_PAYLOAD_LEN);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(63, premium, true);
    view.setBigUint64(71, fees, true);
    return bytes;
  };
  it("allows equal and lower prices", () => {
    expect(checkPurchaseLimit(message(80n), 80n)).toBe(80n);
    expect(checkPurchaseLimit(message(79n), 80n)).toBe(79n);
  });
  it("blocks increased cost including fees", () => {
    expect(() => checkPurchaseLimit(message(81n), 80n)).toThrow("exceeds");
    expect(() => checkPurchaseLimit(message(80n, 1n), 80n)).toThrow("exceeds");
  });
  it("rejects malformed payloads and invalid approval", () => {
    expect(() => checkPurchaseLimit(new Uint8Array(94), 80n)).toThrow();
    expect(() => checkPurchaseLimit(message(80n), -1n)).toThrow();
  });
  it("reads the canonical serialized quote layout", () => {
    const bytes = serializeQuotePayload({ buyer: "test", assetId: 1, seriesId: 2, quantity: 1_000_000n, strike: 1_100_000_000n, expiryTs: 123, referenceVersion: 1, premium: 80_000_000n, fees: 1_000_000n, quoteId: 9n, quoteExpiryTs: 100 }, new Uint8Array(32));
    expect(checkPurchaseLimit(bytes, 81_000_000n)).toBe(80_000_000n);
    expect(() => checkPurchaseLimit(bytes, 80_000_000n)).toThrow("exceeds");
  });
});
