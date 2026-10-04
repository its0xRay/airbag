import { describe,it,expect,vi,beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WalletBar from "./WalletBar";
const state = vi.hoisted(() => ({ connected:false,busy:false,refreshing:false,address:"demo-address",tokenBalance:100 }));
vi.mock("../onchain/store",()=>({useChain:()=>state,NETWORK:"devnet",explorerUrl:()=>"https://explorer.solana.com/address/demo-address?cluster=devnet"}));
describe("wallet entry points",()=>{
  beforeEach(() => { state.connected=false; state.busy=false; state.refreshing=false; state.tokenBalance=100; });
  it("separates the demo and invite-only mainnet without a network dropdown",()=>{
    const html=renderToStaticMarkup(<WalletBar/>);
    expect(html).toContain("Try demo</button>");expect(html).toContain("Connect wallet</span><small>Mainnet beta</small>");
    expect(html).toContain('href="/?beta=1"');
    expect(html).not.toContain("Choose network");
    expect(html).not.toContain("Devnet");
  });
  it("keeps connected wallet diagnostics inside a closed disclosure",()=>{
    state.connected=true;
    const html=renderToStaticMarkup(<WalletBar/>);
    expect(html).toContain('<details class="wallet-details"><summary');
    expect(html).toContain('Demo wallet</summary>');
    expect(html).toContain('Copy address');
    expect(html).toContain('View on Explorer');
    expect(html).toContain('Refresh wallet');
    expect(html).not.toContain('pill green');
    expect(html).not.toContain('pill blue');
    expect(html).not.toContain('Try demo');
  });
  it("shows connection progress and disables repeated connection",()=>{
    state.busy=true;
    const html=renderToStaticMarkup(<WalletBar/>);
    expect(html).toContain('disabled="" aria-busy="true">Connecting…');
  });
  it("preserves empty-wallet recovery inside wallet details",()=>{
    state.connected=true;state.tokenBalance=0;state.refreshing=true;
    const html=renderToStaticMarkup(<WalletBar/>);
    expect(html).toContain('Get demo oUSD');
    expect(html).toContain('disabled="" aria-busy="true">Refreshing…');
  });
});
