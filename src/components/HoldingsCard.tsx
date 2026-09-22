import { useState } from "react";
import { VERIFIED_ASSETS } from "../data/assets";
import { fetchHoldings, type Holdings } from "../data/marketData";
import { useChain } from "../onchain/store";

interface Row { key: string; symbol: string; holdings: Holdings | null; error?: string }

/**
 * Read-only real holdings (PRD §13.2). Reads actual Solana mainnet balances for
 * the verified assets and applies the Token-2022 scaled-balance multiplier, so
 * the number shown is share-equivalents — not the raw token amount (§4.1).
 *
 * Holdings never modify a contract; they can optionally seed the reference
 * exposure so the coverage tracker (§16) compares against something real.
 */
export default function HoldingsCard({ onProtect }: { onProtect?: (assetId: number, quantity: number) => void }) {
  const setExposure = useChain((s) => s.setExposure);
  const [address, setAddress] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address.trim());

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) { setError("That doesn't look like a Solana address."); return; }
    setLoading(true); setError(null); setRows(null); setImported(null);
    try {
      const out = await Promise.all(
        VERIFIED_ASSETS.map(async (a): Promise<Row> => {
          try {
            return { key: a.key, symbol: a.symbol, holdings: await fetchHoldings(address.trim(), a.mint) };
          } catch (err) {
            return { key: a.key, symbol: a.symbol, holdings: null, error: (err as Error).message };
          }
        }),
      );
      setRows(out);
      if (out.every((r) => !r.holdings)) setError("Couldn't reach the holdings service. Is the quote service running?");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function applyExposure(assetIndex: number, shareEquiv: number) {
    setExposure(assetIndex, shareEquiv);
    setImported(VERIFIED_ASSETS[assetIndex].symbol);
    onProtect?.(assetIndex, shareEquiv);
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="between" style={{ marginBottom: 4 }}>
        <div className="card-title" style={{ margin: 0 }}>Real holdings — Solana mainnet</div>
        <span className="pill blue">read-only</span>
      </div>
      <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
        Look up any wallet's actual balance of the verified assets. Raw Token-2022 amounts are
        converted to share-equivalents using the token’s current scaled-balance multiplier.
      </div>

      <form onSubmit={lookup} className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <label className="field" style={{ flex: "1 1 320px" }}>
          <span className="lbl">Wallet address</span>
          <input
            className="input"
            value={address}
            onChange={(e) => { setAddress(e.target.value); setError(null); }}
            placeholder="Paste a Solana wallet address"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={error ? "holdings-error" : undefined}
          />
        </label>
        <button className="btn primary" type="submit" disabled={loading || !address.trim()} style={{ alignSelf: "flex-end" }}>
          {loading ? "Looking up…" : "Look up"}
        </button>
      </form>

      {error && (
        <div className="callout warn" id="holdings-error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ marginTop: 14 }} aria-busy="true">
          <div className="lp-skel line" />
          <div className="lp-skel line short" />
        </div>
      )}

      {rows && !loading && (
        <div style={{ marginTop: 14 }}>
          {rows.map((r, i) => {
            const a = VERIFIED_ASSETS[i];
            const h = r.holdings;
            const shareEquiv = h ? h.displayed : 0;
            const hasBalance = !!h && h.displayed > 0;
            return (
              <div key={r.key} className="kv" style={{ alignItems: "center" }}>
                <span className="k">
                  {r.symbol} <span className="faint">· {a.name}</span>
                </span>
                <span className="v" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {!h ? (
                    <span className="faint">unavailable</span>
                  ) : hasBalance ? (
                    <>
                      <span className="mono">{shareEquiv.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                      <button className="btn ghost sm" onClick={() => applyExposure(i, shareEquiv)}>
                        {onProtect ? "Use this quantity" : "Use as exposure"}
                      </button>
                    </>
                  ) : (
                    <span className="faint">no balance</span>
                  )}
                </span>
              </div>
            );
          })}

          {imported && (
            <div className="callout" style={{ marginTop: 12 }}>
              Using the inspected address’s {imported} balance as reference exposure. No tokens move; protection is purchased separately on Devnet.
            </div>
          )}

          {rows.every((r) => r.holdings && r.holdings.displayed === 0) && (
            <div className="disclosure" style={{ marginTop: 12 }}>
              This wallet holds neither asset. That's expected for most wallets — try one that
              holds NVDAx or Anthropic PreStocks, or just enter a quantity manually in Open position.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
