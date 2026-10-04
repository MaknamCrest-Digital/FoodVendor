import 'fake-indexeddb/auto';
import {beforeEach,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {getDatabase} from '../lib/db';
import {saveSession} from '../lib/auth';
import {defaultSettings} from '../lib/settings';
import {exportLocalData,importLocalData,type LocalDataBundle} from '../storage/dataTransfer';
import type {LocalOrder} from '../types/domain';
import type {JournalEntry} from '../types/admin';
import type {SettingsCacheRecord} from '../storage/database';

const businessId='transfer-business';
const locationId='transfer-location';

function order(id:string,scope={businessId,locationId},totalPesewas=1200):LocalOrder{
 return {id,receiptNo:`R-${id}`,businessId:scope.businessId,locationId:scope.locationId,terminalId:'terminal-a',cashierId:'cashier-a',cashierName:'Cashier',totalPesewas,paymentMethod:'CASH',occurredAt:'2026-01-01T10:00:00.000Z',items:[{id:`item-${id}`,menuItemId:'menu-1',name:'Pork',quantity:1,unitPricePesewas:totalPesewas}],syncStatus:'PENDING'};
}

function journal(eventId:string,scope={businessId,locationId}):JournalEntry{
 return {eventId,orderId:'shift-1',attempts:0,createdAt:'2026-01-01T10:00:00.000Z',recordType:'operation',synced:false,operation:{id:eventId,businessId:scope.businessId,locationId:scope.locationId,actorId:'cashier-a',entityId:'shift-1',kind:'shift',action:'SHIFT_OPENED',baseVersion:0,occurredAt:'2026-01-01T10:00:00.000Z',data:{}}};
}

beforeEach(async()=>{
 const db=await getDatabase();
 await db.clear('orders');
 await db.clear('outbox');
 saveSession({token:'test',expiresAt:'2099-01-01T00:00:00.000Z',user:{id:'cashier-a',businessId,locationId,terminalId:'terminal-a',terminalName:'T1',businessName:'Test',locationName:'Test',name:'Cashier',email:'cashier@example.test',role:'ADMIN',permissions:['sales.view_all','devices.manage']}});
});

describe('offline data transfer',()=>{
 it('exports only this location and the related offline journal without device settings',async()=>{
  const db=await getDatabase();
  const localOrder=order('local-sale');
  await db.put('orders',localOrder);
  await db.put('orders',order('other-sale',{businessId:'other-business',locationId}));
  await db.put('outbox',{eventId:'sale-event',orderId:localOrder.id,attempts:0,createdAt:localOrder.occurredAt});
  await db.put('outbox',journal('journal-event'));
  const settings:SettingsCacheRecord={eventId:`setting:${businessId}:device:terminal-a`,recordType:'settings-cache',setting:{section:'device',scope:'DEVICE',scopeId:'terminal-a',revision:0,values:defaultSettings().device}};
  await db.put('outbox',settings);

  const bundle=await exportLocalData();
  assert.deepEqual(bundle.orders.map(item=>item.id),['local-sale']);
  assert.deepEqual(bundle.outbox.map(item=>item.eventId).sort(),['journal-event','sale-event']);
  assert.equal(bundle.businessId,businessId);
  assert.equal(bundle.locationId,locationId);
 });

 it('imports a scoped bundle once and safely skips identical records on retry',async()=>{
  const db=await getDatabase();
  const localOrder=order('imported-sale');
  const bundle:LocalDataBundle={format:'maknam-pos-local-data',version:1,businessId,locationId,exportedAt:'2026-01-01T10:00:00.000Z',orders:[localOrder],outbox:[{eventId:'imported-event',orderId:localOrder.id,attempts:0,createdAt:localOrder.occurredAt},journal('imported-journal')]};

  assert.deepEqual(await importLocalData(JSON.stringify(bundle)),{ordersAdded:1,outboxAdded:2,recordsSkipped:0});
  assert.deepEqual(await importLocalData(JSON.stringify(bundle)),{ordersAdded:0,outboxAdded:0,recordsSkipped:3});
  assert.equal((await db.get<LocalOrder>('orders',localOrder.id))?.totalPesewas,1200);
 });

 it('rejects cross-tenant bundles and rolls back a conflicting import atomically',async()=>{
  const db=await getDatabase();
  await assert.rejects(importLocalData(JSON.stringify({format:'maknam-pos-local-data',version:1,businessId:'other-business',locationId,orders:[],outbox:[]})),/different business or location/);
  const existing=order('existing-sale',undefined,900);
  await db.put('orders',existing);
  const bundle:LocalDataBundle={format:'maknam-pos-local-data',version:1,businessId,locationId,exportedAt:'2026-01-01T10:00:00.000Z',orders:[order('new-sale'),order('existing-sale',undefined,1000)],outbox:[]};

  await assert.rejects(importLocalData(JSON.stringify(bundle)),/already exists with different data/);
  assert.equal(await db.get('orders','new-sale'),undefined);
  assert.equal((await db.get<LocalOrder>('orders','existing-sale'))?.totalPesewas,900);
 });
});
