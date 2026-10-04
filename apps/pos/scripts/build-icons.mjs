// Renders public/icons/*.png from public/icons/icon.svg. Run after changing the SVG:
//   node scripts/build-icons.mjs
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const svg=await readFile('public/icons/icon.svg','utf8');
// "any" icons use rounded corners; maskable/apple icons are full-bleed squares
// so launchers can apply their own mask without clipping the mark.
const targets=[
  ['icon-192.png',192,true],['icon-512.png',512,true],
  ['icon-maskable-512.png',512,false],['apple-touch-icon.png',180,false],
];
const browser=await chromium.launch();
const page=await browser.newPage();
for(const [name,size,rounded] of targets){
  await page.setViewportSize({width:size,height:size});
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px;${rounded?`border-radius:${size*0.22}px;overflow:hidden`:''}}</style>${svg}`);
  await page.locator('svg').screenshot({path:`public/icons/${name}`,omitBackground:true});
  console.log(`public/icons/${name}`);
}
await browser.close();
