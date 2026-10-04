import 'fake-indexeddb/auto';
import {beforeEach,it,mock,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {getDatabase,listOrders,pendingEvents} from '../lib/db';
import {saveSession} from '../lib/auth';
import {saveCategory,saveMenu,configuredMenu,updateStock,stockQuantity,menuMovements,type MenuDraft} from '../lib/menu';
import {journal,project,saveRecord} from '../lib/operations';
import {completeSale} from './checkout';

const draft:MenuDraft={name:'Coke',categoryId:'test-category',description:'',image:'',pricingType:'SINGLE',pricePesewas:1500,variations:[],requiresKitchen:false,trackStock:true,isAvailable:true,stockUnit:'Bottle',lowStockLevel:5};
const records=async()=>project(await journal());
const coke=async()=>configuredMenu(await records()).find(p=>p.id==='test-coke')!;
beforeEach(async()=>{
  saveSession({token:'test-token',expiresAt:new Date(Date.now()+3600000).toISOString(),user:{id:'test-admin',email:'admin@example.test',name:'Admin',role:'ADMIN',permissions:['pos.sale.create','sales.view_all','menu.create','menu.edit','menu.price.edit','menu.availability.edit','inventory.stock.add','inventory.stock.remove','inventory.stock.adjust','shifts.open'],businessId:'test-business',locationId:'test-location',businessName:'Test',locationName:'Branch',terminalId:'test-terminal',terminalName:'TEST'}});
  const db=await getDatabase();await db.clear('orders');await db.clear('outbox');
  await saveRecord('shift',{operatorId:'test-admin',terminalId:'test-terminal',status:'OPEN',openedAt:new Date().toISOString(),openingCash:0},'SHIFT_OPENED');
  await saveCategory({name:'Drinks',active:true,position:0},'test-category');
  await saveMenu(draft,'test-coke',0,24);
});
afterEach(()=>mock.restoreAll());

it('commits Coke sale, payment, stock movement and sync events together without the network',async()=>{
  mock.method(globalThis,'fetch',()=>{throw new Error('No internet');});
  const order=await completeSale([{...await coke(),quantity:2}],'CASH');
  assert.equal(order.totalPesewas,3000);assert.equal(stockQuantity(await records(),'test-coke'),22);
  assert.deepEqual(menuMovements(await records(),'test-coke').map(r=>[r.data.type,r.data.quantityDelta]),[['SALE',-2],['OPENING_STOCK',24]]);
  assert.equal(order.stockMovements![0].data.referenceId,order.id);
  assert.equal((await records()).filter(r=>r.kind==='payment').length,1);
  assert.equal((await listOrders()).length,1);assert.equal((await pendingEvents()).length,1);
  assert.equal((await getDatabase()).version,1);
});
it('rejects insufficient stock and leaves all financial stores unchanged',async()=>{
  await assert.rejects(completeSale([{...await coke(),quantity:25}],'CASH'),/Only 24 Bottle/);
  assert.equal((await listOrders()).length,0);assert.equal((await pendingEvents()).length,0);
  assert.equal(stockQuantity(await records(),'test-coke'),24);
});
it('serializes simultaneous local checkouts so stock never becomes negative',async()=>{
  const item=await coke();
  const results=await Promise.allSettled([completeSale([{...item,quantity:20}],'CASH'),completeSale([{...item,quantity:20}],'MOMO')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(stockQuantity(await records(),'test-coke'),4);assert.equal((await listOrders()).length,1);
});
it('rolls the whole sale back if writing its stock movement fails',async()=>{
  const add=IDBObjectStore.prototype.add;
  mock.method(IDBObjectStore.prototype,'add',function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
    const entry=value as {operation?:{kind:string;data:{type:string}}};
    if(entry.operation?.kind==='stock'&&entry.operation.data.type==='SALE')throw new Error('Disk full');
    return add.call(this,value,key);
  });
  await assert.rejects(completeSale([{...await coke(),quantity:2}],'CASH'),/Disk full/);
  assert.equal((await listOrders()).length,0);assert.equal(stockQuantity(await records(),'test-coke'),24);
  assert.equal((await records()).filter(r=>r.kind==='payment').length,0);
});
it('uses configured variation prices without any ingredient deduction',async()=>{
  await saveMenu({...draft,name:'Pork + Yam',trackStock:false,requiresKitchen:true,pricingType:'VARIATIONS',variations:[{id:'small',name:'Small',pricePesewas:4500},{id:'large',name:'Large',pricePesewas:9000}]},'meal');
  const meal=configuredMenu(await records()).find(p=>p.id==='meal')!;
  const order=await completeSale([{...meal,id:'meal:large',menuItemId:'meal',variationId:'large',pricePesewas:9000,quantity:1}],'CARD');
  assert.equal(order.totalPesewas,9000);assert.equal(order.items[0].variationName,'Large');assert.equal(order.stockMovements?.length,0);
  assert.equal(stockQuantity(await records(),'test-coke'),24);
});
it('rechecks availability and prices at checkout instead of trusting a stale cart',async()=>{
  const item=await coke();await saveMenu({...draft,isAvailable:false},'test-coke',1);
  await assert.rejects(completeSale([{...item,quantity:1}],'CASH'),/unavailable/);
  await saveMenu({...draft,pricePesewas:1600},'test-coke',2);
  await assert.rejects(completeSale([{...item,quantity:1}],'CASH'),/price changed/);
  assert.equal((await listOrders()).length,0);
});
it('keeps restocks, removals and physical counts as signed movement history',async()=>{
  await updateStock('test-coke','ADD',24,'Delivery',24);
  await updateStock('test-coke','REMOVE',2,'Broken bottles',48,'WASTAGE');
  await updateStock('test-coke','SET',40,'Counted shelf',46);
  assert.equal(stockQuantity(await records(),'test-coke'),40);
  assert.deepEqual(menuMovements(await records(),'test-coke').map(r=>r.data.quantityDelta),[-6,-2,24,24]);
  await assert.rejects(updateStock('test-coke','REMOVE',41,'Bad count',40),/Only 40/);
  await assert.rejects(updateStock('test-coke','SET',1,'Stale count',39),/Stock changed/);
});
