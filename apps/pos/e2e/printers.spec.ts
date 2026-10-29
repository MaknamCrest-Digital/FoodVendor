import {test,expect,type Page} from '@playwright/test';
import {pilot,savedOrders,user} from './pilot-fixture';

const pos={confirmSale:true,autoPrint:true,showChangeCalculator:true,allowNegativeStock:false,lowStockWarnings:true,requireShift:true,requireOpeningCash:true,requireClosingCount:true,requireVarianceNote:true};
const systemPrinter={id:'printer-1',businessId:user.businessId,locationId:user.locationId,deviceId:user.terminalId,name:'Counter printer',printerType:'THERMAL',connectionType:'SYSTEM_PRINTER',paperProfile:'THERMAL_58',status:'CONFIGURED',isDefault:true,capabilities:['SYSTEM_PRINTER'],configuration:{setupMode:'AUTOMATIC'}};

async function cacheSetting(page:Page,section:'pos'|'device',scopeId:string,scope:string,values:Record<string,unknown>){
 await page.evaluate(async({section,scopeId,scope,values,businessId})=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('food-vendor-os-pos',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('outbox','readwrite');tx.objectStore('outbox').put({eventId:`setting:${businessId}:${section}:${scopeId}`,recordType:'settings-cache',setting:{section,scope,scopeId,revision:1,values}});tx.oncomplete=()=>{db.close();resolve();};};});},{section,scopeId,scope,values,businessId:user.businessId});
}
const devicePrinters=(page:Page)=>cacheSetting(page,'device',user.terminalId,'DEVICE',{name:user.terminalName,printerName:'Counter printer',paperWidth:58,printerType:'MOCK',printers:[systemPrinter],defaultPrinterId:'printer-1'});
const outboxCount=(page:Page)=>page.evaluate(()=>new Promise<number>(resolve=>{const request=indexedDB.open('food-vendor-os-pos',1);request.onsuccess=()=>{const db=request.result;const count=db.transaction('outbox').objectStore('outbox').count();count.onsuccess=()=>{resolve(count.result);db.close();};};}));
// Every frame, including the receipt print frame, gets a print() that closes at once.
const stubPrintDialog=(page:Page)=>page.addInitScript(()=>{window.print=()=>{setTimeout(()=>window.dispatchEvent(new Event('afterprint')),20);};});

test('with auto-print off the sale is saved and Print receipt is offered; reopened receipts offer Print again',async({page})=>{
 await pilot(page);await cacheSetting(page,'pos',user.businessId,'BUSINESS',{...pos,autoPrint:false});
 await page.goto('/pos/');
 await page.getByRole('button',{name:/Fried Pork/}).click();await page.getByRole('button',{name:/Complete sale/}).click();await page.getByRole('button',{name:/Payment received/}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog).toContainText('Automatic printing is disabled');
 await expect(dialog.getByRole('button',{name:'Print receipt'})).toBeEnabled();
 await expect(dialog.getByRole('button',{name:'Print again'})).toHaveCount(0);
 expect(await savedOrders(page)).toHaveLength(1);
 await page.getByRole('button',{name:'Done · New order'}).click();
 await page.getByRole('link',{name:'Sales',exact:true}).click();
 await page.getByRole('button',{name:'Receipt',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('button',{name:'Print again'})).toBeEnabled();
 expect(await savedOrders(page)).toHaveLength(1);
});

test('owner test print reports the result, asks for confirmation and changes no sales data',async({page})=>{
 await stubPrintDialog(page);await pilot(page);await devicePrinters(page);
 await page.goto('/devices/');
 const card=page.locator('.printer-profile',{hasText:'Counter printer'});
 await expect(card).toContainText('Connected');
 await expect(card).toContainText('Automatic setup');
 const before=await outboxCount(page);
 await card.getByRole('button',{name:'Test print'}).click();
 await expect(card).toContainText('Print dialog closed. The browser cannot confirm paper output');
 const question=card.getByRole('group',{name:'Did the test receipt print correctly?'});
 for(const answer of ['Printed correctly','Printed incorrectly','Nothing printed','Retry test'])await expect(question.getByRole('button',{name:answer})).toBeVisible();
 await question.getByRole('button',{name:'Printed correctly'}).click();
 await expect(card).toContainText('confirmed for receipts on this device');
 expect(await savedOrders(page)).toHaveLength(0);
 expect(await outboxCount(page)).toBe(before);
 const record=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),`maknam-printer-test:${user.businessId}:${user.terminalId}:printer-1`);
 expect(record).toMatchObject({businessId:user.businessId,deviceId:user.terminalId,printerId:'printer-1',result:'DIALOG_CLOSED',confirmation:'PRINTED_CORRECTLY'});
 expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('maknam-printer-test:')))).toHaveLength(1);
});

test('owner sees both setup modes and manual Bluetooth rejects unverified settings',async({page})=>{
 await pilot(page);
 await page.goto('/devices/');
 await expect(page.getByRole('button',{name:'Automatic detection (recommended)'})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByText('Bluetooth Classic (SPP), used by many generic 58 mm printers')).toBeVisible();
 await expect(page.getByRole('button',{name:'Use print dialog printer'})).toBeVisible();
 await page.getByRole('button',{name:'Manual configuration (advanced)'}).click();
 await page.getByLabel('Printer name').fill('Counter printer');
 await page.getByLabel('Printing method').selectOption('BLUETOOTH_PRINTER');
 await page.getByLabel('Service UUID').fill('not-a-uuid');
 await page.getByLabel('Write characteristic UUID').fill('also-wrong');
 await page.getByRole('button',{name:'Add printer'}).click();
 await expect(page.getByText(/Service UUID must be a 128-bit UUID/)).toBeVisible();
 await expect(page.getByText(/Enter the verified service and characteristic UUIDs/)).toBeVisible();
});

test('cashier can test an existing printer but cannot change printer setup',async({page})=>{
 await stubPrintDialog(page);await pilot(page,true);await devicePrinters(page);
 await page.goto('/devices/');
 const card=page.locator('.printer-profile',{hasText:'Counter printer'});
 await expect(card.getByRole('button',{name:'Test print'})).toBeVisible();
 await expect(card.getByRole('button',{name:'Remove'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Add a printer'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Manual configuration (advanced)'})).toHaveCount(0);
 await expect(page.getByText(/Auto-print after payment: (On|Off)/)).toBeVisible();
 await card.getByRole('button',{name:'Test print'}).click();
 await expect(card.getByRole('group',{name:'Did the test receipt print correctly?'})).toBeVisible();
 expect(await savedOrders(page)).toHaveLength(0);
});
