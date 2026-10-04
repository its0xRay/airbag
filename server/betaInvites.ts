import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(24).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);
type Challenge = { wallet: string; message: string; expires: number };

/** One persistent SQLite volume, shared by the CLI and a single service replica.
 * Redemption binds a code before any chain write. An interrupted grant can be
 * retried by the same wallet, but never by a different wallet. */
export class BetaInvites {
  readonly db: DatabaseSync;
  constructor(path: string, readonly domain: string, readonly program: string) {
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS scope (id INTEGER PRIMARY KEY CHECK(id=1), domain TEXT, program TEXT);
      CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, wallet TEXT, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS wallets (wallet TEXT PRIMARY KEY, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, wallet TEXT NOT NULL, expires INTEGER NOT NULL);`);
    this.db.prepare("INSERT OR IGNORE INTO scope VALUES (1,?,?)").run(domain, program);
    const scope = this.db.prepare("SELECT domain,program FROM scope WHERE id=1").get();
    if (scope?.domain !== domain || scope?.program !== program) {
      this.db.close();
      throw new Error("Invite database deployment scope mismatch");
    }
  }
  generate(count: number, expires: number) {
    if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isSafeInteger(expires) || expires <= now()) throw new Error("Invalid invitation count or expiry");
    return Array.from({ length: count }, () => {
      const code = secret();
      this.db.prepare("INSERT INTO invites(hash,expires) VALUES (?,?)").run(hash(code), expires);
      return code;
    });
  }
  list() { return this.db.prepare("SELECT hash,expires,wallet,revoked FROM invites ORDER BY expires").all(); }
  revokeCode(id: string) { this.db.prepare("UPDATE invites SET revoked=1 WHERE hash=?").run(id); }
  revokeWallet(wallet: string) {
    this.db.prepare("INSERT INTO wallets(wallet,revoked) VALUES (?,1) ON CONFLICT(wallet) DO UPDATE SET revoked=1").run(new PublicKey(wallet).toBase58());
    this.db.prepare("DELETE FROM sessions WHERE wallet=?").run(wallet);
  }
  challenge(wallet: string) {
    wallet = new PublicKey(wallet).toBase58();
    this.db.prepare("DELETE FROM challenges WHERE expires<=?").run(now());
    this.db.prepare("DELETE FROM sessions WHERE expires<=?").run(now());
    const id = secret(), expires = now() + 300;
    const message = `${this.domain} requests Airbag wallet verification.\nWallet: ${wallet}\nNetwork: Solana mainnet-beta\nProgram: ${this.program}\nNonce: ${id}\nExpires: ${new Date(expires * 1000).toISOString()}\nNo payment or token approval.`;
    this.db.prepare("INSERT INTO challenges VALUES (?,?,?,?)").run(id, wallet, message, expires);
    return { id, message, expires };
  }
  verify(id: string, signature: string, code?: string) {
    const row = this.db.prepare("SELECT wallet,message,expires FROM challenges WHERE id=?").get(id) as Challenge | undefined;
    if (!row || row.expires <= now()) throw new Error("Verification expired. Request a new message.");
    const bytes = Buffer.from(signature, "base64");
    if (bytes.length !== 64 || !nacl.sign.detached.verify(Buffer.from(row.message), bytes, new PublicKey(row.wallet).toBytes())) throw new Error("Wallet signature did not verify.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.db.prepare("DELETE FROM challenges WHERE id=?").run(id).changes) throw new Error("Verification already used.");
      const existing = this.db.prepare("SELECT revoked FROM wallets WHERE wallet=?").get(row.wallet);
      if (!existing) {
        const invite = this.db.prepare("SELECT expires,wallet,revoked FROM invites WHERE hash=?").get(hash(code ?? ""));
        if (!invite || invite.revoked || Number(invite.expires) <= now() || (invite.wallet && invite.wallet !== row.wallet)) throw new Error("Invitation is invalid, expired or already used.");
        this.db.prepare("UPDATE invites SET wallet=? WHERE hash=?").run(row.wallet, hash(code!));
        this.db.prepare("INSERT INTO wallets(wallet) VALUES (?)").run(row.wallet);
      }
      const token = secret();
      this.db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(hash(token), row.wallet, now() + 3600);
      this.db.exec("COMMIT");
      return { wallet: row.wallet, token };
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  session(token: string): string | null {
    const row = this.db.prepare("SELECT sessions.wallet FROM sessions JOIN wallets USING(wallet) WHERE sessions.hash=? AND sessions.expires>?").get(hash(token), now());
    return typeof row?.wallet === "string" ? row.wallet : null;
  }
  close() { this.db.close(); }
  isRevoked(wallet: string) { return !!this.db.prepare("SELECT revoked FROM wallets WHERE wallet=?").get(wallet)?.revoked; }
}
