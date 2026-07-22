#!/usr/bin/env node
// Shared read/write for data.json so every script serialises it the same way and
// nobody clobbers a block they don't manage. Canonical shape:
//   { asof, results{compact}, [pens{compact}], [profiles{json}], [markets{json}], sched{compact} }
// results/pens/sched stay one-entry-per-line (small, diff-friendly); profiles and
// markets are growing nested objects, written as indented JSON.
import {readFileSync,writeFileSync} from 'fs';
import {fileURLToPath} from 'url';
import {dirname,join} from 'path';

export const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
export const FILE=join(ROOT,'data.json');
export function readData(){return JSON.parse(readFileSync(FILE,'utf8'));}

// Single source of truth for the app's data object D, parsed out of index.html.
// Centralised + validated so a formatting change fails loudly instead of silently
// breaking every script.
export function parseD(){
 const html=readFileSync(join(ROOT,'index.html'),'utf8');
 const m=html.match(/const D=(\{[\s\S]*?\});\nconst CC=/);
 if(!m)throw new Error('parseD: could not locate "const D={...};" in index.html');
 const D=JSON.parse(m[1]);
 for(const k of ['elo','groups','R32','r16','r16m','qf','qfm','sf'])if(!D[k])throw new Error('parseD: D.'+k+' missing');
 return D;
}

export function serialize(d){
 const r=Object.entries(d.results||{}).map(([k,v])=>`  ${JSON.stringify(k)}: [${v[0]}, ${v[1]}]`).join(',\n');
 const s=Object.entries(d.sched||{}).map(([k,v])=>`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
 const pensKeys=Object.keys(d.pens||{});
 const pens=pensKeys.map(k=>`  ${JSON.stringify(k)}: ${JSON.stringify(d.pens[k])}`).join(',\n');
 const pensBlock=pensKeys.length?` "pens": {\n${pens}\n },\n`:'';
 const jsonBlock=(key,obj)=>obj&&Object.keys(obj).length?` ${JSON.stringify(key)}: ${JSON.stringify(obj,null,1).replace(/\n/g,'\n ')},\n`:'';
 const profBlock=jsonBlock('profiles',d.profiles);
 const mktBlock=jsonBlock('markets',d.markets);
 const betsBlock=jsonBlock('bets',d.bets);
 const encBlock=jsonBlock('betsEnc',d.betsEnc);
 const h2hBlock=jsonBlock('h2h',d.h2h);
 const statsBlock=jsonBlock('matchStats',d.matchStats);
 const rankBlock=jsonBlock('fifaRank',d.fifaRank);
 const thirdsBlock=jsonBlock('thirds',d.thirds);   // official FIFA 3rd-place → R32 slot map (set once all 12 groups complete)
 const out=`{\n "asof": ${JSON.stringify(d.asof)},\n "results": {\n${r}\n },\n${pensBlock}${statsBlock}${rankBlock}${thirdsBlock}${profBlock}${mktBlock}${h2hBlock}${betsBlock}${encBlock} "sched": {\n${s}\n }\n}\n`;
 JSON.parse(out); // guard: must be valid JSON
 return out;
}
export function writeData(d){const out=serialize(d);writeFileSync(FILE,out);return out;}
