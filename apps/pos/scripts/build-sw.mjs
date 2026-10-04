import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

async function walk(directory){
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())result.push(...await walk(path));
    else result.push(path.replaceAll('\\','/').replace(/^out\//,'/'));
  }
  return result;
}
// Cache every exported route and its RSC/segment payload, not just the first page.
const assets=(await walk('out')).filter(path=>path!=='/sw.js'&&path!=='/_headers').sort();
const hash=createHash('sha256');
for(const path of assets)hash.update(path).update(await readFile(`out${path}`));
const version=hash.digest('hex').slice(0,16);
await writeFile('out/sw.js',`
const CACHE='food-vendor-pos-${version}';
const ASSETS=new Set(${JSON.stringify(assets)});
const routeFile=path=>(path.endsWith('/')?path:path+'/')+'index.html';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([...ASSETS]))));
// Never force activation during an active shift. A new worker waits for tabs to close.
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith('food-vendor-pos-')||key.startsWith('adonai-pos-'))&&key!==CACHE).map(key=>caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  let key=url.pathname;
  if(event.request.mode==='navigate')key=ASSETS.has(key)?key:routeFile(key);
  else if(!ASSETS.has(key)&&(event.request.headers.get('RSC')==='1'||url.searchParams.has('_rsc'))){
    key=(key.endsWith('/')?key:key+'/')+'index.txt';
  }
  if(!ASSETS.has(key))return;
  // Query tokens used by Next prefetch do not change immutable exported content.
  event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(key))||fetch(event.request)));
});
`);
console.log(`Offline export cached: ${assets.length} files, release ${version}`);
