#!/usr/bin/env node
// Generates the home-screen / PWA icons (180/192/512) from the trophy mark.
// Needs the SVG rasteriser: npm i @resvg/resvg-js   (build-time only; gitignored)
// Run: node scripts/make_icon.mjs
import {Resvg} from '@resvg/resvg-js';
import fs from 'fs';

const GOLD='#E7B43C', GREEN='#16915A';
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
 <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#103024"/><stop offset="1" stop-color="#080B0C"/></linearGradient>
 <filter id="sh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.4"/></filter></defs>
 <rect width="512" height="512" fill="url(#g)"/>
 <g filter="url(#sh)" fill="${GOLD}">
  <path d="M150,166 C100,166 100,250 168,262 L162,228 C132,222 132,188 162,186 Z"/>
  <path d="M362,166 C412,166 412,250 344,262 L350,228 C380,222 380,188 350,186 Z"/>
  <ellipse cx="256" cy="158" rx="104" ry="22"/>
  <path d="M152,158 C152,262 206,316 256,316 C306,316 360,262 360,158 Z"/>
  <rect x="238" y="312" width="36" height="50" rx="4"/>
  <path d="M196,392 L214,356 H298 L316,392 Z"/>
  <rect x="180" y="388" width="152" height="20" rx="8"/>
 </g>
 <rect x="206" y="430" width="100" height="12" rx="6" fill="${GREEN}"/></svg>`;

for(const S of [180,192,512]){
  const png=new Resvg(svg,{fitTo:{mode:'width',value:S}}).render().asPng();
  fs.writeFileSync(`icon-${S}.png`,png);
  console.log(`wrote icon-${S}.png (${png.length} bytes)`);
}
