import { useEffect, useRef, useState, type ReactNode } from "react";
import "./CapitalFlow.css";

/** A mechanism explanation, never a live transaction indicator. */
export default function CapitalFlow({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setEntered(true);
        observer.disconnect();
      }
    }, { threshold: 0.25 });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={root} className="risk-relationship capital-flow" data-entered={entered}
    aria-label="Mechanism: holders pay premiums to a vault; the vault funds contractual payouts when the floor pays.">
    {children}
  </div>;
}

export function CapitalFlowPaths() {
  return <div className="capital-paths">
    <div className="capital-path capital-premium">
      <div className="capital-path-label">Premiums</div>
      <div className="capital-rail" aria-hidden="true"><i className="capital-pulse" /><i className="capital-arrow" /></div>
    </div>
    <div className="capital-path capital-payout">
      <div className="capital-path-label">Payouts<small>When the floor pays</small></div>
      <div className="capital-rail" aria-hidden="true"><i className="capital-pulse" /><i className="capital-arrow" /></div>
    </div>
  </div>;
}
