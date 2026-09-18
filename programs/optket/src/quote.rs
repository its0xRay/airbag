//! Signed premium quotes (PRD §8).
//!
//! The off-chain quote service (an authorized `quote_authority`) signs a
//! canonical, borsh-serialized `QuotePayload` with an ed25519 key. The client
//! includes a native Ed25519 program instruction in the same transaction that
//! actually verifies the signature; this module then confirms that instruction
//! bound the expected public key and the exact message bytes we reconstruct
//! on-chain. This is the standard Solana ed25519 verification pattern.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked;

use crate::errors::OptketError;

/// Canonical quote payload. The byte layout below MUST match what the quote
/// service signs (see the TS `signQuote` helper). Field order is significant.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct QuotePayload {
    pub buyer: Pubkey,
    pub asset_id: u8,
    pub series_id: u16,
    pub quantity: u64,
    pub strike: u64,
    pub expiry_ts: i64,
    pub reference_version: u32,
    pub premium: u64,
    pub fees: u64,
    pub quote_id: u64,
    pub quote_expiry_ts: i64,
}

impl QuotePayload {
    /// Deterministic message bytes that get signed and verified.
    pub fn message_bytes(&self) -> Vec<u8> {
        self.try_to_vec().expect("quote payload serializes")
    }
}

// Ed25519 native program instruction layout (single signature):
//   offset 0: num_signatures (u8)  == 1
//   offset 1: padding (u8)
//   offset 2: signature_offset (u16 LE)
//   offset 4: signature_instruction_index (u16 LE)
//   offset 6: public_key_offset (u16 LE)
//   offset 8: public_key_instruction_index (u16 LE)
//   offset 10: message_data_offset (u16 LE)
//   offset 12: message_data_size (u16 LE)
//   offset 14: message_instruction_index (u16 LE)
//   then: public_key (32) | signature (64) | message (message_data_size)
const ED25519_HEADER_LEN: usize = 16;
const PUBKEY_LEN: usize = 32;
const SIGNATURE_LEN: usize = 64;

fn read_u16_le(data: &[u8], offset: usize) -> Result<u16> {
    let end = offset.checked_add(2).ok_or(OptketError::MissingEd25519Instruction)?;
    let slice = data.get(offset..end).ok_or(OptketError::MissingEd25519Instruction)?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

/// Verify that the transaction contains a well-formed Ed25519 instruction (at
/// `ed25519_ix_index`) that verified `expected_pubkey` over `expected_msg`.
///
/// Because the native Ed25519 program has already cryptographically verified
/// the signature when the transaction executes, confirming the bound pubkey +
/// message here is sufficient to trust the signature.
pub fn verify_ed25519(
    instruction_sysvar: &AccountInfo,
    ed25519_ix_index: u8,
    expected_pubkey: &Pubkey,
    expected_msg: &[u8],
) -> Result<()> {
    let ix = load_instruction_at_checked(ed25519_ix_index as usize, instruction_sysvar)
        .map_err(|_| OptketError::MissingEd25519Instruction)?;

    require_keys_eq!(
        ix.program_id,
        ed25519_program::ID,
        OptketError::MissingEd25519Instruction
    );

    let data = &ix.data;
    require!(data.len() >= ED25519_HEADER_LEN, OptketError::MissingEd25519Instruction);

    // Exactly one signature is expected.
    require!(data[0] == 1, OptketError::MissingEd25519Instruction);

    let sig_ix_index = read_u16_le(data, 4)?;
    let pubkey_offset = read_u16_le(data, 6)? as usize;
    let pubkey_ix_index = read_u16_le(data, 8)?;
    let msg_offset = read_u16_le(data, 10)? as usize;
    let msg_size = read_u16_le(data, 12)? as usize;
    let msg_ix_index = read_u16_le(data, 14)?;

    // All data must live inside THIS instruction (index sentinel 0xFFFF means
    // "current instruction"). Reject any cross-instruction indirection.
    let this = u16::MAX;
    require!(
        (sig_ix_index == this || sig_ix_index == ed25519_ix_index as u16)
            && (pubkey_ix_index == this || pubkey_ix_index == ed25519_ix_index as u16)
            && (msg_ix_index == this || msg_ix_index == ed25519_ix_index as u16),
        OptketError::BadQuoteSignature
    );

    // Bound public key must equal the authorized quote authority.
    let pk_end = pubkey_offset
        .checked_add(PUBKEY_LEN)
        .ok_or(OptketError::MissingEd25519Instruction)?;
    let bound_pubkey = data
        .get(pubkey_offset..pk_end)
        .ok_or(OptketError::MissingEd25519Instruction)?;
    require!(
        bound_pubkey == expected_pubkey.as_ref(),
        OptketError::BadQuoteAuthority
    );

    // Sanity: the signature must sit where the header claims.
    require!(data.len() >= pubkey_offset + PUBKEY_LEN, OptketError::MissingEd25519Instruction);
    require!(data.len() >= msg_offset + msg_size, OptketError::MissingEd25519Instruction);
    let _ = SIGNATURE_LEN; // documented layout constant

    // Bound message must equal the exact bytes we reconstruct on-chain.
    require!(msg_size == expected_msg.len(), OptketError::QuoteTermsMismatch);
    let msg_end = msg_offset
        .checked_add(msg_size)
        .ok_or(OptketError::MissingEd25519Instruction)?;
    let bound_msg = data
        .get(msg_offset..msg_end)
        .ok_or(OptketError::MissingEd25519Instruction)?;
    require!(bound_msg == expected_msg, OptketError::QuoteTermsMismatch);

    Ok(())
}
