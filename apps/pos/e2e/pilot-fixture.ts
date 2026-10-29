import nextEnv from '@next/env';
import type {Page} from '@playwright/test';
// Read the same env files as the build under test: the Supabase client names its
// session cookie after the configured project, so a hard-coded ref only matches one project.
nextEnv.loadEnvConfig(process.cwd(),false);
export function supabaseAuthCookie(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 if(!url)throw new Error('Set NEXT_PUBLIC_SUPABASE_URL to the value the tested build was made with.');
 return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}
export const permissions=`dashboard.view dashboard.sales_summary.view dashboard.payment_breakdown.view dashboard.expenses.view dashboard.cash_position.view dashboard.stock_alerts.view dashboard.sync_status.view dashboard.shift_status.view pos.view pos.sale.create pos.receipt.reprint sales.view_all sales.view_own sales.refund sales.void menu.view menu.create menu.edit menu.price.edit menu.availability.edit inventory.view inventory.stock.add inventory.stock.remove inventory.stock.adjust inventory.movements.view purchases.view expenses.view expenses.create expenses.edit customers.view shifts.open shifts.view_all shifts.view_own shifts.close_own shifts.close_any reports.view reports.export team.view team.create team.edit team.deactivate roles.manage audit.view settings.general settings.appearance settings.payments settings.receipts settings.pos settings.team_access settings.sync settings.about orders.view kitchen.view devices.view devices.manage`.split(' ');
export const user={id:'test-owner',businessId:'11111111-1111-1111-1111-111111111111',locationId:'22222222-2222-2222-2222-222222222222',terminalId:'33333333-3333-3333-3333-333333333333',terminalName:'TEST-01',businessName:'Pilot Test Restaurant',locationName:'Test Branch',name:'Test Owner',email:'test@example.test',role:'OWNER',roleName:'Owner',permissions};
export async function pilot(page:Page,cashier=false){
 const profile=cashier?{...user,id:'test-cashier',name:'Test Cashier',role:'CASHIER',roleName:'Cashier',permissions:'dashboard.view dashboard.shift_status.view dashboard.sync_status.view pos.view pos.sale.create pos.receipt.reprint sales.view_own shifts.open shifts.view_own shifts.close_own settings.appearance settings.about devices.view'.split(' ')}:user;
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/auth/me'))return route.fulfill({json:profile});
  if(path.endsWith('/admin/snapshot'))return route.fulfill({json:{events:[],orders:[]}});
  if(path.endsWith('/admin/events'))return route.fulfill({json:{id:route.request().postDataJSON().id,status:'accepted'}});
  if(path.endsWith('/sync/events')){const body=route.request().postDataJSON();return route.fulfill({json:{event_id:body.event_id,entity_id:body.entity_id,status:'accepted'}});}
  if(path.endsWith('/settings'))return route.fulfill({json:{businessId:profile.businessId,userId:profile.id,sections:[]}});
  if(path.endsWith('/settings/appearance'))return route.abort();
  if(path.endsWith('/admin/security-audit'))return route.fulfill({json:[]});
  return route.fulfill({status:503,json:{detail:'Test endpoint is offline'}});
 });
 await page.route('**/auth/v1/logout*',route=>route.fulfill({status:204,body:''}));
 await page.route('**/__pilot_setup',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated pilot fixture</title>'}));
 await page.goto('/__pilot_setup');
 await page.evaluate(async ({profile,cookie})=>{
  const expiresAt=Math.floor(Date.now()/1000)+86400;
  localStorage.setItem('food-vendor-admin-session',JSON.stringify({token:'isolated-test-token',expiresAt:new Date(expiresAt*1000).toISOString(),user:profile}));
  const user={id:profile.id,aud:'authenticated',role:'authenticated',email:profile.email,last_sign_in_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const session={access_token:'isolated-test-token',token_type:'bearer',expires_in:86400,expires_at:expiresAt,refresh_token:'isolated-refresh-token',user};
  const encoded=btoa(JSON.stringify(session)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  document.cookie=`${cookie}=base64-${encoded}; Path=/; SameSite=Lax`;
  const entries:unknown[]=[];let clock=Date.now()-10000;
  const add=(kind:string,id:string,data:Record<string,unknown>)=>{const eventId=crypto.randomUUID(),time=new Date(clock++).toISOString();entries.push({eventId,orderId:eventId,createdAt:time,attempts:0,recordType:'operation',synced:true,operation:{id:eventId,businessId:profile.businessId,locationId:profile.locationId,actorId:profile.id,entityId:id,kind,action:'CREATED',baseVersion:0,occurredAt:time,data}});};
  add('category','drinks',{name:'Drinks',position:1,active:true});add('category','pork',{name:'Pork',position:0,active:true});
  const common={description:'',image:'',pricingType:'SINGLE',variations:[],isAvailable:true,trackStock:false,requiresKitchen:true,stockUnit:'Bottle',lowStockLevel:5};
  add('menu','coke',{...common,name:'Coke',categoryId:'drinks',pricePesewas:1500,trackStock:true,requiresKitchen:false});
  add('menu','yam',{...common,name:'Pork + Yam',categoryId:'pork',pricePesewas:8500,pricingType:'VARIATIONS',variations:[{id:'regular',name:'Regular',pricePesewas:8500},{id:'large',name:'Large',pricePesewas:9000}]});
  add('menu','fried',{...common,name:'Fried Pork',categoryId:'pork',pricePesewas:7000});
  add('stock','opening-coke',{menuItemId:'coke',type:'OPENING_STOCK',quantityDelta:24,balanceBefore:0,balanceAfter:24,reason:'Opening stock',referenceId:null});
  add('shift','test-shift',{operatorId:profile.id,operatorName:profile.name,terminalId:profile.terminalId,status:'OPEN',openedAt:new Date(clock).toISOString(),openingCash:10000,staffIds:[],notes:''});
  await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('food-vendor-os-pos',1);request.onupgradeneeded=()=>{request.result.createObjectStore('orders',{keyPath:'id'});request.result.createObjectStore('outbox',{keyPath:'eventId'});};request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('outbox','readwrite');for(const entry of entries)tx.objectStore('outbox').add(entry);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
 },{profile,cookie:supabaseAuthCookie()});
}
export async function savedOrders(page:Page){return page.evaluate(async()=>new Promise<Array<{id:string;cashierId:string;totalPesewas:number;syncStatus:string;amountTendered:number;change:number;receiptSnapshot:unknown}>>((resolve,reject)=>{const request=indexedDB.open('food-vendor-os-pos',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const read=db.transaction('orders').objectStore('orders').getAll();read.onsuccess=()=>{resolve(read.result);db.close();};};}));}
export async function stock(page:Page){return page.evaluate(async()=>new Promise<number>(resolve=>{const request=indexedDB.open('food-vendor-os-pos',1);request.onsuccess=()=>{const db=request.result;const read=db.transaction('outbox').objectStore('outbox').getAll();read.onsuccess=()=>{resolve(read.result.filter(e=>e.recordType==='operation'&&e.operation.kind==='stock'&&e.operation.data.menuItemId==='coke').reduce((n,e)=>n+e.operation.data.quantityDelta,0));db.close();};};}));}
