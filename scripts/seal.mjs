#!/usr/bin/env node
/* seal.mjs — hide a destination URL behind a command word.
 *
 * The URL never appears in the shipped source. It is XORed with a keystream
 * derived from the command itself, so it only reconstructs when someone types
 * the right thing. A wrong command decrypts to garbage and is rejected.
 *
 * Be clear-eyed about what this is: obscurity, not security. Anyone can read
 * the shipped JavaScript and see that a sealed blob exists. What they cannot
 * do is read the URL out of it without guessing the command. That is the
 * whole guarantee — and it is enough here, because the URL it hides is a
 * public login page that grants nobody anything. Tailscale is the real gate.
 *
 *   node scripts/seal.mjs "<command>" "<url>"
 *   node scripts/seal.mjs                 # re-seal with current defaults
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'sites', 'lab', 'assets', 'sealed.js');

const MAGIC = 'ts:';                       // proves a correct decryption
const command = (process.argv[2] || 'tailscale').toLowerCase();
const url = process.argv[3] || 'https://login.tailscale.com/';

const sha = (buf) => createHash('sha256').update(buf).digest();

function keystream(key, length) {
  const out = Buffer.alloc(length);
  let written = 0, counter = 0;
  while (written < length) {
    const block = sha(Buffer.concat([key, Buffer.from([counter++])]));
    const take = Math.min(block.length, length - written);
    block.copy(out, written, 0, take);
    written += take;
  }
  return out;
}

const key = sha(Buffer.from(command, 'utf8'));
const plain = Buffer.from(MAGIC + url, 'utf8');
const cipher = Buffer.alloc(plain.length);
const ks = keystream(key, plain.length);
for (let i = 0; i < plain.length; i++) cipher[i] = plain[i] ^ ks[i];

/* The shipped file carries no comment. Anything explaining what the blob is,
 * or naming what it points at, would undo the only thing sealing buys. */
writeFileSync(OUT, `window.__sealed='${cipher.toString('hex')}';\n`);

console.log(`sealed ${plain.length} bytes → ${OUT}`);
console.log(`  command : ${command}`);
console.log(`  target  : ${url}`);
console.log(`\n  Type "/" on lab.monk97.me, then "${command}".`);
