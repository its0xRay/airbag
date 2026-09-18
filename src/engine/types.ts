// Domain types shared by the engine and the UI. Mirrors the on-chain state
// accounts (programs/optket/src/state.rs).

export type AssetKind = "EquityToken" | "PreStocks";
export type ReferenceKind = "Equity" | "PreStocks";

export type ContractStatus =
  | "Active"
  | "PartiallySettled"
  | "Exercised"
  | "Expired"
  | "Refunded"
  | "Cancelled";

export type RequestStatus = "Pending" | "Settled" | "Failed";

export interface AssetConfig {
  assetId: number;
  kind: AssetKind;
  symbol: string;
  name: string;
  /** Human label for what the reference actually tracks (PRD §5). */
  referenceLabel: string;
  referenceVersion: number;
  conversionVersion: number;
  /** Whether verified for live-reference contracts (PRD §4.3). */
  active: boolean;
  /** Max aggregate maximum-liability across live contracts (token base units). */
  maxAggregateExposure: bigint;
}

export interface Series {
  assetId: number;
  seriesId: number;
  strike: bigint;
  expiryTs: number;
  purchaseCutoffTs: number;
  exerciseCutoffTs: number;
  maxContractSize: bigint;
  referenceVersion: number;
}

export interface QuotePayload {
  buyer: string;
  assetId: number;
  seriesId: number;
  quantity: bigint;
  strike: bigint;
  expiryTs: number;
  referenceVersion: number;
  premium: bigint;
  fees: bigint;
  quoteId: bigint;
  quoteExpiryTs: number;
}

export interface Observation {
  slot: bigint;
  sourceTs: number;
  collectedTs: number;
  price: bigint;
}

export interface ExerciseRequest {
  contractId: bigint;
  nonce: number;
  quantity: bigint;
  requestTs: number;
  windowStart: number;
  windowEnd: number;
  kind: ReferenceKind;
  status: RequestStatus;
  reservedLocked: bigint;
  settlementReference: bigint;
  payout: bigint;
}

export interface Contract {
  contractId: bigint;
  buyer: string;
  assetId: number;
  seriesId: number;
  conversionVersion: number;
  referenceVersion: number;
  // immutable terms
  originalQuantity: bigint;
  strike: bigint;
  expiryTs: number;
  exerciseCutoffTs: number;
  premiumPaid: bigint;
  feesPaid: bigint;
  // mutable counters
  remainingQuantity: bigint;
  pendingQuantity: bigint;
  reservedCollateral: bigint;
  status: ContractStatus;
  createdTs: number;
  nextRequestNonce: number;
  requests: ExerciseRequest[];
}

export interface Pool {
  assetId: number;
  /** Actual demo-token balance held by the vault (bookkeeping mirror). */
  vaultBalance: bigint;
  availableCapital: bigint;
  reserved: bigint;
  pendingExercise: bigint;
  refundObligations: bigint;
  premiumReceipts: bigint;
  totalPayouts: bigint;
  totalRefunds: bigint;
  released: bigint;
}
