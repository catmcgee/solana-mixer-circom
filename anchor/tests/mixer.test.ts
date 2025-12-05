const anchor = require("@coral-xyz/anchor");
const { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { assert } = require("chai");
const snarkjs = require("snarkjs");
const circomlibjs = require("circomlibjs");
const { utils } = require("ffjavascript");
const path = require("path");

describe("mixer", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Mixer;

  const mixerPool = Keypair.generate();
  const authority = provider.wallet;
  const DENOMINATION = 0.1 * LAMPORTS_PER_SOL;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mixerPool.publicKey.toBuffer()],
    program.programId
  );

  let pedersen: any, poseidon: any, babyjub: any, F: any;
  let depositSecret: bigint, depositNullifier: bigint, depositCommitment: bigint;

  before(async () => {
    pedersen = await circomlibjs.buildPedersenHash();
    poseidon = await circomlibjs.buildPoseidon();
    babyjub = await circomlibjs.buildBabyjub();
    F = poseidon.F;
  });

  function toBitsLE(value: bigint, len: number): number[] {
    const bits = new Array(len).fill(0);
    let v = value;
    for (let i = 0; i < len; i++) {
      bits[i] = Number(v & 1n);
      v >>= 1n;
    }
    return bits;
  }

  function bitsToBuffer(bits: number[]): Buffer {
    const bytes = new Uint8Array(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) {
      if (bits[i]) bytes[(i / 8) | 0] |= 1 << (i % 8);
    }
    return Buffer.from(bytes);
  }

  function randomField(bits: number): bigint {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(bits / 8)));
    let x = 0n;
    for (const b of bytes) x = (x << 8n) + BigInt(b);
    return x % (1n << BigInt(bits));
  }

  it("initializes pool", async () => {
    await program.methods
      .initialize(new anchor.BN(DENOMINATION))
      .accounts({
        mixerPool: mixerPool.publicKey,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([mixerPool])
      .rpc();

    const pool = await program.account.mixerPool.fetch(mixerPool.publicKey);
    assert.equal(pool.denomination.toNumber(), DENOMINATION);
    assert.equal(pool.nextLeafIndex, 0);
  });

  it("deposits commitment", async () => {
    depositNullifier = randomField(248);
    depositSecret = randomField(248);

    // Compute Pedersen commitment
    const msgBits = [...toBitsLE(depositNullifier, 248), ...toBitsLE(depositSecret, 248)];
    const packed = pedersen.hash(bitsToBuffer(msgBits));
    const point = babyjub.unpackPoint(packed);
    depositCommitment = F.toObject(point[0]);

    const commitment = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
      commitment[31 - i] = Number((depositCommitment >> BigInt(i * 8)) & 0xffn);
    }

    const depositor = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(depositor.publicKey, 2 * LAMPORTS_PER_SOL)
    );

    await program.methods
      .deposit(Array.from(commitment))
      .accounts({
        mixerPool: mixerPool.publicKey,
        vault: vaultPda,
        depositor: depositor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();

    const pool = await program.account.mixerPool.fetch(mixerPool.publicKey);
    assert.equal(pool.nextLeafIndex, 1);
  });

  it("withdraws with ZK proof", async () => {
    // Generate BN254-compatible recipient
    let recipient: typeof Keypair.prototype, recipientBn: bigint;
    while (true) {
      recipient = Keypair.generate();
      recipientBn = BigInt("0x" + recipient.publicKey.toBuffer().toString("hex"));
      if (recipientBn < F.p) break;
      }

    // Compute zero hashes and merkle path
    const LEVELS = 20;
    const zeros = [0n];
    for (let i = 0; i < LEVELS; i++) {
      zeros.push(F.toObject(poseidon([zeros[i], zeros[i]])));
    }
    const pathElements = zeros.slice(0, LEVELS);
    const pathIndices = new Array(LEVELS).fill(0);

    // Compute nullifier hash
    const nullifierHash = F.toObject(
      babyjub.unpackPoint(pedersen.hash(bitsToBuffer(toBitsLE(depositNullifier, 248))))[0]
    );

    // Get on-chain root
    const pool = await program.account.mixerPool.fetch(mixerPool.publicKey);
    const onChainRoot = BigInt("0x" + Buffer.from(pool.currentRoot).toString("hex"));

    const input = {
      root: onChainRoot.toString(),
      nullifierHash: nullifierHash.toString(),
      recipient: recipientBn.toString(),
      relayer: "0",
      fee: "0",
      refund: "0",
      nullifier: depositNullifier.toString(),
      secret: depositSecret.toString(),
      pathElements: pathElements.map((x: bigint) => x.toString()),
      pathIndices,
    };

    const wasmPath = path.resolve(__dirname, "../../build/withdraw/withdraw_js/withdraw.wasm");
    const zkeyPath = path.resolve(__dirname, "../../build/withdraw/withdraw_final.zkey");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);

    // Format proof for groth16-solana
    const BN254_FIELD = BigInt("21888242871839275222246405745257275088696311157297823662689037894645226208583");
    const proofData = utils.unstringifyBigInts(proof);

    const pi_a_x = Array.from(utils.leInt2Buff(proofData.pi_a[0], 32) as Uint8Array).reverse();
    const pi_a_y = Array.from(utils.leInt2Buff(BN254_FIELD - proofData.pi_a[1], 32) as Uint8Array).reverse();

    const pi_b_x = [...Array.from(utils.leInt2Buff(proofData.pi_b[0][0], 32) as Uint8Array), ...Array.from(utils.leInt2Buff(proofData.pi_b[0][1], 32) as Uint8Array)].reverse();
    const pi_b_y = [...Array.from(utils.leInt2Buff(proofData.pi_b[1][0], 32) as Uint8Array), ...Array.from(utils.leInt2Buff(proofData.pi_b[1][1], 32) as Uint8Array)].reverse();

    const pi_c_x = Array.from(utils.leInt2Buff(proofData.pi_c[0], 32) as Uint8Array).reverse();
    const pi_c_y = Array.from(utils.leInt2Buff(proofData.pi_c[1], 32) as Uint8Array).reverse();

    const proofArgs = {
      a: [...pi_a_x, ...pi_a_y],
      b: [...pi_b_x, ...pi_b_y],
      c: [...pi_c_x, ...pi_c_y],
    };

    const publicInputsProcessed = utils.unstringifyBigInts(publicSignals);
    const publicInputsArgs = {
      root: Array.from(utils.leInt2Buff(publicInputsProcessed[0], 32) as Uint8Array).reverse(),
      nullifierHash: Array.from(utils.leInt2Buff(publicInputsProcessed[1], 32) as Uint8Array).reverse(),
      recipient: Array.from(utils.leInt2Buff(publicInputsProcessed[2], 32) as Uint8Array).reverse(),
      relayer: Array.from(utils.leInt2Buff(publicInputsProcessed[3], 32) as Uint8Array).reverse(),
      fee: Array.from(utils.leInt2Buff(publicInputsProcessed[4], 32) as Uint8Array).reverse(),
      refund: Array.from(utils.leInt2Buff(publicInputsProcessed[5], 32) as Uint8Array).reverse(),
    };

    const nullifierPda = PublicKey.findProgramAddressSync(
      [Buffer.from("nullifier"), Buffer.from(publicInputsArgs.nullifierHash)],
      program.programId
    )[0];

    await program.methods
      .withdraw(proofArgs, publicInputsArgs)
      .accounts({
        mixerPool: mixerPool.publicKey,
        vault: vaultPda,
        nullifier: nullifierPda,
        recipient: recipient.publicKey,
        payer: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1000000 }),
      ])
      .rpc();

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalance, 0);
  });
});
