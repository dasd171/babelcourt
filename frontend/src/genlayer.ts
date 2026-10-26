import { createAccount, createClient, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS ||
  "0xd8cD45708980F90b6b718E6d61e46BdAa06Aa6b8") as `0x${string}`;
export const RPC_URL = studionet.rpcUrls.default.http[0];
export const EXPLORER = "https://explorer-studio.genlayer.com";
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;

const BURNER_KEY = "babelcourt.burner.pk";

export type WalletMode = "none" | "burner" | "injected";

export interface Wallet {
  mode: WalletMode;
  address?: `0x${string}`;
}

// Read-only client: no account needed for view calls.
export const reader = createClient({ chain: studionet });

let writer: ReturnType<typeof createClient> | null = null;

export function loadBurner(): Wallet | null {
  const pk = localStorage.getItem(BURNER_KEY) as `0x${string}` | null;
  if (!pk) return null;
  const account = createAccount(pk);
  writer = createClient({ chain: studionet, account });
  return { mode: "burner", address: account.address };
}

export function newBurner(): Wallet {
  localStorage.setItem(BURNER_KEY, generatePrivateKey());
  return loadBurner()!;
}

export function forgetBurner() {
  localStorage.removeItem(BURNER_KEY);
  writer = null;
}

export async function connectInjected(): Promise<Wallet> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No injected wallet found. Install MetaMask or use Demo mode.");
  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  const address = accounts[0] as `0x${string}`;
  const chainHex = "0x" + studionet.id.toString(16);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
  } catch {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainHex,
          chainName: "GenLayer Studionet",
          rpcUrls: [RPC_URL],
          nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
          blockExplorerUrls: [EXPLORER],
        },
      ],
    });
  }
  writer = createClient({ chain: studionet, account: address, provider: eth });
  return { mode: "injected", address };
}

/** Studionet-only faucet: the Studio exposes sim_fundAccount for test GEN. */
export async function fundTestGen(address: string, gen = 10) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sim_fundAccount",
      params: [address, Number(BigInt(gen) * 10n ** 18n)],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "Faucet failed");
  return j.result as string;
}

export async function getBalance(address: string): Promise<bigint> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
  });
  const j = await res.json();
  return BigInt(j.result || "0x0");
}

export async function read<T = any>(functionName: string, args: any[] = []): Promise<T> {
  const out = await reader.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    jsonSafeReturn: true,
  });
  return normalize(out) as T;
}

function normalize(v: any): any {
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [k, normalize(x)]));
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v === "bigint") return Number(v);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  return v;
}

export async function write(functionName: string, args: any[], value: bigint = 0n): Promise<string> {
  if (!writer) throw new Error("Connect a wallet first (Demo mode works without any setup).");
  const hash = await writer.writeContract({ address: CONTRACT_ADDRESS, functionName, args, value });
  return hash as string;
}

export async function waitAccepted(hash: string) {
  const r: any = await reader.waitForTransactionReceipt({
    hash: hash as any,
    status: TransactionStatus.ACCEPTED,
    interval: 4000,
    retries: 120,
  });
  return r;
}

export const formatGen = (wei: string | number | bigint) => {
  const w = BigInt(wei || 0);
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n).toString().padStart(18, "0").slice(0, 3).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
};

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
