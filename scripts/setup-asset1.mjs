import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash } from "node:crypto"; import { readFileSync } from "node:fs"; import { homedir } from "node:os";
const conn = new Connection("http://127.0.0.1:8899", "confirmed");
const PROGRAM_ID = new PublicKey("Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`))));
const disc = (n) => createHash("sha256").update("global:"+n).digest().subarray(0,8);
const u64=(v)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(v));return b;};
const i64=(v)=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(v));return b;};
const u32=(v)=>{const b=Buffer.alloc(4);b.writeUInt32LE(v);return b;};
const u16=(v)=>{const b=Buffer.alloc(2);b.writeUInt16LE(v);return b;};
const meta=(p,s,w)=>({pubkey:p,isSigner:s,isWritable:w}); const S=(s)=>Buffer.from(s);
const pda=(seeds)=>PublicKey.findProgramAddressSync(seeds,PROGRAM_ID)[0];
const A=1;
const config=pda([S("config")]), asset=pda([S("asset"),Buffer.from([A])]), pool=pda([S("pool"),Buffer.from([A])]), vault=pda([S("vault"),Buffer.from([A])]);
const sidBuf=Buffer.alloc(2); const series=pda([S("series"),Buffer.from([A]),sidBuf]);
async function send(ixs){ await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer], {commitment:"confirmed"}); }
async function main(){
  const cfg=await conn.getAccountInfo(config); const demoMint=new PublicKey(cfg.data.subarray(104,136));
  const adminToken=getAssociatedTokenAddressSync(demoMint,payer.publicKey);
  if(await conn.getAccountInfo(asset)){ console.log("asset 1 already exists"); } else {
    await send([new TransactionInstruction({programId:PROGRAM_ID,keys:[meta(payer.publicKey,true,true),meta(config,false,false),meta(asset,false,true),meta(pool,false,true),meta(vault,false,true),meta(demoMint,false,false),meta(demoMint,false,false),meta(TOKEN_PROGRAM_ID,false,false),meta(SystemProgram.programId,false,false)],data:Buffer.concat([disc("init_asset"),Buffer.from([A]),Buffer.from([1]),u32(1),u32(1),u64(2_000_000_000_000n),Buffer.from([1])])})]);
    console.log("✓ init_asset 1 (PreStocks)");
    await send([new TransactionInstruction({programId:PROGRAM_ID,keys:[meta(payer.publicKey,true,true),meta(config,false,false),meta(pool,false,true),meta(vault,false,true),meta(adminToken,false,true),meta(demoMint,false,false),meta(TOKEN_PROGRAM_ID,false,false)],data:Buffer.concat([disc("fund_pool"),Buffer.from([A]),u64(300_000_000_000n)])})]);
    console.log("✓ fund_pool 1 (300,000)");
  }
  if(!(await conn.getAccountInfo(series))){
    const expiry=Math.floor(Date.now()/1000)+7*24*3600;
    await send([new TransactionInstruction({programId:PROGRAM_ID,keys:[meta(payer.publicKey,true,true),meta(config,false,false),meta(asset,false,false),meta(series,false,true),meta(SystemProgram.programId,false,false)],data:Buffer.concat([disc("create_series"),Buffer.from([A]),u16(0),u64(24_000_000),i64(expiry),i64(expiry-900),i64(expiry-300),u64(2_000_000_000)])})]);
    console.log("✓ create_series 1:0 (strike $24)");
  } else console.log("series 1:0 already exists");
}
main().catch(e=>{console.error(e);process.exit(1);});
