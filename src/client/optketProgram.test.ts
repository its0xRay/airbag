import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { decodeOptketInstruction } from "./optketProgram";

describe("Optket instruction decoding", () => {
  it("names confirmed program instructions from their Anchor discriminator", () => {
    expect(decodeOptketInstruction(bs58.encode(Uint8Array.from([21, 93, 113, 154, 193, 160, 242, 168]))))
      .toBe("Protection purchased");
    expect(decodeOptketInstruction(bs58.encode(Uint8Array.from([118, 143, 58, 243, 239, 176, 80, 103]))))
      .toBe("Exercise settled");
    expect(decodeOptketInstruction(bs58.encode(Uint8Array.from([66, 142, 159, 134, 127, 139, 75, 167]))))
      .toBe("Asset metadata updated");
    expect(decodeOptketInstruction(bs58.encode(Uint8Array.from([190, 43, 148, 248, 68, 5, 215, 136]))))
      .toBe("Pool withdrawal");
  });

  it("does not invent a label for unknown or invalid data", () => {
    expect(decodeOptketInstruction("not base58!")).toBeNull();
    expect(decodeOptketInstruction(bs58.encode(Uint8Array.from([1, 2, 3])))).toBeNull();
  });
});
