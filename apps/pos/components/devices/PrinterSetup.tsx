"use client";
import {useState,type FormEvent} from 'react';
import {Check,Info,X} from 'lucide-react';
import {Button} from '../ui/primitives';
import {bluetoothPrinter,printer} from '../../src/services/printer';
import {manualSetupErrors,type PrinterConfiguration} from '../../src/services/printerConfig';
import type {AdminUser} from '../../src/lib/auth';
import type {PaperProfile,PrinterConnection,PrinterProfile} from '../../src/lib/settings';

export type SetupMode='AUTOMATIC'|'MANUAL';
export type AddPrinter=(profile:PrinterProfile,message:string)=>Promise<void>;
type Props={user:AdminUser;busy:boolean;onAdd:AddPrinter};

export function draftPrinter(user:AdminUser,name:string,connectionType:PrinterConnection,paperProfile:PaperProfile,configuration:PrinterConfiguration):PrinterProfile{
 return {id:crypto.randomUUID(),businessId:user.businessId,locationId:user.locationId,deviceId:user.terminalId,name,
  printerType:paperProfile==='A4'||paperProfile==='LETTER'?'OFFICE':'THERMAL',connectionType,paperProfile,status:'CONFIGURED',isDefault:false,capabilities:[],configuration};
}

const thermalPapers:Array<{value:PaperProfile;label:string}>=[{value:'THERMAL_58',label:'Thermal · 58 mm'},{value:'THERMAL_80',label:'Thermal · 80 mm'}];

// What this browser and device can print through. Shown to everyone on Devices & Printers.
export function DeviceCapabilities(){
 const bluetoothReason=bluetoothPrinter.unavailableReason();
 const printDialog=printer.detectCapabilities().capabilities.includes('SYSTEM_PRINTER');
 const rows:Array<{ok:boolean|null;title:string;state:string;detail:string}>=[
  {ok:printDialog,title:'Device print dialog',state:printDialog?'Available':'Unsupported',detail:printDialog?'On Android, a Bluetooth printer appears there only through an Android print service app for that printer.':'This browser cannot open a print dialog.'},
  {ok:!bluetoothReason,title:'Direct Bluetooth Low Energy',state:bluetoothReason?'Unsupported':'Available',detail:bluetoothReason||'For printer models verified on real hardware.'},
  {ok:null,title:'Bluetooth Classic (SPP), used by many generic 58 mm printers',state:'Not reachable from a browser',detail:'Use the print dialog route with a print service app, or a future native app.'},
 ];
 return <ul className="capability-list">{rows.map(row=><li key={row.title}>
  <span className={`capability-icon ${row.ok===true?'is-ok':row.ok===false?'is-off':'is-info'}`} aria-hidden="true">{row.ok===true?<Check size={14}/>:row.ok===false?<X size={14}/>:<Info size={14}/>}</span>
  <span><strong>{row.title}</strong><small><b>{row.state}.</b> {row.detail}</small></span>
 </li>)}</ul>;
}

