// Trial budget / fee-support controller (PRD §19).
//
// Grants small, capped SOL allocations to trial wallets so users can pay their
// own transaction fees without funding a wallet first. Enforces: a hard total
// cap, a per-request max, a per-wallet lifetime max, a rate limit, a per-wallet
// cooldown (duplicate-request control), an append-only spend log, and automatic
// shutdown once the cap is reached. The budget wallet is a DEDICATED keypair,
// separate from the collateral pool and the admin/quote/publisher keys.
//
// Per-wallet limits do not prove unique users; grants are never tied to
// purchases or payouts (PRD §19).

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { loadKey } from "./keys";

export interface TrialConfig {
  capSol: number;         // hard total spending cap
  perGrantSol: number;    // max per single request
  perWalletMaxSol: number; // lifetime max per wallet
  cooldownMs: number;     // min gap between grants to one wallet (dup control)
  rateWindowMs: number;   // rolling window for the global rate limit
  rateMax: number;        // max grants per window
}

export interface GrantResult { ok: boolean; grantedSol: number; remainingSol: number; reason?: string; active: boolean; }

interface WalletState { spentLamports: number; count: number; lastTs: number; }
interface LogEntry { ts: number; wallet: string; lamports: number; sig?: string; }

export class TrialBudget {
  private budget: Keypair;
  private spentLamports = 0;
  private active = true;
  private wallets = new Map<string, WalletState>();
  private grantTimestamps: number[] = [];
  private log: LogEntry[] = [];

  private conn: Connection;
  private cfg: TrialConfig;
  constructor(conn: Connection, cfg: TrialConfig, keypairPath: string) {
    this.conn = conn;
    this.cfg = cfg;
    // env secret in production (Railway), gitignored file locally
    this.budget = loadKey("TRIAL_BUDGET_SECRET", keypairPath);
  }

  get address() { return this.budget.publicKey; }

  /** Fund the budget wallet on localnet (no-op if it already has SOL). Devnet/
   *  mainnet operators fund the printed address manually. */
  async ensureFunded(targetSol = 25) {
    try {
      const bal = await this.conn.getBalance(this.budget.publicKey);
      if (bal < targetSol * LAMPORTS_PER_SOL && /127\.0\.0\.1|localhost/.test((this.conn as unknown as { rpcEndpoint: string }).rpcEndpoint)) {
        const sig = await this.conn.requestAirdrop(this.budget.publicKey, Math.ceil(targetSol) * LAMPORTS_PER_SOL);
        await this.conn.confirmTransaction(sig, "confirmed");
      }
    } catch { /* devnet: fund manually */ }
  }

  async status() {
    let balance = 0;
    try { balance = await this.conn.getBalance(this.budget.publicKey) / LAMPORTS_PER_SOL; } catch { /* rpc */ }
    return {
      active: this.active,
      budgetWallet: this.budget.publicKey.toBase58(),
      capSol: this.cfg.capSol,
      spentSol: this.spentLamports / LAMPORTS_PER_SOL,
      remainingSol: Math.max(0, this.cfg.capSol - this.spentLamports / LAMPORTS_PER_SOL),
      walletBalanceSol: balance,
      grants: this.log.length,
      perGrantSol: this.cfg.perGrantSol,
      perWalletMaxSol: this.cfg.perWalletMaxSol,
      recent: this.log.slice(-8).reverse(),
    };
  }

  /**
   * Authorize an exact-sized sponsorship spend (fee + rent subsidy) without
   * transferring — the transfer rides inside the sponsored transaction.
   * Applies the same hard cap, per-wallet ceiling and rate limit as a grant,
   * but no cooldown: a user legitimately signs several transactions in a row.
   */
  authorizeSponsorship(address: string, lamports: number): { ok: boolean; reason?: string; remainingSol: number } {
    const remaining = () => Math.max(0, this.cfg.capSol - this.spentLamports / LAMPORTS_PER_SOL);
    if (!this.active) return { ok: false, reason: "trial budget closed (cap reached)", remainingSol: remaining() };

    const now = Date.now();
    if (this.spentLamports + lamports > this.cfg.capSol * LAMPORTS_PER_SOL) {
      this.active = false;
      return { ok: false, reason: "trial budget cap reached — sponsorship disabled", remainingSol: remaining() };
    }
    this.grantTimestamps = this.grantTimestamps.filter((t) => now - t < this.cfg.rateWindowMs);
    if (this.grantTimestamps.length >= this.cfg.rateMax) {
      return { ok: false, reason: "rate limit — try again shortly", remainingSol: remaining() };
    }
    const w = this.wallets.get(address) || { spentLamports: 0, count: 0, lastTs: 0 };
    if (w.spentLamports + lamports > this.cfg.perWalletMaxSol * LAMPORTS_PER_SOL) {
      return { ok: false, reason: "per-wallet trial limit reached", remainingSol: remaining() };
    }

    this.spentLamports += lamports;
    w.spentLamports += lamports; w.count += 1; w.lastTs = now;
    this.wallets.set(address, w);
    this.grantTimestamps.push(now);
    this.log.push({ ts: now, wallet: address, lamports });
    if (this.spentLamports >= this.cfg.capSol * LAMPORTS_PER_SOL) this.active = false;
    return { ok: true, remainingSol: remaining() };
  }

