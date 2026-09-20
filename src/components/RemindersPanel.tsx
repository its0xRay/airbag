import { useState } from "react";
import { useChain } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import { fmtDuration } from "../format";
import { useNowSeconds } from "../useNowSeconds";

const tok = (v: bigint) => Number(v) / 1e6;
const REMINDER_KEY = "optket.reminders";
const SOON_SECS = 48 * 3600;

function loadSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(REMINDER_KEY) || "[]")); } catch { return new Set(); }
}

/**
 * Renewal reminders (PRD §18). Stored locally in this browser. "Renew" opens
 * a FRESH quote — it never
 * carries the old contract's terms over and never spends anything by itself.
 */
export default function RemindersPanel({ onRenew }: { onRenew: (assetId: number, quantity: number) => void }) {
  const c = useChain();
  const [reminders, setReminders] = useState<Set<string>>(loadSet);
  const now = useNowSeconds();

  const open = c.contracts.filter((k) => k.status === "Active" || k.status === "PartiallySettled");
  if (open.length === 0) return null;

  const toggle = (id: string) => {
    const next = new Set(reminders);
    if (next.has(id)) next.delete(id); else next.add(id);
    localStorage.setItem(REMINDER_KEY, JSON.stringify([...next]));
    setReminders(next);
  };

  const tracked = open.filter((k) => reminders.has(k.contractId.toString()));
  const soon = open.filter((k) => !reminders.has(k.contractId.toString()) && k.expiryTs - now <= SOON_SECS);
  if (tracked.length === 0 && soon.length === 0) return null;

  const Row = ({ k, tracking }: { k: (typeof open)[number]; tracking: boolean }) => (
    <div className="between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <div>
        <strong>#{k.contractId.toString()} · {VERIFIED_ASSETS[k.assetId]?.symbol}</strong>{" "}
        <span className="dim">
          {tok(k.remainingQuantity).toLocaleString(undefined, { maximumFractionDigits: 4 })} protected ·{" "}
          {k.expiryTs > now ? `expires in ${fmtDuration(k.expiryTs - now)}` : "expired"}
        </span>
      </div>
      <div className="row">
        <button className="btn primary sm" onClick={() => onRenew(k.assetId, tok(k.remainingQuantity))}>Renew</button>
        <button className="btn ghost sm" onClick={() => toggle(k.contractId.toString())}>
          {tracking ? "Remove" : "Remind me"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>Renewal reminders</div>

      {tracked.map((k) => <Row key={k.address} k={k} tracking />)}
      {soon.length > 0 && (
        <>
          <div className="faint" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", margin: "12px 0 4px" }}>
            Expiring soon — no reminder set
          </div>
          {soon.map((k) => <Row key={k.address} k={k} tracking={false} />)}
        </>
      )}

      <div className="disclosure" style={{ marginTop: 10 }}>
        Stored only in this browser. Renewal opens a <strong>fresh quote</strong> — no automatic
        purchase, and old terms never carry over.
      </div>
    </div>
  );
}
