import AssetLogo from "./AssetLogo";
import { VERIFIED_ASSETS } from "../data/assets";

export default function AssetSelector({ value, onChange, disabled = false, label = "Choose an asset" }: {
  value: number; onChange: (asset: number) => void; disabled?: boolean; label?: string;
}) {
  return <div className="asset-selector" role="group" aria-label={label}>
    {VERIFIED_ASSETS.map((asset, id) => <button key={asset.key} className="asset-option" aria-pressed={value === id} disabled={disabled} onClick={() => onChange(id)}>
      <AssetLogo asset={asset} /><span><strong>{id === 0 ? "NVDAx" : "Anthropic PreStocks"}</strong><small>{id === 0 ? "Tokenized public equity" : "Pre-IPO token exposure"}</small></span>
    </button>)}
  </div>;
}
