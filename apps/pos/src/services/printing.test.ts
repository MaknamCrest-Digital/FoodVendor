import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {getDatabase} from '../lib/db';
import {toReceiptDocument,type ReceiptDocument} from '../lib/receipt';
import type {PrinterProfile} from '../lib/settings';
import type {LocalOrder} from '../types/domain';
import {BluetoothEscPosAdapter,PrinterError,type BluetoothDeviceLike,type WebBluetoothLike} from './bluetoothPrinter';
import {columns,decodePrintable,encodeReceipt,encodeTestPrint,printerMoney,printerText,wrap,type TestPrintDetails} from './escpos';
import {CLASSIC_UNSUPPORTED,NOT_SET_UP,configurationErrors,manualSetupErrors,normalizeUuid,parseBluetoothConfig,printerWidth} from './printerConfig';
import {DefaultPrintService,type PrintDestination,type PrinterAdapter,type PrintOutcome} from './printer';
import {describeTestRecord,readTestRecord,saveTestRecord} from './printerTests';
import type {VerifiedBlePrinter} from './verifiedPrinters';

// Placeholder UUIDs for tests only; real values are read from the printer.
const SERVICE='12345678-1234-1234-1234-123456789abc';
const CHARACTERISTIC='87654321-4321-4321-4321-cba987654321';
const ESC=0x1b;

function order(overrides:Partial<LocalOrder>={}):LocalOrder{
  return {
    id:'order-0001-aaaa',receiptNo:'AD-01-0001',businessId:'b',locationId:'l',terminalId:'t',totalPesewas:10500,paymentMethod:'CASH',
    occurredAt:'2026-10-29T12:30:00Z',cashierName:'Ama Mensah',currency:'GHS',amountTendered:12000,change:1500,paymentReference:'',syncStatus:'PENDING',
    items:[
      {id:'i1',menuItemId:'pork',name:'Pork + Yam with extra pepper sauce and kelewele',variationName:'Large',quantity:1,unitPricePesewas:9000},
      {id:'i2',menuItemId:'coke',name:'Coke',quantity:1,unitPricePesewas:1500},
    ],
    receiptSnapshot:{
      general:{businessName:'Adonai Pork',businessType:'',email:'',phone:'024 000 0000',address:'Dansoman, Accra',logo:'',currency:'GHS',timezone:'Africa/Accra',dateFormat:'DD/MM/YYYY',timeFormat:'24h'},
      location:{name:'Dansoman',address:'Dansoman Market Road',phone:''},
      receipts:{showLogo:false,showBusinessName:true,showAddress:true,showPhone:true,showCashier:true,showPaymentMethod:true,showOrderNumber:true,showReceiptNumber:true,paperWidth:58,collectionMessage:'',footer:'Thank you — come again!'},
      terminalName:'AD-01',paperProfile:'THERMAL_58',
    },
    ...overrides,
  } as LocalOrder;
}

function profile(overrides:Partial<PrinterProfile>={}):PrintDestination{
  return {id:'p1',businessId:'b',locationId:'l',deviceId:'t',name:'Counter printer',printerType:'THERMAL',connectionType:'BLUETOOTH_PRINTER',paperProfile:'THERMAL_58',status:'CONFIGURED',isDefault:true,capabilities:[],
    configuration:{transport:'BLE_GATT',serviceUuid:SERVICE,characteristicUuid:CHARACTERISTIC},...overrides};
}

const printable=(bytes:Uint8Array)=>decodePrintable(bytes);
const testDetails:TestPrintDetails={printerName:'Counter printer',vendorName:'Adonai Pork',dateTime:'2026-10-29T12:30:00Z',timezone:'Africa/Accra',dateFormat:'DD/MM/YYYY',timeFormat:'24h'};

