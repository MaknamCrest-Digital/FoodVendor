import {test,expect} from '@playwright/test';
import {pilot,savedOrders,stock,user} from './pilot-fixture';

test('responsive checkout, payment selection, offline reload and reconnect',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await pilot(page);await page.goto('/pos/');
 await expect(page.getByRole('button',{name:/Pork \+ Yam/})).toBeEnabled();
 for(const width of [1440,1024,820,768,600,390,320]){await page.setViewportSize({width,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`).toBe(true);}
 await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'test-results/pilot-pos-desktop.png',fullPage:true});
 await page.getByRole('button',{name:/Coke/}).click();await page.getByRole('button',{name:'Add one Coke',exact:true}).click();
 await page.getByRole('button',{name:'MoMo',exact:true}).click();expect(await savedOrders(page)).toHaveLength(0);
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 await context.setOffline(true);await page.getByRole('button',{name:/Complete sale/}).click();await page.getByRole('button',{name:/Payment received/}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
 await expect(page.getByRole('dialog')).toContainText('No default printer configured');await expect(page).toHaveURL(/\/pos\/?$/);expect(await savedOrders(page)).toHaveLength(1);expect(await stock(page)).toBe(22);
 await page.getByRole('button',{name:'Done · New order'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload();expect(await stock(page)).toBe(22);await page.getByRole('link',{name:'Sales',exact:true}).click();await expect(page.getByRole('table',{name:'Sales history'})).toContainText('Pending');
 await page.getByRole('button',{name:'Receipt',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Payment: MOMO');await page.getByRole('button',{name:'Done · New order'}).click();expect(await savedOrders(page)).toHaveLength(1);
 await context.setOffline(false);await expect.poll(async()=>(await savedOrders(page))[0].syncStatus).toBe('SYNCED');expect(await stock(page)).toBe(22);expect(errors).toEqual([]);
});

test('all Version 1 routes navigate and reopen offline',async({page,context})=>{
 await pilot(page);await page.goto('/pos/');await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);await context.setOffline(true);
 const routes=[['/','Dashboard'],['/orders/','Orders'],['/kitchen/','Kitchen'],['/inventory/','Inventory'],['/menu/','Menu'],['/purchases/','Purchases'],['/expenses/','Expenses'],['/customers/','Customers'],['/shifts/','Shifts'],['/reports/','Reports'],['/staff/','Staff & Roles'],['/devices/','Devices & Printers'],['/settings/','Settings'],['/audit/','Audit Log']];
 for(const [route,title] of routes){await page.goto(route);await expect(page.getByRole('heading',{name:title,exact:true}).first()).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});

test('pre-migration schema-1 orders and pending events survive the framework change',async({page})=>{
 await pilot(page);await page.route('**/api/v1/sync/events',route=>route.abort());
 await page.evaluate(async user=>{await new Promise<void>((resolve)=>{const request=indexedDB.open('food-vendor-os-pos',1);request.onsuccess=()=>{const db=request.result;const tx=db.transaction(['orders','outbox'],'readwrite');tx.objectStore('orders').add({id:'legacy-sale',receiptNo:'AD-01-LEGACY',businessId:user.businessId,locationId:user.locationId,terminalId:user.terminalId,totalPesewas:8500,paymentMethod:'CASH',occurredAt:'2026-09-27T12:00:00Z',syncStatus:'PENDING',items:[{id:'legacy-item',menuItemId:'p1',name:'Pork + Yam',quantity:1,unitPricePesewas:8500}]});tx.objectStore('outbox').add({eventId:'legacy-event',orderId:'legacy-sale',attempts:0,createdAt:'2026-09-27T12:00:00Z'});tx.oncomplete=()=>{db.close();resolve();};};});},user);
 await page.goto('/sales/');await expect(page.getByRole('table')).toContainText('AD-01-LEGACY');await expect(page.getByRole('table')).toContainText('Pending');await page.getByRole('button',{name:'Receipt',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('85.00');expect(await page.evaluate(async()=>new Promise<number>(resolve=>{const r=indexedDB.open('food-vendor-os-pos');r.onsuccess=()=>{resolve(r.result.version);r.result.close();};}))).toBe(1);
});

test('unsupported printer preserves sale and offers a browser print fallback',async({page})=>{
 await pilot(page);await page.evaluate(async user=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('food-vendor-os-pos',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('outbox','readwrite');tx.objectStore('outbox').put({eventId:`setting:${user.businessId}:device:${user.terminalId}`,recordType:'settings-cache',setting:{section:'device',scope:'DEVICE',scopeId:user.terminalId,revision:1,values:{name:user.terminalName,printerName:'Bluetooth printer',paperWidth:80,printerType:'MOCK',printers:[{id:'printer-1',businessId:user.businessId,locationId:user.locationId,deviceId:user.terminalId,name:'Bluetooth printer',printerType:'THERMAL',connectionType:'BLUETOOTH_PRINTER',paperProfile:'THERMAL_80',status:'CONFIGURED',isDefault:true,capabilities:[],configuration:{}}],defaultPrinterId:'printer-1'}}});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});},user);await page.goto('/pos/');await page.getByRole('button',{name:/Fried Pork/}).click();await page.getByRole('button',{name:/Complete sale/}).click();await page.getByRole('button',{name:/Payment received/}).click();await expect(page.getByRole('dialog')).toContainText('not available in this build');expect(await savedOrders(page)).toHaveLength(1);await expect(page.getByRole('button',{name:'Print again'})).toBeEnabled();await page.getByRole('button',{name:'Done · New order'}).click();await page.getByRole('link',{name:'Sales',exact:true}).click();await expect(page.getByRole('table')).toContainText('70.00');
});

test('variation price and cash change are immutable receipt snapshots',async({page})=>{
 await pilot(page);await page.goto('/pos/');await page.getByRole('button',{name:/Pork \+ Yam/}).click();await page.getByRole('button',{name:/Large/}).click();await page.getByRole('button',{name:/Complete sale/}).click();await page.getByLabel('Cash received').fill('100');await expect(page.getByRole('dialog')).toContainText('10.00');await page.getByRole('button',{name:/Payment received/}).click();await expect.poll(async()=>(await savedOrders(page)).length).toBe(1);const sale=(await savedOrders(page))[0];expect(sale.totalPesewas).toBe(9000);expect(sale.amountTendered).toBe(10000);expect(sale.change).toBe(1000);expect(sale.receiptSnapshot).toBeTruthy();expect(await stock(page)).toBe(24);
});

test('cashier sees own dashboard controls and cannot open restricted pages',async({page})=>{
 await pilot(page,true);await page.goto('/');await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();await expect(page.getByText("Today's sales",{exact:true})).toHaveCount(0);await expect(page.getByText('Payments today',{exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Inventory',exact:true})).toHaveCount(0);await page.goto('/inventory/');await expect(page.getByRole('heading',{name:'Access restricted'})).toBeVisible();await page.goto('/settings/');await expect(page.getByRole('button',{name:'General',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByRole('button',{name:'Dark Dark interface'}).click();await page.getByRole('button',{name:'Save changes'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.screenshot({path:'test-results/pilot-settings-dark.png',fullPage:true});
});

test('twenty offline sales survive reload and reconnect without duplicates',async({page,context})=>{
 test.setTimeout(120000);await pilot(page);await page.goto('/pos/');await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);await context.setOffline(true);
 for(let i=0;i<20;i++){await page.getByRole('button',{name:/Fried Pork/}).click();await page.getByRole('button',{name:/Complete sale/}).click();await page.getByRole('button',{name:/Payment received/}).click();await expect.poll(async()=>(await savedOrders(page)).length).toBe(i+1);await page.getByRole('button',{name:'Done · New order'}).click();if(i===9)await page.reload();}
 await page.reload();expect(await savedOrders(page)).toHaveLength(20);await context.setOffline(false);await expect.poll(async()=>(await savedOrders(page)).filter(o=>o.syncStatus==='SYNCED').length,{timeout:30000}).toBe(20);expect(new Set((await savedOrders(page)).map(o=>o.id)).size).toBe(20);
});
