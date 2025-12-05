//! Groth16 proof verification using groth16-solana
//! https://github.com/Lightprotocol/groth16-solana

use anchor_lang::prelude::*;
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

use crate::vk;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Proof {
    pub a: [u8; 64],
    pub b: [u8; 128],
    pub c: [u8; 64],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PublicInputs {
    pub root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub recipient: [u8; 32],
    pub relayer: [u8; 32],
    pub fee: [u8; 32],
    pub refund: [u8; 32],
}

impl PublicInputs {
    fn to_array<const N: usize>(&self) -> [[u8; 32]; N] {
        let mut out = [[0u8; 32]; N];
        if N > 0 { out[0] = self.root; }
        if N > 1 { out[1] = self.nullifier_hash; }
        if N > 2 { out[2] = self.recipient; }
        if N > 3 { out[3] = self.relayer; }
        if N > 4 { out[4] = self.fee; }
        if N > 5 { out[5] = self.refund; }
        out
    }
}

pub fn verify_proof(
    proof: &Proof,
    public_inputs: &PublicInputs,
    vk: &Groth16Verifyingkey,
) -> Result<bool> {
    let inputs: [[u8; 32]; vk::N_PUBLIC] = public_inputs.to_array();

    let mut verifier = Groth16Verifier::<{ vk::N_PUBLIC }>::new(&proof.a, &proof.b, &proof.c, &inputs, vk)
        .map_err(|_| ErrorCode::ProofCreationFailed)?;

    verifier
        .prepare_inputs::<true>()
        .map_err(|_| ErrorCode::ProofPreparationFailed)?;

    verifier.verify().map_err(|_| ErrorCode::ProofVerificationFailed)?;

    Ok(true)
}

pub fn get_verification_key() -> Groth16Verifyingkey<'static> {
    Groth16Verifyingkey {
        nr_pubinputs: vk::N_PUBLIC,
        vk_alpha_g1: vk::VK_ALPHA_G1,
        vk_beta_g2: vk::VK_BETA_G2,
        vk_gamme_g2: vk::VK_GAMMA_G2,
        vk_delta_g2: vk::VK_DELTA_G2,
        vk_ic: &vk::VK_IC,
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Failed to create proof verifier")]
    ProofCreationFailed,
    #[msg("Failed to prepare proof inputs")]
    ProofPreparationFailed,
    #[msg("Proof verification failed")]
    ProofVerificationFailed,
}
