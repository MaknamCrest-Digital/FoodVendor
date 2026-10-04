import {getDatabase} from './db';
import {requireUser} from './auth';
import {requirePermission} from './access';
import type {AdminRecord,Data,EntityKind,JournalEntry,Operation,PurchaseLine} from '../types/admin';
import {num,str,lines} from '../types/admin';
import type {LocalOrder} from '../types/domain';
import {isJournalEntry,type StoredOutbox} from '../storage/database';

export function journalEntry(operation:Operation,synced=false):JournalEntry{return {eventId:operation.id,orderId:operation.id,attempts:0,createdAt:operation.occurredAt,recordType:'operation',operation,synced};}
let lastOperationTime=0;
export function makeOperation(kind:EntityKind,entityId:string,action:string,data:Data,baseVersion=0):Operation{
  lastOperationTime=Math.max(Date.now(),lastOperationTime+1);
  const user=requireUser();return {id:crypto.randomUUID(),businessId:user.businessId,locationId:user.locationId,actorId:user.id,entityId,kind,action,data,baseVersion,occurredAt:new Date(lastOperationTime).toISOString()};
}
export function scopeEntries(entries:StoredOutbox[]){const user=requireUser();return entries.filter(isJournalEntry).filter(entry=>entry.operation.businessId===user.businessId&&entry.operation.locationId===user.locationId);}
export async function journal():Promise<JournalEntry[]>{return scopeEntries(await(await getDatabase()).getAll('outbox'));}
export function project(entries:JournalEntry[]):AdminRecord[]{
  const map=new Map<string,AdminRecord>();
  for(const entry of entries){const event=entry.operation;const key=`${event.kind}:${event.entityId}`;const old=map.get(key);
    if(!old||old.revision<=event.baseVersion)map.set(key,{id:event.entityId,kind:event.kind,revision:event.baseVersion+1,data:event.data,updatedAt:event.occurredAt,pending:!entry.synced,error:entry.syncError});
  }return [...map.values()];
}
export function stockMovements(records:AdminRecord[]){
  const movements=records.filter(r=>r.kind==='movement').map(r=>({id:r.id,itemId:str(r.data,'itemId'),quantity:num(r.data,'quantity'),type:str(r.data,'type'),reason:str(r.data,'reason'),date:r.updatedAt}));
  for(const purchase of records.filter(r=>r.kind==='purchase'&&r.data.status==='RECEIVED'))for(const [index,line] of lines(purchase.data).entries())movements.push({id:`${purchase.id}:${index}`,itemId:line.itemId,quantity:line.quantity,type:'PURCHASE',reason:`Purchase ${purchase.id.slice(0,8)}`,date:purchase.updatedAt});
  return movements;
}
export function balance(records:AdminRecord[],id:string){return stockMovements(records).filter(m=>m.itemId===id).reduce((sum,m)=>sum+m.quantity,0);}
export function corrections(records:AdminRecord[],orderId:string){return records.filter(r=>r.kind==='correction'&&r.data.orderId===orderId).reduce((sum,r)=>sum+num(r.data,'amount'),0);}
export function currentShift(records:AdminRecord[]){const user=requireUser();return records.find(r=>r.kind==='shift'&&r.data.status==='OPEN'&&(!r.data.operatorId||r.data.operatorId===user.id)&&(!r.data.terminalId||r.data.terminalId===user.terminalId));}
export function shiftTotals(records:AdminRecord[],orders:LocalOrder[],shift:AdminRecord){
  const sales=orders.filter(o=>o.shiftId===shift.id);
  const totals={CASH:0,MOMO:0,CARD:0};for(const order of sales)totals[order.paymentMethod]+=order.totalPesewas;
  const refunds=records.filter(r=>r.kind==='correction'&&r.data.shiftId===shift.id);
  const cashMovements=records.filter(r=>r.kind==='cash'&&r.data.shiftId===shift.id).reduce((s,r)=>s+num(r.data,'amount'),0);
  const expected=num(shift.data,'openingCash')+totals.CASH-refunds.filter(r=>r.data.paymentMethod==='CASH').reduce((s,r)=>s+num(r.data,'amount'),0)+cashMovements;
  return {...totals,refunds:refunds.reduce((s,r)=>s+num(r.data,'amount'),0),cashMovements,expected};
}
const transitions:Record<string,string[]>={NEW:['ACCEPTED','PREPARING','CANCELLED'],ACCEPTED:['PREPARING','CANCELLED'],PREPARING:['READY'],READY:['COMPLETED'],COMPLETED:[],CANCELLED:[]};
export function validateOperation(kind:EntityKind,id:string,data:Data,old:AdminRecord|undefined,records:AdminRecord[],orders:LocalOrder[]){
  if(old&&['movement','cash','correction','payment','system'].includes(kind))throw new Error('This record cannot be edited.');
  if(kind==='purchase'){
    if(old&&old.data.status!=='DRAFT')throw new Error('Only draft purchases may change.');
    if(!lines(data).length||lines(data).some(l=>!l.itemId||!Number.isFinite(l.quantity)||l.quantity<=0||!Number.isSafeInteger(l.unitCost)||l.unitCost<0))throw new Error('Add valid purchase items, quantities and unit costs.');
    if(!records.some(r=>r.kind==='supplier'&&r.id===data.supplierId))throw new Error('Select a supplier.');
  }
  if(kind==='expense'&&old&&old.data.status!=='DRAFT')throw new Error('Settled expenses cannot be edited.');
  if(kind==='movement'){
    if(!Number.isFinite(num(data,'quantity'))||num(data,'quantity')===0)throw new Error('Enter a non-zero quantity.');
    if(data.type==='WASTAGE'&&num(data,'quantity')>=0)throw new Error('Wastage quantity must be negative.');
    if(data.type==='RECEIVE'&&num(data,'quantity')<=0)throw new Error('Received quantity must be positive.');
    if(!str(data,'reason').trim())throw new Error('A movement reason is required.');
  }
  if(kind==='correction'){
    const order=orders.find(o=>o.id===data.orderId);if(!order)throw new Error('Sale not found.');
    const corrected=corrections(records,order.id);const amount=num(data,'amount');
    if(!Number.isSafeInteger(amount)||amount<=0||amount>order.totalPesewas-corrected)throw new Error('Amount exceeds the remaining sale balance.');
    if(data.type==='VOID'&&(corrected>0||amount!==order.totalPesewas))throw new Error('A void reverses the whole uncorrected sale.');
    if(!str(data,'reason').trim())throw new Error('A correction reason is required.');
  }
  if(kind==='workflow'&&old){
    if(!transitions[str(old.data,'status')]?.includes(str(data,'status')))throw new Error('This order transition is not allowed.');
    if(data.status==='CANCELLED'){const order=orders.find(o=>o.id===id);if(order&&corrections(records,id)<order.totalPesewas)throw new Error('Refund or void this paid sale before cancelling the order.');}
  }
  if(kind==='shift'){
    if(!old&&currentShift(records))throw new Error('Close the current shift first.');
    if(old&&old.data.status!=='OPEN')throw new Error('Closed shifts are immutable.');
  }
  if(kind==='hold'&&old&&old.data.status!=='HELD')throw new Error('This order has already been resumed or cancelled.');
}

