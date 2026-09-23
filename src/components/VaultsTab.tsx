import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { VaultClient, roundStage, type VaultRoundAccount, type VaultDepositAccount, type VaultPositionAccount } from "../client/vaultProgram";
import { useChain, explorerUrl } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import { fmtClock, fmtOusd } from "../format";
import { useNowSeconds } from "../useNowSeconds";
import { pendingTransaction } from "../onchain/transactionRecovery";
import AssetLogo from "./AssetLogo";
import "./VaultsTab.css";

const token = (n: bigint) => fmtOusd(Number(n) / 1e6);
function parseVaultAmount(text: string): bigint | null {
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const n = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return n > 0n && n <= 18446744073709551615n ? n : null;
}

export default function VaultsTab({ onOpenPosition }: { onOpenPosition: (asset: number) => void }) {
  const chain = useChain();
  const now = useNowSeconds();
  const client = useMemo(() => new VaultClient(chain.conn), [chain.conn]);
  const [asset, setAsset] = useState(0);
  const [rounds, setRounds] = useState<VaultRoundAccount[]>([]);
  const [roundChoice, setRoundChoice] = useState<string | null>(null);
  const [deposits, setDeposits] = useState<Record<string, VaultDepositAccount | null>>({});
  const [adminDeposits, setAdminDeposits] = useState<Record<string, VaultDepositAccount | null>>({});
  const [positions, setPositions] = useState<VaultPositionAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [amountText, setAmountText] = useState("100");
  const [review, setReview] = useState<{ round: string; amount: bigint; action: "deposit" | "cancel" | "redeem" } | null>(null);
  const [receipt, setReceipt] = useState<{ round: string; signature: string; action: string } | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const generation = useRef(0);
  const reviewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (review) { reviewRef.current?.scrollIntoView({ block: "center", behavior: "instant" }); reviewRef.current?.focus({ preventScroll: true }); }
  }, [review]);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const [next, contracts] = await Promise.all([client.rounds(), client.positions()]);
      const mine: Record<string, VaultDepositAccount | null> = {};
      const administrators: Record<string, VaultDepositAccount | null> = {};
      // Bound concurrent account reads for RPC providers with small request limits.
      for (const round of next) {
        const [owned, seeded] = await Promise.all([
          chain.address ? client.getDeposit(round.address, new PublicKey(chain.address)) : Promise.resolve(null),
          client.getDeposit(round.address, round.administrator),
        ]);
        mine[round.address.toBase58()] = owned;
        administrators[round.address.toBase58()] = seeded;
      }
      if (request !== generation.current) return;
      setRounds(next); setPositions(contracts); setDeposits(mine); setAdminDeposits(administrators);
      setLoadedAt(Math.floor(Date.now() / 1000)); setError(null);
    } catch { if (request === generation.current) setError("Vault data could not be refreshed. Retry before submitting a transaction."); }
    finally { if (request === generation.current) setLoading(false); }
  }, [client, chain.address]);
  useEffect(() => {
    const cancel = () => { ++generation.current; };
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(refresh, 15000);
    return () => { cancel(); clearTimeout(first); clearInterval(timer); };
  }, [refresh]);
  const choices = rounds.filter(r => r.assetId === asset).sort((a, b) => b.fundingClose - a.fundingClose);
  const selected = choices.find(r => r.address.toBase58() === roundChoice) ?? choices[0];
  const address = selected?.address.toBase58();
  const owned = address ? deposits[address] : null;
  const admin = address ? adminDeposits[address] : null;
  const stage = selected ? roundStage(selected, now) : null;
  const frozen = chain.busy || loading || !!error || now - loadedAt > 30 || !!pendingTransaction(chain.transaction, chain.conn.rpcEndpoint, chain.address);
  const amount = parseVaultAmount(amountText);
  const currentReview = review && review.round === address ? review : null;
  const canDeposit = stage === "Funding";
  const exposures = positions.filter(p => p.round.toBase58() === address);

  function begin(action: "deposit" | "cancel" | "redeem") {
    if (!selected) return;
    const value = action === "deposit" ? amount : owned?.shares ?? 0n;
    if (value == null || value <= 0n) { setFieldError("Enter a positive amount with up to six decimal places."); return; }
    if (action === "deposit" && value > selected.depositCap - selected.totalShares) { setFieldError("This amount exceeds the round’s remaining capacity."); return; }
    if (action === "deposit" && Number(value) / 1e6 > chain.tokenBalance) { setFieldError("Your test-oUSD balance is too low for this deposit."); return; }
    setFieldError(null); setReceipt(null); setReview({ round: selected.address.toBase58(), amount: value, action });
  }
  async function confirm() {
    if (!currentReview || !selected || frozen) return;
    if (currentReview.action !== "redeem" && stage !== "Funding") { setReview(null); setFieldError("The funding window has closed."); return; }
    try {
      const signature = await chain.vaultAction(selected, currentReview.action, currentReview.amount);
      setReceipt({ round: currentReview.round, signature, action: currentReview.action === "deposit" ? "Deposit confirmed" : currentReview.action === "cancel" ? "Deposit returned" : "Redemption confirmed" });
      setReview(null); await refresh();
    } catch (e) { setFieldError(e instanceof Error ? e.message : "Transaction could not be confirmed. Check its status before retrying."); }
  }

  return <main className="vaults-page">
    <div className="app-page-head"><div><h1>Fund the downside.</h1><p>Back positions in tokenized equities. Share the premiums—and the payouts.</p></div><span className="disclosure">Test oUSD · no real value</span></div>
    <div className="vault-asset-switch" role="group" aria-label="Choose a vault">
      {VERIFIED_ASSETS.map((a, i) => <button key={a.key} className="vault-asset-option" aria-pressed={asset === i}
        onClick={() => { setAsset(i); setRoundChoice(null); setReview(null); setFieldError(null); }}><AssetLogo asset={a} /><span><strong>{i === 0 ? "NVDAx" : "Anthropic"}</strong><small>{i === 0 ? "Tokenized public equity" : "PreStocks token market"}</small></span></button>)}
    </div>
    {error && <div className="callout warn" role="alert">{error} <button className="btn ghost" disabled={loading} onClick={() => void refresh()}>Retry</button></div>}
    {!selected ? <section className="card empty" aria-busy={loading} role="status"><h2>{loading ? "Reading vault accounts…" : "No round published yet"}</h2><p>{loading ? "Checking confirmed capital and ownership." : "This vault has no published round. Deposits open when a funding window is available."}</p><button className="btn ghost" disabled={loading} onClick={() => void refresh()}>Refresh</button></section> : <>
      <div className="vault-round-header"><h2>{VERIFIED_ASSETS[asset].symbol} vault <span className="pill gray">{stage}</span></h2>
        <label className="field"><span className="lbl">Round</span><select className="input" value={address} onChange={e => { setRoundChoice(e.target.value); setReview(null); }}>{choices.map(r => <option key={r.address.toBase58()} value={r.address.toBase58()}>{fmtClock(r.fundingClose)} · {roundStage(r, now)}</option>)}</select></label></div>
      <div className="vault-workspace"><section className="vault-capital">
        <div className="vault-metrics"><div><span>Deposited this round</span><strong className="mono">{token(selected.totalShares)}</strong></div><div><span>Committed to positions</span><strong className="mono">{token(selected.reserved)}</strong></div></div>
        <div className="capacity-visual"><div className="bar" role="meter" aria-label="Share of deposited capital committed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={selected.totalShares ? Number(selected.reserved * 10000n / selected.totalShares) / 100 : 0}><span style={{ width: `${selected.totalShares ? Number(selected.reserved * 10000n / selected.totalShares) / 100 : 0}%` }} /></div></div>
        <dl className="vault-ledger"><div><dt>Premiums collected</dt><dd>{token(selected.premiums)}</dd></div><div><dt>Buyer payouts</dt><dd>{token(selected.payouts)}</dd></div><div><dt>Premium refunds</dt><dd>{token(selected.refunds)}</dd></div>
          {stage === "Redeemable" && <div><dt>Final round result</dt><dd>{token(selected.finalBalance - selected.totalShares)}</dd></div>}</dl>
        <p className="disclosure">Premiums are not profit until obligations settle. Deposits can lose value.</p>
        <details className="secondary-tool"><summary>Round terms & capital</summary><dl className="vault-ledger"><div><dt>Funding closes</dt><dd>{fmtClock(selected.fundingClose)}</dd></div><div><dt>New positions close</dt><dd>{fmtClock(selected.salesClose)}</dd></div><div><dt>Latest contract expiry</dt><dd>{fmtClock(selected.latestExpiry)}</dd></div><div><dt>Maximum commitment</dt><dd>{token(selected.exposureCap)}</dd></div><div><dt>Administrator deposit</dt><dd>{token(admin?.shares ?? 0n)}</dd></div><div><dt>Vault fees</dt><dd>None</dd></div></dl>
          <p>Floors ${(Number(selected.minStrike) / 1e6).toFixed(2)}–${(Number(selected.maxStrike) / 1e6).toFixed(2)} · Up to {Number(selected.maxQuantity) / 1e6} units per position.</p>
          <p>Administrator deposits receive the same proportional gains, losses, and withdrawal rights. Premiums are not reused to fund more positions in this round.</p><p>Reference or keeper delays can extend the lock. Funds unlock only after all obligations settle.</p><a href={explorerUrl("address", address!)} target="_blank" rel="noreferrer">Inspect round and pricing-policy commitment ↗</a></details>
      </section><section className="card vault-deposit-panel"><h2>Your deposit</h2>
        {owned && owned.shares > 0n ? <><strong className="vault-owned mono">{token(owned.shares)}</strong><p>{selected.totalShares > 0n ? (Number(owned.shares * 10000n / selected.totalShares) / 100).toFixed(2) : "0"}% of this round{stage === "Funding" ? " · changes as deposits arrive" : " · ownership fixed"}</p>
          {owned.redeemed ? <p className="callout">Redeemed {token(owned.redemptionAmount)}</p> : stage === "Redeemable" ? <><p>Available to redeem: <strong>{token(owned.shares * selected.finalBalance / selected.totalShares)}</strong></p><button className="btn primary" disabled={frozen} onClick={() => begin("redeem")}>Review redemption</button></> : !canDeposit ? <p>Capital is locked. Redemption is expected after {fmtClock(selected.latestExpiry)}, once all obligations settle.</p> : null}</> : <p>Deposit test oUSD to back this asset’s positions.</p>}
        {!chain.connected ? <button className="btn primary" disabled={chain.busy} onClick={() => void chain.connect()}>Connect demo wallet</button> : canDeposit && <form onSubmit={e => { e.preventDefault(); begin("deposit"); }}>
          <label className="field" htmlFor="vault-amount"><span className="lbl">Deposit amount · oUSD</span><input id="vault-amount" className="input mono" type="text" inputMode="decimal" autoComplete="off" value={amountText}
            aria-invalid={!!fieldError} aria-describedby="vault-amount-help" onChange={e => { setAmountText(e.target.value); setReview(null); setFieldError(null); }} /></label>
          <p id="vault-amount-help" className="disclosure">Balance {fmtOusd(chain.tokenBalance)} · No real monetary value</p>
          <p>Cancel before {fmtClock(selected.fundingClose)}. Then your capital locks until the round settles.</p>
          <button className="btn primary" type="submit" disabled={frozen}>Review deposit</button>
          {!!owned?.shares && !owned.redeemed && <button className="btn ghost" type="button" disabled={frozen} onClick={() => begin("cancel")}>Withdraw funding deposit</button>}
        </form>}
        {!canDeposit && !owned?.shares && <p className="disclosure">This round is closed to deposits. New deposits reopen with the next published funding round.</p>}
        {currentReview && <section ref={reviewRef} tabIndex={-1} className="purchase-review" aria-label="Review vault transaction"><h3>{currentReview.action === "deposit" ? "Confirm deposit" : currentReview.action === "cancel" ? "Return your deposit" : "Redeem your share"}</h3><p>{currentReview.action === "redeem" && selected.totalShares > 0n ? token(currentReview.amount * selected.finalBalance / selected.totalShares) : token(currentReview.amount)} · {VERIFIED_ASSETS[asset].symbol} vault</p><p>{currentReview.action === "deposit" ? "Your capital backs buyer payouts. Returns are not guaranteed; principal can be lost." : "Funds return to your connected demo wallet."} Test oUSD has no real value. Network fees are sponsored when available.</p><div className="row"><button className="btn primary" disabled={frozen} aria-busy={chain.busy} onClick={() => void confirm()}>{chain.busy ? chain.status : "Confirm onchain"}</button><button className="btn ghost" disabled={chain.busy} onClick={() => setReview(null)}>Back</button></div></section>}
        {fieldError && <p className="field-error" role="alert">{fieldError}</p>}
        {receipt?.round === address && <p className="callout" role="status">{receipt.action} · <a href={explorerUrl("tx", receipt.signature)} target="_blank" rel="noreferrer">View transaction ↗</a></p>}
      </section></div>
      <details className="secondary-tool vault-exposures"><summary>Positions backed by this round ({exposures.length})</summary>{exposures.length ? exposures.map(p => <div className="kv" key={p.address.toBase58()}><span>{Number(p.originalQuantity) / 1e6} units · ${(Number(p.strike) / 1e6).toFixed(2)} floor</span><a href={explorerUrl("address", p.address.toBase58())} target="_blank" rel="noreferrer">{p.remainingQuantity > 0n ? "Open" : "Settled"} position ↗</a></div>) : <p>No positions have been issued against this round.</p>}</details>
      <div className="vault-buyer-link"><span>Prefer to define your own downside?</span><button className="btn ghost" onClick={() => onOpenPosition(asset)}>Open a position ↗</button></div>
    </>}
  </main>;
}
