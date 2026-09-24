import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AssetSelector from "./AssetSelector";
it("uses consistent asset names and semantic selection in both flows", () => {
  const render = (label: string) => renderToStaticMarkup(<AssetSelector label={label} value={1} onChange={() => {}} />);
  for (const label of ["Choose an asset", "Choose a vault"]) {
    const html = render(label);
    expect(html).toContain("Anthropic PreStocks");
    expect(html).toContain("Pre-IPO token exposure");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).not.toContain("✓");
  }
});
