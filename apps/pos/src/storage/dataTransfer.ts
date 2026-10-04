import {getDatabase} from '../lib/db';
import {requireUser} from '../lib/auth';
import {requirePermission} from '../lib/access';
import {isJournalEntry,type StoredOrder,type StoredOutbox} from './database';

export type LocalDataBundle={
 format:'maknam-pos-local-data';
 version:1;
 businessId:string;
 locationId:string;
 exportedAt:string;
 orders:StoredOrder[];
 outbox:StoredOutbox[];
};

function isRecord(value:unknown):value is Record<string,unknown>{
 return typeof value==='object'&&value!==null&&!Array.isArray(value);
}

function isLocalOrder(value:unknown):value is StoredOrder{
 if(!isRecord(value))return false;
 return typeof value.id==='string'&&typeof value.businessId==='string'&&typeof value.locationId==='string'&&
  typeof value.receiptNo==='string'&&Number.isSafeInteger(value.totalPesewas)&&Number(value.totalPesewas)>=0&&
  (value.paymentMethod==='CASH'||value.paymentMethod==='MOMO'||value.paymentMethod==='CARD')&&
  Array.isArray(value.items)&&value.items.every(item=>isRecord(item)&&typeof item.id==='string'&&
   typeof item.menuItemId==='string'&&typeof item.name==='string'&&Number.isSafeInteger(item.quantity)&&
   Number(item.quantity)>0&&Number.isSafeInteger(item.unitPricePesewas)&&Number(item.unitPricePesewas)>=0)&&
  (value.syncStatus==='PENDING'||value.syncStatus==='SYNCED');
}

function isOutboxRecord(value:unknown):value is StoredOutbox{
 if(!isRecord(value)||typeof value.eventId!=='string'||typeof value.orderId!=='string'||
  !Number.isSafeInteger(value.attempts)||Number(value.attempts)<0||typeof value.createdAt!=='string')return false;
 if(value.recordType==='operation'){
  const operation=value.operation;
  return value.synced!==undefined&&typeof value.synced==='boolean'&&isRecord(operation)&&
   typeof operation.id==='string'&&typeof operation.businessId==='string'&&typeof operation.locationId==='string'&&
   typeof operation.actorId==='string'&&typeof operation.entityId==='string'&&typeof operation.kind==='string'&&
   typeof operation.action==='string'&&Number.isSafeInteger(operation.baseVersion)&&typeof operation.occurredAt==='string'&&isRecord(operation.data);
 }
 return value.recordType===undefined;
}

export async function exportLocalData():Promise<LocalDataBundle>{
 requirePermission('devices.manage');
 const user=requireUser();
 const db=await getDatabase();
 const orders=(await db.getAll<StoredOrder>('orders')).filter(order=>order.businessId===user.businessId&&order.locationId===user.locationId);
 const orderIds=new Set(orders.map(order=>order.id));
 const outbox=(await db.getAll<StoredOutbox>('outbox')).filter(entry=>
  isJournalEntry(entry)
   ?entry.operation.businessId===user.businessId&&entry.operation.locationId===user.locationId
   :'orderId' in entry&&orderIds.has(entry.orderId),
 );
 return {format:'maknam-pos-local-data',version:1,businessId:user.businessId,locationId:user.locationId,exportedAt:new Date().toISOString(),orders,outbox};
}

export async function importLocalData(json:string):Promise<{ordersAdded:number;outboxAdded:number;recordsSkipped:number}>{
 requirePermission('devices.manage');
 const user=requireUser();
 let parsed:unknown;
 try{parsed=JSON.parse(json);}catch{throw new Error('This file is not valid JSON.');}
 if(!isRecord(parsed)||parsed.format!=='maknam-pos-local-data'||parsed.version!==1||
  parsed.businessId!==user.businessId||parsed.locationId!==user.locationId||
  !Array.isArray(parsed.orders)||!Array.isArray(parsed.outbox)){
  throw new Error('This data file is invalid or belongs to a different business or location.');
 }
 if(parsed.orders.length+parsed.outbox.length>50000)throw new Error('This data file contains too many records to import at once.');
 const orders=parsed.orders;
 const outbox=parsed.outbox;
 if(!orders.every(isLocalOrder)||!outbox.every(isOutboxRecord))throw new Error('This data file contains an invalid local record.');
 const orderIds=new Set<string>();
 for(const order of orders){
  if(order.businessId!==user.businessId||order.locationId!==user.locationId)throw new Error('This data file contains a sale from a different business or location.');
  if(orderIds.has(order.id))throw new Error(`Duplicate sale ID ${order.id} in data file.`);
  orderIds.add(order.id);
 }
 const eventIds=new Set<string>();
 for(const entry of outbox){
  if(eventIds.has(entry.eventId))throw new Error(`Duplicate local event ID ${entry.eventId} in data file.`);
  eventIds.add(entry.eventId);
  if(isJournalEntry(entry)){
   if(entry.operation.businessId!==user.businessId||entry.operation.locationId!==user.locationId)throw new Error('This data file contains an event from a different business or location.');
  }else if(!('orderId' in entry)||!orderIds.has(entry.orderId)){
   throw new Error(`Outbox event ${entry.eventId} does not belong to an included sale.`);
  }
 }

 const db=await getDatabase();
 const tx=db.transaction(['orders','outbox'],'readwrite');
 let ordersAdded=0,outboxAdded=0,recordsSkipped=0;
 try{
  for(const order of orders){
   const existing=await tx.objectStore('orders').get<StoredOrder>(order.id);
   if(existing){
    if(JSON.stringify(existing)!==JSON.stringify(order))throw new Error(`Sale ${order.id} already exists with different data.`);
    recordsSkipped++;
   }else{await tx.objectStore('orders').add(order);ordersAdded++;}
  }
  for(const entry of outbox){
   const existing=await tx.objectStore('outbox').get<StoredOutbox>(entry.eventId);
   if(existing){
    if(JSON.stringify(existing)!==JSON.stringify(entry))throw new Error(`Local event ${entry.eventId} already exists with different data.`);
    recordsSkipped++;
   }else{await tx.objectStore('outbox').add(entry);outboxAdded++;}
  }
  await tx.done;
  return {ordersAdded,outboxAdded,recordsSkipped};
 }catch(error){
  tx.abort();
  await tx.done.catch(()=>{});
  throw error;
 }
}
