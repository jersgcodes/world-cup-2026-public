#!/usr/bin/env node
// Check whether a passphrase decrypts data.json's betsEnc. Runs entirely locally —
// the passphrase is never printed, logged, or sent anywhere. Mirrors the app's decBets.
//
//   WC_BETS_PASS='your phrase' node scripts/checkpass.mjs
//
// OK   → that passphrase matches the blob (this is what you must type to unlock)
// FAIL → the passphrase does NOT match; you typed/encrypted a different string
import {readFileSync} from 'fs';

const pass = process.env.WC_BETS_PASS;
if (!pass) { console.error('set WC_BETS_PASS, e.g.  WC_BETS_PASS=\'a-b-c-d-e\' node scripts/checkpass.mjs'); process.exit(1); }

const be = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8')).betsEnc;
if (!be) { console.error('no betsEnc in data.json'); process.exit(1); }
const ub = s => Uint8Array.from(Buffer.from(s, 'base64'));
const iters = be.it || 100000;

const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: ub(be.salt), iterations: iters, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
try {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub(be.iv) }, key, ub(be.ct));
  const o = JSON.parse(new TextDecoder().decode(pt));
  console.log(`OK — passphrase decrypts the blob (v${be.v}/${iters} iters, ${(o.bets || []).length} bets). Type this exact string to unlock.`);
} catch {
  console.log(`FAIL — this passphrase does NOT match the betsEnc blob (v${be.v}/${iters} iters). Check for autocapitalized first letter, a typo, or a stray space.`);
  process.exit(2);
}
