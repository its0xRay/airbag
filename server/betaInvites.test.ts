import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { BetaInvites } from "./betaInvites";
describe("private beta invitations", () => {
  it("binds once, rejects replay and allows returning-wallet authentication", () => {
    const db = new BetaInvites(":memory:", "https://www.airbag.fyi", "program");
    const wallet = Keypair.generate(), other = Keypair.generate();
    const [code] = db.generate(1, Math.floor(Date.now()/1000)+600);
    const login = (key: Keypair, invite?: string) => {
      const c = db.challenge(key.publicKey.toBase58());
      const sig = Buffer.from(nacl.sign.detached(Buffer.from(c.message), key.secretKey)).toString("base64");
      return { c, sig, run: () => db.verify(c.id, sig, invite) };
    };
    const first = login(wallet, code), session = first.run();
    expect(db.session(session.token)).toBe(wallet.publicKey.toBase58());
    expect(() => first.run()).toThrow();
    expect(() => login(other, code).run()).toThrow();
    expect(login(wallet).run().wallet).toBe(wallet.publicKey.toBase58());
    expect(JSON.stringify(db.list())).not.toContain(code);
    db.revokeWallet(wallet.publicKey.toBase58());
    expect(db.session(session.token)).toBeNull();
    expect(login(wallet).run().wallet).toBe(wallet.publicKey.toBase58());
    expect(db.isRevoked(wallet.publicKey.toBase58())).toBe(true);
    db.close();
  });
  it("rejects invalid signatures and revoked invitations", () => {
    const db = new BetaInvites(":memory:", "https://www.airbag.fyi", "program");
    const key = Keypair.generate(), c = db.challenge(key.publicKey.toBase58());
    expect(() => db.verify(c.id, Buffer.alloc(64).toString("base64"))).toThrow();
    const [code] = db.generate(1, Math.floor(Date.now()/1000)+600);
    db.revokeCode(String(db.list()[0].hash));
    const sig = Buffer.from(nacl.sign.detached(Buffer.from(c.message), key.secretKey)).toString("base64");
    expect(() => db.verify(c.id, sig, code)).toThrow();
    db.close();
  });
});
