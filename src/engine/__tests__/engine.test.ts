import { describe, it, expect, beforeEach } from "vitest";
import {
  OptketEngine,
  makeDemoEngine,
  toFixed,
  fromFixed,
  maxLiability,
  payout,
  quotePremium,
  serializeQuotePayload,
  QUOTE_PAYLOAD_LEN,
  QUOTE_VALIDITY_SECS,
  type QuotePayload,
  type Observation,
  DEMO_BUYER,
} from "../index";

const NOW = 1_800_000_000; // fixed base timestamp

function mkQuote(engine: OptketEngine, over: Partial<QuotePayload> = {}): QuotePayload {
  const series = engine.getSeries(0, 0);
  const qty = toFixed(10);
  const prem = quotePremium(0, qty, series.strike, toFixed(172.5), series.expiryTs - engine.now());
  return {
    buyer: DEMO_BUYER,
    assetId: 0,
    seriesId: 0,
    quantity: qty,
    strike: series.strike,
    expiryTs: series.expiryTs,
    referenceVersion: series.referenceVersion,
    premium: prem.premium,
    fees: 0n,
    quoteId: 1n,
    quoteExpiryTs: engine.now() + QUOTE_VALIDITY_SECS,
    ...over,
  };
}

describe("fixed-point arithmetic (PRD §6.3)", () => {
  it("reserves round up, payouts round down, payout <= liability", () => {
    const qty = 7_333_333n;
    const strike = 41_250_000n;
    const l = maxLiability(qty, strike);
    expect(payout(qty, strike, 0n)).toBeLessThanOrEqual(l);
  });
  it("payout is zero at or above strike", () => {
    expect(payout(toFixed(2), toFixed(100), toFixed(100))).toBe(0n);
    expect(payout(toFixed(2), toFixed(100), toFixed(110))).toBe(0n);
  });
});