describe('ESC/POS receipt encoding',()=>{
  it('encodes a complete 58 mm receipt within 32 characters per line',()=>{
    const bytes=encodeReceipt(toReceiptDocument(order()),32);
    assert.deepEqual([...bytes.slice(0,2)],[ESC,0x40]);
    assert.deepEqual([...bytes.slice(-3)],[ESC,0x64,4]);
    const lines=printable(bytes);
    for(const line of lines)assert.ok(line.length<=32,`"${line}" is ${line.length} wide`);
    const text=lines.join('\n');
    for(const expected of ['Adonai Pork','Receipt: AD-01-0001','Cashier: Ama Mensah','Terminal: AD-01','(Large)','GHS 90.00','GHS 105.00','TOTAL','CASH','Tendered','GHS 120.00','GHS 15.00','come again!'])
      assert.ok(text.includes(expected),`missing ${expected}`);
    assert.match(text,/29\/10\/2026 12:30:00/);
  });

  it('uses 48 characters on 80 mm and keeps every byte printable ASCII or a command',()=>{
    const bytes=encodeReceipt(toReceiptDocument(order()),48);
    assert.ok(printable(bytes).every(line=>line.length<=48));
    assert.ok(printable(bytes).some(line=>line.length>32));
    assert.ok(printable(bytes).every(line=>/^[\x20-\x7e]*$/.test(line)));
  });

  it('formats cedis and symbols for the printer character set',()=>{
    assert.equal(printerMoney(1250,'GHS'),'GHS 12.50');
    assert.equal(printerMoney(-500,'GHS'),'GHS -5.00');
    assert.equal(printerText('2 × Café — GH₵ 5'),'2 x Cafe - GHC 5');
    assert.equal(printerText('Jollof 🍚'),'Jollof ??');
  });

  it('strips control characters so item names cannot inject printer commands',()=>{
    const clean=encodeReceipt(toReceiptDocument(order()),32);
    const hostile=encodeReceipt(toReceiptDocument(order({items:[{id:'x',menuItemId:'x',name:'Pork\x1b@\x1dV\x01 cut',quantity:1,unitPricePesewas:10500}]})),32);
    const escCount=(bytes:Uint8Array)=>[...bytes].filter(byte=>byte===ESC).length;
    assert.equal(escCount(hostile),escCount(clean));
    assert.ok(![...hostile].includes(0x1d));
  });

  it('wraps long words and moves amounts that do not fit to their own line',()=>{
    assert.deepEqual(wrap('Supercalifragilistic pork',10),['Supercalif','ragilistic','pork']);
    assert.deepEqual(columns('Total','GHS 9.00',20),['Total       GHS 9.00']);
    assert.deepEqual(columns('A very long item name here','GHS 9.00',12),['A very long','item name','here','    GHS 9.00']);
  });

  it('builds a sample test receipt that cannot be mistaken for a sale',()=>{
    for(const width of [32,48]){
      const lines=printable(encodeTestPrint(testDetails,width));
      const text=lines.join(' ');  // wrapped phrases span lines on 32-character paper
      for(const expected of ['MAKNAM POS','Adonai Pork','TEST PRINT - NOT A SALE','No payment, stock or receipt number','Printer: Counter printer','Sample item (test only)','SAMPLE TOTAL','ABC abc 0123456789','Centre','*** END OF TEST ***'])
        assert.ok(text.includes(expected),`missing ${expected}`);
      assert.ok(lines.includes(Array.from({length:width},(_,index)=>String((index+1)%10)).join('')),'width ruler');
      assert.ok(lines.some(line=>line.startsWith('Left')&&line.endsWith('Right')&&line.length===width),'alignment row');
      assert.ok(lines.every(line=>line.length<=width));
      assert.ok(lines.some(line=>/29\/10\/2026 12:30:00/.test(line)));
      assert.ok(!lines.some(line=>/^Receipt:|^Order:|^TOTAL /.test(line)),'no sale fields');
    }
  });
});