export async function saveRecord(kind:EntityKind,data:Data,action:string,id=crypto.randomUUID(),expectedRevision?:number){
  const permission=kind==='correction'?(data.type==='VOID'?'sales.void':'sales.refund'):kind==='shift'?(data.status==='OPEN'?'shifts.open':data.operatorId===requireUser().id?'shifts.close_own':'shifts.close_any'):kind==='cash'?'shifts.open':kind==='expense'?(expectedRevision?'expenses.edit':'expenses.create'):kind==='system'?(action.startsWith('RECEIPT_REPRINT')?'pos.receipt.reprint':action.startsWith('PRINT_')?'pos.sale.create':'audit.view'):null;
  if(permission)requirePermission(permission);
  const db=await getDatabase();const tx=db.transaction(['orders','outbox'],'readwrite');
  try{
    const entries=scopeEntries(await tx.objectStore('outbox').getAll());const records=project(entries);
    const old=records.find(r=>r.kind===kind&&r.id===id);
    if(expectedRevision!==undefined&&(old?.revision||0)!==expectedRevision)throw new Error('This record changed. Reopen it before saving.');
    validateOperation(kind,id,data,old,records,await tx.objectStore('orders').getAll());
    const operation=makeOperation(kind,id,action,data,old?.revision||0);
    await tx.objectStore('outbox').add(journalEntry(operation));
    if(kind==='expense'&&data.fromDrawer&&data.status==='SETTLED'){
      const shift=currentShift(records);if(!shift||data.shiftId!==shift.id||data.paymentMethod!=='CASH')throw new Error('A drawer expense needs your open shift and cash payment.');
      requirePermission('shifts.open');
      await tx.objectStore('outbox').add(journalEntry(makeOperation('cash',`expense-${id}`,'EXPENSE_CASH_OUT',{expenseId:id,shiftId:shift.id,amount:-num(data,'amount'),reason:`Expense: ${str(data,'description')}`})));
    }
    await tx.done;return operation;
  }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
export async function logSystem(action:string,message:string,orderId?:string){return saveRecord('system',{message,orderId:orderId||null},action);}
export function purchaseTotal(items:PurchaseLine[]){return Math.round(items.reduce((sum,item)=>sum+item.quantity*item.unitCost,0));}
