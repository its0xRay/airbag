use anchor_lang::prelude::*;

#[error_code]
pub enum OptketError {
    // ---- Roles / config ----
    #[msg("Caller is not authorized for this action")]
    Unauthorized,
    #[msg("New purchases are paused")]
    PurchasesPaused,
    #[msg("Asset is not active for live-reference contracts")]
    AssetInactive,
    #[msg("Series is not active")]
    SeriesInactive,

    // ---- Token / collateral gating ----
    #[msg("Only the configured demo mint may be used (real USDC is rejected)")]
    WrongMint,
    #[msg("Pool has insufficient available capital to reserve this liability")]
    InsufficientCollateral,
    #[msg("Withdrawal would drop the pool below its outstanding obligations")]
    WithdrawalBelowObligations,

    // ---- Quote verification ----
    #[msg("Quote signature verification failed")]
    BadQuoteSignature,
    #[msg("Quote was signed by an unauthorized key")]
    BadQuoteAuthority,
    #[msg("Quote has expired")]
    QuoteExpired,
    #[msg("Quote lifetime exceeds the maximum allowed")]
    QuoteTtlTooLong,
    #[msg("Quote fields do not match the on-chain series/terms")]
    QuoteTermsMismatch,
    #[msg("Quote buyer does not match the transaction signer")]
    QuoteBuyerMismatch,
    #[msg("Missing or malformed ed25519 verification instruction")]
    MissingEd25519Instruction,
    #[msg("This quote id has already been used (replay)")]
    QuoteReplay,

    // ---- Series / exposure ----
    #[msg("Purchase window has closed")]
    PurchaseCutoffPassed,
    #[msg("Quantity exceeds the maximum contract size")]
    ContractSizeExceeded,
    #[msg("Purchase would exceed the asset aggregate exposure limit")]
    AggregateExposureExceeded,
    #[msg("Quantity must be greater than zero")]
    ZeroQuantity,
    #[msg("Fees must be zero in the demo configuration")]
    NonZeroFees,

    // ---- Exercise ----
    #[msg("Contract is not in an active state")]
    ContractNotActive,
    #[msg("Requested quantity exceeds remaining active quantity")]
    ExceedsRemaining,
    #[msg("Exercise cutoff has passed")]
    ExerciseCutoffPassed,
    #[msg("Exercise request is not pending")]
    RequestNotPending,
    #[msg("Reference kind does not match the settlement path")]
    WrongReferencePath,

    // ---- References / observations ----
    #[msg("Observation source timestamp is not strictly after the request")]
    ObservationNotAfterRequest,
    #[msg("Observation is outside the required window")]
    ObservationOutsideWindow,
    #[msg("Observation is too stale at collection time")]
    ObservationStale,
    #[msg("Too few qualifying observations to settle")]
    InsufficientObservations,
    #[msg("Observation source slots are not strictly increasing / are duplicated")]
    NonIncreasingSlots,
    #[msg("Reference is invalid or negative")]
    InvalidReference,
    #[msg("No qualifying reference could be established for this window")]
    ReferenceWindowFailed,
    #[msg("Expiry has not been reached yet")]
    ExpiryNotReached,
    #[msg("Expiry reference must be at or after the fixed expiry timestamp")]
    ReferenceBeforeExpiry,
    #[msg("Pending exercise requests must be resolved before expiry settlement")]
    PendingRequestsOutstanding,

    // ---- Arithmetic ----
    #[msg("Arithmetic overflow")]
    MathOverflow,

    // ---- Accounting invariants ----
    #[msg("Accounting invariant violated")]
    InvariantViolation,

    // ---- Trial budget ----
    #[msg("Trial spending cap would be exceeded")]
    TrialCapExceeded,
}