describe('printer configuration',()=>{
  it('accepts 128-bit UUIDs and expands only standard assigned numbers',()=>{
    assert.equal(normalizeUuid(SERVICE.toUpperCase()),SERVICE);
    assert.equal(normalizeUuid('0xFFE0'),'0000ffe0-0000-1000-8000-00805f9b34fb');
    assert.equal(normalizeUuid('0000ffe0'),'0000ffe0-0000-1000-8000-00805f9b34fb');
    for(const bad of ['','ffe','printer','12345678-1234-1234-1234-12345678',42])assert.equal(normalizeUuid(bad),null);
  });

  it('keeps Bluetooth unavailable until verified UUIDs are configured',()=>{
    assert.deepEqual(parseBluetoothConfig({}),{ok:false,reason:NOT_SET_UP});
    assert.deepEqual(parseBluetoothConfig({transport:'BLE_GATT',serviceUuid:SERVICE}),{ok:false,reason:NOT_SET_UP});
    assert.deepEqual(parseBluetoothConfig({transport:'CLASSIC_SPP'}),{ok:false,reason:CLASSIC_UNSUPPORTED});
    const parsed=parseBluetoothConfig({transport:'BLE_GATT',serviceUuid:SERVICE,characteristicUuid:CHARACTERISTIC});
    assert.ok(parsed.ok&&parsed.config.chunkSize===20&&parsed.config.characteristicUuid===CHARACTERISTIC);
    assert.equal(parseBluetoothConfig({transport:'BLE_GATT',serviceUuid:SERVICE,characteristicUuid:CHARACTERISTIC,chunkSize:'5'}).ok,false);
  });

  it('validates entered values before a profile is saved',()=>{
    assert.deepEqual(configurationErrors('BLUETOOTH_PRINTER','THERMAL_58',{transport:'BLE_GATT'}),[]);
    assert.equal(configurationErrors('BLUETOOTH_PRINTER','THERMAL_58',{transport:'BLE_GATT',serviceUuid:'not-a-uuid'}).length,1);
    assert.equal(configurationErrors('BLUETOOTH_PRINTER','A4',{transport:'BLE_GATT'}).length,1);
    assert.equal(configurationErrors('SYSTEM_PRINTER','THERMAL_58',{charsPerLine:'99'}).length,1);
    assert.equal(configurationErrors('BLUETOOTH_PRINTER','THERMAL_58',{transport:'BLE_GATT',chunkSize:'2000'}).length,1);
  });

  it('derives the line width from paper with an optional override',()=>{
    assert.equal(printerWidth('THERMAL_58',{}),32);
    assert.equal(printerWidth('THERMAL_80',{}),48);
    assert.equal(printerWidth('THERMAL_58',{charsPerLine:'30'}),30);
    assert.equal(printerWidth('THERMAL_58',{charsPerLine:'7'}),32);
  });
});

type FakeOptions={write?:boolean;withoutResponse?:boolean;writeFails?:boolean;hang?:boolean;requestError?:string;getDevices?:boolean};
function fakeBluetooth(options:FakeOptions={}){
  const written:number[][]=[];const requests:unknown[]=[];
  let connects=0;
  const characteristic={
    properties:{write:options.write??true,writeWithoutResponse:options.withoutResponse??false},
    writeValueWithResponse:async(data:Uint8Array)=>{if(options.hang)await new Promise(()=>undefined);if(options.writeFails)throw new Error('GATT write failed');written.push([...data]);},
    writeValueWithoutResponse:async(data:Uint8Array)=>{written.push([...data]);},
  };
  const server={connected:false,connect:async()=>{connects++;server.connected=true;return server;},getPrimaryService:async(uuid:string)=>{
    if(uuid!==SERVICE)throw new Error('No such service');
    return {getCharacteristic:async(id:string)=>{if(id!==CHARACTERISTIC)throw new Error('No such characteristic');return characteristic;}};
  }};
  const device:BluetoothDeviceLike={id:'device-1',name:'BlueTooth Printer',gatt:server};
  const bluetooth:WebBluetoothLike={
    requestDevice:async(request)=>{requests.push(request);if(options.requestError)throw Object.assign(new Error('denied'),{name:options.requestError});return device;},
    getDevices:options.getDevices?async()=>[device]:undefined,
  };
  return {bluetooth,written,requests,connects:()=>connects};
}
const adapterWith=(fake:ReturnType<typeof fakeBluetooth>|null,secure=true,timeoutMs=1000)=>new BluetoothEscPosAdapter(()=>({bluetooth:fake?.bluetooth,secureContext:secure}),timeoutMs);

