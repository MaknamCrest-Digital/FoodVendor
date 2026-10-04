import {listOrders,markSynced,pendingEvents,markSyncFailure} from '../lib/db';
import {API_BASE_URL as API} from '../lib/config';
import {APP_VERSION, LOCAL_SCHEMA_VERSION, SYNC_PROTOCOL_VERSION} from '../lib/version';
import {authHeaders} from '../lib/auth';
import {syncOperations} from './adminSync';
export type SyncResult = {synced:number; failed:number; offline:boolean};
let inFlight: Promise<SyncResult>|undefined;

// Timer, reconnect and manual requests share one worker in this page.
export function syncPending(): Promise<SyncResult> {
  if (!inFlight) inFlight = runSync().finally(()=>{inFlight=undefined;});
  return inFlight;
}

async function runSync(): Promise<SyncResult> {
  const result = {synced:0, failed:0, offline:!navigator.onLine};
  if (result.offline) return result;
  const setup=await syncOperations('before');
  result.synced+=setup.synced;result.failed+=setup.failed;
  const events = await pendingEvents();
  const orders = await listOrders();
  for (const evt of events) {
    const order = orders.find(o=>o.id===evt.orderId);
    if (!order) {result.failed++; continue;}
    const body = {
      event_id:evt.eventId,event_type:'order.completed',entity_id:order.id,
      business_id:order.businessId,location_id:order.locationId,terminal_id:order.terminalId,
      app_version:APP_VERSION,local_schema_version:LOCAL_SCHEMA_VERSION,sync_protocol_version:order.stockMovements?.length?SYNC_PROTOCOL_VERSION:1,occurred_at:order.occurredAt,
      payload:{id:order.id,receipt_no:order.receiptNo,total_pesewas:order.totalPesewas,payment_method:order.paymentMethod,
        order_type:order.orderType||'TAKEAWAY',notes:order.notes||'',customer_id:order.customerId||null,shift_id:order.shiftId||null,
        cashier_id:order.cashierId||null,cashier_name:order.cashierName||'',currency:order.currency||'GHS',amount_tendered:order.amountTendered??null,change:order.change||0,payment_reference:order.paymentReference||'',receipt_snapshot:order.receiptSnapshot||{},
        stock_movements:order.stockMovements||[],
        items:order.items.map(i=>({id:i.id,menu_item_id:i.menuItemId,name:i.name,quantity:i.quantity,unit_price_pesewas:i.unitPricePesewas,requires_kitchen:i.requiresKitchen||false,track_stock:i.trackStock||false,variation_id:i.variationId||null,variation_name:i.variationName||null}))},
    };
    try {
      const response = await fetch(`${API}/sync/events`, {method:'POST',headers:{...authHeaders(),'Content-Type':'application/json','Idempotency-Key':evt.eventId},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
      if (!response.ok) {const body=await response.json().catch(()=>({}));await markSyncFailure(order,typeof body.detail==='string'?body.detail:'Server rejected sync');result.failed++; continue;}
      const ack = await response.json();
      if (ack.event_id!==evt.eventId || ack.entity_id!==order.id || !['accepted','already_processed'].includes(ack.status)) {result.failed++; continue;}
      await markSynced(order.id,evt.eventId);
      result.synced++;
    } catch {
      // Stop on transport failure; all remaining events stay durable for retry.
      result.failed++;
      break;
    }
  }
  const operations=await syncOperations('after');
  result.synced+=operations.synced;result.failed+=operations.failed;
  return result;
}
