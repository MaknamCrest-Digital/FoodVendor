// Bluetooth Low Energy (GATT) ESC/POS printing through Web Bluetooth.
//
// Web Bluetooth cannot reach Bluetooth Classic (SPP) printers, can only open the GATT
// services listed when the printer is chosen, and may show its device chooser only in
// response to a tap. So the chooser is opened only by pair() from an explicit Connect
// button; checkout, reprint and test print reuse an already permitted printer and
// otherwise fail with a clear message, leaving the saved sale untouched.
import type {ReceiptDocument} from '../lib/receipt';
import {encodeReceipt,encodeTestPrint,type TestPrintDetails} from './escpos';
import {NOT_SET_UP,parseBluetoothConfig,printerWidth,type BluetoothPrinterConfig} from './printerConfig';
import type {PrintDestination,PrinterAdapter,PrinterStatus,PrintOutcome} from './printer';
import {VERIFIED_BLE_PRINTERS,type VerifiedBlePrinter} from './verifiedPrinters';

type GattCharacteristic={
  properties:{write:boolean;writeWithoutResponse:boolean};
  writeValueWithResponse?(data:Uint8Array):Promise<void>;
  writeValueWithoutResponse?(data:Uint8Array):Promise<void>;
  writeValue?(data:Uint8Array):Promise<void>;
};
type GattServer={
  connected:boolean;
  connect():Promise<GattServer>;
  getPrimaryService(uuid:string):Promise<{getCharacteristic(uuid:string):Promise<GattCharacteristic>}>;
};
export type BluetoothDeviceLike={id:string;name?:string;gatt?:GattServer};
export type WebBluetoothLike={
  requestDevice(options:{filters?:Array<{namePrefix:string}>;acceptAllDevices?:boolean;optionalServices:string[]}):Promise<BluetoothDeviceLike>;
  getDevices?():Promise<BluetoothDeviceLike[]>;
};
export type BluetoothEnvironment={bluetooth?:WebBluetoothLike;secureContext:boolean};

export type PrinterErrorCode='UNSUPPORTED'|'NOT_CONNECTED'|'PERMISSION_DENIED'|'CANCELLED'|'CONNECTION_FAILED'|'WRITE_FAILED'|'TIMEOUT';
export class PrinterError extends Error{
  constructor(message:string,readonly code:PrinterErrorCode){super(message);this.name='PrinterError';}
}

const STEP_TIMEOUT_MS=15000;

function browserEnvironment():BluetoothEnvironment{
  const navigatorWithBluetooth=typeof navigator==='undefined'?undefined:navigator as Navigator&{bluetooth?:WebBluetoothLike};
  return {bluetooth:navigatorWithBluetooth?.bluetooth,secureContext:typeof window!=='undefined'&&window.isSecureContext===true};
}

async function step<T>(work:Promise<T>,failure:string,timeoutMs:number):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new PrinterError(`${failure} The printer did not respond in time.`,'TIMEOUT')),timeoutMs);});
  try{return await Promise.race([work,timeout]);}finally{clearTimeout(timer);}
}

// Connections are kept per tenant, terminal and printer, so a session for another
// business in the same tab never reuses this printer connection.
const connectionKey=(destination:PrintDestination)=>`${destination.businessId}:${destination.deviceId}:${destination.id}`;

function chooserError(error:unknown):PrinterError{
  const name=error instanceof Error?error.name:'';
  if(name==='NotFoundError')return new PrinterError('No printer was selected.','CANCELLED');
  if(name==='SecurityError'||name==='NotAllowedError')return new PrinterError('Bluetooth permission was denied. Allow Bluetooth for this site and try again.','PERMISSION_DENIED');
  return new PrinterError('Could not open the Bluetooth printer chooser.','CONNECTION_FAILED');
}

export class BluetoothEscPosAdapter implements PrinterAdapter{
  readonly connectionTypes=['BLUETOOTH_PRINTER'] as PrinterAdapter['connectionTypes'];
  private readonly devices=new Map<string,BluetoothDeviceLike>();
  private queue:Promise<unknown>=Promise.resolve();

