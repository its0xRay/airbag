// Separate process, keys, RPC and persistent volume from the Devnet services.
import { createServer } from "node:http";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { BetaInvites } from "./betaInvites";
import { betaConnection, betaKey, betaProgram, required, verifyBetaDeployment } from "./betaConfig";
import { BETA_WALLET_LIMIT, MAINNET_GENESIS, USDC_MINT, readBetaAccess, readBetaPolicy, setBetaAccessIx } from "../src/client/betaProgram";
import { VaultClient } from "../src/client/vaultProgram";
import { createRpcRelay, validateRpcRequest } from "./rpcRelay";
import { signedVaultQuote } from "./vaultQuotes";
import { createNvdaTokenReference, JupiterPreStocksAdapter } from "./references";
import { loadObservations, saveObservations, pruneObservations } from "./observationStore";
import { tickVaults } from "./vaultKeeper";
import { betaObservationWindow } from "./betaObservations";

const enabled = process.env.BETA_ENABLED === "true";
const origin = required("BETA_ORIGIN");
if (new URL(origin).origin !== origin || !origin.startsWith("https://")) throw new Error("Use an exact HTTPS BETA_ORIGIN");
const port = Number(process.env.PORT || 8790);
const encode = (data: unknown) => JSON.stringify(data, (_k,v) => typeof v === "bigint" ? v.toString() : v);
const now = () => Math.floor(Date.now()/1000);
const runtime = enabled ? await initialize() : null;
async function initialize() {
  const conn = betaConnection(), program = betaProgram();
  const access = betaKey("BETA_ACCESS_SECRET"), quote = betaKey("BETA_QUOTE_SECRET"), publisher = betaKey("BETA_PUBLISHER_SECRET");
  if (new Set([access,quote,publisher].map(k => k.publicKey.toBase58())).size !== 3) throw new Error("Use distinct beta authorities");
  const verified = await verifyBetaDeployment(conn, program);
  if (!verified.policy.authority.equals(access.publicKey)
    || !new PublicKey(verified.config.data.subarray(40,72)).equals(quote.publicKey)
    || !new PublicKey(verified.config.data.subarray(72,104)).equals(publisher.publicKey)) throw new Error("Beta role mismatch");
  const invites = new BetaInvites(required("BETA_DB_PATH"), origin, program.toBase58());
  const client = new VaultClient(conn, program);
  const relay = createRpcRelay(required("BETA_RPC_URL"), program.toBase58());
  const scope = { genesisHash: MAINNET_GENESIS, program: program.toBase58(), publisher: publisher.publicKey.toBase58(), versions: { 0: 2, 1: 1 } };
  const observationPath = required("BETA_OBSERVATIONS_PATH");
  let buffer = loadObservations(observationPath, scope, now());
  const adapters = [createNvdaTokenReference(), new JupiterPreStocksAdapter(1)];
  let running = false, keeperHealthy = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const asset of [0,1]) {
        for (const o of await adapters[asset].observe(1)) {
          if (!o.available || o.price <= 0n || o.sourceTs > now() || now()-o.sourceTs > 60) continue;
          // Anthropic v1 sequences real API snapshots by the confirmed collection
          // slot, matching the existing keeper. NVDA v2 retains its upstream slot.
          const slot = asset === 1 ? BigInt(await conn.getSlot("confirmed")) : o.slot;
          const previous = buffer[asset].at(-1);
          if (!previous || slot > previous.slot)
            buffer[asset].push({ price: o.price, sourceTs: o.sourceTs, collectedTs: now(), slot });
        }
      }
      buffer = pruneObservations(buffer, now());
      saveObservations(observationPath, scope, buffer, now());
      const errors = await tickVaults(client, publisher, (asset,lo,hi) => betaObservationWindow(buffer[asset],lo,hi));
      keeperHealthy = errors.length === 0;
      if (errors.length) console.error("Beta keeper has unsettled operations requiring retry");
    } catch { keeperHealthy = false; console.error("Beta keeper tick failed; purchases suspended until recovery"); }
    finally { running = false; }
  };
  await tick();
  setInterval(() => void tick(), 5000).unref();
  return { conn, program, access, quote, invites, client, relay,
    healthy: () => keeperHealthy,
    reference: async (asset: number) => {
      const sample = buffer[asset]?.at(-1);
      return sample && now()-sample.sourceTs <= 60 ? { available: true, spot: sample.price } : { available: false, reason: "A fresh token-market reference is unavailable." };
    } };
}
// Bound both storage and global request throughput. Do not trust X-Forwarded-For.
const limits = new Map<string,{ start: number; count: number }>();
let globalStart = now(), globalCount = 0;
createServer(async (req,res) => {
  const send = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff",
      "access-control-allow-origin": origin, "vary": "Origin", "access-control-allow-headers": "content-type,authorization", "access-control-allow-methods": "GET,POST,OPTIONS" });
    res.end(encode(data));
  };
  try {
    if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: "Origin not permitted." });
    if (req.method === "OPTIONS") return send(204, {});
    const path = new URL(req.url || "/", origin).pathname;
    if (path === "/health") return send(200, { enabled: !!runtime, keeperHealthy: runtime?.healthy() ?? false });
    if (path === "/config") return send(200, { enabled: !!runtime, network: "mainnet-beta", programId: runtime?.program.toBase58(), mint: USDC_MINT.toBase58(), walletLimit: BETA_WALLET_LIMIT.toString(), origin });
    if (!runtime) return send(503, { error: "Mainnet beta is not open. Devnet remains available." });
    const r = runtime;
    if (now()-globalStart >= 60) { globalStart = now(); globalCount=0; limits.clear(); }
    if (++globalCount > 600) return send(429, { error: "Beta is busy. Please retry shortly." });
    const identity = req.headers.authorization || req.socket.remoteAddress || "unknown";
    const limit = limits.get(identity) ?? { start: now(), count: 0 }; limit.count++; limits.set(identity, limit);
    if (limit.count > 180) return send(429, { error: "Too many requests. Please wait a minute." });
    if (req.method !== "POST" || req.headers.origin !== origin) return send(405, { error: "POST from the configured app is required." });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw)>8192) return send(413,{ error:"Request too large." }); }
    const body = JSON.parse(raw || "{}");
    if (path === "/challenge") return send(200,r.invites.challenge(String(body.wallet)));
    if (path === "/verify") {
      const session = r.invites.verify(String(body.id),String(body.signature),typeof body.code === "string" ? body.code : undefined);
      const owner = new PublicKey(session.wallet);
      const existing = await readBetaAccess(r.conn,r.program,owner);
      // Never silently re-enable an onchain revocation. A retry after a failed
      // first grant may initialize the missing account, using its bound wallet.
      if (!existing && !r.invites.isRevoked(session.wallet)) {
        await sendAndConfirmTransaction(r.conn,new Transaction().add(setBetaAccessIx(r.program,r.access.publicKey,owner,true)),[r.access],{ commitment:"confirmed" });
      }
      return send(200, session);
    }
    const wallet = r.invites.session((req.headers.authorization || "").replace(/^Bearer /,""));
    if (!wallet) return send(401,{ error:"Session expired. Verify your wallet again." });
    if (path === "/rpc") return send(200,await r.relay(body));
    if (path === "/simulate") {
      const allowed = validateRpcRequest({jsonrpc:"2.0",id:1,method:"sendTransaction",params:[body.transaction,{encoding:"base64"}]},r.program.toBase58());
      const tx = Transaction.from(Buffer.from(String(allowed.params[0]),"base64"));
      if (tx.feePayer?.toBase58() !== wallet) return send(403,{error:"Wallet does not match transaction."});
      const result = await r.conn.simulateTransaction(tx);
      return send(200,{ ok: !result.value.err });
    }
    const owner = new PublicKey(wallet);
    const [access,policy,configAccount] = await Promise.all([readBetaAccess(r.conn,r.program,owner),readBetaPolicy(r.conn,r.program),r.conn.getAccountInfo(r.client.pdas.config())]);
    // A valid invite grants access automatically. Only actual deployment health,
    // revocation and the onchain emergency pause can block new participation.
    const accepting=r.healthy() && !r.invites.isRevoked(wallet) && configAccount?.data[136]===0;
    if (path === "/status") return send(200,{ access, policy, walletLimit:BETA_WALLET_LIMIT, accepting,
      admin: configAccount?.owner.equals(r.program) ? new PublicKey(configAccount.data.subarray(8,40)).toBase58() : null });
    if (path === "/quote") {
      if (!accepting || !access?.enabled || !policy) return send(403,{error:"New participation is currently unavailable. Existing positions remain accessible."});
      const quote = await signedVaultQuote(r.client,r.quote,r.reference,{ buyer:wallet,round:String(body.round),quantity:String(body.quantity),strike:String(body.strike) });
      if (access.used+BigInt(quote.premium)>BETA_WALLET_LIMIT || policy.used+BigInt(quote.premium)>policy.limit) return send(400,{error:"Premium exceeds the remaining beta allowance."});
      return send(200,quote);
    }
    return send(404,{ error:"Not found." });
  } catch { return send(400,{ error:"Request could not be completed. Check your invitation, wallet and transaction status before retrying." }); }
}).listen(port,()=>console.log(`Private beta service listening on ${port}; enabled=${enabled}`));
