// Isolated validator integration test. All keys and tokens below are disposable
// LOCAL fixtures. This script never accepts a remote RPC endpoint.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, Ed25519Program, ComputeBudgetProgram, SYSVAR_CLOCK_PUBKEY, sendAndConfirmTransaction } from "@solana/web3.js";
import { MintLayout, TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import nacl from "tweetnacl";
import { initializeBetaPolicyIx, setBetaAccessIx, withBetaAccounts, readBetaAccess, readBetaPolicy, seedVaultIx, betaPdas, USDC_MINT, MAINNET_GENESIS, BETA_TESTER_LIMIT, BETA_SEED_LIMIT } from "../src/client/betaProgram";
import { VaultClient, vaultQuoteMessage } from "../src/client/vaultProgram";
import { serializeQuotePayload } from "../src/engine/quote";

const binary=process.env.BETA_TEST_BINARY,validator=process.env.SOLANA_TEST_VALIDATOR;
if(!binary||!validator)throw new Error("Set BETA_TEST_BINARY and SOLANA_TEST_VALIDATOR. See docs/mainnet-beta.md for test-only build keys.");
const program=new PublicKey("Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHGvG95yGLr");
const admin=Keypair.fromSeed(new Uint8Array(32).fill(73));
const quoteKey=Keypair.generate(),authority=Keypair.generate(),buyer=Keypair.generate(),outsider=Keypair.generate();
const directory=mkdtempSync(join(tmpdir(),"airbag-beta-validator-"));
const fixture=(name:string,pubkey:PublicKey,owner:PublicKey,data:Buffer,lamports:number)=>{
  const file=join(directory,`${name}.json`);writeFileSync(file,JSON.stringify({pubkey:pubkey.toBase58(),account:{lamports,data:[data.toString("base64"),"base64"],owner:owner.toBase58(),executable:false,rentEpoch:0,space:data.length}}));return file;
};
const mint=Buffer.alloc(MintLayout.span);
MintLayout.encode({mintAuthorityOption:1,mintAuthority:admin.publicKey,supply:0n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mint);
const proc=spawn(validator,["--ledger",join(directory,"ledger"),"--rpc-port","18999","--faucet-port","18998","--bind-address","127.0.0.1","--dynamic-port-range","19000-19040","--bpf-program",program.toBase58(),resolve(binary),"--account",USDC_MINT.toBase58(),fixture("mint",USDC_MINT,TOKEN_PROGRAM_ID,mint,2_000_000),"--account",admin.publicKey.toBase58(),fixture("admin",admin.publicKey,SystemProgram.programId,Buffer.alloc(0),100_000_000_000)],{stdio:["ignore","pipe","pipe"]});
let logs="";proc.stdout.on("data",b=>{logs=(logs+b).slice(-12000);});proc.stderr.on("data",b=>{logs=(logs+b).slice(-12000);});
const conn=new Connection("http://127.0.0.1:18999","confirmed");
const client=new VaultClient(conn,program);
const chainNow=async()=>Number((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY))!.data.readBigInt64LE(32));
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const key=(pubkey:PublicKey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
const u64=(n:bigint)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b;};
const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const derive=(s:string,a:number)=>PublicKey.findProgramAddressSync([Buffer.from(s),Buffer.from([a])],program)[0];
let serial=0, passed=false;
const send=async(ix:TransactionInstruction|Transaction,signers=[admin])=>{
  const tx=ix instanceof Transaction?ix:new Transaction().add(ix);
  // Unique memo-free recent blockhash/fee priority avoids duplicate test sends.
  serial++;tx.add(ComputeBudgetProgram.setComputeUnitPrice({microLamports:serial}));
  return sendAndConfirmTransaction(conn,tx,signers,{commitment:"confirmed"});
};
try {
  for(let i=0;i<60;i++){if(proc.exitCode!==null)throw new Error(logs);try{await conn.getVersion();break;}catch{await sleep(500);}}
  assert.notEqual(await conn.getGenesisHash(),MAINNET_GENESIS,"Never run fixtures on mainnet");
  await send(new Transaction().add(...[authority,buyer,outsider].map(k=>SystemProgram.transfer({fromPubkey:admin.publicKey,toPubkey:k.publicKey,lamports:1_000_000_000}))));
  const configIx=(signer:PublicKey)=>new TransactionInstruction({programId:program,keys:[key(signer,true,true),key(client.pdas.config(),true),key(USDC_MINT),key(SystemProgram.programId)],data:Buffer.concat([Buffer.from([208,127,21,1,194,190,196,70]),quoteKey.publicKey.toBuffer(),admin.publicKey.toBuffer(),u64(0n)])});
  await assert.rejects(send(configIx(outsider.publicKey),[outsider]));
  await send(configIx(admin.publicKey));
  assert.equal((await conn.getAccountInfo(client.pdas.config()))!.data[136],1,"Starts paused");
  const oversizedPolicy=initializeBetaPolicyIx(program,admin.publicKey,authority.publicKey,BETA_TESTER_LIMIT);
  oversizedPolicy.data.writeBigUInt64LE(BETA_TESTER_LIMIT+1n,40);
  await assert.rejects(send(oversizedPolicy),"Program rejects a tester budget above 20 USDC");
  await send(initializeBetaPolicyIx(program,admin.publicKey,authority.publicKey,BETA_TESTER_LIMIT));
  for(const asset of [0,1])await send(new TransactionInstruction({programId:program,keys:[key(admin.publicKey,true,true),key(client.pdas.config()),key(client.pdas.asset(asset),true),key(derive("pool",asset),true),key(derive("vault",asset),true),key(USDC_MINT),key(TOKEN_PROGRAM_ID),key(SystemProgram.programId)],data:Buffer.concat([Buffer.from([133,1,51,41,37,45,8,38,asset,asset]),Keypair.generate().publicKey.toBuffer(),u32(asset===0?2:1),u32(1),u64(100_000_000n),Buffer.from([1])])}));
  await send(new TransactionInstruction({programId:program,keys:[key(admin.publicKey,false,true),key(client.pdas.config(),true)],data:Buffer.from([63,32,154,2,56,103,79,45,0])}));
  const now=await chainNow(),fundingClose=now+60;
  for(const asset of [0,1])await send(client.createIx(admin.publicKey,USDC_MINT,1n,{assetId:asset,fundingClose,salesClose:now+360,latestExpiry:now+420,depositCap:100_000_000n,exposureCap:100_000_000n,minStrike:1n,maxStrike:10_000_000n,maxQuantity:1_000_000n},new Uint8Array(32).fill(1)));
  const rounds=await client.rounds(),r0=rounds.find(r=>r.assetId===0)!,r1=rounds.find(r=>r.assetId===1)!;
  for(const owner of [admin,buyer,outsider]){
    const ata=await getOrCreateAssociatedTokenAccount(conn,admin,USDC_MINT,owner.publicKey);
    await mintTo(conn,admin,USDC_MINT,ata.address,admin,100_000_000n);
  }
  await assert.rejects(send(withBetaAccounts(client.depositIx(r0,outsider.publicKey,outsider.publicKey,1n),outsider.publicKey),[outsider]));
  for(const owner of [admin,buyer])await send(setBetaAccessIx(program,authority.publicKey,owner.publicKey,true),[authority]);
  await assert.rejects(send(seedVaultIx(client,r0,buyer.publicKey,1n),[buyer]),"Tester cannot use seed path");
  const forgedSeed=seedVaultIx(client,r0,buyer.publicKey,1n);
  forgedSeed.keys.at(-1)!.pubkey=betaPdas(program).access(admin.publicKey);
  await assert.rejects(send(forgedSeed,[buyer]),"Tester cannot borrow admin access");
  const missingPolicy=seedVaultIx(client,r0,admin.publicKey,1n);missingPolicy.keys.splice(-2);
  await assert.rejects(send(missingPolicy),"Seed requires canonical policy accounts");
  // A failed ledger operation must roll back the earlier seed budget charge.
  const restrictedRoundId=2n;
  await send(client.createIx(admin.publicKey,USDC_MINT,restrictedRoundId,{assetId:0,fundingClose,salesClose:now+360,latestExpiry:now+420,depositCap:1_000_000n,exposureCap:1_000_000n,minStrike:1n,maxStrike:1_000_000n,maxQuantity:1_000_000n},new Uint8Array(32).fill(1)));
  const restricted=(await client.rounds()).find(r=>r.address.equals(client.pdas.round(0,restrictedRoundId)))!;
  await assert.rejects(send(seedVaultIx(client,restricted,admin.publicKey,2_000_000n)));
  assert.equal((await readBetaPolicy(conn,program))!.seedUsed,0n,"Failed deposit rolls back seed counter");
  await send(seedVaultIx(client,r0,admin.publicKey,12_500_000n));
  await send(setBetaAccessIx(program,authority.publicKey,admin.publicKey,false),[authority]);
  await assert.rejects(send(seedVaultIx(client,r1,admin.publicKey,1n)),"Revoked admin cannot seed");
  await send(setBetaAccessIx(program,authority.publicKey,admin.publicKey,true),[authority]);
  await send(seedVaultIx(client,r1,admin.publicKey,12_500_000n));
  assert.equal((await readBetaPolicy(conn,program))!.seedUsed,BETA_SEED_LIMIT);
  assert.equal((await readBetaPolicy(conn,program))!.used,0n,"Seed does not consume tester budget");
  assert.equal((await readBetaAccess(conn,program,admin.publicKey))!.used,0n);
  await assert.rejects(send(seedVaultIx(client,r0,admin.publicKey,1n)),"25 USDC cap is shared across assets");
  await send(client.withdrawIx(r1,admin.publicKey,"cancel",1_000_000n));
  await assert.rejects(send(seedVaultIx(client,r1,admin.publicKey,1n)),"Cancelling seed cannot reset its budget");
  console.log("PASS: admin-only seed path, separate 25 USDC lifetime cap, cross-asset enforcement and rollback.");
  await assert.rejects(send(client.depositIx(r0,admin.publicKey,admin.publicKey,1n)),"Cannot omit policy accounts");
  await send(withBetaAccounts(client.depositIx(r0,admin.publicKey,admin.publicKey,6_000_000n),admin.publicKey));
  await send(withBetaAccounts(client.depositIx(r1,admin.publicKey,admin.publicKey,4_000_000n),admin.publicKey));
  await assert.rejects(send(withBetaAccounts(client.depositIx(r0,admin.publicKey,admin.publicKey,1n),admin.publicKey)));
  await send(client.withdrawIx(r0,admin.publicKey,"cancel",2_000_000n));
  await assert.rejects(send(withBetaAccounts(client.depositIx(r0,admin.publicKey,admin.publicKey,1n),admin.publicKey)),"Cancel cannot restore allowance");
  await send(setBetaAccessIx(program,authority.publicKey,admin.publicKey,false),[authority]);
  await send(client.withdrawIx(r0,admin.publicKey,"cancel",1_000_000n));
  await send(setBetaAccessIx(program,authority.publicKey,admin.publicKey,true),[authority]);
  assert.equal((await readBetaAccess(conn,program,admin.publicKey))!.used,10_000_000n);
  await send(withBetaAccounts(client.depositIx(r0,buyer.publicKey,buyer.publicKey,2_000_000n),buyer.publicKey),[buyer]);
  await send(setBetaAccessIx(program,authority.publicKey,outsider.publicKey,true),[authority]);
  await send(withBetaAccounts(client.depositIx(r1,outsider.publicKey,outsider.publicKey,7_900_000n),outsider.publicKey),[outsider]);
  console.log("PASS: pinned initializer, closed access, canonical policy accounts, cross-asset lifetime cap, cancellation and revocation.");
  while(await chainNow()<=fundingClose)await sleep(500);
  await send(client.advanceIx(r0,admin.publicKey,"activate"));
  const q={buyer:buyer.publicKey.toBase58(),assetId:0,seriesId:0,quantity:1_000_000n,strike:1_000_000n,expiryTs:r0.latestExpiry,referenceVersion:2,premium:100_000n,fees:0n,quoteId:1n,quoteExpiryTs:await chainNow()+60};
  const purchase=(gated:boolean,quoteId=1n)=>{
    const payload=serializeQuotePayload({...q,quoteId},buyer.publicKey.toBytes()),message=vaultQuoteMessage(r0.address,payload,program),signature=nacl.sign.detached(message,quoteKey.secretKey);
    return new Transaction().add(Ed25519Program.createInstructionWithPublicKey({publicKey:quoteKey.publicKey.toBytes(),message,signature}),gated?withBetaAccounts(client.purchaseIx(r0,buyer.publicKey,buyer.publicKey,payload,quoteId,0,100_000n),buyer.publicKey):client.purchaseIx(r0,buyer.publicKey,buyer.publicKey,payload,quoteId,0,100_000n));
  };
  await assert.rejects(send(purchase(false),[buyer]));
  await send(purchase(true),[buyer]);
  assert.equal((await readBetaAccess(conn,program,buyer.publicKey))!.used,2_100_000n);
  assert.equal((await readBetaPolicy(conn,program))!.used,BETA_TESTER_LIMIT);
  assert.equal((await readBetaPolicy(conn,program))!.seedUsed,BETA_SEED_LIMIT);
  await assert.rejects(send(purchase(true,2n),[buyer]),"Aggregate 20 USDC cap applies even with individual allowance left");
  await assert.rejects(send(purchase(true),[buyer]),"Quote replay rejected");
  assert.equal((await readBetaAccess(conn,program,buyer.publicKey))!.used,2_100_000n,"Rejected purchase rolls back usage");
  const [position]=await client.positionsForBuyer(buyer.publicKey);
  await send(setBetaAccessIx(program,authority.publicKey,buyer.publicKey,false),[authority]);
  await send(client.requestIx(position,buyer.publicKey,500_000n),[buyer]);
  assert.equal((await client.requestsForPosition(position.address))[0].quantity,500_000n);
  console.log("PASS: real signed purchase, shared premium/deposit counter, atomic rollback, replay protection and partial exercise after revocation.");
  passed=true;
} catch(error) {
  console.error(error);
} finally {
  if(proc.exitCode===null&&proc.signalCode===null)await new Promise<void>(resolve=>{proc.once("exit",()=>resolve());proc.kill("SIGTERM");});
  console.log(`Local test ledger retained at ${directory}`);
  // web3.js confirmation websocket retries otherwise outlive the local validator.
  process.exit(passed?0:1);
}
