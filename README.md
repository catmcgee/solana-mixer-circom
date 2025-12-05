# Solana Mixer

A ZK-SNARK mixer on Solana enabling private deposits and withdrawals. Users deposit a fixed amount of SOL and can later withdraw to any address without revealing the link between deposit and withdrawal.

**⚠️ Educational only. Not audited.**

## How It Works

### Deposit

1. User generates a random `secret` and `nullifier` (248 bits each)
2. Computes `commitment = Pedersen(nullifier || secret)`
3. Sends commitment to on-chain Merkle tree along with SOL

### Withdrawal

1. User provides a ZK proof showing they know `secret` and `nullifier` for a commitment in the tree
2. Circuit verifies: commitment exists in tree, nullifier hash matches
3. Program verifies proof on-chain using Groth16 (BN254 pairing via Solana syscalls)
4. SOL sent to recipient, nullifier marked spent (prevents double-spend)

### Privacy

The ZK proof reveals nothing about which deposit is being withdrawn. An observer sees only that *some* valid deposit is being claimed.

## Architecture

```
circuits/          # Circom circuits (Pedersen commitment, Poseidon Merkle tree)
anchor/programs/   # Solana program (Anchor)
app/               # Next.js frontend using @solana/* packages
scripts/           # Circuit helpers (input generation, VK conversion)
```

### Key Components

- **Commitment Hash**: Pedersen (babyjub curve) - matches circomlibjs
- **Merkle Tree**: Poseidon hash, 20 levels (~1M deposits)
- **Proof System**: Groth16 on BN254, verified via `groth16-solana`
- **Root History**: Stores last 30 roots to handle concurrent deposits

## Quick Start

```bash
# Install dependencies
bun install

# Build circuits (first run takes ~5 min for Powers of Tau)
bun run circuits:full

# Run Solana validator
solana-test-validator

# Build and deploy program
cd anchor && anchor build && anchor deploy

# Run tests
bun run test

# Start frontend
bun run dev
```

## Requirements

- [Rust](https://rustup.rs/)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor](https://www.anchor-lang.com/docs/installation)
- [Circom 2.x](https://docs.circom.io/getting-started/installation/)
- [Bun](https://bun.sh/)

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start frontend |
| `bun run test` | Run Anchor tests |
| `bun run circuits:full` | Compile circuits + trusted setup |
| `bun run vk:convert` | Convert verification key to Rust |

## Project Structure

```
├── anchor/
│   ├── programs/mixer/src/
│   │   ├── lib.rs          # Program entrypoint
│   │   ├── state.rs        # Account structures
│   │   ├── merkle_tree.rs  # Merkle tree operations
│   │   ├── poseidon.rs     # Poseidon hasher
│   │   ├── verifier.rs     # Groth16 verification
│   │   └── vk.rs           # Verification key (auto-generated)
│   └── tests/
├── app/
│   └── app/
│       ├── page.tsx        # Main UI
│       ├── mixer.ts        # Instruction builders
│       └── merkle.ts       # Client-side Merkle tree
├── circuits/
│   ├── withdraw.circom     # Main circuit
│   └── merkletree.circom   # Merkle proof checker
└── scripts/
    ├── generate-input.ts   # Test input generator
    └── convert-vk.ts       # VK to Rust converter
```

## Technical Details

### Circuit Public Inputs

1. `root` - Merkle root (proves membership)
2. `nullifierHash` - Pedersen(nullifier) (prevents double-spend)
3. `recipient` - Withdrawal address
4. `relayer`, `fee`, `refund` - For relayer support (unused in demo)

### Proof Format

groth16-solana expects:
- `pi_a`: G1 point, y-coordinate negated
- `pi_b`: G2 point, coordinates in specific LE/BE format
- `pi_c`: G1 point

### BN254 Field Constraint

Solana addresses (32 bytes) can exceed BN254's scalar field. The frontend generates addresses that fit within the field for circuit compatibility.

## License

MIT