describe('Bluetooth ESC/POS adapter',()=>{
  it('reports unsupported browsers, insecure pages and Classic SPP printers without prompting',async()=>{
    assert.match(adapterWith(null).unavailableReason(profile())!,/cannot use Bluetooth printers/);
    assert.match(adapterWith(fakeBluetooth(),false).unavailableReason(profile())!,/https/);
    const fake=fakeBluetooth();
    const adapter=adapterWith(fake);
    assert.equal(adapter.unavailableReason(profile({configuration:{transport:'CLASSIC_SPP'}})),CLASSIC_UNSUPPORTED);
    await assert.rejects(adapter.print(toReceiptDocument(order()),profile({configuration:{transport:'CLASSIC_SPP'}})),(error:unknown)=>error instanceof PrinterError&&error.code==='UNSUPPORTED');
    assert.equal(fake.requests.length,0);
  });

  it('pairs only on request, then sends the encoded receipt in 20-byte chunks',async()=>{
    const fake=fakeBluetooth();const adapter=adapterWith(fake);
    const destination=profile({configuration:{transport:'BLE_GATT',serviceUuid:SERVICE,characteristicUuid:CHARACTERISTIC,namePrefix:'BlueTooth'}});
    assert.deepEqual(await adapter.pair(destination),{deviceId:'device-1',deviceName:'BlueTooth Printer'});
    assert.deepEqual(fake.requests,[{filters:[{namePrefix:'BlueTooth'}],optionalServices:[SERVICE]}]);
    const document=toReceiptDocument(order());
    assert.equal(await adapter.print(document,destination),'SENT');
    assert.ok(fake.written.every(chunk=>chunk.length<=20));
    assert.deepEqual(fake.written.flat(),[...encodeReceipt(document,32)]);
    await adapter.print(document,destination);
    assert.equal(fake.requests.length,1,'printing never opens the chooser again');
  });

  it('reuses a printer the browser already permitted, without prompting',async()=>{
    const fake=fakeBluetooth({getDevices:true});const adapter=adapterWith(fake);
    const destination=profile({configuration:{transport:'BLE_GATT',serviceUuid:SERVICE,characteristicUuid:CHARACTERISTIC,deviceId:'device-1'}});
    assert.equal(await adapter.print(toReceiptDocument(order()),destination),'SENT');
    assert.equal(fake.requests.length,0);
  });

  it('fails clearly when not connected, denied, cancelled, unwritable, failing or silent',async()=>{
    const document=toReceiptDocument(order());
    const code=async(work:Promise<unknown>)=>{try{await work;return 'ok';}catch(error){return error instanceof PrinterError?error.code:String(error);}};
    const idle=fakeBluetooth();
    assert.equal(await code(adapterWith(idle).print(document,profile())),'NOT_CONNECTED');
    assert.equal(idle.requests.length,0);
    assert.equal(await code(adapterWith(fakeBluetooth({requestError:'NotAllowedError'})).pair(profile())),'PERMISSION_DENIED');
    assert.equal(await code(adapterWith(fakeBluetooth({requestError:'NotFoundError'})).pair(profile())),'CANCELLED');
    const readOnly=adapterWith(fakeBluetooth({write:false,withoutResponse:false}));await readOnly.pair(profile());
    assert.equal(await code(readOnly.print(document,profile())),'WRITE_FAILED');
    const failing=adapterWith(fakeBluetooth({writeFails:true}));await failing.pair(profile());
    assert.equal(await code(failing.print(document,profile())),'WRITE_FAILED');
    const silent=adapterWith(fakeBluetooth({hang:true}),true,20);await silent.pair(profile());
    assert.equal(await code(silent.print(document,profile())),'TIMEOUT');
    const wrongService=adapterWith(fakeBluetooth());
    assert.equal(await code(wrongService.pair(profile({configuration:{transport:'BLE_GATT',serviceUuid:'0xffe0',characteristicUuid:CHARACTERISTIC}}))),'CONNECTION_FAILED');
  });

  it('never interleaves two print jobs',async()=>{
    const fake=fakeBluetooth();const adapter=adapterWith(fake);await adapter.pair(profile());
    const first=toReceiptDocument(order());const second=toReceiptDocument(order({receiptNo:'AD-01-0002'}));
    await Promise.all([adapter.print(first,profile()),adapter.print(second,profile())]);
    assert.deepEqual(fake.written.flat(),[...encodeReceipt(first,32),...encodeReceipt(second,32)]);
  });
});

