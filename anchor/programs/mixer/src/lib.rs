use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

mod merkle_tree;
mod poseidon;
mod state;
mod verifier;
mod vk;

use state::*;
use verifier::{get_verification_key, verify_proof, Proof, PublicInputs};

declare_id!("BKkVngJDT8GNKDDcjhH7oyPAC4NQNUgKmVotWDnkUspa");

// BN254 scalar field prime - addresses are reduced mod this value in the ZK circuit
const BN254_PRIME: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
    0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

// Convert pubkey bytes to field element (mod BN254_PRIME if >= prime)
fn pubkey_to_field_element(pubkey: &Pubkey) -> [u8; 32] {
    let bytes = pubkey.to_bytes();
    
    // Compare bytes (big-endian style comparison)
    let mut is_greater_or_equal = false;
    for i in (0..32).rev() {
        if bytes[31 - i] > BN254_PRIME[i] {
            is_greater_or_equal = true;
            break;
        } else if bytes[31 - i] < BN254_PRIME[i] {
            break;
        }
        if i == 0 {
            is_greater_or_equal = true;
        }
    }
    
    if !is_greater_or_equal {
        return bytes;
    }
    
    // Subtract prime (simple subtraction since we know bytes >= prime)
    let mut result = [0u8; 32];
    let mut borrow = 0i16;
    
    for i in 0..32 {
        let diff = (bytes[i] as i16) - (BN254_PRIME[31 - i] as i16) - borrow;
        if diff < 0 {
            result[i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            result[i] = diff as u8;
            borrow = 0;
        }
    }
    
    result
}

#[program]
pub mod mixer {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, denomination: u64) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool.load_init()?;
        pool.denomination = denomination;
        pool.authority = ctx.accounts.authority.key();
        pool.initialize_tree()?;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32]) -> Result<()> {
        let pool = &mut ctx.accounts.mixer_pool.load_mut()?;

        // Transfer SOL to vault
        transfer(
            CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.depositor.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            pool.denomination,
        )?;

        // Insert commitment into merkle tree
        pool.insert(commitment)?;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, proof: Proof, public_inputs: PublicInputs) -> Result<()> {
        let pool = &ctx.accounts.mixer_pool.load()?;

        // Verify merkle root is known
        require!(
            pool.is_known_root(&public_inputs.root),
            MixerError::InvalidRoot
        );

        // Verify recipient matches (compare as field elements since circuit uses mod p)
        let recipient_field = pubkey_to_field_element(&ctx.accounts.recipient.key());
        require!(
            public_inputs.recipient == recipient_field,
            MixerError::RecipientMismatch
        );

        // Verify ZK proof
        let vk = get_verification_key();
        require!(verify_proof(&proof, &public_inputs, &vk)?, MixerError::InvalidProof);

        // Mark nullifier as spent
        ctx.accounts.nullifier.nullifier = public_inputs.nullifier_hash;
        ctx.accounts.nullifier.spent_at = Clock::get()?.unix_timestamp;

        // Transfer SOL to recipient
        let pool_key = ctx.accounts.mixer_pool.key();
        let seeds: &[&[&[u8]]] = &[&[b"vault", pool_key.as_ref(), &[ctx.bumps.vault]]];

        transfer(
            CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient.to_account_info(),
                },
                seeds,
            ),
            pool.denomination,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = MixerPool::LEN)]
    pub mixer_pool: AccountLoader<'info, MixerPool>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub mixer_pool: AccountLoader<'info, MixerPool>,
    /// CHECK: PDA vault holding deposited SOL
    #[account(mut, seeds = [b"vault", mixer_pool.key().as_ref()], bump)]
    pub vault: AccountInfo<'info>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proof: Proof, public_inputs: PublicInputs)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub mixer_pool: AccountLoader<'info, MixerPool>,
    /// CHECK: PDA vault holding deposited SOL
    #[account(mut, seeds = [b"vault", mixer_pool.key().as_ref()], bump)]
    pub vault: AccountInfo<'info>,
    #[account(
        init,
        payer = payer,
        space = NullifierAccount::LEN,
        seeds = [b"nullifier", public_inputs.nullifier_hash.as_ref()],
        bump,
    )]
    pub nullifier: Account<'info, NullifierAccount>,
    /// CHECK: Validated against public inputs
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum MixerError {
    #[msg("Invalid merkle root")]
    InvalidRoot,
    #[msg("Recipient mismatch")]
    RecipientMismatch,
    #[msg("Invalid ZK proof")]
    InvalidProof,
}