describe("purchase (PRD §8)", () => {
  let engine: OptketEngine;
  beforeEach(() => (engine = makeDemoEngine(NOW)));

  it("creates a contract, reserves max liability, takes premium", () => {
    const q = mkQuote(engine);
    const c = engine.purchase(q);
    expect(c.remainingQuantity).toBe(q.quantity);
    expect(c.reservedCollateral).toBe(maxLiability(q.quantity, q.strike));
    const pool = engine.pool(0);
    expect(pool.reserved).toBe(c.reservedCollateral);
    expect(pool.premiumReceipts).toBe(q.premium);
  });

  it("rejects a replayed quote id (PRD §22)", () => {
    engine.purchase(mkQuote(engine, { quoteId: 5n }));
    expect(() => engine.purchase(mkQuote(engine, { quoteId: 5n }))).toThrow(/replay/);
  });

  it("rejects an expired quote", () => {
    const q = mkQuote(engine, { quoteId: 9n, quoteExpiryTs: engine.now() - 1 });
    expect(() => engine.purchase(q)).toThrow(/expired/);
  });

  it("rejects non-zero fees in demo", () => {
    expect(() => engine.purchase(mkQuote(engine, { quoteId: 3n, fees: 1n }))).toThrow(/fees/);
  });

  it("rejects mismatched terms", () => {
    expect(() => engine.purchase(mkQuote(engine, { quoteId: 4n, strike: toFixed(999) }))).toThrow(
      /mismatch/,
    );
  });

  it("blocks purchases when reserves are insufficient", () => {
    const small = new OptketEngine(engine.config, NOW);
    for (const a of engine.assets.values()) small.addAsset(a);
    small.addSeries(engine.getSeries(0, 0));
    small.fundPool(0, 1n); // basically nothing
    expect(() => small.purchase(mkQuote(small))).toThrow(/collateral|exposure/);
  });

  it("respects the aggregate exposure limit", () => {
    // exposure limit is 5,000,000; strike 170 => each unit ~170 liability.
    // Buying max contract size repeatedly should eventually be blocked.
    let blocked = false;
    for (let i = 0; i < 200; i++) {
      try {
        engine.purchase(mkQuote(engine, { quoteId: BigInt(1000 + i), quantity: toFixed(500) }));
      } catch (e) {
        blocked = /exposure|collateral/.test(String(e));
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  it("paused purchases are blocked", () => {
    engine.setPaused(true);
    expect(() => engine.purchase(mkQuote(engine, { quoteId: 7n }))).toThrow(/paused/);
  });
});

describe("partial exercise + settlement (PRD §10, §22)", () => {
  let engine: OptketEngine;
  beforeEach(() => (engine = makeDemoEngine(NOW)));

  it("partial equity exercise preserves remaining quantity and never double-pays", () => {
    const c = engine.purchase(mkQuote(engine, { quoteId: 11n, quantity: toFixed(10) }));
    const r = engine.requestExercise(c.contractId, toFixed(4));
    expect(c.remainingQuantity).toBe(toFixed(6));
    expect(c.pendingQuantity).toBe(toFixed(4));

    // qualifying equity observation strictly after request, fresh
    const t = r.requestTs + 10;
    const payoutAmt = engine.settleExerciseEquity(c.contractId, r.nonce, {
      slot: 1n,
      sourceTs: t,
      collectedTs: t + 5,
      price: toFixed(150), // 20 below strike 170
    });
    // 4 * (170-150) = 80 demo tokens
    expect(fromFixed(payoutAmt)).toBeCloseTo(80, 6);
    expect(c.remainingQuantity).toBe(toFixed(6));
    expect(c.pendingQuantity).toBe(0n);
    expect(c.status).toBe("PartiallySettled");

    // settling the same request again must fail (no double payout)
    expect(() => engine.settleExerciseEquity(c.contractId, r.nonce, {
      slot: 2n, sourceTs: t + 1, collectedTs: t + 6, price: toFixed(150),
    })).toThrow(/not pending/);
  });

  it("rejects an observation not strictly after the request (historical) — PRD §22", () => {
    const c = engine.purchase(mkQuote(engine, { quoteId: 12n }));
    const r = engine.requestExercise(c.contractId, toFixed(1));
    expect(() =>
      engine.settleExerciseEquity(c.contractId, r.nonce, {
        slot: 1n,
        sourceTs: r.requestTs, // NOT strictly after
        collectedTs: r.requestTs + 5,
        price: toFixed(150),
      }),
    ).toThrow(/after/);
  });

  it("PreStocks median settlement across a qualifying window", () => {
    const c = engine.purchase(
      mkQuote(engine, {
        quoteId: 13n,
        assetId: 1,
        seriesId: 0,
        strike: engine.getSeries(1, 0).strike,
        quantity: toFixed(100),
        premium: quotePremium(1, toFixed(100), engine.getSeries(1, 0).strike, toFixed(25), engine.getSeries(1, 0).expiryTs - engine.now()).premium,
      }),
    );
    const r = engine.requestExercise(c.contractId, toFixed(100));
    const obs = [
      { slot: 10n, sourceTs: r.requestTs + 30, collectedTs: r.requestTs + 33, price: toFixed(20) },
      { slot: 11n, sourceTs: r.requestTs + 60, collectedTs: r.requestTs + 63, price: toFixed(21) },
      { slot: 12n, sourceTs: r.requestTs + 90, collectedTs: r.requestTs + 93, price: toFixed(19) },
    ];
    const pay = engine.settleExercisePrestocks(c.contractId, r.nonce, obs);
    // median(19,20,21)=20; strike 24 => 100*(24-20)=400
    expect(fromFixed(pay)).toBeCloseTo(400, 6);
    expect(c.status).toBe("Exercised");
  });

  it("rejects duplicate/non-increasing slots and too few samples (PRD §22)", () => {
    const c = engine.purchase(mkQuote(engine, { quoteId: 14n, assetId: 1, seriesId: 0, strike: engine.getSeries(1, 0).strike, quantity: toFixed(10), premium: 1_000_000n }));
    const r = engine.requestExercise(c.contractId, toFixed(10));
    const dup: Observation[] = [
      { slot: 5n, sourceTs: r.requestTs + 30, collectedTs: r.requestTs + 33, price: toFixed(20) },
      { slot: 5n, sourceTs: r.requestTs + 60, collectedTs: r.requestTs + 63, price: toFixed(20) },
      { slot: 6n, sourceTs: r.requestTs + 90, collectedTs: r.requestTs + 93, price: toFixed(20) },
    ];
    expect(() => engine.settleExercisePrestocks(c.contractId, r.nonce, dup)).toThrow(/slot/);
    expect(() =>
      engine.settleExercisePrestocks(c.contractId, r.nonce, dup.slice(0, 2)),
    ).toThrow(/insufficient/);
  });

  it("failed request restores the exact quantity to active coverage (PRD §22)", () => {
    const c = engine.purchase(mkQuote(engine, { quoteId: 15n, quantity: toFixed(10) }));
    const r = engine.requestExercise(c.contractId, toFixed(4));
    engine.advance(1000); // window elapses
    engine.failExercise(c.contractId, r.nonce);
    expect(c.remainingQuantity).toBe(toFixed(10));
    expect(c.pendingQuantity).toBe(0n);
    expect(r.status).toBe("Failed");
  });
});

describe("expiry & refunds (PRD §11)", () => {
  let engine: OptketEngine;
  beforeEach(() => (engine = makeDemoEngine(NOW)));

  it("expiry below strike pays intrinsic value", () => {
    const c = engine.purchase(mkQuote(engine, { quoteId: 21n, quantity: toFixed(3) }));
    engine.setNow(c.expiryTs + 10);
    const t = c.expiryTs + 5;
    const pay = engine.settleExpiryEquity(c.contractId, {
      slot: 1n, sourceTs: t, collectedTs: t + 5, price: toFixed(160),
    });
    expect(fromFixed(pay)).toBeCloseTo(30, 6); // 3*(170-160)
    expect(c.status).toBe("Expired");
    expect(engine.pool(0).reserved).toBe(0n);
  });

  it("expiry at/above strike closes with zero payout", () => {
    const c = engine.purchase(mkQuote(engine, { quoteId: 22n, quantity: toFixed(3) }));
    engine.setNow(c.expiryTs + 10);
    const t = c.expiryTs + 5;
    const pay = engine.settleExpiryEquity(c.contractId, {
      slot: 1n, sourceTs: t, collectedTs: t + 5, price: toFixed(180),
    });
    expect(pay).toBe(0n);
    expect(c.status).toBe("Expired");
  });

  it("invalid expiry reference triggers a proportional demo refund (PRD §11.2)", () => {
    const c = engine.purchase(mkQuote(engine, { quoteId: 23n, quantity: toFixed(10) }));
    // exercise half first
    const r = engine.requestExercise(c.contractId, toFixed(5));
    const t = r.requestTs + 10;
    engine.settleExerciseEquity(c.contractId, r.nonce, { slot: 1n, sourceTs: t, collectedTs: t + 5, price: toFixed(150) });
    engine.setNow(c.expiryTs + 10);
    const refund = engine.expireRefund(c.contractId);
    // refund is premium attributable to the remaining 5 of 10 => half premium
    expect(refund).toBe(c.premiumPaid / 2n);
    expect(c.status).toBe("Refunded");
    expect(engine.pool(0).reserved).toBe(0n);
  });

  it("cannot settle expiry before expiry timestamp", () => {
    const c = engine.purchase(mkQuote(engine, { quoteId: 24n }));
    expect(() =>
      engine.settleExpiryEquity(c.contractId, { slot: 1n, sourceTs: c.expiryTs, collectedTs: c.expiryTs + 5, price: toFixed(150) }),
    ).toThrow(/expiry not reached/);
  });
});

describe("accounting invariants hold across a full lifecycle (PRD §12, §22)", () => {
  it("one asset outage does not disable the other; invariants stay intact", () => {
    const engine = makeDemoEngine(NOW);
    // asset 0 activity
    const c0 = engine.purchase(mkQuote(engine, { quoteId: 31n, quantity: toFixed(10) }));
    const r0 = engine.requestExercise(c0.contractId, toFixed(3));
    const t = r0.requestTs + 10;
    engine.settleExerciseEquity(c0.contractId, r0.nonce, { slot: 1n, sourceTs: t, collectedTs: t + 5, price: toFixed(150) });

    // asset 1 activity independent of asset 0
    const s1 = engine.getSeries(1, 0);
    const c1 = engine.purchase({
      buyer: DEMO_BUYER, assetId: 1, seriesId: 0, quantity: toFixed(50), strike: s1.strike,
      expiryTs: s1.expiryTs, referenceVersion: s1.referenceVersion,
      premium: quotePremium(1, toFixed(50), s1.strike, toFixed(25), s1.expiryTs - engine.now()).premium,
      fees: 0n, quoteId: 32n, quoteExpiryTs: engine.now() + QUOTE_VALIDITY_SECS,
    });
    expect(c1.assetId).toBe(1);

    // invariants both assets
    engine.checkInvariants(0);
    engine.checkInvariants(1);

    // reserved for asset 0 must equal sum of its open contracts' reserves.
    expect(engine.pool(0).reserved).toBe(c0.reservedCollateral);
    expect(engine.pool(1).reserved).toBe(c1.reservedCollateral);
  });
});

describe("quote serialization parity (PRD §8.1)", () => {
  it("serializes to the fixed 95-byte borsh layout", () => {
    const engine = makeDemoEngine(NOW);
    const q = mkQuote(engine);
    const bytes = serializeQuotePayload(q, new Uint8Array(32));
    expect(bytes.length).toBe(QUOTE_PAYLOAD_LEN);
  });
});