class RecordingAdapter implements PrinterAdapter{
  documents:ReceiptDocument[]=[];destinations:PrintDestination[]=[];
  constructor(readonly connectionTypes:PrinterAdapter['connectionTypes'],private readonly outcome:PrintOutcome|Error,private readonly available=true){}
  isAvailable(){return this.available;}
  async print(document:ReceiptDocument,destination:PrintDestination){
    this.documents.push(document);this.destinations.push(destination);
    if(this.outcome instanceof Error)throw this.outcome;
    return this.outcome;
  }
}

describe('print service fallback and side effects',()=>{
  it('falls back to browser printing when the configured printer fails, without a new sale',async()=>{
    const bluetooth=new RecordingAdapter(['BLUETOOTH_PRINTER'],new Error('Printer is out of paper.'));
    const browser=new RecordingAdapter(['BROWSER_PRINT','SYSTEM_PRINTER'],'DIALOG_CLOSED');
    const service=new DefaultPrintService([browser,bluetooth]);
    const sale=order();
    const result=await service.reprint(sale,profile());
    assert.equal(result.usedFallback,true);
    assert.equal(result.failure,'Printer is out of paper.');
    assert.equal(result.outcome,'DIALOG_CLOSED');
    assert.equal(browser.destinations[0].connectionType,'BROWSER_PRINT');
    assert.equal(browser.documents[0].receiptNumber,sale.receiptNo);
  });

  it('uses the fallback directly for unavailable destinations and reports why',async()=>{
    const browser=new RecordingAdapter(['BROWSER_PRINT','SYSTEM_PRINTER'],'DIALOG_CLOSED');
    const service=new DefaultPrintService([browser,new RecordingAdapter(['BLUETOOTH_PRINTER'],'SENT',false)]);
    assert.match(service.unavailableReason(profile({connectionType:'USB_PRINTER'}))!,/No print adapter is available for usb printer/);
    const result=await service.reprint(order(),profile());
    assert.equal(result.usedFallback,true);
    assert.match(result.failure!,/not available on this device/);
    await assert.rejects(service.printReceipt(order(),profile()),/not available on this device/);
  });

});

class TestPageAdapter extends RecordingAdapter{
  tests:TestPrintDetails[]=[];
  async printTest(_destination:PrintDestination,details:TestPrintDetails){this.tests.push(details);return 'DIALOG_CLOSED' as const;}
}

