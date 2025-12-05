use anchor_lang::prelude::*;
use crate::poseidon::PoseidonHasher;
use crate::state::{MixerPool, MERKLE_TREE_HEIGHT, ROOT_HISTORY_SIZE};

impl MixerPool {
    /// Initialize empty merkle tree with zero hashes
    pub fn initialize_tree(&mut self) -> Result<()> {
        let zeros = PoseidonHasher::zero_bytes();
        
        for i in 0..MERKLE_TREE_HEIGHT {
            self.subtrees[i] = zeros[i];
        }

        self.current_root = zeros[MERKLE_TREE_HEIGHT];
        for i in 0..ROOT_HISTORY_SIZE {
            self.root_history[i] = self.current_root;
        }

        self.current_root_index = 0;
        self.next_leaf_index = 0;
        Ok(())
    }

    /// Insert commitment into tree and update root
    pub fn insert(&mut self, commitment: [u8; 32]) -> Result<()> {
        require!(
            (self.next_leaf_index as usize) < (1 << MERKLE_TREE_HEIGHT),
            ErrorCode::MerkleTreeFull
        );

        let mut idx = self.next_leaf_index as usize;
        let mut hash = commitment;
        let zeros = PoseidonHasher::zero_bytes();

        for i in 0..MERKLE_TREE_HEIGHT {
            let (left, right) = if idx % 2 == 0 {
                self.subtrees[i] = hash;
                (hash, zeros[i])
            } else {
                (self.subtrees[i], hash)
            };
            hash = PoseidonHasher::hash_pair(&left, &right)?;
            idx /= 2;
        }

        self.current_root = hash;
        self.current_root_index = ((self.current_root_index as usize + 1) % ROOT_HISTORY_SIZE) as u64;
        self.root_history[self.current_root_index as usize] = hash;
        self.next_leaf_index += 1;

        Ok(())
    }

    /// Check if root exists in history (allows proving against recent roots)
    pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
        self.root_history.iter().any(|r| r == root)
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Merkle tree is full")]
    MerkleTreeFull,
}
