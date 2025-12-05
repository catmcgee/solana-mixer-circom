use anchor_lang::prelude::*;

pub const MERKLE_TREE_HEIGHT: usize = 20;
pub const ROOT_HISTORY_SIZE: usize = 30;

/// Pool account storing merkle tree state. Uses zero_copy for large account size.
#[account(zero_copy)]
#[repr(C)]
pub struct MixerPool {
    pub authority: Pubkey,
    pub denomination: u64,
    pub next_leaf_index: u64,
    pub current_root_index: u64,
    pub current_root: [u8; 32],
    pub subtrees: [[u8; 32]; MERKLE_TREE_HEIGHT],
    pub root_history: [[u8; 32]; ROOT_HISTORY_SIZE],
}

impl MixerPool {
    pub const LEN: usize = 8 + std::mem::size_of::<MixerPool>();
}

/// Nullifier account prevents double-spending. Created on withdrawal.
#[account]
pub struct NullifierAccount {
    pub nullifier: [u8; 32],
    pub spent_at: i64,
}

impl NullifierAccount {
    pub const LEN: usize = 8 + 32 + 8;
}
