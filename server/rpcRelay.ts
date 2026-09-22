import { PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

type RpcRequest = { jsonrpc: "2.0"; id: string | number; method: string; params: unknown[] };
function address(value: unknown): string {
  if (typeof value !== "string") throw new Error("Address required");
  return new PublicKey(value).toBase58();
}
function signature(value: unknown): string {
  if (typeof value !== "string" || value.length > 90 || bs58.decode(value).length !== 64) throw new Error("Invalid signature");
  return value;
}
/** Rebuild allowed params rather than forwarding arbitrary provider options. */
export function validateRpcRequest(input: unknown, program: string): RpcRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("RPC batches are not supported");
  const request = input as Record<string, unknown>;
  if (request.jsonrpc !== "2.0" || !["string", "number"].includes(typeof request.id)
    || String(request.id).length > 80 || typeof request.method !== "string" || !Array.isArray(request.params)) throw new Error("Invalid RPC request");
  const p = request.params;
  const config = p.at(-1) && typeof p.at(-1) === "object" ? p.at(-1) as Record<string, unknown> : {};
  const commitment = config.commitment === "finalized" ? "finalized" : "confirmed";
  let params: unknown[];
  switch (request.method) {
    case "getGenesisHash": params = []; break;
    case "getSlot": case "getBlockHeight": case "getLatestBlockhash": params = [{ commitment }]; break;
    case "getBalance": case "getTokenAccountBalance": params = [address(p[0]), { commitment }]; break;
    case "getAccountInfo": params = [address(p[0]), { commitment, encoding: "base64" }]; break;
    case "getProgramAccounts": {
      if (address(p[0]) !== program || !Array.isArray(config.filters) || config.filters.length < 1 || config.filters.length > 3) throw new Error("Only filtered Airbag accounts are available");
      const filters = config.filters.map(filter => {
        const m = filter?.memcmp;
        if (!m || !Number.isInteger(m.offset) || m.offset < 0 || m.offset > 256 || typeof m.bytes !== "string" || m.bytes.length > 90) throw new Error("Invalid account filter");
        bs58.decode(m.bytes);
        return { memcmp: { offset: m.offset, bytes: m.bytes } };
      });
      params = [program, { commitment, encoding: "base64", filters }]; break;
    }
    case "getSignatureStatuses": {
      if (!Array.isArray(p[0]) || p[0].length < 1 || p[0].length > 5) throw new Error("At most five signatures are allowed");
      params = [p[0].map(signature), { searchTransactionHistory: true }]; break;
    }
    case "getSignaturesForAddress":
      params = [address(p[0]), { commitment, limit: Math.min(30, Math.max(1, Number(config.limit) || 12)) }]; break;
    case "getTransaction":
      params = [signature(p[0]), { commitment, encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]; break;
    case "sendTransaction": {
      if (typeof p[0] !== "string" || p[0].length > 1700 || config.encoding !== "base64") throw new Error("Invalid transaction encoding");
      const bytes = Buffer.from(p[0], "base64");
      if (bytes.length > 1232) throw new Error("Transaction too large");
      const transaction = Transaction.from(bytes);
      const allowed = new Set([program, "Ed25519SigVerify111111111111111111111111111", "ComputeBudget111111111111111111111111111111"]);
      if (!transaction.verifySignatures() || !transaction.instructions.some(ix => ix.programId.toBase58() === program)
        || transaction.instructions.some(ix => !allowed.has(ix.programId.toBase58()))) throw new Error("Only signed Airbag transactions are allowed");
      params = [p[0], { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }]; break;
    }
    default: throw new Error("RPC method not available");
  }
  return { jsonrpc: "2.0", id: request.id as string | number, method: request.method, params };
}

/** Global bounded pacing; public visitors cannot create an unbounded queue. */
export function createRpcRelay(endpoint: string, program: string) {
  let pending = 0;
  let nextStart = 0;
  return async (input: unknown) => {
    const request = validateRpcRequest(input, program);
    if (pending >= 40) return { jsonrpc: "2.0", id: request.id, error: { code: -32005, message: "RPC busy. Retry shortly." } };
    pending++;
    const start = Math.max(Date.now(), nextStart);
    nextStart = start + 250;
    try {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, start - Date.now())));
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(request), signal: AbortSignal.timeout(12000), redirect: "error" });
      if (!response.ok) throw new Error("Upstream unavailable");
      const result = await response.json() as Record<string, unknown>;
      // Never reflect provider diagnostics, URLs or credentials to visitors.
      if (result.error || !("result" in result)) throw new Error("RPC request rejected");
      return { jsonrpc: "2.0", id: request.id, result: result.result };
    } catch {
      return { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Devnet RPC unavailable. Check your transaction status before retrying." } };
    } finally { pending--; }
  };
}
