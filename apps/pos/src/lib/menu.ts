import {getDatabase} from './db';
import {journalEntry,makeOperation,project,scopeEntries} from './operations';
import {num,str,type AdminRecord,type Data,type Operation} from '../types/admin';
import type {MenuItem,Variation} from '../types/domain';
import {requirePermission} from './access';

export type MenuDraft={name:string;categoryId:string;description:string;image:string;pricingType:'SINGLE'|'VARIATIONS';pricePesewas:number;variations:Variation[];requiresKitchen:boolean;trackStock:boolean;isAvailable:boolean;stockUnit:string;lowStockLevel:number};
export type StockType='OPENING_STOCK'|'RESTOCK'|'SALE'|'ADJUSTMENT'|'WASTAGE'|'RETURN';
export function categories(records:AdminRecord[]){return records.filter(r=>r.kind==='category').sort((a,b)=>num(a.data,'position')-num(b.data,'position')||str(a.data,'name').localeCompare(str(b.data,'name')));}
export function menuMovements(records:AdminRecord[],menuItemId?:string){return records.filter(r=>r.kind==='stock'&&(!menuItemId||r.data.menuItemId===menuItemId)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
export function stockQuantity(records:AdminRecord[],id:string){return menuMovements(records,id).reduce((sum,r)=>sum+num(r.data,'quantityDelta'),0);}
export function configuredMenu(records:AdminRecord[]):MenuItem[]{
  return records.filter(r=>r.kind==='menu').map<MenuItem>(r=>{
    const data=r.data;const category=records.find(c=>c.kind==='category'&&c.id===data.categoryId);
    return {id:r.id,name:str(data,'name'),category:str(category?.data||{},'name',str(data,'category','Uncategorized')),categoryId:str(data,'categoryId'),description:str(data,'description'),image:str(data,'image'),pricingType:data.pricingType==='VARIATIONS'?'VARIATIONS':'SINGLE',variations:(data.variations||[]) as Variation[],pricePesewas:num(data,'pricePesewas'),requiresKitchen:data.requiresKitchen!==false,trackStock:data.trackStock===true,isAvailable:data.isAvailable!==false&&data.active!==false,active:category?category.data.active!==false:false,stockUnit:str(data,'stockUnit','Bottle'),lowStockLevel:num(data,'lowStockLevel'),stockQuantity:stockQuantity(records,r.id),revision:r.revision};
  }).sort((a,b)=>a.name.localeCompare(b.name));
}
export function stockOperation(item:MenuItem,type:StockType,delta:number,before:number,reason='',referenceId:string|null=null,allowNegative=false):Operation{
  const after=before+delta;
  if(!Number.isSafeInteger(delta)||!Number.isSafeInteger(after)||(!allowNegative&&after<0))throw new Error(`Only ${before} ${item.stockUnit||'units'} available.`);
  return makeOperation('stock',crypto.randomUUID(),type==='SALE'?'STOCK_SOLD':`STOCK_${type}`,{menuItemId:item.id,type,quantityDelta:delta,balanceBefore:before,balanceAfter:after,referenceId,reason});
}
export function validateMenu(data:MenuDraft,records:AdminRecord[]){
  if(!data.name.trim()||data.name.length>160)throw new Error('Enter an item name (up to 160 characters).');
  if(!records.some(r=>r.kind==='category'&&r.id===data.categoryId))throw new Error('Choose a category.');
  if(!Number.isSafeInteger(data.pricePesewas)||data.pricePesewas<0)throw new Error('Enter a valid price.');
  if(data.pricingType==='VARIATIONS'){
    if(!data.variations.length||data.variations.some(v=>!v.name.trim()||!v.id||!Number.isSafeInteger(v.pricePesewas)||v.pricePesewas<0))throw new Error('Every variation needs a name and valid price.');
    if(new Set(data.variations.map(v=>v.name.trim().toLowerCase())).size!==data.variations.length||new Set(data.variations.map(v=>v.id)).size!==data.variations.length)throw new Error('Variation names must be unique.');
  }
  if(data.trackStock&&(!data.stockUnit.trim()||!Number.isSafeInteger(data.lowStockLevel)||data.lowStockLevel<0))throw new Error('Enter a stock unit and a whole-number low stock level.');
  if(data.image&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data.image)||data.image.length>550000))throw new Error('Use a PNG, JPEG or WebP image under 400 KB.');
}
export async function saveMenu(data:MenuDraft,id=crypto.randomUUID(),expectedRevision=0,openingStock=0){
  requirePermission(expectedRevision?'menu.edit':'menu.create');
  const db=await getDatabase();const tx=db.transaction('outbox','readwrite');
  try{
    const records=project(scopeEntries(await tx.store.getAll()));const old=records.find(r=>r.kind==='menu'&&r.id===id);
    if((old?.revision||0)!==expectedRevision)throw new Error('This item changed. Reopen it before saving.');
    validateMenu(data,records);
    if(!Number.isSafeInteger(openingStock)||openingStock<0)throw new Error('Opening stock must be a whole number of zero or more.');
    const firstStock=data.trackStock&&!records.some(r=>r.kind==='stock'&&r.data.menuItemId===id);
    if(!firstStock&&openingStock)throw new Error('Use Update Stock to change an existing count.');
    if(old&&stockQuantity(records,id)!==0&&str(old.data,'stockUnit','Bottle')!==data.stockUnit)throw new Error('Count stock to zero before changing its unit.');
    const saved={...data,name:data.name.trim(),variations:data.pricingType==='SINGLE'?[]:data.variations,pricePesewas:data.pricingType==='VARIATIONS'?Math.min(...data.variations.map(v=>v.pricePesewas)):data.pricePesewas};
    await tx.store.add(journalEntry(makeOperation('menu',id,old?'MENU_UPDATED':'MENU_CREATED',saved,expectedRevision)));
    if(firstStock){requirePermission('inventory.stock.add');await tx.store.add(journalEntry(stockOperation({...saved,id,category:''},'OPENING_STOCK',openingStock,0,'Opening stock')));}
    await tx.done;return id;
  }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
export async function updateStock(id:string,mode:'ADD'|'REMOVE'|'SET',quantity:number,reason:string,expectedBalance:number,type?:StockType){
  requirePermission(mode==='ADD'?'inventory.stock.add':mode==='REMOVE'?'inventory.stock.remove':'inventory.stock.adjust');
  const db=await getDatabase();const tx=db.transaction('outbox','readwrite');
  try{
    const records=project(scopeEntries(await tx.store.getAll()));const item=configuredMenu(records).find(r=>r.id===id);
    if(!item?.trackStock)throw new Error('Stock tracking is not enabled for this item.');
    const before=stockQuantity(records,id);
    if(before!==expectedBalance)throw new Error(`Stock changed to ${before}. Close and reopen Update Stock.`);
    if(!Number.isSafeInteger(quantity)||quantity<0||(mode!=='SET'&&quantity===0))throw new Error('Enter a valid whole-number quantity.');
    if(mode!=='ADD'&&!reason.trim())throw new Error('Enter a reason for this stock change.');
    const delta=mode==='SET'?quantity-before:mode==='REMOVE'?-quantity:quantity;
    if(delta===0)throw new Error('The stock count has not changed.');
    await tx.store.add(journalEntry(stockOperation(item,type||(mode==='ADD'?'RESTOCK':'ADJUSTMENT'),delta,before,reason)));
    await tx.done;
  }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
export async function saveCategory(data:Data,id=crypto.randomUUID(),revision=0){
  requirePermission('menu.edit');
  const db=await getDatabase();const tx=db.transaction('outbox','readwrite');
  try{
    const records=project(scopeEntries(await tx.store.getAll()));const old=records.find(r=>r.kind==='category'&&r.id===id);
    if((old?.revision||0)!==revision)throw new Error('Category changed. Reopen before saving.');
    if(!str(data,'name').trim()||str(data,'name').length>80)throw new Error('Enter a category name (up to 80 characters).');
    if(categories(records).some(r=>r.id!==id&&str(r.data,'name').toLowerCase()===str(data,'name').trim().toLowerCase()))throw new Error('A category with this name already exists.');
    await tx.store.add(journalEntry(makeOperation('category',id,old?'CATEGORY_UPDATED':'CATEGORY_CREATED',{name:str(data,'name').trim(),active:data.active!==false,position:num(data,'position',categories(records).length)},revision)));
    await tx.done;
  }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
export async function reorderCategories(first:AdminRecord,second:AdminRecord){
  requirePermission('menu.edit');
  const db=await getDatabase();const tx=db.transaction('outbox','readwrite');
  try{
    const records=project(scopeEntries(await tx.store.getAll()));
    for(const r of [first,second])if(records.find(row=>row.kind==='category'&&row.id===r.id)?.revision!==r.revision)throw new Error('Categories changed. Try again.');
    const ordered=categories(records);const a=ordered.findIndex(r=>r.id===first.id),b=ordered.findIndex(r=>r.id===second.id);
    [ordered[a],ordered[b]]=[ordered[b],ordered[a]];
    for(const [position,r] of ordered.entries())await tx.store.add(journalEntry(makeOperation('category',r.id,'CATEGORY_REORDERED',{...r.data,position},r.revision)));
    await tx.done;
  }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
