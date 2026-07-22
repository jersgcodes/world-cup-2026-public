#!/usr/bin/env node
// Encrypts the bet slip so the public site can show it ONLY to whoever has the
// passphrase. Reads the canonical PLAINTEXT slip (the private bets-private branch,
// or data.json's "bets"), encrypts it with WC_BETS_PASS (AES-GCM, PBKDF2), writes
// the ciphertext to data.json's "betsEnc", and removes the public plaintext "bets".
// The app decrypts betsEnc in-browser with the same passphrase.
//
//   WC_BETS_PASS='your passphrase' node scripts/encrypt_bets.mjs
//   node scripts/encrypt_bets.mjs --pass 'your passphrase'   # (avoid; leaks to ps)
//
// Matches the app's Web Crypto scheme exactly (v2: PBKDF2 600k/SHA-256 → AES-GCM;
// iteration count is stored in blob.it so the app decrypts v1 100k blobs too).
import {execFileSync} from 'child_process';
import {readData,writeData} from './datafile.mjs';

const argv=process.argv.slice(2);
const pi=argv.indexOf('--pass');
const pass=pi>=0?argv[pi+1]:process.env.WC_BETS_PASS;
if(!pass){console.error('no passphrase: set WC_BETS_PASS env (preferred) or pass --pass "…"');process.exit(1);}

const d=readData();
let bets=Array.isArray(d.bets)?d.bets:null;
let reads=(d.reads&&typeof d.reads==='object')?d.reads:null;
let teams=Array.isArray(d.teams)?d.teams:null;
if(!bets){try{const bp=JSON.parse(execFileSync('git',['show','origin/bets-private:bets.json'],{encoding:'utf8'}));bets=bp.bets;reads=reads||bp.reads||null;teams=teams||bp.teams||null;}catch(e){console.error('could not read origin/bets-private:bets.json —',e.message);}}
if(!bets||!bets.length){console.error('no plaintext slip found (data.json "bets" or origin/bets-private)');process.exit(1);}
reads=reads||{};teams=teams||[];

const enc=new TextEncoder();
const b64=u=>Buffer.from(u).toString('base64');
const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
const km=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);
const ITERS=600000; // v2: OWASP floor for PBKDF2-HMAC-SHA256 (was 100k in v1); app reads it from blob.it
const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERS,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt']);
const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify({bets,reads,teams})));
d.betsEnc={v:2,it:ITERS,salt:b64(salt),iv:b64(iv),ct:b64(new Uint8Array(ct))};
delete d.bets;delete d.reads;delete d.teams; // remove any public plaintext
writeData(d);
console.log(`encrypted ${bets.length} bets + ${Object.keys(reads).length} read(s) + ${teams.length} team(s) into data.json "betsEnc"; public plaintext removed`);
