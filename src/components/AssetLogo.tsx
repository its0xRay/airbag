import { useState } from "react";
import type { VerifiedAsset } from "../data/assets";

export default function AssetLogo({ asset }: { asset: VerifiedAsset }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <span className="token-logo token-logo-fallback" aria-hidden="true">{asset.symbol[0]}</span>
    : <img className={"token-logo" + (asset.symbol === "ANTHROPIC" ? " token-logo-anthropic" : "")} src={asset.logo} width="28" height="28" alt="" onError={() => setFailed(true)} />;
}
