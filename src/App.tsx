import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import {
  ASSETS,
  DEMO_SPOT,
  quotePremium,
  underwriterEconomics,
  payout as intrinsic,
  toFixed,
  fromFixed,
  type Contract,
  type AssetConfig,
} from "./engine";
import {
  fmtTokens,
  fmtQty,
  fmtPrice,
  fmtUsd,
  fmtPct,
  fmtDuration,
  fmtClock,
} from "./format";
import OnchainTab from "./components/OnchainTab";
import Landing from "./components/Landing";
import { VERIFIED_ASSETS, assetByKey } from "./data/assets";
import { fetchMarket, type Market } from "./data/marketData";

type Tab = "home" | "protect" | "portfolio" | "compare" | "calculator" | "underwriter" | "history" | "onchain";

export default function App() {
  const connected = useStore((s) => s.connected);
  const connect = useStore((s) => s.connect);
  const disconnect = useStore((s) => s.disconnect);
  const walletBalance = useStore((s) => s.walletBalance);
  const engine = useStore((s) => s.engine);
  const navTarget = useStore((s) => s.navTarget);
  const clearNav = useStore((s) => s.clearNav);
  useStore((s) => s.tick); // subscribe to re-render on mutation
  const [tab, setTab] = useState<Tab>("home");

  // Cross-component navigation (e.g. renewal jumps to Protect).
  useEffect(() => {
    if (navTarget) {
      setTab(navTarget as Tab);
      clearNav();
    }
  }, [navTarget, clearNav]);

  return (
    <div className="app">
      <header className="header">
        <button className="logo" onClick={() => setTab("home")} aria-label="Optket home">
          <span className="dot" aria-hidden="true" /> Optket
          <span className="pill gray" style={{ marginLeft: 6 }}>demo</span>
        </button>
        <div className="spacer" />
        <span className="faint mono hide-sm" style={{ fontSize: 12 }}>sim clock {fmtClock(engine.now())}</span>
        {connected ? (
          <>
            <span className="pill green mono">{fmtTokens(walletBalance)} oUSD</span>
            <button className="btn ghost sm" onClick={disconnect}>Disconnect</button>
          </>
        ) : (
          <button className="btn primary" onClick={connect}>Connect demo wallet</button>
        )}
      </header>

      <div className="simbanner">
        SIMULATION — free demo tokens, no redemption promise. Real-USDC purchases, public underwriting deposits, and hedge execution are disabled.
      </div>

      <div className="tabs">
        {(
          [
            ["home", "Home"],
            ["protect", "Protect"],
            ["portfolio", "Portfolio"],
            ["compare", "Compare"],
            ["calculator", "Calculator"],
            ["underwriter", "Underwriter"],
            ["history", "History"],
            ["onchain", "On-chain"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} className={"tab" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {!connected && tab !== "underwriter" && tab !== "onchain" && tab !== "compare" && tab !== "home" ? (
        <div className="card empty">
          Connect the demo wallet to begin. You'll receive free demo tokens (oUSD) and simulated holdings.
        </div>
      ) : (
        <>
          {tab === "home" && <Landing onLaunch={(t) => setTab(t)} />}
          {tab === "protect" && <ProtectTab />}
          {tab === "portfolio" && <PortfolioTab />}
          {tab === "compare" && <CompareTab />}
          {tab === "calculator" && <CalculatorTab />}
          {tab === "underwriter" && <UnderwriterTab />}
          {tab === "history" && <HistoryTab />}
          {tab === "onchain" && <OnchainTab />}
        </>
      )}
    </div>
  );
}

function assetIcon(a: AssetConfig) {
  return (
    <div className={"asset-icon " + (a.kind === "EquityToken" ? "eq" : "pre")}>{a.symbol.slice(0, 3)}</div>
  );
}

// ------------------------------------------------------------- Protect tab ---
function ProtectTab() {
  const engine = useStore((s) => s.engine);
  const selectedAsset = useStore((s) => s.selectedAsset);
  const selectAsset = useStore((s) => s.selectAsset);
  const holdings = useStore((s) => s.holdings);
  const purchase = useStore((s) => s.purchase);
  const contractsFor = useStore((s) => s.contractsFor);
  const walletBalance = useStore((s) => s.walletBalance);
  const renewalPrefill = useStore((s) => s.renewalPrefill);
  const clearRenewalPrefill = useStore((s) => s.clearRenewalPrefill);
  useStore((s) => s.tick);

  const asset = ASSETS[selectedAsset];
  const [qtyStr, setQtyStr] = useState("10");
  const [seriesId, setSeriesId] = useState(0);
  const [source, setSource] = useState<"holdings" | "manual">("manual");
  const [purchased, setPurchased] = useState<Contract | null>(null);
  const [isRenewal, setIsRenewal] = useState(false);

  // Consume a renewal prefill: quantity only — a fresh quote otherwise.
  useEffect(() => {
    if (renewalPrefill && renewalPrefill.assetId === selectedAsset) {
      setQtyStr(renewalPrefill.quantity);
      setPurchased(null);
      setIsRenewal(true);
      clearRenewalPrefill();
    }
  }, [renewalPrefill, selectedAsset, clearRenewalPrefill]);

  const qty = useMemo(() => {
    const n = parseFloat(qtyStr);
    return isNaN(n) || n <= 0 ? 0n : toFixed(n);
  }, [qtyStr]);

  const seriesList = [engine.getSeries(selectedAsset, 0), engine.getSeries(selectedAsset, 1)];
  const spot = toFixed(DEMO_SPOT[selectedAsset]);
  const secondsToExpiry = seriesList[0].expiryTs - engine.now();

  const selected = seriesList[seriesId];
  const quote = qty > 0n ? quotePremium(selectedAsset, qty, selected.strike, spot, secondsToExpiry) : null;
  const notional = qty > 0n ? qty * selected.strike / 1_000_000n : 0n;
  const premiumPct = quote && notional > 0n ? fromFixed(quote.premium) / fromFixed(notional) : 0;

  const canBuy = qty > 0n && quote && walletBalance >= quote.premium && qty <= selected.maxContractSize;

  function doPurchase() {
    purchase(selectedAsset, seriesId, qty);
    setPurchased(contractsFor(selectedAsset)[0]);
  }

  return (
    <>
      {isRenewal && (
        <div className="callout" style={{ marginBottom: 16 }}>
          🔄 Renewing coverage — this is a <strong>fresh quote</strong>. Quantity is prefilled; strike, premium, expiry and reference are re-quoted. Your previous contract keeps its own terms and is unaffected.
        </div>
      )}
      <div className="card-title">1 · Select asset</div>
      <div className="grid cols-2">
        {ASSETS.map((a) => (
          <div
            key={a.assetId}
            className={"asset-tile" + (a.assetId === selectedAsset ? " active" : "")}
            onClick={() => { selectAsset(a.assetId); setSeriesId(0); }}
          >
            {assetIcon(a)}
            <div style={{ flex: 1 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{a.symbol}</strong>
                <span className={"pill " + (a.active ? "green" : "amber")}>{a.active ? "live-reference" : "synthetic only"}</span>
              </div>
              <div className="faint" style={{ fontSize: 12 }}>{a.name}</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>Protects: {a.referenceLabel}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="callout" style={{ marginTop: 14 }}>
        {asset.kind === "EquityToken"
          ? "Coverage references the underlying listed-stock benchmark (an oracle observation, not an exchange close). Token-market discounts are excluded."
          : "Coverage references a specified token-market median (Jupiter Price API). This is not an independently observed public-stock price."}
      </div>

      <div style={{ height: 18 }} />
      <div className="grid cols-2">
        <div className="card">
          <div className="card-title">2 · Exposure</div>
          <div className="row" style={{ marginBottom: 12 }}>
            <button className={"btn sm " + (source === "manual" ? "primary" : "ghost")} onClick={() => setSource("manual")}>Manual qty</button>
            <button
              className={"btn sm " + (source === "holdings" ? "primary" : "ghost")}
              onClick={() => { setSource("holdings"); setQtyStr(String(fromFixed(holdings[selectedAsset] || 0n))); }}
            >
              Use holdings ({fmtQty(holdings[selectedAsset] || 0n)})
            </button>
          </div>
          <label className="field">
            <span className="lbl">Protected quantity ({asset.symbol} {asset.kind === "EquityToken" ? "share-equivalents" : "token units"})</span>
            <input className="input" value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} />
          </label>
          <div className="kv" style={{ marginTop: 12 }}><span className="k">Max contract size</span><span className="v mono">{fmtQty(selected.maxContractSize, 0)}</span></div>
          <div className="kv"><span className="k">Your holdings (read-only demo)</span><span className="v mono">{fmtQty(holdings[selectedAsset] || 0n)}</span></div>
          <div className="disclosure" style={{ marginTop: 10 }}>
            Buying protection does not move or escrow your tokens. Holdings and purchased protection are tracked separately.
          </div>
        </div>

        <div className="card">
          <div className="card-title">3 · Strike & expiry</div>
          <div className="grid cols-2">
            {seriesList.map((s, i) => {
              const q = qty > 0n ? quotePremium(selectedAsset, qty, s.strike, spot, secondsToExpiry) : null;
              return (
                <div key={i} className={"strike-option" + (seriesId === i ? " active" : "")} onClick={() => setSeriesId(i)}>
                  <div className="between">
                    <strong className="mono">{fmtPrice(s.strike)}</strong>
                    <span className="pill gray">strike {i + 1}</span>
                  </div>
                  <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>Premium</div>
                  <div className="stat-value sm mono">{q ? fmtTokens(q.premium) : "—"}</div>
                </div>
              );
            })}
          </div>
          <div className="kv" style={{ marginTop: 14 }}><span className="k">Shared weekly expiry</span><span className="v mono">{fmtClock(selected.expiryTs)}</span></div>
          <div className="kv"><span className="k">Remaining time</span><span className="v mono">{fmtDuration(secondsToExpiry)}</span></div>
          <div className="kv"><span className="k">Exercise cutoff</span><span className="v mono">{fmtClock(selected.exerciseCutoffTs)}</span></div>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <div className="card">
        <div className="card-title">4 · Review & purchase</div>
        <div className="grid cols-3">
          <Stat label="Protected notional" value={fmtTokens(notional) + " oUSD"} />
          <Stat label="Premium" value={quote ? fmtTokens(quote.premium) + " oUSD" : "—"} />
          <Stat label="Premium / notional / wk" value={quote ? fmtPct(premiumPct) : "—"} />
        </div>
        <div className="hr" />
        <div className="grid cols-2">
          <div>
            <div className="kv"><span className="k">Reference source</span><span className="v">{asset.referenceLabel}</span></div>
            <div className="kv"><span className="k">Exercise settlement delay</span><span className="v">{asset.kind === "EquityToken" ? "next feed obs after request" : "5-min median window"}</span></div>
            <div className="kv"><span className="k">Excludes</span><span className="v">{asset.kind === "EquityToken" ? "token-market discount, dividends" : "time value after early exercise"}</span></div>
            <div className="kv"><span className="k">Outage / event fallback</span><span className="v">disclosed demo refund</span></div>
          </div>
          <div className="card" style={{ background: "var(--bg)", margin: 0 }}>
            <div className="card-title">Scenario at expiry</div>
            {quote && <ScenarioMini qty={qty} strike={selected.strike} premium={quote.premium} spot={spot} />}
          </div>
        </div>
        <div className="hr" />
        <div className="between">
          <div className="disclosure">Quote valid 60s · signed by the quote service · replay-protected · fees are zero in the demo.</div>
          <button className="btn primary" disabled={!canBuy} onClick={doPurchase}>
            {qty > 0n && quote && walletBalance < quote.premium ? "Insufficient demo balance" : "Purchase protection"}
          </button>
        </div>
        {purchased && (
          <div className="callout" style={{ marginTop: 14 }}>
            ✓ Contract #{purchased.contractId.toString()} created — protecting {fmtQty(purchased.originalQuantity)} {asset.symbol} at {fmtPrice(purchased.strike)}. See the Portfolio tab.
          </div>
        )}
      </div>
    </>
  );
}

function ScenarioMini({ qty, strike, premium, spot }: { qty: bigint; strike: bigint; premium: bigint; spot: bigint }) {
  const rows = [
    { label: "Ref +5%", ref: (spot * 105n) / 100n },
    { label: "At strike", ref: strike },
    { label: "Ref −15%", ref: (spot * 85n) / 100n },
    { label: "Ref −30%", ref: (spot * 70n) / 100n },
  ];
  return (
    <table className="log">
      <thead><tr><th>Case</th><th>Ref</th><th>Payout</th><th>Net</th></tr></thead>
      <tbody>
        {rows.map((r) => {
          const pay = intrinsic(qty, strike, r.ref);
          const net = pay - premium;
          return (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="mono">{fmtPrice(r.ref)}</td>
              <td className="mono">{fmtTokens(pay)}</td>
              <td className={"mono " + (net >= 0n ? "pos" : "neg")}>{net >= 0n ? "+" : ""}{fmtTokens(net)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={"stat-value sm mono " + (tone || "")}>{value}</div>
    </div>
  );
}

// ------------------------------------------------------- Renewal reminders ---
function RemindersPanel() {
  const engine = useStore((s) => s.engine);
  const allContracts = useStore((s) => s.allContracts);
  const reminders = useStore((s) => s.reminders);
  const toggleReminder = useStore((s) => s.toggleReminder);
  const renew = useStore((s) => s.renew);
  const externalReminders = useStore((s) => s.externalReminders);
  const setExternalReminders = useStore((s) => s.setExternalReminders);
  useStore((s) => s.tick);

  const now = engine.now();
  const open = allContracts().filter((c) => c.status === "Active" || c.status === "PartiallySettled");
  if (open.length === 0) return null;

  const reminded = open.filter((c) => reminders.has(c.contractId.toString()));
  const expiringSoon = open.filter(
    (c) => !reminders.has(c.contractId.toString()) && c.expiryTs - now <= 48 * 3600,
  );

  const Line = ({ c, action }: { c: Contract; action: "remove" | "add" }) => {
    const asset = ASSETS[c.assetId];
    return (
      <div className="between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <div>
          <strong>#{c.contractId.toString()} · {asset.symbol}</strong>{" "}
          <span className="dim">{fmtQty(c.remainingQuantity)} protected · expires in {fmtDuration(c.expiryTs - now)}</span>
        </div>
        <div className="row">
          <button className="btn primary sm" onClick={() => renew(c.contractId)}>Renew</button>
          <button className="btn ghost sm" onClick={() => toggleReminder(c.contractId)}>
            {action === "remove" ? "Remove" : "Remind me"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="between" style={{ marginBottom: 8 }}>
        <div className="card-title" style={{ margin: 0 }}>Renewal reminders</div>
        <button
          className={"btn sm " + (externalReminders ? "primary" : "ghost")}
          onClick={() => setExternalReminders(!externalReminders)}
          title="External delivery requires explicit opt-in (PRD §18)"
        >
          {externalReminders ? "✓ Email reminders on (demo)" : "Enable email reminders (opt-in)"}
        </button>
      </div>

      {reminded.length === 0 && expiringSoon.length === 0 ? (
        <div className="faint" style={{ fontSize: 12 }}>No reminders set. Use “Remind me” on a contract to be nudged before expiry.</div>
      ) : (
        <>
          {reminded.map((c) => <Line key={c.contractId.toString()} c={c} action="remove" />)}
          {expiringSoon.length > 0 && (
            <>
              <div className="faint" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", margin: "12px 0 4px" }}>Expiring within 48h — no reminder set</div>
              {expiringSoon.map((c) => <Line key={c.contractId.toString()} c={c} action="add" />)}
            </>
          )}
        </>
      )}
      <div className="disclosure" style={{ marginTop: 10 }}>
        In-app reminders by default; external channels require the explicit opt-in above. Renewal opens a <strong>fresh quote</strong> — no automatic purchase or spending, and old terms never carry over silently.
      </div>
    </div>
  );
}

// ----------------------------------------------------------- Portfolio tab ---
function PortfolioTab() {
  const selectedAsset = useStore((s) => s.selectedAsset);
  const selectAsset = useStore((s) => s.selectAsset);
  const contractsFor = useStore((s) => s.contractsFor);
  const holdings = useStore((s) => s.holdings);
  useStore((s) => s.tick);

  const asset = ASSETS[selectedAsset];
  const contracts = contractsFor(selectedAsset);

  const activeProtected = contracts.filter((c) => c.status === "Active" || c.status === "PartiallySettled").reduce((a, c) => a + c.remainingQuantity, 0n);
  const pending = contracts.reduce((a, c) => a + c.pendingQuantity, 0n);
  const held = holdings[selectedAsset] || 0n;
  const unprotected = held > activeProtected ? held - activeProtected : 0n;
  const excess = activeProtected > held ? activeProtected - held : 0n;

  return (
    <>
      <RemindersPanel />

      <div className="row" style={{ marginBottom: 16 }}>
        {ASSETS.map((a) => (
          <button key={a.assetId} className={"btn sm " + (a.assetId === selectedAsset ? "primary" : "ghost")} onClick={() => selectAsset(a.assetId)}>{a.symbol}</button>
        ))}
      </div>

      <div className="card">
        <div className="card-title">Coverage tracker — {asset.symbol}</div>
        <div className="grid cols-3">
          <Stat label="Holdings (read-only)" value={fmtQty(held)} />
          <Stat label="Active protected" value={fmtQty(activeProtected)} tone="pos" />
          <Stat label="Pending exercise" value={fmtQty(pending)} />
        </div>
        <div className="hr" />
        <div className="grid cols-2">
          <Stat label="Unprotected holdings" value={fmtQty(unprotected)} tone={unprotected > 0n ? "neg" : undefined} />
          <Stat label="Protection beyond holdings" value={fmtQty(excess)} tone={excess > 0n ? "neg" : undefined} />
        </div>
        <div className="disclosure" style={{ marginTop: 10 }}>
          Informational only — the tracker never modifies contracts. Buying or selling {asset.symbol} changes this ratio; your contracts keep their purchased terms.
        </div>
      </div>

      <div style={{ height: 8 }} />
      {contracts.length === 0 ? (
        <div className="card empty">No contracts for {asset.symbol} yet. Buy protection in the Protect tab.</div>
      ) : (
        contracts.map((c) => <ContractCard key={c.contractId.toString()} contract={c} />)
      )}
    </>
  );
}

function statusPill(status: Contract["status"]) {
  const map: Record<Contract["status"], string> = {
    Active: "green", PartiallySettled: "blue", Exercised: "gray", Expired: "gray", Refunded: "amber", Cancelled: "gray",
  };
  return <span className={"pill " + map[status]}>{status}</span>;
}

function ContractCard({ contract: c }: { contract: Contract }) {
  const engine = useStore((s) => s.engine);
  const requestExercise = useStore((s) => s.requestExercise);
  const settleExercise = useStore((s) => s.settleExercise);
  const failExercise = useStore((s) => s.failExercise);
  const settleExpiry = useStore((s) => s.settleExpiry);
  const advanceToExpiry = useStore((s) => s.advanceToExpiry);
  const reminders = useStore((s) => s.reminders);
  const toggleReminder = useStore((s) => s.toggleReminder);
  const renew = useStore((s) => s.renew);
  useStore((s) => s.tick);

  const asset = ASSETS[c.assetId];
  const [exQty, setExQty] = useState("");
  const [refPrice, setRefPrice] = useState(String(DEMO_SPOT[c.assetId]));
  const open = c.status === "Active" || c.status === "PartiallySettled";
  const now = engine.now();
  const expiringSoon = open && c.expiryTs - now <= 48 * 3600;
  const beforeExerciseCutoff = now <= c.exerciseCutoffTs;
  const afterExpiry = now >= c.expiryTs;
  const indic = intrinsic(c.remainingQuantity, c.strike, toFixed(parseFloat(refPrice) || 0));
  const pendingReqs = c.requests.filter((r) => r.status === "Pending");

  return (
    <div className="card">
      <div className="between">
        <div className="row">
          {assetIcon(asset)}
          <div>
            <div className="row" style={{ gap: 8 }}>
              <strong>#{c.contractId.toString()} · {asset.symbol}</strong>
              {statusPill(c.status)}
              {reminders.has(c.contractId.toString()) && <span className="pill blue">🔔 reminder</span>}
              {expiringSoon && <span className="pill amber">expiring soon</span>}
            </div>
            <div className="faint" style={{ fontSize: 12 }}>strike {fmtPrice(c.strike)} · expiry {fmtClock(c.expiryTs)} · {fmtDuration(c.expiryTs - now)} left</div>
          </div>
        </div>
        <div className="row">
          <button className="btn ghost sm" onClick={() => renew(c.contractId)}>Renew</button>
          <button className="btn ghost sm" onClick={() => toggleReminder(c.contractId)}>
            {reminders.has(c.contractId.toString()) ? "Remove reminder" : "Remind me"}
          </button>
        </div>
      </div>

      <div className="hr" />
      <div className="grid cols-3">
        <Stat label="Remaining protected" value={fmtQty(c.remainingQuantity)} />
        <Stat label="Pending exercise" value={fmtQty(c.pendingQuantity)} />
        <Stat label="Premium paid" value={fmtTokens(c.premiumPaid) + " oUSD"} />
      </div>
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <Stat label={`Indicative payout @ ${refPrice}`} value={fmtTokens(indic) + " oUSD"} tone={indic > 0n ? "pos" : undefined} />
        <Stat label="Reserved collateral" value={fmtTokens(c.reservedCollateral) + " oUSD"} />
      </div>

      {/* pending request settlement (acting as keeper/publisher) */}
      {pendingReqs.map((r) => (
        <div key={r.nonce} className="callout" style={{ marginTop: 12 }}>
          <div className="between">
            <span>Request #{r.nonce}: {fmtQty(r.quantity)} pending · window ends {fmtClock(r.windowEnd)}</span>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input className="input" style={{ width: 120 }} value={refPrice} onChange={(e) => setRefPrice(e.target.value)} />
            <button className="btn primary sm" onClick={() => settleExercise(c.contractId, r.nonce, parseFloat(refPrice) || 0)}>Settle @ ref</button>
            {now > r.windowEnd && <button className="btn danger sm" onClick={() => failExercise(c.contractId, r.nonce)}>Fail (window elapsed)</button>}
          </div>
          <div className="disclosure" style={{ marginTop: 6 }}>
            {asset.kind === "EquityToken" ? "Settles on the next qualifying feed observation after the request." : "Settles on the median of a 5-minute window after the request."} Irrevocable; time value is forfeited.
          </div>
        </div>
      ))}

      {/* actions */}
      {open && (
        <>
          <div className="hr" />
          {beforeExerciseCutoff && c.remainingQuantity > 0n && (
            <div className="row" style={{ marginBottom: 10 }}>
              <input className="input" style={{ width: 140 }} placeholder="qty to exercise" value={exQty} onChange={(e) => setExQty(e.target.value)} />
              <button
                className="btn"
                disabled={!(parseFloat(exQty) > 0) || toFixed(parseFloat(exQty) || 0) > c.remainingQuantity}
                onClick={() => { requestExercise(c.contractId, toFixed(parseFloat(exQty))); setExQty(""); }}
              >
                Request early exercise
              </button>
              <button className="btn ghost sm" onClick={() => setExQty(String(fromFixed(c.remainingQuantity)))}>Max</button>
            </div>
          )}
          <div className="row">
            {!afterExpiry && <button className="btn ghost sm" onClick={() => advanceToExpiry(c.contractId)}>⏩ Advance sim to expiry</button>}
            {afterExpiry && c.remainingQuantity > 0n && c.pendingQuantity === 0n && (
              <>
                <input className="input" style={{ width: 120 }} value={refPrice} onChange={(e) => setRefPrice(e.target.value)} />
                <button className="btn primary sm" onClick={() => settleExpiry(c.contractId, parseFloat(refPrice) || 0, false)}>Settle expiry</button>
                <button className="btn danger sm" onClick={() => settleExpiry(c.contractId, 0, true)}>Invalid ref → refund</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- Compare tab ---
function CompareTab() {
  const [assetKey, setAssetKey] = useState(VERIFIED_ASSETS[0].key);
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const asset = assetByKey(assetKey)!;

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null); setMarket(null);
    const load = () => fetchMarket(asset.mint)
      .then((m) => { if (alive) { setMarket(m); setLoading(false); } })
      .catch((e) => { if (alive) { setErr(String(e.message || e)); setLoading(false); } });
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [assetKey]);

  const equity = asset.kind === "EquityToken";
  const token = market?.usdPrice ?? null;
  const bench = market?.benchmark ?? null;
  const basis = token != null && bench ? (token - bench) / bench : null;
  const mult = market?.scaledMultiplier ?? asset.scaledMultiplier;
  const solscan = `https://solscan.io/token/${asset.mint}`;

  return (
    <>
      <div className="callout" style={{ marginBottom: 16 }}>
        🟢 <strong>Live mainnet data</strong> — real Token-2022 mints, real Jupiter prices, and the real scaled-balance multiplier (verified {asset.verifiedAt}). The Optket contract stays a demo per §1; this reference/identity layer is real.
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        {VERIFIED_ASSETS.map((a) => (
          <button key={a.key} className={"btn sm " + (a.key === assetKey ? "primary" : "ghost")} onClick={() => setAssetKey(a.key)}>{a.symbol}</button>
        ))}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="between" style={{ marginBottom: 4 }}>
            <div className="card-title" style={{ margin: 0 }}>Token vs {equity ? "stock" : "issuer mark"} — {asset.symbol}</div>
            {market?.available ? <span className="pill green">live</span> : <span className="pill amber">{loading ? "loading…" : "unavailable"}</span>}
          </div>
          <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>{asset.name} · {asset.benchmarkLabel}</div>

          {err && <div className="callout warn">{err} — is <code>npm run quote-service</code> running?</div>}
          {loading && !market && <div className="empty">Fetching live mainnet data…</div>}
          {market?.available && (
            <>
              <div className="grid cols-3">
                <Stat label={equity ? "Stock benchmark" : "Issuer mark"} value={bench != null ? fmtUsd(bench) : "—"} />
                <Stat label="Token market" value={token != null ? fmtUsd(token) : "—"} />
                <Stat label="Basis" value={basis != null ? (basis >= 0 ? "+" : "") + fmtPct(basis) : "—"} tone={basis != null && basis < 0 ? "neg" : "pos"} />
              </div>
              <div className="hr" />
              <div className="kv"><span className="k">24h token change</span><span className={"v mono " + ((market.priceChange24h ?? 0) >= 0 ? "pos" : "neg")}>{market.priceChange24h != null ? (market.priceChange24h >= 0 ? "+" : "") + market.priceChange24h.toFixed(2) + "%" : "—"}</span></div>
              <div className="kv"><span className="k">Jupiter liquidity</span><span className="v mono">{market.liquidity != null ? fmtUsd(market.liquidity, 0) : "—"}</span></div>
              <div className="kv"><span className="k">Source time (live)</span><span className="v mono">{market.updatedAt ? new Date(market.updatedAt).toLocaleTimeString() : "—"}</span></div>
              <div className="callout" style={{ marginTop: 14 }}>
                {equity
                  ? <>A stock-benchmark contract references the underlying NVDA stock and <strong>excludes the token-market basis</strong> shown here ({basis != null ? fmtPct(Math.abs(basis)) : "—"} right now).</>
                  : <>This is an <strong>issuer mark</strong> for a private company — not an executable price and not an independent public benchmark (§15).</>}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title">§4 verification — {asset.symbol}</div>
          <div className="kv"><span className="k">Mint (mainnet)</span><span className="v mono" style={{ fontSize: 11 }}><a href={solscan} target="_blank" rel="noreferrer">{asset.mint.slice(0, 6)}…{asset.mint.slice(-4)}</a></span></div>
          <div className="kv"><span className="k">Token program</span><span className="v">{asset.program} <span className="pill green">verified</span></span></div>
          <div className="kv"><span className="k">Decimals</span><span className="v mono">{asset.decimals}</span></div>
          <div className="kv"><span className="k">Scaled multiplier (live)</span><span className="v mono">{mult.toFixed(10)}</span></div>
          <div className="kv"><span className="k">1 raw token equals</span><span className="v mono">{mult.toFixed(6)} share-equiv</span></div>
          <div className="kv"><span className="k">Underlying</span><span className="v">{asset.underlying}</span></div>
          <div className="kv"><span className="k">Jupiter coverage</span><span className="v">{asset.jupiter ? <span className="pill green">yes</span> : "no"}</span></div>
          <div className="disclosure" style={{ marginTop: 10 }}>
            Raw Token-2022 amounts are multiplied by the live scaled factor to get share-equivalents (§4.1) — applied when reading real holdings.
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------- Calculator tab ---
function CalculatorTab() {
  const selectedAsset = useStore((s) => s.selectedAsset);
  const selectAsset = useStore((s) => s.selectAsset);
  const engine = useStore((s) => s.engine);
  const asset = ASSETS[selectedAsset];
  const [qtyStr, setQtyStr] = useState("10");
  const [seriesId, setSeriesId] = useState(0);
  const [refStr, setRefStr] = useState(String(DEMO_SPOT[selectedAsset]));

  const qty = toFixed(parseFloat(qtyStr) || 0);
  const series = engine.getSeries(selectedAsset, seriesId);
  const spot = toFixed(DEMO_SPOT[selectedAsset]);
  const q = qty > 0n ? quotePremium(selectedAsset, qty, series.strike, spot, series.expiryTs - engine.now()) : null;
  const ref = toFixed(parseFloat(refStr) || 0);
  const payout = intrinsic(qty, series.strike, ref);
  const net = q ? payout - q.premium : 0n;
  const remainingExposure = qty; // tokens still held after exercise

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        {ASSETS.map((a) => (
          <button key={a.assetId} className={"btn sm " + (a.assetId === selectedAsset ? "primary" : "ghost")} onClick={() => { selectAsset(a.assetId); setRefStr(String(DEMO_SPOT[a.assetId])); }}>{a.symbol}</button>
        ))}
      </div>
      <div className="grid cols-2">
        <div className="card">
          <div className="card-title">Scenario inputs</div>
          <label className="field"><span className="lbl">Protected quantity</span><input className="input" value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} /></label>
          <div style={{ height: 12 }} />
          <label className="field"><span className="lbl">Strike</span>
            <select className="input" value={seriesId} onChange={(e) => setSeriesId(Number(e.target.value))}>
              <option value={0}>{fmtPrice(engine.getSeries(selectedAsset, 0).strike)}</option>
              <option value={1}>{fmtPrice(engine.getSeries(selectedAsset, 1).strike)}</option>
            </select>
          </label>
          <div style={{ height: 12 }} />
          <label className="field"><span className="lbl">Hypothetical settlement reference {asset.kind === "EquityToken" ? "(stock benchmark)" : "(token-market)"}</span>
            <input className="input" value={refStr} onChange={(e) => setRefStr(e.target.value)} />
          </label>
          <input type="range" min={fromFixed(spot) * 0.4} max={fromFixed(spot) * 1.3} step={0.5} value={parseFloat(refStr) || 0} onChange={(e) => setRefStr(e.target.value)} style={{ width: "100%", marginTop: 12 }} />
          <div className="disclosure" style={{ marginTop: 8 }}>Hypothetical input — not the eventual settlement value. Uses the same payout arithmetic as the contract engine.</div>
        </div>
        <div className="card">
          <div className="card-title">Result</div>
          <div className="grid cols-2">
            <Stat label="Gross payout" value={fmtTokens(payout) + " oUSD"} tone={payout > 0n ? "pos" : undefined} />
            <Stat label="Premium paid" value={q ? fmtTokens(q.premium) + " oUSD" : "—"} />
          </div>
          <div className="hr" />
          <Stat label="Net result from protection" value={(net >= 0n ? "+" : "") + fmtTokens(net) + " oUSD"} tone={net >= 0n ? "pos" : "neg"} />
          <div className="hr" />
          <div className="kv"><span className="k">Outcome vs strike</span><span className="v">{ref < series.strike ? "below — pays intrinsic" : ref === series.strike ? "at strike — zero" : "above — zero payout"}</span></div>
          <div className="kv"><span className="k">Remaining token exposure after exercise</span><span className="v mono">{fmtQty(remainingExposure)} {asset.symbol}</span></div>
          <div className="disclosure" style={{ marginTop: 10 }}>
            Your {asset.symbol} tokens remain exposed to the market after exercised protection ends. {asset.kind === "EquityToken" && "A stock-benchmark contract excludes any token-market discount."}
          </div>
        </div>
      </div>
    </>
  );
}

// --------------------------------------------------------- Underwriter tab ---
function UnderwriterTab() {
  const engine = useStore((s) => s.engine);
  useStore((s) => s.tick);
  return (
    <>
      <div className="callout warn" style={{ marginBottom: 16 }}>
        Modeled underwriting economics. Realized demo outcomes are shown separately from modeled costs. Unavailable hedges are flagged and never modeled as executable.
      </div>
      <div className="grid cols-2">
        {ASSETS.map((a) => {
          const e = underwriterEconomics(engine, a.assetId);
          return (
            <div key={a.assetId} className="card">
              <div className="between" style={{ marginBottom: 12 }}>
                <strong>{a.symbol}</strong>
                <span className={"pill " + (e.hedgeAvailable ? "green" : "amber")}>{e.hedgeAvailable ? "hedge investigable" : "no executable hedge"}</span>
              </div>
              <div className="card-title">Realized (demo)</div>
              <div className="kv"><span className="k">Premium receipts</span><span className="v mono">{fmtUsd(e.premiumReceipts)}</span></div>
              <div className="kv"><span className="k">Gross payouts</span><span className="v mono">{fmtUsd(e.grossPayouts)}</span></div>
              <div className="kv"><span className="k">Refunds</span><span className="v mono">{fmtUsd(e.refunds)}</span></div>
              <div className="kv"><span className="k">Realized net</span><span className={"v mono " + (e.realizedNet >= 0 ? "pos" : "neg")}>{fmtUsd(e.realizedNet)}</span></div>

              <div className="card-title" style={{ marginTop: 16 }}>Capital</div>
              <div className="kv"><span className="k">Available / reserved</span><span className="v mono">{fmtUsd(e.availableCapital, 0)} / {fmtUsd(e.reservedCapital, 0)}</span></div>
              <div className="bar" style={{ marginTop: 8 }}><span style={{ width: fmtPct(e.utilization), background: "var(--blue)" }} /></div>
              <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>utilization {fmtPct(e.utilization)}</div>

              <div className="card-title" style={{ marginTop: 16 }}>Modeled costs</div>
              <div className="kv"><span className="k">Execution + funding</span><span className="v mono">{fmtUsd(e.executionFundingCost)}</span></div>
              <div className="kv"><span className="k">Operating expense</span><span className="v mono">{fmtUsd(e.operatingExpense)}</span></div>
              <div className="kv"><span className="k">Capital opportunity cost</span><span className="v mono">{fmtUsd(e.capitalOpportunityCost)}</span></div>
              <div className="kv"><span className="k">Risk allowance</span><span className="v mono">{fmtUsd(e.riskAllowance)}</span></div>
              <div className="kv"><span className="k">Modeled hedge result</span><span className="v mono">{e.hedgeAvailable ? fmtUsd(e.modeledHedgeResult) : "n/a"}</span></div>

              <div className="hr" />
              <div className="kv"><span className="k">Modeled net (unhedged)</span><span className={"v mono " + (e.modeledNetUnhedged >= 0 ? "pos" : "neg")}>{fmtUsd(e.modeledNetUnhedged)}</span></div>
              <div className="kv"><span className="k">Modeled net (hedged)</span><span className="v mono">{e.modeledNetHedged === null ? "n/a" : fmtUsd(e.modeledNetHedged)}</span></div>
              <div className="kv"><span className="k">Stress: ref −20%</span><span className="v mono neg">−{fmtUsd(e.stressLossAtMinus20pct, 0)}</span></div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ------------------------------------------------------------- History tab ---
function HistoryTab() {
  const log = useStore((s) => s.log);
  useStore((s) => s.tick);
  if (log.length === 0) return <div className="card empty">No activity yet.</div>;
  return (
    <div className="card">
      <div className="card-title">Activity log (PRD §13.7)</div>
      <table className="log">
        <thead><tr><th>Time</th><th>Event</th><th>Contract</th><th>Detail</th></tr></thead>
        <tbody>
          {log.map((l, i) => (
            <tr key={i}>
              <td className="mono faint">{fmtClock(l.ts)}</td>
              <td><span className={"pill " + logTone(l.kind)}>{l.kind}</span></td>
              <td className="mono">#{l.contractId.toString()}</td>
              <td className="dim">{l.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="disclosure" style={{ marginTop: 12 }}>
        In the on-chain build each row links to a Solana explorer transaction. Here the engine runs locally as a faithful mirror of the program accounting.
      </div>
    </div>
  );
}

function logTone(kind: string): string {
  return { purchase: "green", request: "blue", settle: "green", expiry: "gray", refund: "amber", fail: "red" }[kind] || "gray";
}
