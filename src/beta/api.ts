import { Connection } from "@solana/web3.js";
const endpoint = import.meta.env.VITE_BETA_SERVICE as string | undefined;
export function betaEndpoint() {
  if (!endpoint || new URL(endpoint).protocol !== "https:") throw new Error("Mainnet beta is not open yet. You can still use the Devnet demo.");
  return endpoint.replace(/\/$/,"");
}
export async function betaApi<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${betaEndpoint()}${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { "content-type":"application/json", ...(token ? { authorization:`Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(20000), redirect:"error" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Beta request failed.");
  return data;
}
export const betaConnection = (token: string) => new Connection(`${betaEndpoint()}/rpc`, {
  commitment:"confirmed", disableRetryOnRateLimit:true,
  fetch: (input,init) => fetch(input,{...init,headers:{...init?.headers,authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(15000)}),
});
export interface BetaConfig { enabled:boolean; network:string; programId:string; mint:string; walletLimit:string; origin:string; }
export interface BetaStatus { access: {used:string;enabled:boolean}|null; policy:{used:string;limit:string;seedUsed:string;seedLimit:string}|null; admin:string|null;walletLimit:string;accepting:boolean; }