  /** Sign a transaction as fee payer. Callers MUST validate the tx first. */
  signAsFeePayer<T extends { partialSign: (kp: Keypair) => void }>(tx: T): T {
    tx.partialSign(this.budget);
    return tx;
  }

  async grant(address: string): Promise<GrantResult> {
    const remaining = () => Math.max(0, this.cfg.capSol - this.spentLamports / LAMPORTS_PER_SOL);
    if (!this.active) return { ok: false, grantedSol: 0, remainingSol: remaining(), reason: "trial budget closed (cap reached)", active: false };

    const now = Date.now();
    const grantLamports = Math.round(this.cfg.perGrantSol * LAMPORTS_PER_SOL);

    // hard cap → auto-shutdown
    if (this.spentLamports + grantLamports > this.cfg.capSol * LAMPORTS_PER_SOL) {
      this.active = false;
      return { ok: false, grantedSol: 0, remainingSol: remaining(), reason: "trial budget cap reached — shutting down", active: false };
    }
    // global rate limit
    this.grantTimestamps = this.grantTimestamps.filter((t) => now - t < this.cfg.rateWindowMs);
    if (this.grantTimestamps.length >= this.cfg.rateMax) return { ok: false, grantedSol: 0, remainingSol: remaining(), reason: "rate limit — try again shortly", active: true };

    let dest: PublicKey;
    try { dest = new PublicKey(address); } catch { return { ok: false, grantedSol: 0, remainingSol: remaining(), reason: "invalid address", active: true }; }

    const w = this.wallets.get(address) || { spentLamports: 0, count: 0, lastTs: 0 };
    // per-wallet cooldown (duplicate-request control)
    if (now - w.lastTs < this.cfg.cooldownMs) return { ok: false, grantedSol: 0, remainingSol: remaining(), reason: "per-wallet cooldown active", active: true };
    // per-wallet lifetime cap
    if (w.spentLamports + grantLamports > this.cfg.perWalletMaxSol * LAMPORTS_PER_SOL) return { ok: false, grantedSol: 0, remainingSol: remaining(), reason: "per-wallet trial limit reached", active: true };

    // transfer from the dedicated budget wallet
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: this.budget.publicKey, toPubkey: dest, lamports: grantLamports }));
    const sig = await sendAndConfirmTransaction(this.conn, tx, [this.budget], { commitment: "confirmed" });

    this.spentLamports += grantLamports;
    w.spentLamports += grantLamports; w.count += 1; w.lastTs = now;
    this.wallets.set(address, w);
    this.grantTimestamps.push(now);
    this.log.push({ ts: now, wallet: address, lamports: grantLamports, sig });
    if (this.spentLamports >= this.cfg.capSol * LAMPORTS_PER_SOL) this.active = false;

    return { ok: true, grantedSol: grantLamports / LAMPORTS_PER_SOL, remainingSol: remaining(), active: this.active };
  }
}

export function trialConfigFromEnv(): TrialConfig {
  return {
    capSol: Number(process.env.TRIAL_CAP_SOL || 20),
    perGrantSol: Number(process.env.TRIAL_PER_GRANT_SOL || 0.3),
    perWalletMaxSol: Number(process.env.TRIAL_PER_WALLET_SOL || 0.6),
    cooldownMs: Number(process.env.TRIAL_COOLDOWN_MS || 4000),
    rateWindowMs: Number(process.env.TRIAL_RATE_WINDOW_MS || 60000),
    rateMax: Number(process.env.TRIAL_RATE_MAX || 40),
  };
}
