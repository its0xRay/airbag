import { create } from "zustand";
import {
  OptketEngine,
  makeDemoEngine,
  quotePremium,
  toFixed,
  DEMO_BUYER,
  DEMO_SPOT,
  QUOTE_VALIDITY_SECS,
  type Contract,
  type Observation,
  type QuotePayload,
} from "./engine";

// A single history log entry for the UI (PRD §13.7).
export interface LogEntry {
  ts: number;
  kind: "purchase" | "request" | "settle" | "expiry" | "refund" | "fail";
  contractId: bigint;
  detail: string;
}

interface State {
  engine: OptketEngine;
  tick: number; // bump to force re-render after engine mutation
  connected: boolean;
  buyer: string;
  /** Demo token balance held in the "wallet" (base units). */
  walletBalance: bigint;
  /** Read-only demo holdings of each underlying asset token (qty units). */
  holdings: Record<number, bigint>;
  selectedAsset: number;
  log: LogEntry[];
  quoteCounter: bigint;
  reminders: Set<string>;
  /** External (email) reminder opt-in — off by default (PRD §18). */
  externalReminders: boolean;
  /** Cross-component nav + renewal prefill (no silent carry of old terms). */
  navTarget: string | null;
  renewalPrefill: { assetId: number; quantity: string } | null;

  connect: () => void;
  disconnect: () => void;
  selectAsset: (id: number) => void;
  setHolding: (assetId: number, qty: bigint) => void;
  setExternalReminders: (on: boolean) => void;
  renew: (contractId: bigint) => void;
  clearNav: () => void;
  clearRenewalPrefill: () => void;
  allContracts: () => Contract[];

  buildQuote: (assetId: number, seriesId: number, qty: bigint) => QuotePayload;
  purchase: (assetId: number, seriesId: number, qty: bigint) => void;
  requestExercise: (contractId: bigint, qty: bigint) => void;
  settleExercise: (contractId: bigint, nonce: number, price: number) => void;
  failExercise: (contractId: bigint, nonce: number) => void;
  advanceToExpiry: (contractId: bigint) => void;
  settleExpiry: (contractId: bigint, price: number, invalid: boolean) => void;
  toggleReminder: (contractId: bigint) => void;

