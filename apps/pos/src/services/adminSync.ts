import {getDatabase} from '../lib/db';
import {authHeaders,requireUser} from '../lib/auth';
import {API_BASE_URL} from '../lib/config';
import {journal,journalEntry} from '../lib/operations';
import type {Operation} from '../types/admin';
import type {LocalOrder} from '../types/domain';

export async function syncOperations(stage:'before'|'after'='after'){
  const entries=await journal();let synced=0,failed=0;
  const db=await getDatabase();
  for(const entry of entries.filter(e=>!e.synced&&e.operation.actorId===requireUser().id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.operation.baseVersion-b.operation.baseVersion)){
    // SALE movements travel inside the financial sync envelope, never alone.
    if(entry.operation.kind==='stock'&&entry.operation.data.type==='SALE')continue;
    const before=['category','menu','stock'].includes(entry.operation.kind)||(entry.operation.kind==='shift'&&entry.operation.data.status==='OPEN');
    if((stage==='before')!==before)continue;
    try{
      const response=await fetch(`${API_BASE_URL}/admin/events`,{method:'POST',headers:{...authHeaders(),'Content-Type':'application/json','Idempotency-Key':entry.eventId},body:JSON.stringify(entry.operation),signal:AbortSignal.timeout(8000)});
      const ack=await response.json();
      if(!response.ok||ack.id!==entry.eventId){entry.syncError=typeof ack.detail==='string'?ack.detail:'Sync rejected';failed++;}
      else{entry.synced=true;entry.syncError=undefined;synced++;}
      await db.put('outbox',entry);
      if(response.status===401)break;
    }catch{failed++;break;}
  }
  if(stage==='before')return {synced,failed};
  // Read only this authenticated tenant. Never replace pending local changes.
  try{
    const response=await fetch(`${API_BASE_URL}/admin/snapshot`,{headers:authHeaders(),signal:AbortSignal.timeout(8000)});
    if(response.ok){
      const snapshot=await response.json() as {orders:LocalOrder[];events:Operation[]};const user=requireUser();
      const tx=db.transaction(['orders','outbox'],'readwrite');
      for(const order of snapshot.orders){if(order.businessId!==user.businessId||order.locationId!==user.locationId)continue;if(!await tx.objectStore('orders').get(order.id))await tx.objectStore('orders').add(order);}
      for(const event of snapshot.events){if(event.businessId!==user.businessId||event.locationId!==user.locationId)continue;if(!await tx.objectStore('outbox').get(event.id))await tx.objectStore('outbox').add(journalEntry(event,true));}
      await tx.done;
      if(typeof localStorage!=='undefined')localStorage.setItem(`last-sync:${user.businessId}:${user.locationId}`,new Date().toISOString());
    }else failed++;
  }catch{failed++;}
  if(typeof window!=='undefined')window.dispatchEvent(new Event('records-changed'));
  return {synced,failed};
}
