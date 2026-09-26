import { describe, expect, it } from "vitest";
import { parseContractAmount, contractAmountText } from "./customFloor";
describe("exact custom contract inputs", () => {
  it.each(["850", "850.123456", "0.000001", "10000"])("round-trips %s without rounding", text => {
    expect(contractAmountText(parseContractAmount(text)!)).toBe(text);
  });
  it.each(["", "0", "-850", "1e3", "850.1234567", "NaN", "Infinity", "1,000", "18446744073710"])("rejects %s without substitution", text => {
    expect(parseContractAmount(text)).toBeNull();
  });
});
