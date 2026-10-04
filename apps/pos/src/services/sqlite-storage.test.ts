import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteLocalDatabase} from '../storage/sqliteDatabase';
import type {LocalOrder} from '../types/domain';
import type {OutboxEvent} from '../types/domain';

class FakeSQLite{
 readonly stores={orders:new Map<string,string>(),outbox:new Map<string,string>()};
 private snapshot:{orders:Map<string,string>;outbox:Map<string,string>}|undefined;
 active=false;
 maximumActive=0;
 beginCount=0;
 commitCount=0;
 rollbackCount=0;

 async beginTransaction(){
  assert.equal(this.active,false);
  this.snapshot={orders:new Map(this.stores.orders),outbox:new Map(this.stores.outbox)};
  this.active=true;
  this.maximumActive=Math.max(this.maximumActive,1);
  this.beginCount++;
 }

 async commitTransaction(){assert.equal(this.active,true);this.active=false;this.snapshot=undefined;this.commitCount++;}

 async rollbackTransaction(){
  assert.ok(this.snapshot);
  this.stores.orders=this.snapshot.orders;
  this.stores.outbox=this.snapshot.outbox;
  this.snapshot=undefined;
  this.active=false;
  this.rollbackCount++;
 }

 async query(statement:string,values:unknown[]=[]){
  const match=/FROM (orders|outbox) WHERE record_key/.exec(statement);
  if(match){
   const value=this.stores[match[1] as 'orders'|'outbox'].get(String(values[0]));
   return {values:value===undefined?[]:[{value}]};
  }
  const table=/FROM (orders|outbox)/.exec(statement)?.[1] as 'orders'|'outbox'|undefined;
  return {values:table?[...this.stores[table].values()].map(value=>({value})):[]};
 }

 async run(statement:string,values:unknown[]=[]){
  assert.equal(this.active,true);
  const match=/INSERT(?: OR IGNORE)? INTO (orders|outbox)/.exec(statement);
  if(match){
   const store=this.stores[match[1] as 'orders'|'outbox'];
   const key=String(values[0]);
   if(statement.startsWith('INSERT INTO')&&store.has(key))throw new Error('duplicate key');
   store.set(key,String(values[1]));
   return;
  }
  const clear=/DELETE FROM (orders|outbox)(?: WHERE record_key = \?)?/.exec(statement);
  if(clear){
   if(statement.includes('WHERE'))this.stores[clear[1] as 'orders'|'outbox'].delete(String(values[0]));
   else this.stores[clear[1] as 'orders'|'outbox'].clear();
  }
 }

 async execute(){return;}
 async isDBOpen(){return {result:true};}
 async open(){return;}
}

function testOrder(id:string):LocalOrder{
 return {id,receiptNo:`R-${id}`,businessId:'business',locationId:'location',terminalId:'terminal',totalPesewas:100,paymentMethod:'CASH',occurredAt:'2026-01-01T10:00:00.000Z',items:[],syncStatus:'PENDING'};
}

function testEvent(id:string):OutboxEvent{
 return {eventId:id,orderId:'order-1',attempts:0,createdAt:'2026-01-01T10:00:00.000Z'};
}

describe('native SQLite transaction adapter',()=>{
 it('serializes transaction boundaries and commits a multi-store write atomically',async()=>{
  const sqlite=new FakeSQLite();
  const db=new SQLiteLocalDatabase(sqlite);
  const first=db.transaction(['orders','outbox'],'readwrite');
  const second=db.transaction(['orders'],'readwrite');
  const firstOrder=first.objectStore('orders').add(testOrder('order-1'));
  const firstEvent=first.objectStore('outbox').add(testEvent('event-1'));
  const secondOrder=second.store.add(testOrder('order-2'));

  await Promise.all([firstOrder,firstEvent]);
  await first.done;
  await secondOrder;
  await second.done;

  assert.equal(sqlite.maximumActive,1);
  assert.equal(sqlite.beginCount,2);
  assert.equal(sqlite.commitCount,2);
  assert.equal(sqlite.stores.orders.size,2);
  assert.equal(sqlite.stores.outbox.size,1);
 });

 it('rolls back every store when an insert fails before commit',async()=>{
  const sqlite=new FakeSQLite();
  const db=new SQLiteLocalDatabase(sqlite);
  const tx=db.transaction(['orders','outbox'],'readwrite');
  await tx.objectStore('outbox').add(testEvent('duplicate-event'));
  await assert.rejects(tx.objectStore('outbox').add(testEvent('duplicate-event')),/duplicate key/);
  tx.abort();
  await assert.rejects(tx.done,/duplicate key|aborted/i);

  assert.equal(sqlite.rollbackCount,1);
  assert.equal(sqlite.stores.outbox.size,0);
  assert.equal(sqlite.stores.orders.size,0);
 });
});