  constructor(private readonly environment:()=>BluetoothEnvironment=browserEnvironment,private readonly timeoutMs=STEP_TIMEOUT_MS){}

  private environmentReason():string|null{
    const {bluetooth,secureContext}=this.environment();
    if(!secureContext)return 'Bluetooth printing needs the secure (https) app address.';
    if(!bluetooth)return 'This browser cannot use Bluetooth printers. Use Chrome on Android, or the Android print dialog route.';
    return null;
  }

  unavailableReason(destination?:PrintDestination):string|null{
    const environment=this.environmentReason();
    if(environment)return environment;
    if(!destination)return null;
    const parsed=parseBluetoothConfig(destination.configuration);
    return parsed.ok?null:parsed.reason;
  }

  isAvailable(destination?:PrintDestination){return this.unavailableReason(destination)===null;}

  // Must be called from a user tap (Connect). Returns identifiers to store in the profile.
  async pair(destination:PrintDestination):Promise<{deviceId:string;deviceName:string}>{
    const config=this.config(destination);
    const bluetooth=this.environment().bluetooth!;
    let device:BluetoothDeviceLike;
    try{
      device=await bluetooth.requestDevice(config.namePrefix?{filters:[{namePrefix:config.namePrefix}],optionalServices:[config.serviceUuid]}:{acceptAllDevices:true,optionalServices:[config.serviceUuid]});
    }catch(error){throw chooserError(error);}
    await this.characteristic(device,config);  // proves the configured service and characteristic exist
    this.devices.set(connectionKey(destination),device);
    return {deviceId:device.id,deviceName:device.name||''};
  }

  isConnected(destination:PrintDestination){return Boolean(this.devices.get(connectionKey(destination))?.gatt?.connected);}

  status(destination:PrintDestination):PrinterStatus{
    const environment=this.environmentReason();
    if(environment)return {state:'UNSUPPORTED',detail:environment};
    const parsed=parseBluetoothConfig(destination.configuration);
    if(!parsed.ok)return {state:parsed.reason===NOT_SET_UP?'SETUP_REQUIRED':'UNSUPPORTED',detail:parsed.reason};
    return this.isConnected(destination)
      ?{state:'CONNECTED',detail:'Receipts are sent straight to this printer.'}
      :{state:'DISCONNECTED',detail:'Not connected in this session. It reconnects automatically where the browser allows; otherwise tap Connect.'};
  }