describe('test print',()=>{
  it('reports dialog closed, bytes sent, unsupported and connection/write failures without throwing',async()=>{
    const browser=new TestPageAdapter(['BROWSER_PRINT','SYSTEM_PRINTER'],'DIALOG_CLOSED');
    const connected=fakeBluetooth();const ble=adapterWith(connected);await ble.pair(profile());
    const service=new DefaultPrintService([browser,ble]);
    assert.equal((await service.testPrint(profile({connectionType:'SYSTEM_PRINTER',configuration:{}}),testDetails)).status,'DIALOG_CLOSED');
    assert.deepEqual(browser.tests,[testDetails]);
    const sent=await service.testPrint(profile(),testDetails);
    assert.equal(sent.status,'SENT');
    assert.ok(decodePrintable(Uint8Array.from(connected.written.flat())).includes('*** END OF TEST ***'));
    assert.equal((await service.testPrint(profile({configuration:{transport:'CLASSIC_SPP'}}),testDetails)).status,'UNSUPPORTED');
    assert.equal((await service.testPrint(profile({configuration:{}}),testDetails)).status,'UNSUPPORTED');
    assert.equal((await service.testPrint(profile({connectionType:'USB_PRINTER'}),testDetails)).status,'UNSUPPORTED');
    const idle=fakeBluetooth();
    const notConnected=await new DefaultPrintService([browser,adapterWith(idle)]).testPrint(profile(),testDetails);
    assert.deepEqual([notConnected.status,/tap Connect/.test(notConnected.message)],['FAILED',true]);
    assert.equal(idle.requests.length,0,'test print never opens the Bluetooth chooser');
    const failing=adapterWith(fakeBluetooth({writeFails:true}));await failing.pair(profile());
    assert.equal((await new DefaultPrintService([browser,failing]).testPrint(profile(),testDetails)).status,'FAILED');
  });

  it('cannot create a sale, use a receipt number, move stock, change a shift or add outbox events',async()=>{
    const db=await getDatabase();
    await db.clear('orders');await db.clear('outbox');
    const sale=order();
    const stored=(value:unknown)=>value as Parameters<typeof db.put>[1];
    await db.put('orders',stored(sale));
    const operation=(kind:string,entityId:string,data:Record<string,unknown>)=>stored({eventId:`${kind}-${entityId}`,orderId:`${kind}-${entityId}`,createdAt:'2026-10-29T12:00:00Z',attempts:0,recordType:'operation',synced:false,
      operation:{id:`${kind}-${entityId}`,businessId:'b',locationId:'l',actorId:'u',entityId,kind,action:'CREATED',baseVersion:0,occurredAt:'2026-10-29T12:00:00Z',data}});
    await db.put('outbox',stored({eventId:'sale-event',orderId:sale.id,attempts:0,createdAt:'2026-10-29T12:30:00Z'}));
    await db.put('outbox',operation('shift','shift-1',{operatorId:'u',status:'OPEN',openingCash:10000}));
    await db.put('outbox',operation('stock','coke-open',{menuItemId:'coke',type:'OPENING_STOCK',quantityDelta:24,balanceBefore:0,balanceAfter:24}));
    await db.put('outbox',stored({eventId:'setting:b:device:t',recordType:'settings-cache',setting:{section:'device'}}));
    const snapshot=async()=>JSON.stringify([await db.getAll('orders'),await db.getAll('outbox')]);
    const before=await snapshot();

    const browser=new TestPageAdapter(['BROWSER_PRINT','SYSTEM_PRINTER'],'DIALOG_CLOSED');
    const ble=adapterWith(fakeBluetooth());await ble.pair(profile());
    const service=new DefaultPrintService([browser,ble]);
    for(const destination of [profile({connectionType:'SYSTEM_PRINTER',configuration:{}}),profile(),profile({configuration:{}}),profile({id:'p2'}),profile({connectionType:'USB_PRINTER'})])
      await service.testPrint(destination,testDetails);

    assert.equal(await snapshot(),before,'orders and outbox (sales, receipt numbers, stock, shifts, audit) are unchanged');
    assert.deepEqual((await db.getAll<LocalOrder>('orders')).map(saved=>saved.receiptNo),[sale.receiptNo]);
  });
});

