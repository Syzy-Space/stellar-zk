import buildPoseidon from "./node_modules/circomlibjs/src/poseidon_reference.js";
import poseidonConstants from "./node_modules/circomlibjs/src/poseidon_constants.js";
import fs from 'fs';
const r = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const R = (1n<<256n) % r;
const poseidon = await buildPoseidon();
const F = poseidon.F;
const hexBE = (x)=>F.toObject(x).toString(16).padStart(64,'0');
const C = poseidonConstants.C[1].map(s=>BigInt(s));
const M = poseidonConstants.M[1].map(row=>row.map(s=>BigInt(s)));
function limbs(x){x=((BigInt(x)%r)+r)%r;const m=(1n<<64n)-1n;const o=[];for(let i=0;i<4;i++)o.push((x>>BigInt(64*i))&m);return o.map(v=>"0x"+v.toString(16).padStart(16,'0')+"u64");}
// Montgomery form: x*R mod r
function mont(x){ return (BigInt(x)*R)%r; }
function feLit(x){ return `Fr([${limbs(mont(x)).join(", ")}])`; }

let s = "// AUTO-GENERATED from circomlibjs poseidon_reference constants (t=3). DO NOT EDIT.\n";
s += "// See gen_rust.mjs at repo root. C length = 195 = 65*3 (nRoundsF=8 + nRoundsP=57), row-major C[round*t + i].\n";
s += "// M is 3x3, M[i][j] with state[i] = sum_j M[i][j]*state[j].\n";
s += "// Values stored in Montgomery form (x*R mod r), little-endian [u64;4] limbs.\n";
s += "use super::field::Fr;\n\n";
s += `pub const C: [Fr; 195] = [\n`;
for(const c of C){ s += "    "+feLit(c)+",\n"; }
s += "];\n\n";
s += `pub const M: [[Fr; 3]; 3] = [\n`;
for(const row of M){ s += "    ["+row.map(feLit).join(", ")+"],\n"; }
s += "];\n";
fs.writeFileSync("contracts/poseidon_probe/src/constants.rs", s);
console.error("wrote constants.rs (Montgomery form)");
const vecs=[[1,2],[0,0],[7,42],[123456789,987654321],
  ["21888242871839275222246405745257275088548364400416034343698204186575808495616", 5]];
let vs="";
for(const [a,b] of vecs){ vs += `${a} ${b} ${hexBE(poseidon([a,b]))}\n`; }
fs.writeFileSync("vectors.txt", vs);
console.error(vs);
