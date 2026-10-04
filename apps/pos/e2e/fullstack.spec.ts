// Real FastAPI (services/api/scripts/e2e_server.py), real signed JWTs, real PWA.
// Run: FULLSTACK_TOKENS=<workdir>/tokens.json npx playwright test e2e/fullstack.spec.ts
import {readFileSync} from 'node:fs';
import nextEnv from '@next/env';
import {test,expect,type APIRequestContext,type BrowserContext,type Page,type Route} from '@playwright/test';
import {savedOrders} from './pilot-fixture';

const file=process.env.FULLSTACK_TOKENS;
const tokens=file?JSON.parse(readFileSync(file,'utf8')) as {admin:string;cashier:string;api:string}:null;
nextEnv.loadEnvConfig(process.cwd(),false);
const projectRef=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'https://local.supabase.co').hostname.split('.')[0];
const target=(url:string)=>tokens!.api+new URL(url).pathname.replace(/^.*\/api\/v1/,'')+new URL(url).search;

async function forwardApi(context:BrowserContext){
  // The static build targets its configured API host; send those calls to the e2e API unchanged.
  await context.route(/\/api\/v1\//,route=>forward(route));
}
// A request cut off by reload/navigation behaves like a dropped connection.
async function forward(route:Route,dropAfterCommit=false){
  try{
    const response=await route.fetch({url:target(route.request().url())});
    const body=await response.body();
    if(dropAfterCommit)return await route.abort('connectionreset');
    await route.fulfill({status:response.status(),headers:response.headers(),body});
  }catch{await route.abort('connectionreset').catch(()=>{});}
}
async function signIn(page:Page,request:APIRequestContext,token:string){
  const profile=await (await request.get(`${tokens!.api}/auth/me`,{headers:{Authorization:`Bearer ${token}`}})).json();
  await page.route('**/__fullstack_setup',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>setup</title>'}));
  await page.goto('/__fullstack_setup');
  await page.evaluate(({profile,token,projectRef})=>{
    const expiresAt=Math.floor(Date.now()/1000)+3*3600;
    localStorage.setItem('food-vendor-admin-session',JSON.stringify({token,expiresAt:new Date(Date.now()+7*864e5).toISOString(),user:profile}));
    const user={id:profile.id,aud:'authenticated',role:'authenticated',email:profile.email,app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
    const session={access_token:token,token_type:'bearer',expires_in:10800,expires_at:expiresAt,refresh_token:'e2e-refresh',user};
    const encoded=btoa(JSON.stringify(session)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    document.cookie=`sb-${projectRef}-auth-token=base64-${encoded}; Path=/; SameSite=Lax`;
  },{profile,token,projectRef});
  return profile as {id:string;businessId:string};
}
async function serverSnapshot(request:APIRequestContext,token:string){
  return (await request.get(`${tokens!.api}/admin/snapshot`,{headers:{Authorization:`Bearer ${token}`}})).json() as Promise<{orders:{id:string;totalPesewas:number;paymentMethod:string}[];events:{kind:string;entityId:string;data:Record<string,unknown>}[]}>;
}

test.skip(!tokens,'Set FULLSTACK_TOKENS (from services/api/scripts/e2e_server.py) to run against the real API.');

test('offline sale survives restart, then syncs exactly once to the real API despite a lost acknowledgement',async({page,context,request})=>{
  test.setTimeout(150000);
  await forwardApi(context);
  await signIn(page,request,tokens!.cashier);
  await page.goto('/shifts/');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);

  // Online: open the shift; it reaches the server.
  await page.getByRole('button',{name:'Open shift',exact:true}).click();
  await page.getByLabel(/Opening cash/).fill('200');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect.poll(async()=>(await serverSnapshot(request,tokens!.cashier)).events.filter(e=>e.kind==='shift').length,{timeout:30000}).toBe(1);
  await page.goto('/pos/');
  await expect(page.getByRole('button',{name:/Coke/})).toContainText('48');

  // Offline: complete a sale (Pork + Yam Medium + Coke, cash).
  await context.setOffline(true);
  await expect(page.locator('.admin-header')).toContainText('Local mode');
  await page.getByRole('button',{name:/Pork \+ Yam/}).click();
  await page.getByRole('button',{name:/Medium/}).click();
  await page.getByRole('button',{name:/Coke/}).click();
  await page.getByRole('button',{name:/Complete sale/}).click();
  await page.getByRole('button',{name:/Payment received/}).click();
  await expect(page.getByRole('dialog')).toContainText('102.00');
  await page.getByRole('button',{name:'Done · New order'}).click();
  expect(await savedOrders(page)).toHaveLength(1);

  // Restart the app while still offline: sale and outbox survive.
  await page.reload();
  await expect(page.getByRole('button',{name:/Coke/})).toContainText('47');
  const [sale]=await savedOrders(page);
  expect(sale.syncStatus).toBe('PENDING');
  expect(await page.evaluate(()=>new Promise<number>(resolve=>{const r=indexedDB.open('food-vendor-os-pos',1);r.onsuccess=()=>{const read=r.result.transaction('outbox').objectStore('outbox').getAll();read.onsuccess=()=>resolve(read.result.filter(e=>'orderId' in e&&!('recordType' in e)).length);};}))).toBe(1);
  expect((await serverSnapshot(request,tokens!.admin)).orders).toHaveLength(0);

  // Reconnect. The first upload commits on the server but its acknowledgement is lost.
  let uploads=0;
  await page.route('**/sync/events',route=>{uploads++;return forward(route,uploads===1);});
  await context.setOffline(false);
  await expect.poll(async()=>(await savedOrders(page))[0].syncStatus,{timeout:60000}).toBe('SYNCED');
  expect(uploads).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.admin-header')).toContainText('Synced',{timeout:30000});

  // Manual Sync now changes nothing further.
  await page.locator('.admin-header').getByRole('button',{name:/Sync now/}).click();
  const server=await serverSnapshot(request,tokens!.admin);
  expect(server.orders.map(o=>o.id)).toEqual([sale.id]);
  expect(server.orders[0]).toMatchObject({totalPesewas:10200,paymentMethod:'CASH'});
  const coke=server.events.find(e=>e.kind==='menu'&&e.data.name==='Coke')!.entityId;
  const stock=server.events.filter(e=>e.kind==='stock'&&e.data.menuItemId===coke);
  expect(stock.reduce((sum,e)=>sum+Number(e.data.quantityDelta),0)).toBe(47);
  expect(stock.filter(e=>e.data.type==='SALE')).toHaveLength(1);
  expect(server.events.filter(e=>e.kind==='payment')).toHaveLength(1);
});