// Automatic detection: shows what this device supports and opens the Bluetooth chooser
// only when Find Bluetooth printer is tapped. Configures direct printing only for printer
// models verified on real hardware (verifiedPrinters.ts); never guesses a print service.
export function AutomaticSetup({user,busy,onAdd}:Props){
 const [paper,setPaper]=useState<PaperProfile>('THERMAL_58');
 const [message,setMessage]=useState('');
 const [searching,setSearching]=useState(false);
 const bluetoothReason=bluetoothPrinter.unavailableReason();
 const printDialog=printer.detectCapabilities().capabilities.includes('SYSTEM_PRINTER');

 async function findBluetooth(){
  if(searching||busy)return;
  setSearching(true);setMessage('');
  try{
   const found=await bluetoothPrinter.discover();
   if(!found.match){
    setMessage(`Found "${found.deviceName||'a Bluetooth device'}", but its print service has not been verified for direct printing. An owner or technician can verify it (PRINTING.md) and use Manual configuration, or use the print dialog route below.`);
    return;
   }
   const profile=draftPrinter(user,found.deviceName||found.match.model,'BLUETOOTH_PRINTER',paper,{setupMode:'AUTOMATIC',transport:'BLE_GATT',serviceUuid:found.match.serviceUuid,characteristicUuid:found.match.characteristicUuid,deviceId:found.device.id,deviceName:found.deviceName,model:found.match.model});
   bluetoothPrinter.remember(profile,found.device);
   await onAdd(profile,`Found and connected ${profile.name} (${found.match.model}). Use Test print to check the output.`);
  }catch(error){setMessage(error instanceof Error?error.message:'Could not search for Bluetooth printers.');}
  finally{setSearching(false);}
 }

 async function addPrintDialogPrinter(){
  await onAdd(draftPrinter(user,'Print dialog printer','SYSTEM_PRINTER',paper,{setupMode:'AUTOMATIC'}),'Print dialog printer added. Receipts open the device print dialog.');
 }

 return <div className="owner-form setup-panel">
  <p className="settings-group-hint">Find a Bluetooth Low Energy printer, or use the printer chosen in this device&apos;s print dialog. Direct Bluetooth is set up only for printer models verified on real hardware.</p>
  <label>Paper width<select value={paper} onChange={event=>setPaper(event.target.value as PaperProfile)}>{thermalPapers.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
  <div className="printer-profile-actions">
   {!bluetoothReason&&<Button variant="primary" disabled={busy||searching} onClick={()=>void findBluetooth()}>{searching?'Searching…':'Find Bluetooth printer'}</Button>}
   {printDialog&&<Button disabled={busy||searching} onClick={()=>void addPrintDialogPrinter()}>Use print dialog printer</Button>}
  </div>
  {message&&<p role="status">{message}</p>}
 </div>;
}

// Manual configuration for owners and technicians: browser/system printing, or direct BLE
// printing with service and characteristic UUIDs read from the printer. All values are
// validated; a BLE profile is only saved once both UUIDs are present and well formed.
export function ManualSetup({user,busy,onAdd}:Props){
 const [name,setName]=useState('');
 const [connectionType,setConnectionType]=useState<PrinterConnection>('SYSTEM_PRINTER');
 const [paper,setPaper]=useState<PaperProfile>('THERMAL_58');
 const [fields,setFields]=useState({serviceUuid:'',characteristicUuid:'',namePrefix:'',chunkSize:'',charsPerLine:''});
 const [message,setMessage]=useState('');
 const set=(key:keyof typeof fields)=>(event:{target:{value:string}})=>setFields(current=>({...current,[key]:event.target.value}));
 const bluetooth=connectionType==='BLUETOOTH_PRINTER';

 async function submit(event:FormEvent){
  event.preventDefault();
  if(busy)return;
  const configuration:PrinterConfiguration={setupMode:'MANUAL'};
  if(fields.charsPerLine.trim())configuration.charsPerLine=fields.charsPerLine.trim();
  if(bluetooth){
   configuration.transport='BLE_GATT';
   for(const key of ['serviceUuid','characteristicUuid','namePrefix','chunkSize'] as const)if(fields[key].trim())configuration[key]=fields[key].trim();
  }
  const errors=manualSetupErrors(connectionType,paper,configuration);
  if(errors.length){setMessage(errors.join(' '));return;}
  await onAdd(draftPrinter(user,name.trim(),connectionType,paper,configuration),bluetooth?'Bluetooth printer added. Tap Connect, then Test print.':'Printer added.');
  setName('');setFields({serviceUuid:'',characteristicUuid:'',namePrefix:'',chunkSize:'',charsPerLine:''});setMessage('');
 }

 return <form className="owner-form setup-panel" onSubmit={event=>void submit(event)}>
  <div className="form-grid">
  <label>Printer name<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} placeholder="Receipt printer"/></label>
  <label>Printing method<select value={connectionType} onChange={event=>setConnectionType(event.target.value as PrinterConnection)}>
   <option value="SYSTEM_PRINTER">Device print dialog (system printer)</option>
   <option value="BROWSER_PRINT">Browser print</option>
   <option value="BLUETOOTH_PRINTER">Direct Bluetooth Low Energy (verified UUIDs)</option>
  </select></label>
  <label>Paper width<select value={paper} onChange={event=>setPaper(event.target.value as PaperProfile)}>{[...thermalPapers,{value:'A4' as const,label:'A4'},{value:'LETTER' as const,label:'Letter'}].map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
  {paper.startsWith('THERMAL_')&&<label>Characters per line (optional; 58 mm = 32, 80 mm = 48)<input inputMode="numeric" maxLength={2} value={fields.charsPerLine} onChange={set('charsPerLine')}/></label>}
  </div>
  {bluetooth&&<fieldset>
   <legend>Bluetooth Low Energy details</legend>
   <p className="settings-group-hint">Use the service and writable characteristic read from this printer with a BLE scanner (PRINTING.md). Bluetooth Classic (SPP) printers cannot be used here.</p>
   <div className="form-grid">
   <label>Service UUID<input required maxLength={36} value={fields.serviceUuid} onChange={set('serviceUuid')}/></label>
   <label>Write characteristic UUID<input required maxLength={36} value={fields.characteristicUuid} onChange={set('characteristicUuid')}/></label>
   <label>Device name starts with (optional)<input maxLength={40} value={fields.namePrefix} onChange={set('namePrefix')}/></label>
   <label>Bytes per write (optional, default 20)<input inputMode="numeric" maxLength={3} value={fields.chunkSize} onChange={set('chunkSize')}/></label>
   </div>
  </fieldset>}
  {message&&<p role="status" className="form-error">{message}</p>}
  <div className="form-actions"><Button variant="primary" disabled={busy}>{busy?'Saving…':'Add printer'}</Button></div>
 </form>;
}
