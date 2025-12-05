import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function leBytes32(x: bigint): number[] {
  const b = new Array(32).fill(0);
  let v = x;
  for (let i = 0; i < 32; i++) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

function g1ToBytes64(g1: [string, string, string]): number[] {
  const x = leBytes32(BigInt(g1[0])).reverse();
  const y = leBytes32(BigInt(g1[1])).reverse();
  return [...x, ...y];
}

function g2ToBytes128(g2: [[string, string], [string, string], [string, string]]): number[] {
  const x = [...leBytes32(BigInt(g2[0][0])), ...leBytes32(BigInt(g2[0][1]))].reverse();
  const y = [...leBytes32(BigInt(g2[1][0])), ...leBytes32(BigInt(g2[1][1]))].reverse();
  return [...x, ...y];
}

function formatBytes(bytes: number[]): string {
  return `[${bytes.join(", ")}]`;
}

function main() {
  const inPath = resolve("build/withdraw/verification_key.json");
  const outPath = resolve("anchor/programs/mixer/src/vk.rs");
  const vk = JSON.parse(readFileSync(inPath, "utf8"));

  const nPublic: number = vk.nPublic | 0;
  const alpha = g1ToBytes64(vk.vk_alpha_1);
  const beta = g2ToBytes128(vk.vk_beta_2);
  const gamma = g2ToBytes128(vk.vk_gamma_2);
  const delta = g2ToBytes128(vk.vk_delta_2);
  const IC: number[][] = (vk.IC as [string, string, string][]).map(g1ToBytes64);

  const out = `// Auto-generated from verification_key.json
#![allow(clippy::all)]

pub const N_PUBLIC: usize = ${nPublic};

pub static VK_ALPHA_G1: [u8; 64] = ${formatBytes(alpha)};
pub static VK_BETA_G2: [u8; 128] = ${formatBytes(beta)};
pub static VK_GAMMA_G2: [u8; 128] = ${formatBytes(gamma)};
pub static VK_DELTA_G2: [u8; 128] = ${formatBytes(delta)};

pub const IC_LEN: usize = ${IC.length};
pub static VK_IC: [[u8; 64]; IC_LEN] = [${IC.map(formatBytes).join(",\n    ")}];
`;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out);
  console.log("Wrote:", outPath);
}

main();
