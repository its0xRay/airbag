"use strict";
const { Buffer } = require("buffer");

function toBigIntBE(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected bytes");
  const hex = Buffer.from(bytes).toString("hex");
  return hex.length ? BigInt("0x" + hex) : 0n;
}
function toBigIntLE(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected bytes");
  return toBigIntBE(Buffer.from(bytes).reverse());
}
function toBufferBE(value, width) {
  if (typeof value !== "bigint") throw new TypeError("Expected bigint");
  if (!Number.isSafeInteger(width) || width < 0 || width > 1048576) throw new RangeError("Invalid byte width");
  if (value < 0n) throw new RangeError("Expected unsigned integer");
  if (width === 0) {
    if (value !== 0n) throw new RangeError("Integer does not fit byte width");
    return Buffer.alloc(0);
  }
  const hex = value.toString(16);
  if (hex.length > width * 2) throw new RangeError("Integer does not fit byte width");
  return Buffer.from(hex.padStart(width * 2, "0"), "hex");
}
function toBufferLE(value, width) { return toBufferBE(value, width).reverse(); }
module.exports = { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE };
