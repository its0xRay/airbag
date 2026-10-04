import { useEffect, useMemo, useState } from "react";
import { Ed25519Program, PublicKey, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import nacl from "tweetnacl";
import { installedWallets, type ExternalWallet } from "./wallet";
import { betaApi, betaConnection, type BetaConfig, type BetaStatus } from "./api";
import { BETA_WALLET_LIMIT, BETA_SEED_LIMIT, MAINNET_GENESIS, USDC_MINT, withBetaAccounts, seedVaultIx } from "../client/betaProgram";
import { OPTKET_PROGRAM_ID, associatedTokenAddress } from "../client/optketProgram";
import { VaultClient, vaultQuoteMessage, type VaultRoundAccount, type VaultPositionAccount, type VaultDepositAccount } from "../client/vaultProgram";
import { serializeQuotePayload } from "../engine/quote";
import { pendingBeta, reconcileBeta, sendBeta } from "./transactions";
import "./beta.css";

const amount = (value: string) => {
  if (!/^\d{1,10}(\.\d{1,6})?$/.test(value.trim())) throw new Error("Enter a positive amount with at most six decimals.");
  const [a,b=""] = value.trim().split("."); const n=BigInt(a)*1_000_000n+BigInt(b.padEnd(6,"0"));
  if (n<=0n) throw new Error("Amount must be above zero."); return n;
};
const display = (n:bigint|string) => (Number(n)/1e6).toLocaleString(undefined,{maximumFractionDigits:6});
const name = (asset:number) => asset===0 ? "NVDAx" : "Anthropic PreStocks";
type Session = {token:string;wallet:string;provider:ExternalWallet};
type Quote = {round:string;payload:string;signature:string;quoteId:string;premium:string;quoteExpiryTs:number;expiryTs:number;quoteAuthority:string};
type Review = {label:string;detail:string;tx:Transaction;expiry?:number};

export default function BetaApp() {
  const [config,setConfig]=useState<BetaConfig|null>(null), [error,setError]=useState(""), [busy,setBusy]=useState(false);
  const [provider,setProvider]=useState<ExternalWallet|null>(null), [address,setAddress]=useState("");
  const [code,setCode]=useState(""), [session,setSession]=useState<Session|null>(null);
  useEffect(()=>{void betaApi<BetaConfig>("/config").then(c=>{
    if (!c.enabled) throw new Error("Mainnet beta is not open yet. Devnet remains available.");
    if (c.network!=="mainnet-beta" || c.mint!==USDC_MINT.toBase58() || c.walletLimit!==BETA_WALLET_LIMIT.toString()
      || c.programId===OPTKET_PROGRAM_ID.toBase58() || c.origin!==window.location.origin) throw new Error("Beta configuration could not be verified.");
    setConfig(c);
  }).catch(e=>setError(e.message));},[]);
  useEffect(()=>{
    if (!provider) return;
    const changed=()=>{setSession(null);setAddress("");setCode("");setError("Wallet changed or disconnected. Connect again to continue.");};
    provider.on?.("accountChanged",changed);provider.on?.("disconnect",changed);
    return ()=>{provider.removeListener?.("accountChanged",changed);provider.removeListener?.("disconnect",changed);};
  },[provider]);
  const connect=async (wallet:ExternalWallet)=>{
    setBusy(true);setError("");
    try {const result=await wallet.connect();setProvider(wallet);setAddress(result.publicKey.toBase58());}
    catch {setError("Wallet connection was not completed. Try again when ready.");} finally{setBusy(false);}
  };
  const verify=async()=>{
    if (!provider || !config) return;
    setBusy(true);setError("");
    try {
      const c=await betaApi<{id:string;message:string}>("/challenge",{wallet:address});
      const signed=await provider.signMessage(new TextEncoder().encode(c.message),"utf8");
      if (provider.publicKey?.toBase58()!==address) throw new Error("Wallet changed. Reconnect.");
      const signature="signature" in signed ? signed.signature : signed;
      const result=await betaApi<{token:string;wallet:string}>("/verify",{id:c.id,signature:Buffer.from(signature).toString("base64"),code:code||undefined});
      if (result.wallet!==address) throw new Error("Wallet verification mismatch.");
      const conn=betaConnection(result.token);
      if (await conn.getGenesisHash()!==MAINNET_GENESIS) throw new Error("Mainnet RPC verification failed.");
      setCode("");setSession({...result,provider});
    } catch(e){setError(e instanceof Error?e.message:"Verification failed.");} finally{setBusy(false);}
  };
  return <div className="beta-shell"><header className="beta-header"><a href="/" className="logo"><span className="dot"/>Airbag</a><span className="pill">Mainnet beta</span><a className="btn ghost" href="/">Back to Devnet</a>{session&&<button className="btn ghost" onClick={()=>{setSession(null);void provider?.disconnect();}}>Disconnect</button>}</header>
    {session&&config ? <Workspace config={config} session={session}/> : <main className="beta-login card"><h1>Connect to the private beta</h1><p>Real USDC. Invite required.</p><p className="dim">Verify access first. For testing, load up to 10 USDC plus SOL for network fees.</p>
      {!address ? <div className="beta-wallets">{installedWallets().map(w=><button className="btn" disabled={!config||busy} key={w.name} onClick={()=>void connect(w.provider)}>Connect {w.name}</button>)}{installedWallets().length===0&&<p>Open Airbag in your Phantom or Solflare browser, or install its browser extension.</p>}</div> : <form onSubmit={e=>{e.preventDefault();void verify();}}><p className="mono">{address.slice(0,6)}…{address.slice(-6)}</p><label htmlFor="beta-invite">Invite code <span className="dim">(first visit only)</span></label><input id="beta-invite" autoComplete="off" spellCheck={false} value={code} onChange={e=>setCode(e.target.value)} maxLength={64}/><p className="dim">Sign a message to verify ownership. No payment or token approval.</p><button className="btn primary" disabled={busy||!config}>{busy?"Verifying…":"Verify access"}</button></form>}
      {error&&<p role="alert">{error}</p>}{!config&&!error&&<p role="status">Checking beta availability…</p>}</main>}
  </div>;
}

function Workspace({config,session}:{config:BetaConfig;session:Session}) {
  const conn=useMemo(()=>betaConnection(session.token),[session.token]);
  const program=useMemo(()=>new PublicKey(config.programId),[config.programId]);
  const owner=useMemo(()=>new PublicKey(session.wallet),[session.wallet]);
  const client=useMemo(()=>new VaultClient(conn,program),[conn,program]);
  const [status,setStatus]=useState<BetaStatus|null>(null), [rounds,setRounds]=useState<VaultRoundAccount[]>([]);
  const [positions,setPositions]=useState<VaultPositionAccount[]>([]),[deposits,setDeposits]=useState<VaultDepositAccount[]>([]);
  const [balance,setBalance]=useState<bigint|null>(null), [error,setError]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const [side,setSide]=useState<"buyer"|"vault"|"seed">("buyer"), [asset,setAsset]=useState(0),[floor,setFloor]=useState(""),[quantity,setQuantity]=useState("1"),[deposit,setDeposit]=useState("");
  const [review,setReview]=useState<Review|null>(null),[signature,setSignature]=useState<string|null>(null);
  const [exerciseAmounts,setExerciseAmounts]=useState<Record<string,string>>({});
  const [now,setNow]=useState(()=>Math.floor(Date.now()/1000));
  const refresh=async()=>{
    try {
      const token=associatedTokenAddress(USDC_MINT,owner);
      const [s,r,p,d,info]=await Promise.all([betaApi<BetaStatus>("/status",{},session.token),client.rounds(),client.positionsForBuyer(owner),client.depositsForOwner(owner),conn.getAccountInfo(token)]);
      const b=info?BigInt((await conn.getTokenAccountBalance(token)).value.amount):0n;
      if (r.some(v=>!v.mint.equals(USDC_MINT))) throw new Error("Unexpected vault settlement token.");
      setStatus(s);setRounds(r);setPositions(p);setDeposits(d);setBalance(b);setError("");
      setSignature(pendingBeta(program,owner)?.signature??null);
    } catch(e){setError(e instanceof Error?e.message:"Could not refresh beta data.");}
  };
  useEffect(()=>{void Promise.resolve().then(refresh);const id=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},30000);const clock=setInterval(()=>setNow(Math.floor(Date.now()/1000)),1000);return()=>{clearInterval(id);clearInterval(clock);};},[client,session.token]); // eslint-disable-line react-hooks/exhaustive-deps
  const remaining=status?.access?BETA_WALLET_LIMIT-BigInt(status.access.used):0n;
  const isAdmin=status?.admin===session.wallet;
  const seedRemaining=status?.policy?BETA_SEED_LIMIT-BigInt(status.policy.seedUsed):0n;
  const testerRemaining=status?.policy?BigInt(status.policy.limit)-BigInt(status.policy.used):0n;
  const modeAllowance=side==="seed"?seedRemaining:(remaining<testerRemaining?remaining:testerRemaining);
  const candidates=rounds.filter(r=>r.assetId===asset&&(side==="buyer"?r.phase==="active"&&r.salesClose>now&&r.latestExpiry>now+300:r.phase==="funding"&&r.fundingClose>now)).sort((a,b)=>a.latestExpiry-b.latestExpiry);
  const [roundAddress,setRoundAddress]=useState("");
  const round=candidates.find(r=>r.address.toBase58()===roundAddress)??candidates[0];
  const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError("");try{await fn();}catch(e){setError(e instanceof Error?e.message:"Operation failed.");}finally{setBusy(false);}};
  const prepare=()=>act(async()=>{
    if (!round||!status?.access?.enabled||!status.accepting) throw new Error("New participation is unavailable.");
    if(modeAllowance<=0n) throw new Error(side==="seed"?"The 25 USDC seed budget is fully used.":"The wallet or shared tester allowance is fully used. Existing positions and withdrawals remain accessible.");
    if (side!=="buyer") {
      const n=amount(deposit);
      if(side==="seed"&&!isAdmin) throw new Error("Only the configured administrator can seed vaults.");
      if(n>modeAllowance||balance===null||n>balance) throw new Error("Deposit exceeds your balance or remaining allowance.");
      const instruction=side==="seed"?seedVaultIx(client,round,owner,n):withBetaAccounts(client.depositIx(round,owner,owner,n),owner);
      setReview({label:`${side==="seed"?"Seed":"Deposit"} ${display(n)} USDC`,detail:`${name(asset)}. ${side==="seed"?"Uses the separate 25 USDC lifetime seed budget, not tester allowance. ":""}Funding closes ${new Date(round.fundingClose*1000).toLocaleString()}. After funding closes, capital stays locked until all obligations settle. Payouts can reduce your deposit.`,tx:new Transaction().add(instruction)});
    } else {
      const q=amount(quantity),strike=amount(floor);
      const response=await betaApi<Quote>("/quote",{round:round.address.toBase58(),quantity:q.toString(),strike:strike.toString()},session.token);
      const payload=Buffer.from(response.payload,"base64"),premium=BigInt(response.premium);
      const expected=serializeQuotePayload({buyer:owner.toBase58(),assetId:asset,seriesId:0,quantity:q,strike,expiryTs:round.latestExpiry,referenceVersion:round.referenceVersion,premium,fees:0n,quoteId:BigInt(response.quoteId),quoteExpiryTs:response.quoteExpiryTs},owner.toBytes());
      const message=vaultQuoteMessage(round.address,payload,program),sig=Buffer.from(response.signature,"base64");
      if(!payload.equals(Buffer.from(expected))||response.round!==round.address.toBase58()||response.quoteAuthority!==round.quoteAuthority.toBase58()||!nacl.sign.detached.verify(message,sig,round.quoteAuthority.toBytes())) throw new Error("Quote does not match the selected terms.");
      if(premium>remaining||balance===null||premium>balance) throw new Error("Premium exceeds your balance or remaining allowance.");
      const tx=new Transaction().add(Ed25519Program.createInstructionWithPublicKey({publicKey:round.quoteAuthority.toBytes(),message,signature:sig}),withBetaAccounts(client.purchaseIx(round,owner,owner,payload,BigInt(response.quoteId),0,premium),owner));
      setReview({label:`Pay ${display(premium)} USDC`,detail:`${display(q)} ${name(asset)} · $${display(strike)} floor · Expiry ${new Date(round.latestExpiry*1000).toLocaleString()}. Settles on the token-market reference.`,tx,expiry:response.quoteExpiryTs});
    }
  });
  const submit=()=>act(async()=>{
    if(!review)return;
    if(review.expiry&&review.expiry<=Math.floor(Date.now()/1000))throw new Error("Quote expired. Close the review and request a fresh quote.");
    const sig=await sendBeta(conn,program,session.provider,owner,review.tx,session.token);
    setSignature(sig);setReview(null);setNotice("Transaction submitted. Check confirmation before submitting another.");
  });
  return <main className="beta-workspace"><section className="card"><h1>Your beta workspace</h1><p className="mono">{session.wallet.slice(0,6)}…{session.wallet.slice(-6)} · Mainnet</p><div className="beta-stats"><div><span>Allowance remaining</span><strong>{status?display(remaining):"Loading…"} USDC</strong></div><div><span>Wallet balance</span><strong>{balance===null?"Loading…":display(balance)} USDC</strong></div></div><p className="dim">10 USDC lifetime total across premiums and vault deposits. Withdrawals do not reset it.</p><button className="btn ghost" disabled={busy} onClick={()=>void refresh()}>Refresh</button>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{signature&&<p><a href={`https://explorer.solana.com/tx/${signature}`} target="_blank" rel="noreferrer">View pending transaction</a> <button className="btn" disabled={busy} onClick={()=>void act(async()=>{const result=await reconcileBeta(conn,program,owner);setNotice(`Transaction ${result}.`);await refresh();})}>Check status</button></p>}</section>
    <section className="card"><div className="beta-tabs"><button className="btn" aria-pressed={side==="buyer"} onClick={()=>{setSide("buyer");setReview(null);}}>Set your floor</button><button className="btn" aria-pressed={side==="vault"} onClick={()=>{setSide("vault");setReview(null);}}>Fund a vault</button>{isAdmin&&<button className="btn" aria-pressed={side==="seed"} onClick={()=>{setSide("seed");setReview(null);}}>Seed vault</button>}</div>{side==="seed"&&isAdmin&&<p className="dim">Seed budget remaining: {display(seedRemaining)} USDC of 25 USDC across both vaults. Separate from tester limits. Withdrawals do not reset this budget.</p>}<form onSubmit={e=>{e.preventDefault();void prepare();}}><label htmlFor="beta-asset">Asset</label><select id="beta-asset" value={asset} onChange={e=>{setAsset(Number(e.target.value));setReview(null);}}><option value={0}>NVDAx</option><option value={1}>Anthropic PreStocks</option></select><label htmlFor="beta-round">{side==="buyer"?"Expiry":"Vault round"}</label><select id="beta-round" value={round?.address.toBase58()??""} onChange={e=>setRoundAddress(e.target.value)}>{candidates.length===0&&<option value="">No available round</option>}{candidates.map(r=><option key={r.address.toBase58()} value={r.address.toBase58()}>{new Date(r.latestExpiry*1000).toLocaleString()}</option>)}</select>{side==="buyer"?<div className="beta-inputs"><label>Price floor (USD)<input autoComplete="off" inputMode="decimal" value={floor} onChange={e=>setFloor(e.target.value)}/></label><label>Quantity<input autoComplete="off" inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label></div>:<label>{side==="seed"?"Seed amount (USDC)":"Deposit (USDC)"}<input autoComplete="off" inputMode="decimal" value={deposit} onChange={e=>setDeposit(e.target.value)}/></label>}<button className="btn primary" disabled={busy||!!signature||!round||!status?.access?.enabled||!status.accepting}>{busy?"Checking…":side==="buyer"?"Review position":side==="seed"?"Review seed deposit":"Review deposit"}</button></form>{!round&&<p className="dim">No {side==="buyer"?"funded buying":"deposit"} window is open for this asset.</p>}</section>
    <section className="card"><h2>Your positions</h2>{positions.length===0&&<p>No positions yet.</p>}{positions.map(p=>{
      const id=p.address.toBase58();
      return <div className="beta-record" key={id}><strong>{name(rounds.find(r=>r.address.equals(p.round))?.assetId??0)} · ${display(p.strike)} floor</strong><p>{display(p.remainingQuantity)} remaining · Paid out {display(p.totalPayout)} USDC</p><a href={`https://explorer.solana.com/address/${p.address}`} target="_blank" rel="noreferrer">Onchain record</a>{p.pendingQuantity>0n&&<p>Exercise requested for {display(p.pendingQuantity)} tokens. Awaiting the reference window.</p>}{p.remainingQuantity>0n&&p.pendingQuantity===0n&&p.expiryTs>now+300&&<form onSubmit={e=>{e.preventDefault();void act(async()=>{
        const q=amount(exerciseAmounts[id]??(Number(p.remainingQuantity)/1e6).toString());
        if(q>p.remainingQuantity)throw new Error("Exercise quantity exceeds your remaining position.");
        setReview({label:"Request early exercise",detail:`Exercise ${display(q)} tokens using the next five-minute reference window.`,tx:new Transaction().add(client.requestIx(p,owner,q))});
      });}}><label>Exercise quantity<input inputMode="decimal" autoComplete="off" value={exerciseAmounts[id]??(Number(p.remainingQuantity)/1e6).toString()} onChange={e=>setExerciseAmounts(v=>({...v,[id]:e.target.value}))}/></label><button className="btn" disabled={busy||!!signature}>Review exercise</button></form>}</div>;
    })}</section>
    <section className="card"><h2>Your vault deposits</h2>{deposits.length===0&&<p>No deposits yet.</p>}{deposits.map(d=>{const r=rounds.find(v=>v.address.equals(d.round));return <div className="beta-record" key={d.address.toBase58()}><strong>{r?name(r.assetId):"Vault"} · {display(d.shares)} shares</strong><p>{d.redeemed?`Redeemed ${display(d.redemptionAmount)} USDC`:r?.phase==="redeemable"?"Ready to withdraw":"Awaiting round settlement"}</p>{r&&!d.redeemed&&(r.phase==="redeemable"||(r.phase==="funding"&&now<r.fundingClose))&&<button className="btn" disabled={busy||!!signature} onClick={()=>setReview({label:r.phase==="redeemable"?"Withdraw settled balance":"Cancel deposit",detail:"Withdrawal does not restore your beta allowance.",tx:new Transaction().add(client.withdrawIx(r,owner,r.phase==="redeemable"?"redeem":"cancel",d.shares))})}>Review withdrawal</button>}</div>;})}</section>
    {review&&<ReviewDialog review={review} busy={busy} error={error} close={()=>setReview(null)} submit={()=>void submit()}/>}
  </main>;
}

function ReviewDialog({review,busy,error,close,submit}:{review:Review;busy:boolean;error:string;close:()=>void;submit:()=>void}) {
  const [element,setElement]=useState<HTMLDialogElement|null>(null);
  useEffect(()=>{element?.showModal();return()=>element?.close();},[element]);
  return <dialog className="beta-review" ref={setElement} onCancel={e=>{e.preventDefault();if(!busy)close();}}><h2>{review.label}</h2><p>{review.detail}</p><p className="dim">Mainnet transaction. Network fees are paid in SOL.</p>{error&&<p role="alert">{error}</p>}<div className="beta-tabs"><button className="btn" disabled={busy} onClick={close}>Cancel</button><button className="btn primary" disabled={busy} onClick={submit}>{busy?"Check your wallet…":"Confirm in wallet"}</button></div></dialog>;
}
