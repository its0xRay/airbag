// Operator CLI. No invitations are generated at service startup. No chain write
// is sent without --execute. Secrets must be injected, not passed as arguments.
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { BetaInvites } from "../server/betaInvites";
import { betaConnection, betaKey, betaProgram, required, verifyBetaDeployment } from "../server/betaConfig";
import { initializeBetaPolicyIx, setBetaAccessIx, MAINNET_GENESIS, USDC_MINT, BETA_TESTER_LIMIT } from "../src/client/betaProgram";
import { VaultClient, vaultPdasFor, type VaultTerms } from "../src/client/vaultProgram";
import { TOKEN_PROGRAM_ID } from "../src/client/optketProgram";
import { VERIFIED_ASSETS } from "../src/data/assets";
import { vaultPolicyHash } from "../server/vaultQuotes";

const [command, ...args] = process.argv.slice(2);
const execute = args.includes("--execute");
const program = betaProgram();
const db = () => new BetaInvites(required("BETA_DB_PATH"), required("BETA_ORIGIN"), program.toBase58());
const u64=(n:bigint)=>{if(n<0n||n>(1n<<64n)-1n)throw new Error("Invalid amount");const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b;};
const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const key=(pubkey:PublicKey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
const derive=(s:string,asset?:number)=>PublicKey.findProgramAddressSync([Buffer.from(s),...(asset===undefined?[]:[Buffer.from([asset])])],program)[0];
async function send(ix:TransactionInstruction, role="BETA_ADMIN_SECRET") {
  const conn=betaConnection();
  if(await conn.getGenesisHash()!==MAINNET_GENESIS)throw new Error("Not mainnet");
  const signer=betaKey(role), tx=new Transaction().add(ix);
  const life=await conn.getLatestBlockhash();tx.feePayer=signer.publicKey;tx.recentBlockhash=life.blockhash;tx.sign(signer);
  const simulation=await conn.simulateTransaction(tx);
  if(simulation.value.err)throw new Error("Preflight failed. No transaction sent.");
  if(!execute){console.log("Preflight passed. Dry run only; repeat with --execute after reviewing the instruction.");return;}
  console.log(await sendAndConfirmTransaction(conn,tx,[signer],{commitment:"confirmed"}));
}
switch(command) {
  case "invites": {
    if(!execute)throw new Error("Generating invitations requires --execute");
    const count=Number(args[0]),expires=Date.parse(args[1])/1000;
    const store=db();try{for(const code of store.generate(count,expires))console.log(code);}finally{store.close();}break;
  }
  case "list": {const store=db();try{console.log(store.list());}finally{store.close();}break;}
  case "revoke-code": {if(!execute)throw new Error("Use --execute");const store=db();try{store.revokeCode(args[0]);}finally{store.close();}break;}
  case "revoke-wallet": {
    const owner=new PublicKey(args[0]), authority=betaKey("BETA_ACCESS_SECRET");
    // Revoke onchain FIRST, so direct program calls are blocked too.
    await send(setBetaAccessIx(program,authority.publicKey,owner,false),"BETA_ACCESS_SECRET");
    if(execute){const store=db();try{store.revokeWallet(owner.toBase58());}finally{store.close();}}break;
  }
  case "config": {
    const admin=betaKey("BETA_ADMIN_SECRET");
    const quote=new PublicKey(required("BETA_QUOTE_PUBLIC_KEY")),publisher=new PublicKey(required("BETA_PUBLISHER_PUBLIC_KEY"));
    await send(new TransactionInstruction({programId:program,keys:[key(admin.publicKey,true,true),key(derive("config"),true),key(USDC_MINT),key(SystemProgram.programId)],
      data:Buffer.concat([Buffer.from([208,127,21,1,194,190,196,70]),quote.toBuffer(),publisher.toBuffer(),u64(0n)])}));break;
  }
  case "policy": {
    const admin=betaKey("BETA_ADMIN_SECRET"), authority=new PublicKey(required("BETA_ACCESS_PUBLIC_KEY"));
    const total=BigInt(process.env.BETA_TOTAL_LIMIT_BASE_UNITS??BETA_TESTER_LIMIT.toString());
    await send(initializeBetaPolicyIx(program,admin.publicKey,authority,total));break;
  }
  case "asset": {
    const asset=Number(args[0]);if(asset!==0&&asset!==1)throw new Error("Asset must be 0 or 1");
    const admin=betaKey("BETA_ADMIN_SECRET"),mint=new PublicKey(VERIFIED_ASSETS[asset].mint);
    const data=Buffer.concat([Buffer.from([133,1,51,41,37,45,8,38,asset,asset]),mint.toBuffer(),u32(asset===0?2:1),u32(1),u64(BigInt(required("BETA_ASSET_EXPOSURE_BASE_UNITS"))),Buffer.from([1])]);
    await send(new TransactionInstruction({programId:program,data,keys:[key(admin.publicKey,true,true),key(derive("config")),key(derive("asset",asset),true),key(derive("pool",asset),true),key(derive("vault",asset),true),key(USDC_MINT),key(TOKEN_PROGRAM_ID),key(SystemProgram.programId)]}));break;
  }
  case "pause": case "unpause": {
    const admin=betaKey("BETA_ADMIN_SECRET");
    if(command==="unpause")await verifyBetaDeployment(betaConnection(),program);
    await send(new TransactionInstruction({programId:program,keys:[key(admin.publicKey,false,true),key(derive("config"),true)],data:Buffer.from([63,32,154,2,56,103,79,45,Number(command==="pause")])}));break;
  }
  case "round": {
    const termsRaw=JSON.parse(required("BETA_ROUND_TERMS"));
    const terms:VaultTerms={...termsRaw,...Object.fromEntries(["depositCap","exposureCap","minStrike","maxStrike","maxQuantity"].map(k=>[k,BigInt(termsRaw[k])]))};
    const admin=betaKey("BETA_ADMIN_SECRET"),client=new VaultClient(betaConnection(),program);
    await send(client.createIx(admin.publicKey,USDC_MINT,BigInt(required("BETA_ROUND_ID")),terms,vaultPolicyHash(terms.assetId)));break;
  }
  case "check": {
    const result=await verifyBetaDeployment(betaConnection(),program);
    console.log({program:program.toBase58(),mint:USDC_MINT.toBase58(),policy:result.policy,config:vaultPdasFor(program).config().toBase58()});break;
  }
  default: throw new Error("Commands: check, config, policy, asset <0|1>, pause, unpause, round, invites <count> <ISO expiry> --execute, list, revoke-code <hash> --execute, revoke-wallet <public key> [--execute]. Chain writes default to simulation only.");
}
