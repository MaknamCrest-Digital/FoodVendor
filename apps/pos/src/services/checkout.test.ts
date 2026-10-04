import 'fake-indexeddb/auto';
import {beforeEach,afterEach,describe,it,mock} from 'node:test';
import assert from 'node:assert/strict';
import {getDatabase,listOrders,pendingEvents,saveOrderAndOutbox} from '../lib/db';
import {completeSale} from './checkout';
import {saveSession} from '../lib/auth';
import {saveCategory,saveMenu,configuredMenu} from '../lib/menu';
import {journal,project,saveRecord} from '../lib/operations';
import type {MenuItem} from '../types/domain';
import {syncPending} from './sync';

const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
let menu:MenuItem[]=[];
function setOnline(onLine:boolean){Object.defineProperty(globalThis,'navigator',{value:{onLine},configurable:true});}
beforeEach(async()=>{
  setOnline(true);
  const db=await getDatabase();
  await db.clear('orders');await db.clear('outbox');
  saveSession({token:'unit-test',expiresAt:new Date(Date.now()+3600000).toISOString(),user:{id:'test-owner',businessId:'test-business',locationId:'test-location',terminalId:'test-terminal',terminalName:'T1',businessName:'Test',locationName:'Test',name:'Owner',email:'test@example.test',role:'ADMIN',permissions:['pos.sale.create','sales.view_all','menu.create','menu.edit','menu.price.edit','menu.availability.edit','inventory.stock.add','inventory.stock.remove','inventory.stock.adjust','shifts.open']}});
  await saveRecord('shift',{operatorId:'test-owner',terminalId:'test-terminal',status:'OPEN',openedAt:new Date().toISOString(),openingCash:0},'SHIFT_OPENED');
  await saveCategory({name:'Test menu'},'test-category');
  for(const [id,name,price] of [['p1','Pork + Yam',8500],['p2','Fried Pork',7000]] as const)await saveMenu({name,categoryId:'test-category',description:'',image:'',pricingType:'SINGLE',pricePesewas:price,variations:[],requiresKitchen:true,trackStock:false,isAvailable:true,stockUnit:'Bottle',lowStockLevel:0},id);
  menu=configuredMenu(project(await journal())).sort((a,b)=>a.id.localeCompare(b.id));
  for(const entry of await journal()){entry.synced=true;await db.put('outbox',entry);}
});
afterEach(()=>{
  mock.restoreAll();
  if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);
});

describe('durable checkout and sync',()=>{
  it('does not overwrite completed sales or leave orphan events on a duplicate write',async()=>{
    const order=await completeSale([{...menu[0],quantity:1}],'CASH');
    await assert.rejects(saveOrderAndOutbox({...order,totalPesewas:1},{eventId:crypto.randomUUID(),orderId:order.id,attempts:0,createdAt:order.occurredAt}));
    assert.equal((await listOrders())[0].totalPesewas,8500);
    assert.equal((await pendingEvents()).length,1);
  });
  it('stores twenty offline sales with unique IDs and exact totals',async()=>{
    setOnline(false);
    for(let i=0;i<20;i++)await completeSale([{...menu[0],quantity:2}],'CASH');
    const orders=await listOrders();
    assert.equal(orders.length,20);
    assert.equal(new Set(orders.map(o=>o.receiptNo)).size,20);
    assert.ok(orders.every(o=>o.totalPesewas===17000&&o.syncStatus==='PENDING'));
    assert.equal((await pendingEvents()).length,20);
    assert.equal((await syncPending()).offline,true);
  });
  it('rejects invalid carts without persisting',async()=>{
    await assert.rejects(completeSale([{...menu[0],quantity:0}],'CASH'));
    await assert.rejects(completeSale([],'CASH'));
    assert.equal((await listOrders()).length,0);
    assert.equal((await pendingEvents()).length,0);
  });
  it('retains a bad acknowledgement then retries the identical event and key',async()=>{
    const order=await completeSale([{...menu[0],quantity:1}],'MOMO');
    const [event]=await pendingEvents();
    let calls=0;
    const fetchMock=mock.method(globalThis,'fetch',async(url:unknown,options?:RequestInit)=>{
      if(String(url).endsWith('/admin/snapshot'))return Response.json({orders:[],events:[]});
      if(String(url).endsWith('/admin/events'))return Response.json({id:JSON.parse(String(options?.body)).id,status:'accepted'});
      return Response.json({status:++calls===1?'accepted':'already_processed',event_id:calls===1?'wrong':event.eventId,entity_id:order.id});
    });
    assert.equal((await syncPending()).failed,1);
    assert.equal((await pendingEvents()).length,1);
    assert.ok((await syncPending()).synced>=1);
    assert.equal((await pendingEvents()).length,0);
    assert.equal((await listOrders())[0].syncStatus,'SYNCED');
    const saleCalls=fetchMock.mock.calls.filter(call=>String(call.arguments[0]).endsWith('/sync/events'));
    const first=saleCalls[0].arguments[1] as RequestInit;
    const second=saleCalls[1].arguments[1] as RequestInit;
    assert.equal(first.body,second.body);
    assert.equal((first.headers as Record<string,string>)['Idempotency-Key'],event.eventId);
    assert.equal(JSON.parse(first.body as string).app_version,'1.0.0');
  });
  it('shares concurrent sync requests and retains data on network failure',async()=>{
    await completeSale([{...menu[1],quantity:1}],'CARD');
    const fetchMock=mock.method(globalThis,'fetch',async()=>{throw new Error('offline');});
    const first=syncPending();assert.equal(syncPending(),first);
    assert.ok((await first).failed>=1);
    assert.equal(fetchMock.mock.calls.filter(call=>String(call.arguments[0]).endsWith('/sync/events')).length,1);
    assert.equal((await pendingEvents()).length,1);
    assert.equal((await listOrders())[0].syncStatus,'PENDING');
  });
});
