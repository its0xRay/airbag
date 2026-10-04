import { describe,it,expect,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WalletBar from "./WalletBar";
vi.mock("../onchain/store",()=>({useChain:()=>({connected:false,busy:false}),NETWORK:"devnet"}));
describe("wallet entry points",()=>{
  it("separates the demo and invite-only mainnet without a network dropdown",()=>{
    const html=renderToStaticMarkup(<WalletBar/>);
    expect(html).toContain("Try demo wallet");expect(html).toContain("Connect wallet");
    expect(html).toContain("Mainnet beta · Invite only");expect(html).toContain('href="/?beta=1"');
    expect(html).not.toContain("Choose network");
  });
});