  contractsFor: (assetId: number) => Contract[];
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

const START = nowSeconds();

export const useStore = create<State>((set, get) => ({
  engine: makeDemoEngine(START),
  tick: 0,
  connected: false,
  buyer: DEMO_BUYER,
  walletBalance: 0n,
  holdings: { 0: 0n, 1: 0n },
  selectedAsset: 0,
  log: [],
  quoteCounter: 1n,
  reminders: new Set<string>(),
  externalReminders: false,
  navTarget: null,
  renewalPrefill: null,

  connect: () =>
    set({
      connected: true,
      walletBalance: toFixed(100_000), // free demo tokens (PRD §19)
      holdings: { 0: toFixed(12), 1: toFixed(150) },
    }),
  disconnect: () => set({ connected: false }),

  selectAsset: (id) => set({ selectedAsset: id }),
  setHolding: (assetId, qty) =>
    set((s) => ({ holdings: { ...s.holdings, [assetId]: qty } })),
  setExternalReminders: (on) => set({ externalReminders: on }),

  // Renewal opens a FRESH quote — we prefill quantity only; strike, premium,
  // expiry and reference are re-quoted. Old contract terms never carry silently.
  renew: (contractId) => {
    const s = get();
    const c = s.engine.contract(contractId);
    const qty = c.remainingQuantity > 0n ? c.remainingQuantity : c.originalQuantity;
    set({
      selectedAsset: c.assetId,
      renewalPrefill: { assetId: c.assetId, quantity: String(Number(qty) / 1e6) },
      navTarget: "protect",
    });
  },
  clearNav: () => set({ navTarget: null }),
  clearRenewalPrefill: () => set({ renewalPrefill: null }),
  allContracts: () => {
    const { engine } = get();
    return [...engine.contracts.values()].sort((a, b) => Number(b.contractId - a.contractId));
  },

  buildQuote: (assetId, seriesId, qty) => {
    const { engine, buyer, quoteCounter } = get();
    const series = engine.getSeries(assetId, seriesId);
    const spot = toFixed(DEMO_SPOT[assetId]);
    const secondsToExpiry = series.expiryTs - engine.now();
    const { premium } = quotePremium(assetId, qty, series.strike, spot, secondsToExpiry);
    return {
      buyer,
      assetId,
      seriesId,
      quantity: qty,
      strike: series.strike,
      expiryTs: series.expiryTs,
      referenceVersion: series.referenceVersion,
      premium,
      fees: 0n,
      quoteId: quoteCounter,
      quoteExpiryTs: engine.now() + QUOTE_VALIDITY_SECS,
    };
  },

  purchase: (assetId, seriesId, qty) => {
    const s = get();
    const quote = s.buildQuote(assetId, seriesId, qty);
    if (s.walletBalance < quote.premium) throw new Error("insufficient demo balance");
    const c = s.engine.purchase(quote);
    set((st) => ({
      tick: st.tick + 1,
      quoteCounter: st.quoteCounter + 1n,
      walletBalance: st.walletBalance - quote.premium,
      log: [
        {
          ts: s.engine.now(),
          kind: "purchase",
          contractId: c.contractId,
          detail: `Bought protection on ${qtyLabel(assetId, qty)} @ strike, premium ${tokenLabel(quote.premium)}`,
        },
        ...st.log,
      ],
    }));
  },

  requestExercise: (contractId, qty) => {
    const s = get();
    const r = s.engine.requestExercise(contractId, qty);
    set((st) => ({
      tick: st.tick + 1,
      log: [
        {
          ts: s.engine.now(),
          kind: "request",
          contractId,
          detail: `Requested exercise of ${qtyLabelFromContract(s, contractId, qty)} (irrevocable, request #${r.nonce})`,
        },
        ...st.log,
      ],
    }));
  },

  settleExercise: (contractId, nonce, price) => {
    const s = get();
    const c = s.engine.contract(contractId);
    const req = c.requests.find((x) => x.nonce === nonce)!;
    let payout = 0n;
    if (c.assetId === 0) {
      const t = req.requestTs + 30;
      const obs: Observation = { slot: 1n, sourceTs: t, collectedTs: t + 5, price: toFixed(price) };
      payout = s.engine.settleExerciseEquity(contractId, nonce, obs);
    } else {
      const obs: Observation[] = buildPrestocksWindow(req.requestTs, price);
      payout = s.engine.settleExercisePrestocks(contractId, nonce, obs);
    }
    set((st) => ({
      tick: st.tick + 1,
      walletBalance: st.walletBalance + payout,
      log: [
        {
          ts: s.engine.now(),
          kind: "settle",
          contractId,
          detail: `Exercise settled at ref ${price} → payout ${tokenLabel(payout)}`,
        },
        ...st.log,
      ],
    }));
  },

  failExercise: (contractId, nonce) => {
    const s = get();
    s.engine.failExercise(contractId, nonce);
    set((st) => ({
      tick: st.tick + 1,
      log: [
        { ts: s.engine.now(), kind: "fail", contractId, detail: `Exercise request #${nonce} failed → quantity restored` },
        ...st.log,
      ],
    }));
  },

  advanceToExpiry: (contractId) => {
    const s = get();
    const c = s.engine.contract(contractId);
    s.engine.setNow(Math.max(s.engine.now(), c.expiryTs + 10));
    set((st) => ({ tick: st.tick + 1 }));
  },

  settleExpiry: (contractId, price, invalid) => {
    const s = get();
    const c = s.engine.contract(contractId);
    if (s.engine.now() < c.expiryTs) s.engine.setNow(c.expiryTs + 10);
    if (invalid) {
      const refund = s.engine.expireRefund(contractId);
      set((st) => ({
        tick: st.tick + 1,
        walletBalance: st.walletBalance + refund,
        log: [
          { ts: s.engine.now(), kind: "refund", contractId, detail: `Invalid reference → demo refund ${tokenLabel(refund)}` },
          ...st.log,
        ],
      }));
      return;
    }
    let payout = 0n;
    if (c.assetId === 0) {
      const t = c.expiryTs + 5;
      payout = s.engine.settleExpiryEquity(contractId, { slot: 1n, sourceTs: t, collectedTs: t + 5, price: toFixed(price) });
    } else {
      payout = s.engine.settleExpiryPrestocks(contractId, buildPrestocksWindow(c.expiryTs - 200, price, c.expiryTs));
    }
    set((st) => ({
      tick: st.tick + 1,
      walletBalance: st.walletBalance + payout,
      log: [
        { ts: s.engine.now(), kind: "expiry", contractId, detail: `Expired at ref ${price} → payout ${tokenLabel(payout)}` },
        ...st.log,
      ],
    }));
  },

  toggleReminder: (contractId) =>
    set((st) => {
      const next = new Set(st.reminders);
      const key = contractId.toString();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { reminders: next };
    }),

  contractsFor: (assetId) => {
    const { engine } = get();
    return [...engine.contracts.values()]
      .filter((c) => c.assetId === assetId)
      .sort((a, b) => Number(b.contractId - a.contractId));
  },
}));

// --- helpers ---
function tokenLabel(v: bigint): string {
  return (Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " oUSD";
}
function qtyLabel(assetId: number, qty: bigint): string {
  const sym = assetId === 0 ? "NVDAx" : "preSPX";
  return (Number(qty) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 }) + " " + sym;
}
function qtyLabelFromContract(s: State, contractId: bigint, qty: bigint): string {
  const c = s.engine.contract(contractId);
  return qtyLabel(c.assetId, qty);
}

/** Build a qualifying PreStocks window: 3 fresh, distinct, increasing samples. */
function buildPrestocksWindow(startTs: number, price: number, endTs?: number): Observation[] {
  const out: Observation[] = [];
  const base = endTs ? endTs - 150 : startTs + 30;
  for (let i = 0; i < 3; i++) {
    const t = base + 30 * (i + 1);
    out.push({ slot: BigInt(2000 + i), sourceTs: t, collectedTs: t + 5, price: toFixed(price) });
  }
  return out;
}
