import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CapitalFlow, { CapitalFlowPaths } from "./CapitalFlow";

describe("capital flow explanation", () => {
  it("renders both directions and conditional payouts without waiting for motion", () => {
    const html = renderToStaticMarkup(<CapitalFlow><CapitalFlowPaths /></CapitalFlow>);
    expect(html).toContain('data-entered="false"');
    expect(html).toContain("Premiums");
    expect(html).toContain("Payouts");
    expect(html).toContain("When the floor pays");
    expect(html.match(/class="capital-rail" aria-hidden="true"/g)).toHaveLength(2);
    expect(html).not.toContain("live");
  });
});
