import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { VaultClient, roundStage, type VaultRoundAccount, type VaultDepositAccount, type VaultPositionAccount } from "../client/vaultProgram";
import { useChain, explorerUrl } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import { fmtClock, fmtOusd } from "../format";
import { useNowSeconds } from "../useNowSeconds";
import { pendingTransaction } from "../onchain/transactionRecovery";
import AssetSelector from "./AssetSelector";
import { redemptionValue } from "../client/vaultPortfolio";
import { useAssetAvailability } from "../data/useAssetAvailability";
import "./VaultsTab.css";

const token = (n: bigint) => fmtOusd(Number(n) / 1e6);
function parseVaultAmount(text: string): bigint | null {
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const n = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return n > 0n && n <= 18446744073709551615n ? n : null;
}

export type VaultDraft = { asset: number; amount: string };
export default function VaultsTab({ onOpenPosition, embedded = false, initialDraft, onDraftChange }: { onOpenPosition: (asset: number) => void; embedded?: boolean; initialDraft?: VaultDraft; onDraftChange?: (draft: VaultDraft) => void }) {
  const chain = useChain();
  const now = useNowSeconds();
  const client = useMemo(() => new VaultClient(chain.conn), [chain.conn]);
  const [assetChoice, setAsset] = useState(initialDraft?.asset ?? 0);
  const [rounds, setRounds] = useState<VaultRoundAccount[]>([]);
  const [roundChoice, setRoundChoice] = useState<string | null>(() => embedded ? null : new URLSearchParams(window.location.search).get("round"));
  const [deposits, setDeposits] = useState<Record<string, VaultDepositAccount | null>>({});
  const [adminDeposits, setAdminDeposits] = useState<Record<string, VaultDepositAccount | null>>({});
  const [positions, setPositions] = useState<VaultPositionAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [loadedScope, setLoadedScope] = useState("");
  const scope = `${chain.conn.rpcEndpoint}:${chain.address ?? "public"}`;
  const [amountText, setAmountText] = useState(initialDraft?.amount ?? "100");
  useEffect(() => { onDraftChange?.({ asset: assetChoice, amount: amountText }); }, [assetChoice, amountText, onDraftChange]);
  const [review, setReview] = useState<{ round: string; scope: string; amount: bigint; action: "deposit" | "cancel" | "redeem" } | null>(null);
  const [receipt, setReceipt] = useState<{ round: string; signature: string; action: string } | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const generation = useRef(0);
  const refreshing = useRef(false);
  const reviewRef = useRef<HTMLElement>(null);
  const reviewTrigger = useRef<HTMLElement | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  function cancelReview() { setReview(null); reviewTrigger.current?.focus(); }
  useEffect(() => {
    if (review) { reviewRef.current?.scrollIntoView({ block: "center", behavior: "instant" }); reviewRef.current?.focus({ preventScroll: true }); }
  }, [review]);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const request = ++generation.current;
    setLoading(true);
    try {
      const [next, contracts] = await Promise.all([client.rounds(), client.positions()]);
      const mine: Record<string, VaultDepositAccount | null> = {};
      const administrators: Record<string, VaultDepositAccount | null> = {};
      // Bound concurrent account reads for RPC providers with small request limits.
      const ownedDeposits = chain.address ? await client.depositsForOwner(new PublicKey(chain.address)) : [];
      const seeds = (await Promise.all([...new Set(next.map(r => r.administrator.toBase58()))]
        .map(owner => client.depositsForOwner(new PublicKey(owner))))).flat();
      for (const round of next) {
        const owned = ownedDeposits.find(d => d.round.equals(round.address)) ?? null;
        const seeded = seeds.find(d => d.round.equals(round.address)) ?? null;
        mine[round.address.toBase58()] = owned;
        administrators[round.address.toBase58()] = seeded;
      }
      if (request !== generation.current) return;
      setRounds(next); setPositions(contracts); setDeposits(mine); setAdminDeposits(administrators);
      setLoadedAt(Math.floor(Date.now() / 1000)); setLoadedScope(scope); setError(null);
    } catch { if (request === generation.current) setError("Vault data could not be refreshed. Retry before submitting a transaction."); }
    finally { refreshing.current = false; if (request === generation.current) setLoading(false); }
  }, [client, chain.address, scope]);
  useEffect(() => {
    const cancel = () => { ++generation.current; };
    const stop = visiblePolling(refresh, 15000);
    return () => { cancel(); stop(); };
  }, [refresh]);
  const linked = rounds.find(r => r.address.toBase58() === roundChoice);
  const asset = linked?.assetId ?? assetChoice;
  const displayedAsset = asset;
  const availability = useAssetAvailability(asset, chain.svcUrl);
  const choices = rounds.filter(r => r.assetId === displayedAsset).sort((a, b) => b.fundingClose - a.fundingClose);
  const selected = choices.find(r => r.address.toBase58() === roundChoice) ?? choices.find(r => roundStage(r, now) === "Funding") ?? choices[0];
  const address = selected?.address.toBase58();
  const owned = address && loadedScope === scope ? deposits[address] : null;
  const admin = address ? adminDeposits[address] : null;
  const stage = selected ? roundStage(selected, now) : null;
  const frozen = chain.busy || loadedScope !== scope || !loadedAt || !!error || now - loadedAt > 30 || !!pendingTransaction(chain.transaction, chain.conn.rpcEndpoint, chain.address);
  const amount = parseVaultAmount(amountText);
  const currentReview = review && review.round === address && review.scope === scope ? review : null;
  const freshRound = loadedScope === scope && loadedAt > 0 && now - loadedAt <= 30 && !error;
  const canDeposit = freshRound && stage === "Funding" && availability.data != null && !availability.data.depositsPaused && !!selected && selected.totalShares < selected.depositCap;
  const buyerCapacity = selected && availability.data ? [selected.principalAvailable, selected.exposureCap - selected.reserved, BigInt(availability.data.availableExposure)].reduce((a, b) => a < b ? a : b) : 0n;
  const buyerStatus = !freshRound ? "Checking round availability" : !availability.data ? availability.label : !availability.data.canQuote ? availability.label
    : stage === "Funding" ? "Buyer positions open after funding closes" : stage !== "Active" ? "Round closed to new positions"
    : !selected || now >= selected.salesClose || selected.latestExpiry - now < 300 ? "Round closed to new positions"
    : buyerCapacity <= 0n ? "Capacity reached · no uncommitted capital" : "Available to back new positions";
  const exposures = positions.filter(p => p.round.toBase58() === address);
  const funding = choices.find(r => roundStage(r, now) === "Funding");
  const settled = choices.filter(r => r.phase === "redeemable" && r.totalShares > 0n);
  const ownedValue = selected && owned ? redemptionValue(selected, owned) : null;
  function chooseRound(value: string) {
    setRoundChoice(value); setReview(null); setFieldError(null);
    const url = new URL(window.location.href); url.searchParams.set("round", value);
    window.history.replaceState(null, "", url);
  }

  function begin(action: "deposit" | "cancel" | "redeem") {
    reviewTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!selected) return;
    if (action === "deposit" && !canDeposit) { setFieldError("Deposits are not currently available. Refresh availability."); return; }
    const value = action === "deposit" ? amount : owned?.shares ?? 0n;
    if (value == null || value <= 0n) { setFieldError("Enter an amount above zero, with up to six decimal places."); amountRef.current?.focus(); return; }
    if (action === "deposit" && value > selected.depositCap - selected.totalShares) { setFieldError("This amount exceeds the round’s remaining capacity. Enter a smaller amount."); amountRef.current?.focus(); return; }
    if (action === "deposit" && Number(value) / 1e6 > chain.tokenBalance) { setFieldError("This amount exceeds your test-oUSD balance. Enter a smaller amount."); amountRef.current?.focus(); return; }
    setFieldError(null); setReceipt(null); setReview({ round: selected.address.toBase58(), scope, amount: value, action });
  }
  async function confirm() {
    if (!currentReview || !selected || frozen) return;
    if (currentReview.action === "deposit" && !canDeposit) { setReview(null); setFieldError("Deposit availability changed. Review again."); return; }
    if (currentReview.action !== "redeem" && stage !== "Funding") { setReview(null); setFieldError("The funding window has closed."); return; }
    try {
      const signature = await chain.vaultAction(selected, currentReview.action, currentReview.amount);
      setReceipt({ round: currentReview.round, signature, action: currentReview.action === "deposit" ? "Deposit confirmed" : currentReview.action === "cancel" ? "Deposit returned" : "Redemption confirmed" });
      setReview(null); await refresh();
    } catch (e) { setFieldError(e instanceof Error ? e.message : "Transaction could not be confirmed. Check its status before retrying."); }
  }

  return <section className={"vaults-page" + (embedded ? " vaults-embedded" : "")} aria-label="Fund a vault">
    {!embedded && <div className="app-page-head"><div><h1>Fund a vault</h1><p>Share in premiums. Your capital funds payouts.</p></div></div>}
    <AssetSelector value={displayedAsset} label="Choose a vault" disabled={chain.busy} onChange={i => { setAsset(i); setRoundChoice(null); setReview(null); setFieldError(null);
      const url = new URL(window.location.href); url.searchParams.delete("round"); window.history.replaceState(null, "", url);
    }} />
    {error && <div className="callout warn" role="alert">{error} <button className="btn ghost" disabled={loading} onClick={() => void refresh()}>Retry</button></div>}
    {!selected ? <section className="card empty" aria-busy={loading} role="status"><h2>{loading ? "Loading vault…" : "No round published yet"}</h2><p>{loading ? "Checking deposits and available capital." : "This vault has no published round. Deposits open when a funding window is available."}</p><button className="btn ghost" disabled={loading} onClick={() => void refresh()}>Refresh</button></section> : <>
      <div className="vault-round-header"><h2>{VERIFIED_ASSETS[displayedAsset].symbol} vault</h2></div>
      <p className="disclosure" role="status">{!freshRound ? "Checking deposit availability" : canDeposit ? "Accepting deposits" : stage === "Funding" ? !availability.data ? "Checking deposit availability" : availability.data.depositsPaused ? "Deposits paused" : "Deposit capacity reached" : owned?.shares && !owned.redeemed && stage === "Redeemable" ? "Ready to withdraw" : owned?.shares && !owned.redeemed ? "Capital locked" : owned?.redeemed ? "Withdrawn" : "Funding closed"} <button className="text-action" onClick={() => { availability.refresh(); void refresh(); }}>Refresh availability</button></p>
      {!embedded && <ol className="vault-journey" aria-label="Deposit lifecycle">
        {["Deposit", "Capital locked", "Settlement", "Withdraw"].map((label, i) => <li key={label} aria-current={i === (stage === "Funding" ? 0 : stage === "Redeemable" ? 3 : stage === "Settling" ? 2 : 1) ? "step" : undefined}><span>0{i + 1}</span><strong>{label}</strong><small>{i === 0 ? `Until ${fmtClock(selected.fundingClose)}` : i === 1 ? "Funds back buyer payouts" : i === 2 ? `Latest expiry ${fmtClock(selected.latestExpiry)}` : "After every obligation resolves"}</small></li>)}
      </ol>}
      {funding && funding.address.toBase58() !== address && <div className="vault-next-round"><span>A new round is accepting deposits. Your existing deposit stays in this round.</span><button className="btn ghost" onClick={() => chooseRound(funding.address.toBase58())}>View funding round</button></div>}
      <div className="vault-workspace"><section className="card vault-deposit-panel"><h2>{owned?.shares ? "Your deposit" : stage === "Funding" ? "Deposit" : "Deposits are closed"}</h2>
        {stage === "Funding" && <div className="vault-amount-entry">          <label className="field" htmlFor="vault-amount"><span className="lbl">Deposit amount · oUSD</span><input ref={amountRef} id="vault-amount" form="vault-deposit-form" className="input mono" type="text" inputMode="decimal" autoComplete="off" value={amountText} disabled={chain.busy}
            aria-invalid={!!fieldError} aria-describedby={[chain.connected && "vault-amount-help", fieldError && "vault-field-error"].filter(Boolean).join(" ") || undefined} onChange={e => { setAmountText(e.target.value); setReview(null); setFieldError(null); }} /></label>
          {chain.connected && <p id="vault-amount-help" className="disclosure">Balance {fmtOusd(chain.tokenBalance)}</p>}
</div>}
        <dl className="vault-lock-summary">
          {stage === "Funding" && <div><dt>Funding closes</dt><dd>{fmtClock(selected.fundingClose)}</dd></div>}
          <div><dt>Latest contract expiry</dt><dd>{fmtClock(selected.latestExpiry)}</dd></div>
        </dl>
        <p>{stage === "Redeemable" ? "This round has settled." : stage === "Funding" ? "Funds lock when funding closes and unlock after settlement completes." : "Funds unlock after settlement completes."}</p>
        {ownedValue != null && owned && <p>Final net result: <strong className="mono">{token(ownedValue - owned.shares)}</strong> · test activity</p>}
        {owned && owned.shares > 0n ? <><strong className="vault-owned mono">{token(owned.shares)}</strong><p>{selected.totalShares > 0n ? (Number(owned.shares * 10000n / selected.totalShares) / 100).toFixed(2) : "0"}% of this round{stage === "Funding" ? " · changes as deposits arrive" : " · ownership fixed"}</p>
          {owned.redeemed ? <p className="callout">Withdrawn {token(owned.redemptionAmount)}</p> : stage !== "Funding" && stage !== "Redeemable" ? <p>Your capital is locked until settlement completes.</p> : stage === "Redeemable" ? <><p>Available to withdraw: <strong>{token(owned.shares * selected.finalBalance / selected.totalShares)}</strong></p><button className="btn primary" disabled={frozen} onClick={() => begin("redeem")}>Review withdrawal</button></> : null}</> : null}
        {stage === "Funding" && <form id="vault-deposit-form" onSubmit={e => { e.preventDefault(); if (!chain.connected) { void chain.connect(); return; } begin("deposit"); }}>
          <p>You can cancel during the funding window.</p>
          <button className="btn primary" type="submit" aria-busy={chain.busy} disabled={chain.busy || (chain.connected && (frozen || !canDeposit))}>{chain.busy ? chain.status || "Connecting…" : chain.connected ? "Review deposit" : "Start with a demo wallet"}</button>
          {!!owned?.shares && !owned.redeemed && <button className="btn ghost" type="button" disabled={frozen} onClick={() => begin("cancel")}>Withdraw funding deposit</button>}
        </form>}
        {!chain.connected && stage !== "Funding" && <button className="btn primary" disabled={chain.busy} onClick={() => void chain.connect()}>{chain.busy ? "Connecting…" : "Connect to view your deposit"}</button>}
        {stage !== "Funding" && !owned?.shares && <p className="disclosure">Choose another published funding round when available. No next opening time is confirmed.</p>}
        {currentReview && <section ref={reviewRef} tabIndex={-1} className="purchase-review" aria-label="Review vault transaction" onKeyDown={e => { if (e.key === "Escape" && !chain.busy) cancelReview(); }}><h3>{currentReview.action === "deposit" ? "Review deposit" : "Review withdrawal"}</h3><dl className="review-terms"><div><dt>Vault</dt><dd>{VERIFIED_ASSETS[asset].symbol}</dd></div><div><dt>{currentReview.action === "deposit" ? "Deposit amount" : "Return to wallet"}</dt><dd className="mono">{currentReview.action === "redeem" && selected.totalShares > 0n ? token(currentReview.amount * selected.finalBalance / selected.totalShares) : token(currentReview.amount)}</dd></div></dl><p>{currentReview.action === "deposit" ? "Your deposit funds payouts. Withdraw the remaining balance after settlement; it may be less than you deposited." : "Funds return to your connected demo wallet."} Network fees are sponsored when available.</p><div className="row"><button className="btn primary" disabled={frozen} aria-busy={chain.busy} onClick={() => void confirm()}>{chain.busy ? chain.status : currentReview.action === "deposit" ? "Deposit" : "Withdraw"}</button><button className="btn ghost" disabled={chain.busy} onClick={cancelReview}>Back</button></div></section>}
        {fieldError && <p id="vault-field-error" className="field-error" role="alert">{fieldError}</p>}
        {embedded && chain.error && <p className="field-error" role="alert">{chain.error}</p>}
        {receipt?.round === address && <div className="callout" role="status"><p>{receipt.action} · <a href={explorerUrl("tx", receipt.signature)} target="_blank" rel="noreferrer">View transaction ↗</a></p>{receipt.action === "Deposit confirmed" && <p>Funding closes {fmtClock(selected.fundingClose)}. Your deposit then stays locked until this round’s obligations resolve.</p>}<a className="btn ghost" href={`?view=positions&positions=vaults&deposit=${address}`}>View your deposits</a></div>}
      </section><section className="vault-capital" aria-label="Round capital">
        <div className="vault-metrics"><div><span>Deposited this round</span><strong className="mono">{token(selected.totalShares)}</strong></div><div><span>Committed to positions</span><strong className="mono">{token(selected.reserved)}</strong></div></div>
        <div className="capacity-visual"><div className="bar" role="meter" aria-label="Share of deposited capital committed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={selected.totalShares ? Number(selected.reserved * 10000n / selected.totalShares) / 100 : 0}><span style={{ width: `${selected.totalShares ? Number(selected.reserved * 10000n / selected.totalShares) / 100 : 0}%` }} /></div></div>
        <details className="secondary-tool"><summary>Round details</summary><p>{buyerStatus}</p><dl className="vault-ledger">
          <div><dt>Premiums collected</dt><dd>{token(selected.premiums)}</dd></div><div><dt>Buyer payouts</dt><dd>{token(selected.payouts)}</dd></div><div><dt>Premium refunds</dt><dd>{token(selected.refunds)}</dd></div>
          {stage === "Redeemable" && <div><dt>Final round result</dt><dd>{token(selected.finalBalance - selected.totalShares)}</dd></div>}
          <div><dt>Funding closes</dt><dd>{fmtClock(selected.fundingClose)}</dd></div><div><dt>New positions close</dt><dd>{fmtClock(selected.salesClose)}</dd></div><div><dt>Latest contract expiry</dt><dd>{fmtClock(selected.latestExpiry)}</dd></div><div><dt>Maximum commitment</dt><dd>{token(selected.exposureCap)}</dd></div><div><dt>Administrator deposit</dt><dd>{token(admin?.shares ?? 0n)}</dd></div><div><dt>Vault fees</dt><dd>None</dd></div></dl>
          <p>Floors ${(Number(selected.minStrike) / 1e6).toFixed(2)}–${(Number(selected.maxStrike) / 1e6).toFixed(2)} · Up to {Number(selected.maxQuantity) / 1e6} units per position.</p>
          <p>Administrator deposits receive the same proportional gains, losses, and withdrawal rights. Premiums are not reused to fund more positions in this round.</p><a href={explorerUrl("address", address!)} target="_blank" rel="noreferrer">Inspect round and pricing-policy commitment ↗</a></details>
      </section></div>
      {!embedded && <><details className="secondary-tool vault-exposures"><summary>Positions backed by this round ({exposures.length})</summary>{exposures.length ? exposures.map(p => <div className="kv" key={p.address.toBase58()}><span>{Number(p.originalQuantity) / 1e6} units · ${(Number(p.strike) / 1e6).toFixed(2)} floor</span><a href={explorerUrl("address", p.address.toBase58())} target="_blank" rel="noreferrer">{p.remainingQuantity > 0n ? "Open" : "Settled"} position ↗</a></div>) : <p>No positions have been issued against this round.</p>}</details>
      <details className="secondary-tool vault-round-history"><summary>Browse all rounds ({choices.length})</summary><label className="field"><span className="lbl">Round</span><select className="input" disabled={chain.busy} value={address} onChange={e => chooseRound(e.target.value)}>{choices.map(r => <option key={r.address.toBase58()} value={r.address.toBase58()}>{fmtClock(r.fundingClose)} · {roundStage(r, now)}</option>)}</select></label></details>
      <section className="vault-results"><h2>Completed activity</h2><p className="disclosure">Onchain Devnet results, including administrator deposits.</p>
        {settled.length ? settled.slice(0, 12).map(r => <div className="vault-result-row" key={r.address.toBase58()}><button className="text-action" onClick={() => chooseRound(r.address.toBase58())}>{fmtClock(r.fundingClose)}</button><span>Premiums <strong>{token(r.premiums)}</strong></span><span>Payouts <strong>{token(r.payouts)}</strong></span><span>Refunds <strong>{token(r.refunds)}</strong></span><span>Net result <strong>{token(r.finalBalance - r.totalShares)}</strong></span></div>) : <p>No funded round has completed yet.</p>}
      </section></>}
      <div className="vault-buyer-link">{embedded ? <a className="btn ghost" href={`?view=vaults&round=${address}`}>Manage vaults</a> : <a className="btn ghost" href="?view=positions&positions=vaults">Your positions</a>}<button className="btn ghost" onClick={() => onOpenPosition(displayedAsset)}>Set your floor</button></div>
    </>}
  </section>;
}
import { visiblePolling } from "../visiblePolling";
