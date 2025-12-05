# Circuits

Circom circuits for the Solana mixer.

## Files

- `withdraw.circom` - Main withdrawal circuit
- `merkletree.circom` - Merkle tree proof verification

## Circuit Logic

The withdrawal circuit proves:

1. You know `secret` and `nullifier` such that `commitment = Pedersen(nullifier || secret)`
2. This commitment exists in the Merkle tree at the given `root`
3. The `nullifierHash` is correctly computed as `Pedersen(nullifier)`

Public inputs are constrained in the proof to prevent tampering:
- `root`, `nullifierHash`, `recipient`, `relayer`, `fee`, `refund`

Private inputs (not revealed):
- `secret`, `nullifier`, `pathElements`, `pathIndices`
