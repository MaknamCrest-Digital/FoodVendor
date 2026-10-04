import type {CartLine, LocalOrder, PaymentMethod} from '../types/domain';
import {getDatabase} from '../lib/db';
import {requireUser} from '../lib/auth';
import {project,scopeEntries,currentShift,journalEntry,makeOperation} from '../lib/operations';
import {configuredMenu,stockOperation} from '../lib/menu';
import {localSettings} from '../lib/settings';
import {requirePermission} from '../lib/access';

export {money} from '../lib/settings';

export async function completeSale(cart: CartLine[], paymentMethod: PaymentMethod,options:{orderType?:'DINE_IN'|'TAKEAWAY';notes?:string;customerId?:string|null;amountTendered?:number;paymentReference?:string}={}): Promise<LocalOrder> {
  requirePermission('pos.sale.create');
  const settings=await localSettings();
  if (!cart.length || cart.some(item => !Number.isSafeInteger(item.quantity) || item.quantity<=0 || !Number.isSafeInteger(item.pricePesewas) || item.pricePesewas<0)) throw new Error('Invalid cart');
  if(!['CASH','MOMO','CARD'].includes(paymentMethod))throw new Error('Choose a payment method.');
  const totalPesewas = cart.reduce((sum,item)=>sum+item.pricePesewas*item.quantity,0);
  if (!Number.isSafeInteger(totalPesewas)) throw new Error('Invalid total');
  if(!settings.payments[paymentMethod.toLowerCase() as 'cash'|'momo'|'card'])throw new Error('This payment method is disabled.');
  const tender=paymentMethod==='CASH'?(options.amountTendered??totalPesewas):undefined;
  if(tender!==undefined&&(!Number.isSafeInteger(tender)||tender<totalPesewas))throw new Error('Cash received must cover the total.');
  if(paymentMethod==='MOMO'&&settings.payments.requireMomoReference&&!options.paymentReference?.trim())throw new Error('Enter the Mobile Money reference.');
  const id = crypto.randomUUID();
  const user=requireUser();
  if(!user.terminalId)throw new Error('Register a terminal before taking payments.');
  const db=await getDatabase();
  // Reading availability, stock and the current shift shares the write lock
  // with the order, payment, movement, audit and outbox commit.
  const tx=db.transaction(['orders','outbox'],'readwrite');
  try{
  const records=project(scopeEntries(await tx.objectStore('outbox').getAll()));
  const menu=configuredMenu(records);
  const quantities=new Map<string,number>();
  for(const line of cart){
    const menuId=line.menuItemId||line.id;const item=menu.find(p=>p.id===menuId);
    if(!item||!item.active||!item.isAvailable)throw new Error(`${line.name} is unavailable. Remove it from the order.`);
    const variation=item.variations?.find(v=>v.id===line.variationId);
    if(item.pricingType==='VARIATIONS'&&!variation)throw new Error(`Choose a current variation for ${item.name}.`);
    if(item.pricingType!=='VARIATIONS'&&line.variationId)throw new Error(`${item.name} has changed. Remove it and add it again.`);
    if(line.pricePesewas!==(variation?.pricePesewas??item.pricePesewas))throw new Error(`${item.name}'s price changed. Remove it and add it again.`);
    quantities.set(menuId,(quantities.get(menuId)||0)+line.quantity);
  }
  const shift=currentShift(records);
  if(settings.pos.requireShift&&!shift)throw new Error('Open your shift before completing a sale.');
  const occurredAt = new Date().toISOString();
  const order: LocalOrder = {
    id, receiptNo:`${user.terminalName}-${id}`, businessId:user.businessId,
    locationId:user.locationId,terminalId:user.terminalId,
    cashierId:user.id,cashierName:user.name,currency:settings.general.currency,amountTendered:tender,change:tender===undefined?0:tender-totalPesewas,paymentReference:options.paymentReference?.trim()||'',receiptSnapshot:{general:settings.general,location:settings.location,receipts:settings.receipts,terminalName:settings.device.name,paperProfile:settings.device.printers.find(printer=>printer.id===settings.device.defaultPrinterId)?.paperProfile||(settings.receipts.paperWidth===58?'THERMAL_58':'THERMAL_80')},
    orderType:options.orderType||'TAKEAWAY',notes:options.notes||'',customerId:options.customerId||null,shiftId:shift?.id||null,
    totalPesewas, paymentMethod, occurredAt, syncStatus:'PENDING',
    items:cart.map(line=>{const item=menu.find(p=>p.id===(line.menuItemId||line.id))!;const variation=item.variations?.find(v=>v.id===line.variationId);return {id:crypto.randomUUID(),menuItemId:item.id,name:variation?`${item.name} · ${variation.name}`:item.name,quantity:line.quantity,unitPricePesewas:line.pricePesewas,requiresKitchen:item.requiresKitchen,trackStock:item.trackStock,variationId:variation?.id,variationName:variation?.name};}),
    stockMovements:[...quantities].flatMap(([menuId,quantity])=>{const item=menu.find(p=>p.id===menuId)!;return item.trackStock?[stockOperation(item,'SALE',-quantity,item.stockQuantity||0,'Paid sale',id,settings.pos.allowNegativeStock)]:[];}),
  };
  const entries=[
    makeOperation('payment',id,'PAYMENT_RECORDED',{orderId:id,amount:totalPesewas,paymentMethod,amountTendered:tender??null,change:order.change,reference:order.paymentReference}),
    makeOperation('workflow',id,'ORDER_CREATED',{orderId:id,status:order.items.some(item=>item.requiresKitchen)?'NEW':'COMPLETED',notes:order.notes}),
    makeOperation('system',crypto.randomUUID(),'SALE_CREATED',{orderId:id,message:`Sale ${order.receiptNo} recorded`}),
    ...(order.stockMovements||[]),
  ].map(operation=>journalEntry(operation));
  await tx.objectStore('orders').add(order);
  await tx.objectStore('outbox').add({eventId:crypto.randomUUID(),orderId:id,attempts:0,createdAt:occurredAt});
  for(const entry of entries)await tx.objectStore('outbox').add(entry);
  await tx.done;
  return order;
  }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
