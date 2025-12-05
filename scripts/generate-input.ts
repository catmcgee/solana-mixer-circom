import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";
import * as circomlibjs from "circomlibjs";

const LEVELS = 20;

function toBitsLE(value: bigint, len: number): number[] {
  const bits: number[] = [];
  let v = value;
  for (let i = 0; i < len; i++) {
    bits.push(Number(v & 1n));
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
  const buf = crypto.randomBytes(Math.ceil(bits / 8));
  let x = 0n;
  for (const b of buf) x = (x << 8n) + BigInt(b);
  return x % (1n << BigInt(bits));
}

async function main() {
  const pedersen = await circomlibjs.buildPedersenHash();
  const poseidon = await circomlibjs.buildPoseidon();
  const babyjub = await circomlibjs.buildBabyjub();
  const F = poseidon.F;

  const nullifier = randomField(248);
  const secret = randomField(248);

  // Pedersen commitment
  const msgBits = [...toBitsLE(nullifier, 248), ...toBitsLE(secret, 248)];
  const packed = pedersen.hash(bitsToBuffer(msgBits));
  const point = babyjub.unpackPoint(packed);
  const commitment = babyjub.F.toObject(point[0]) as bigint;

  // Nullifier hash
  const nullPacked = pedersen.hash(bitsToBuffer(toBitsLE(nullifier, 248)));
  const nullPoint = babyjub.unpackPoint(nullPacked);
  const nullifierHash = babyjub.F.toObject(nullPoint[0]) as bigint;

  // Zero hashes and merkle path
  const zeros: bigint[] = [0n];
  for (let i = 0; i < LEVELS; i++) {
    zeros.push(F.toObject(poseidon([zeros[i], zeros[i]])) as bigint);
  }

  const pathIndices = new Array(LEVELS).fill(0);
  const pathElements = zeros.slice(0, LEVELS);

  // Compute root
  let current = commitment;
  for (let i = 0; i < LEVELS; i++) {
    current = F.toObject(poseidon([current, pathElements[i]])) as bigint;
  }

  const input = {
    root: current.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: "0",
    relayer: "0",
    fee: "0",
    refund: "0",
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements: pathElements.map((x) => x.toString()),
    pathIndices,
  };

  const outPath = resolve("build/withdraw/input.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(input, null, 2));
  console.log("Wrote:", outPath);
}

main().catch(console.error);
