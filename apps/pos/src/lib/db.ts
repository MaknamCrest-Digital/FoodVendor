import {Capacitor} from '@capacitor/core';
import type {LocalDatabase,LocalTransaction,StoreName,StoredOrder,StoredOutbox} from '../storage/database';
import {isJournalEntry} from '../storage/database';
import {openBrowserDatabase} from '../storage/browserDatabase';
import type {LocalOrder,OutboxEvent} from '../types/domain';
import type {JournalEntry} from '../types/admin';
import {requireUser} from './auth';
import {can} from './access';

let dbPromise:Promise<LocalDatabase>|undefined;

export function getDatabase(){
  if(!dbPromise){
    const open=Capacitor.isNativePlatform()
      ?import('../storage/sqliteDatabase').then(({openSQLiteDatabase})=>openSQLiteDatabase())
      :openBrowserDatabase();
    dbPromise=open.catch(error=>{dbPromise=undefined;throw error;});
  }
  return dbPromise;
}

export async function saveOrderAndOutbox(order:LocalOrder,event:OutboxEvent,entries:JournalEntry[]=[]){
  const db=await getDatabase();
  const tx=db.transaction(['orders','outbox'],'readwrite');
  await Promise.all([tx.objectStore('orders').add(order),tx.objectStore('outbox').add(event),...entries.map(entry=>tx.objectStore('outbox').add(entry)),tx.done]);
}

export async function listOrders(){
  const user=requireUser();
  const orders=await(await getDatabase()).getAll<StoredOrder>('orders');
  return orders.filter(order=>order.businessId===user.businessId&&order.locationId===user.locationId&&(can('sales.view_all',user)||order.cashierId===user.id));
}

export async function pendingEvents(){
  const orders=await listOrders();
  const ids=new Set(orders.map(order=>order.id));
  const events=await(await getDatabase()).getAll<StoredOutbox>('outbox');
  return events.filter((event):event is OutboxEvent=>!isJournalEntry(event)&&'orderId' in event&&ids.has(event.orderId));
}

export async function markSynced(orderId:string,eventId:string){
  const db=await getDatabase();
  const tx=db.transaction(['orders','outbox'],'readwrite');
  const store=tx.objectStore('orders');
  const order=await store.get<StoredOrder>(orderId);
  if(!order)throw new Error(`Cannot mark missing local sale ${orderId} as synced.`);
  order.syncStatus='SYNCED';delete order.syncError;await store.put(order);await tx.objectStore('outbox').delete(eventId);
  for(const movement of order.stockMovements||[]){
    const entry=await tx.objectStore('outbox').get<StoredOutbox>(movement.id);
    if(entry&&isJournalEntry(entry)){entry.synced=true;delete entry.syncError;await tx.objectStore('outbox').put(entry);}
  }
  await tx.done;
}

export async function markSyncFailure(order:LocalOrder,error:string){
  const db=await getDatabase();
  const tx=db.transaction(['orders','outbox'],'readwrite');
  const saved=await tx.objectStore('orders').get<StoredOrder>(order.id);
  if(saved){saved.syncError=error;await tx.objectStore('orders').put(saved);}
  for(const movement of order.stockMovements||[]){
    const entry=await tx.objectStore('outbox').get<StoredOutbox>(movement.id);
    if(entry&&isJournalEntry(entry)){entry.syncError=error;await tx.objectStore('outbox').put(entry);}
  }
  await tx.done;
}

export type {LocalDatabase,LocalTransaction,StoreName};