  // Automatic detection. Must be called from a user tap. Opens the chooser and checks the
  // chosen printer only against verified models; returns match=null when the printer's
  // print service is not known (Manual configuration or the print-dialog route is needed).
  async discover(registry:readonly VerifiedBlePrinter[]=VERIFIED_BLE_PRINTERS):Promise<{device:BluetoothDeviceLike;deviceName:string;match:VerifiedBlePrinter|null}>{
    const environment=this.environmentReason();
    if(environment)throw new PrinterError(environment,'UNSUPPORTED');
    const bluetooth=this.environment().bluetooth!;
    let device:BluetoothDeviceLike;
    try{device=await bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[...new Set(registry.map(entry=>entry.serviceUuid))]});}
    catch(error){throw chooserError(error);}
    const name=device.name||'';
    for(const entry of registry){
      if(entry.namePrefixes.length&&!entry.namePrefixes.some(prefix=>name.startsWith(prefix)))continue;
      try{
        await this.characteristic(device,{transport:'BLE_GATT',serviceUuid:entry.serviceUuid,characteristicUuid:entry.characteristicUuid,namePrefix:'',deviceId:device.id,chunkSize:20});
        return {device,deviceName:name,match:entry};
      }catch{/* not this model */}
    }
    return {device,deviceName:name,match:null};
  }

  remember(destination:PrintDestination,device:BluetoothDeviceLike){this.devices.set(connectionKey(destination),device);}

  // Silent reconnection to a printer this browser already permitted. Never prompts.
  async reconnect(destination:PrintDestination):Promise<boolean>{
    if(!this.isAvailable(destination))return false;
    if(this.isConnected(destination))return true;
    const config=this.config(destination);
    const device=this.devices.get(connectionKey(destination))??await this.permittedDevice(config);
    if(!device)return false;
    try{await this.characteristic(device,config);}catch{return false;}
    this.devices.set(connectionKey(destination),device);
    return true;
  }

  async print(document:ReceiptDocument,destination:PrintDestination):Promise<PrintOutcome>{
    return this.send(destination,()=>encodeReceipt(document,printerWidth(destination.paperProfile,destination.configuration)));
  }

  async printTest(destination:PrintDestination,details:TestPrintDetails):Promise<PrintOutcome>{
    return this.send(destination,()=>encodeTestPrint(details,printerWidth(destination.paperProfile,destination.configuration)));
  }

  private config(destination:PrintDestination):BluetoothPrinterConfig{
    const reason=this.unavailableReason(destination);
    if(reason)throw new PrinterError(reason,'UNSUPPORTED');
    const parsed=parseBluetoothConfig(destination.configuration);
    if(!parsed.ok)throw new PrinterError(parsed.reason,'UNSUPPORTED');
    return parsed.config;
  }

  // Jobs run one at a time so an automatic print and a reprint never interleave bytes.
  private send(destination:PrintDestination,encode:()=>Uint8Array):Promise<PrintOutcome>{
    const job=this.queue.then(()=>this.transmit(destination,encode()));
    this.queue=job.catch(()=>undefined);
    return job;
  }

  private async transmit(destination:PrintDestination,bytes:Uint8Array):Promise<PrintOutcome>{
    const config=this.config(destination);
    const device=this.devices.get(connectionKey(destination))??await this.permittedDevice(config);
    if(!device)throw new PrinterError(`${destination.name} is not connected. Open Devices & Printers and tap Connect.`,'NOT_CONNECTED');
    const characteristic=await this.characteristic(device,config);
    const write=characteristic.properties.write&&characteristic.writeValueWithResponse?characteristic.writeValueWithResponse.bind(characteristic)
      :characteristic.properties.writeWithoutResponse&&characteristic.writeValueWithoutResponse?characteristic.writeValueWithoutResponse.bind(characteristic)
      :(characteristic.properties.write||characteristic.properties.writeWithoutResponse)&&characteristic.writeValue?characteristic.writeValue.bind(characteristic)
      :null;
    if(!write)throw new PrinterError('The configured characteristic does not accept data. Re-check the UUIDs read from this printer.','WRITE_FAILED');
    for(let offset=0;offset<bytes.length;offset+=config.chunkSize){
      try{await step(write(bytes.slice(offset,offset+config.chunkSize)),'Sending to the printer failed.',this.timeoutMs);}
      catch(error){
        if(error instanceof PrinterError)throw error;
        throw new PrinterError('Sending to the printer failed. Check that it is on, has paper and is in range.','WRITE_FAILED');
      }
    }
    this.devices.set(connectionKey(destination),device);
    return 'SENT';
  }

  // A printer permitted earlier, without prompting (getDevices is not in every browser).
  private async permittedDevice(config:BluetoothPrinterConfig):Promise<BluetoothDeviceLike|undefined>{
    const bluetooth=this.environment().bluetooth;
    if(!config.deviceId||!bluetooth?.getDevices)return undefined;
    try{return (await bluetooth.getDevices()).find(device=>device.id===config.deviceId);}catch{return undefined;}
  }

  private async characteristic(device:BluetoothDeviceLike,config:BluetoothPrinterConfig):Promise<GattCharacteristic>{
    if(!device.gatt)throw new PrinterError('This Bluetooth device does not offer the services needed for printing.','CONNECTION_FAILED');
    const failure='Could not connect to the printer. Make sure it is on, in range and not connected to another phone.';
    try{
      const server=device.gatt.connected?device.gatt:await step(device.gatt.connect(),failure,this.timeoutMs);
      const service=await step(server.getPrimaryService(config.serviceUuid),failure,this.timeoutMs);
      return await step(service.getCharacteristic(config.characteristicUuid),failure,this.timeoutMs);
    }catch(error){
      if(error instanceof PrinterError)throw error;
      throw new PrinterError(`${failure} If it connects but cannot be found, re-check the service and characteristic UUIDs.`,'CONNECTION_FAILED');
    }
  }
}