describe('device-local test results',()=>{
  const memory=()=>{const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},values};};

  const counter={id:'p1',businessId:'b',deviceId:'t'};
  it('keeps transport success separate from the person confirming paper output',()=>{
    const storage=memory();
    const record={businessId:'b',deviceId:'t',printerId:'p1',printerName:'Counter printer',result:'SENT' as const,confirmation:null,testedAt:'2026-10-29T12:30:00Z'};
    saveTestRecord(record,storage);
    assert.match(describeTestRecord(readTestRecord(counter,storage)!),/data sent to printer · paper not confirmed/);
    saveTestRecord({...record,confirmation:'NOTHING_PRINTED'},storage);
    assert.match(describeTestRecord(readTestRecord(counter,storage)!),/data sent to printer · reported nothing printed/);
    saveTestRecord({...record,result:'DIALOG_CLOSED',confirmation:'PRINTED_CORRECTLY'},storage);
    assert.match(describeTestRecord(readTestRecord(counter,storage)!),/print dialog closed · confirmed printed correctly/);
    assert.deepEqual([...storage.values.keys()],['maknam-printer-test:b:t:p1']);
    assert.equal(readTestRecord({...counter,id:'other'},storage),null);
  });

  it('never shows another tenant or terminal the test result for the same printer id',()=>{
    const storage=memory();
    saveTestRecord({businessId:'b',deviceId:'t',printerId:'p1',printerName:'Counter printer',result:'SENT',confirmation:'PRINTED_CORRECTLY',testedAt:'2026-10-29T12:30:00Z'},storage);
    assert.equal(readTestRecord({...counter,businessId:'other-business'},storage),null);
    assert.equal(readTestRecord({...counter,deviceId:'other-terminal'},storage),null);
    // A record copied under another tenant's key is still rejected by its contents.
    storage.setItem('maknam-printer-test:other-business:t:p1',storage.getItem('maknam-printer-test:b:t:p1')!);
    assert.equal(readTestRecord({...counter,businessId:'other-business'},storage),null);
    assert.equal(readTestRecord(counter,storage)?.confirmation,'PRINTED_CORRECTLY');
  });

  it('does not fail when device storage is blocked',()=>{
    const blocked={getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}};
    assert.doesNotThrow(()=>saveTestRecord({businessId:'b',deviceId:'t',printerId:'p1',printerName:'x',result:'FAILED',confirmation:null,testedAt:'2026-10-29T12:30:00Z'},blocked));
    assert.equal(readTestRecord({id:'p1',businessId:'b',deviceId:'t'},blocked),null);
  });
});

describe('printer setup modes and status',()=>{
  const verified:VerifiedBlePrinter[]=[{model:'Test model (fixture only)',namePrefixes:['BlueTooth'],serviceUuid:SERVICE,characteristicUuid:CHARACTERISTIC,verifiedOn:'unit test'}];

  it('automatic detection opens the chooser once and configures only verified models',async()=>{
    const fake=fakeBluetooth();const adapter=adapterWith(fake);
    const unknown=await adapter.discover([]);
    assert.deepEqual([unknown.deviceName,unknown.match],['BlueTooth Printer',null]);
    assert.deepEqual(fake.requests,[{acceptAllDevices:true,optionalServices:[]}]);
    const found=await adapter.discover(verified);
    assert.equal(found.match?.model,'Test model (fixture only)');
    assert.deepEqual(fake.requests[1],{acceptAllDevices:true,optionalServices:[SERVICE]});
    const otherName=await adapter.discover([{...verified[0],namePrefixes:['Other']}]);
    assert.equal(otherName.match,null,'name prefixes must match');
    const destination=profile({configuration:{setupMode:'AUTOMATIC',transport:'BLE_GATT',serviceUuid:SERVICE,characteristicUuid:CHARACTERISTIC,deviceId:found.device.id}});
    adapter.remember(destination,found.device);
    assert.equal(adapter.status(destination).state,'CONNECTED');
    await assert.rejects(adapterWith(null).discover(verified),(error:unknown)=>error instanceof PrinterError&&error.code==='UNSUPPORTED');
  });

  it('keeps Bluetooth connections per tenant and terminal',async()=>{
    const fake=fakeBluetooth();const adapter=adapterWith(fake);
    await adapter.pair(profile());
    assert.equal(adapter.status(profile()).state,'CONNECTED');
    assert.equal(adapter.isConnected(profile({businessId:'other-business'})),false,'same printer id in another business');
    assert.equal(adapter.isConnected(profile({deviceId:'other-terminal'})),false,'same printer id on another terminal');
    await assert.rejects(adapter.print(toReceiptDocument(order()),profile({businessId:'other-business'})),(error:unknown)=>error instanceof PrinterError&&error.code==='NOT_CONNECTED');
    assert.equal(fake.requests.length,1,'no chooser for the other tenant');
  });

  it('reports Connected, Disconnected, Unsupported and Setup required',async()=>{
    const fake=fakeBluetooth();const adapter=adapterWith(fake);
    assert.equal(adapterWith(null).status(profile()).state,'UNSUPPORTED');
    assert.equal(adapter.status(profile({configuration:{transport:'CLASSIC_SPP'}})).state,'UNSUPPORTED');
    assert.equal(adapter.status(profile({configuration:{transport:'BLE_GATT'}})).state,'SETUP_REQUIRED');
    assert.equal(adapter.status(profile()).state,'DISCONNECTED');
    await adapter.pair(profile());
    assert.equal(adapter.status(profile()).state,'CONNECTED');
    const service=new DefaultPrintService([new RecordingAdapter(['BROWSER_PRINT','SYSTEM_PRINTER'],'DIALOG_CLOSED'),adapter]);
    assert.equal(service.status(profile({connectionType:'SYSTEM_PRINTER',configuration:{}})).state,'CONNECTED');
    assert.equal(service.status(profile({connectionType:'NETWORK_PRINTER'})).state,'UNSUPPORTED');
    assert.equal(service.status(profile()).state,'CONNECTED');
  });

  it('reconnects silently only to a printer the browser already permitted',async()=>{
    const remembered=fakeBluetooth({getDevices:true});
    const destination=profile({configuration:{transport:'BLE_GATT',serviceUuid:SERVICE,characteristicUuid:CHARACTERISTIC,deviceId:'device-1'}});
    const adapter=adapterWith(remembered);
    assert.equal(await adapter.reconnect(destination),true);
    assert.equal(adapter.status(destination).state,'CONNECTED');
    assert.equal(remembered.requests.length,0);
    const unremembered=fakeBluetooth();
    assert.equal(await adapterWith(unremembered).reconnect(destination),false);
    assert.equal(unremembered.requests.length,0);
    assert.equal(await adapterWith(fakeBluetooth({getDevices:true})).reconnect(profile({configuration:{}})),false);
  });

  it('manual configuration enables direct Bluetooth only with verified BLE settings',()=>{
    assert.deepEqual(manualSetupErrors('SYSTEM_PRINTER','THERMAL_58',{setupMode:'MANUAL'}),[]);
    assert.deepEqual(manualSetupErrors('BLUETOOTH_PRINTER','THERMAL_58',{setupMode:'MANUAL',transport:'BLE_GATT',serviceUuid:SERVICE,characteristicUuid:CHARACTERISTIC}),[]);
    assert.match(manualSetupErrors('BLUETOOTH_PRINTER','THERMAL_58',{transport:'BLE_GATT',serviceUuid:SERVICE}).join(' '),/verified service and characteristic/);
    assert.match(manualSetupErrors('BLUETOOTH_PRINTER','THERMAL_58',{transport:'CLASSIC_SPP'}).join(' '),/Low Energy printers only/);
    assert.equal(manualSetupErrors('BLUETOOTH_PRINTER','A4',{transport:'BLE_GATT',serviceUuid:SERVICE,characteristicUuid:CHARACTERISTIC}).length,1);
  });
});
