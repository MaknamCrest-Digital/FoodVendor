"use client";
import {useState,type FormEvent} from 'react';
import {useAuth} from '../auth/AuthProvider';
import {useSettings} from '../settings/SettingsProvider';
import {can} from '../../src/lib/access';
import {Button,PageHeader,StatusBadge} from '../ui/primitives';
import {printer} from '../../src/services/printer';
import type {PaperProfile,PrinterConnection,PrinterProfile} from '../../src/lib/settings';
import {exportLocalData,importLocalData} from '../../src/storage/dataTransfer';

const connections:Array<{value:PrinterConnection;label:string}>=[
 {value:'SYSTEM_PRINTER',label:'System printer'},
 {value:'BROWSER_PRINT',label:'Browser print fallback'},
 {value:'BLUETOOTH_PRINTER',label:'Bluetooth'},
 {value:'USB_PRINTER',label:'USB'},
 {value:'NETWORK_PRINTER',label:'Network'},
 {value:'AIRPRINT_NATIVE',label:'AirPrint / native'},
 {value:'LOCAL_PRINTER',label:'Local printer adapter'},
];
const paperProfiles:Array<{value:PaperProfile;label:string}>=[
 {value:'THERMAL_58',label:'Thermal · 58 mm'},
 {value:'THERMAL_80',label:'Thermal · 80 mm'},
 {value:'A4',label:'A4'},
 {value:'LETTER',label:'Letter'},
];

export default function DeviceScreen(){
 const {session}=useAuth();
 const {settings,save}=useSettings();
 const [name,setName]=useState('');
 const [connectionType,setConnectionType]=useState<PrinterConnection>('SYSTEM_PRINTER');
 const [paperProfile,setPaperProfile]=useState<PaperProfile>('THERMAL_80');
 const [networkAddress,setNetworkAddress]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [transferBusy,setTransferBusy]=useState(false);
 const [transferMessage,setTransferMessage]=useState('');
 const capabilities=printer.detectCapabilities();
 const profiles=settings.device.printers;

 async function persist(printers:PrinterProfile[],defaultPrinterId:string|null,successMessage:string){
  setBusy(true);
  setMessage('');
  try{
   await save('device',{...settings.device,printers,defaultPrinterId,printerName:printers.find(item=>item.id===defaultPrinterId)?.name||''});
   setMessage(successMessage);
  }catch(error){
   setMessage(error instanceof Error?error.message:'Could not save printer settings.');
  }finally{
   setBusy(false);
  }
 }

 async function addPrinter(event:FormEvent){
  event.preventDefault();
  if(!session||busy)return;
  if(connectionType==='NETWORK_PRINTER'&&!networkAddress.trim()){
   setMessage('Enter the network printer address.');
   return;
  }
  const id=crypto.randomUUID();
  const supported=capabilities.capabilities.includes(connectionType);
  const profile:PrinterProfile={
   id,businessId:session.user.businessId,locationId:session.user.locationId,deviceId:session.user.terminalId,
   name:name.trim(),printerType:paperProfile==='A4'||paperProfile==='LETTER'?'OFFICE':'THERMAL',
   connectionType,paperProfile,status:'CONFIGURED',isDefault:!settings.device.defaultPrinterId&&supported,
   capabilities:supported?[connectionType]:[],
   configuration:connectionType==='NETWORK_PRINTER'?{address:networkAddress.trim()}:{},
  };
  await persist([...profiles,profile],profile.isDefault?id:settings.device.defaultPrinterId,'Printer profile added.');
  setName('');
  setNetworkAddress('');
 }

 async function setDefault(profile:PrinterProfile){
  if(busy||!printer.isAvailable(profile))return;
  await persist(profiles.map(item=>({...item,isDefault:item.id===profile.id})),profile.id,`${profile.name} is now the default receipt printer.`);
 }

 async function removePrinter(profile:PrinterProfile){
  if(busy)return;
  const remaining=profiles.filter(item=>item.id!==profile.id);
  const nextDefault=profile.id===settings.device.defaultPrinterId?null:settings.device.defaultPrinterId;
  await persist(remaining,nextDefault,`${profile.name} was removed from this device.`);
 }

 async function testPrint(profile:PrinterProfile){
  setBusy(true);
  setMessage('');
  try{
   await printer.testPrint(profile);
   setMessage('Print dialog closed. Check the printer; this test did not create a sale or payment.');
  }catch(error){
   setMessage(error instanceof Error?error.message:'Could not print a test receipt.');
  }finally{
   setBusy(false);
  }
 }

 async function exportData(){
  setTransferBusy(true);
  setTransferMessage('');
  try{
   const bundle=await exportLocalData();
   const file=new File([JSON.stringify(bundle,null,2)],`maknam-pos-${bundle.businessId}-${bundle.locationId}.json`,{type:'application/json'});
   if(navigator.canShare?.({files:[file]})&&navigator.share){
    await navigator.share({title:'Maknam POS offline data',files:[file]});
   }else{
    const url=URL.createObjectURL(file);
    const link=document.createElement('a');
    link.href=url;
    link.download=file.name;
    link.click();
    URL.revokeObjectURL(url);
   }
   setTransferMessage(`${bundle.orders.length} sales and ${bundle.outbox.length} local events exported. The source device data was not changed.`);
  }catch(error){
   setTransferMessage(error instanceof Error?error.message:'Could not export local data.');
  }finally{
   setTransferBusy(false);
  }
 }

 async function importData(event:FormEvent<HTMLInputElement>){
  const input=event.currentTarget;
  const file=input.files?.[0];
  if(!file)return;
  setTransferBusy(true);
  setTransferMessage('');
  try{
   if(file.size>30*1024*1024)throw new Error('Choose a data file smaller than 30 MB.');
   const result=await importLocalData(await file.text());
   window.dispatchEvent(new Event('records-changed'));
   setTransferMessage(`Import complete: ${result.ordersAdded} sales and ${result.outboxAdded} events added; ${result.recordsSkipped} identical records skipped.`);
  }catch(error){
   setTransferMessage(error instanceof Error?error.message:'Could not import local data.');
  }finally{
   input.value='';
   setTransferBusy(false);
  }
 }

 return <section className="module-page">
  <PageHeader title="Devices & Printers" description="Configure receipt destinations for this business, location and device."/>
  <section className="ui-card" aria-labelledby="available-printers">
   <h2 id="available-printers">Printer destinations</h2>
   <p>Platform: {capabilities.platform}. A browser can open a system print dialog, but cannot discover installed printers or confirm that paper printed. Bluetooth, USB and network routes require a matching native adapter.</p>
   {profiles.length===0?<p>No printer is configured. Checkout will save the sale and open the receipt preview.</p>:<div className="settings-team-list">
    {profiles.map(profile=>{
     const available=printer.isAvailable(profile);
     return <article key={profile.id} className="printer-profile">
      <div><strong>{profile.name}</strong><small>{profile.printerType} · {connections.find(item=>item.value===profile.connectionType)?.label} · {paperProfiles.find(item=>item.value===profile.paperProfile)?.label}</small></div>
      <div><StatusBadge tone={available?'success':'warning'} dot>{available?'Available':'Adapter unavailable'}</StatusBadge>{profile.id===settings.device.defaultPrinterId&&<StatusBadge tone="info">Default</StatusBadge>}</div>
      {profile.connectionType!=='SYSTEM_PRINTER'&&profile.connectionType!=='BROWSER_PRINT'&&<small>Connection discovery and connect/disconnect are not available in this browser build.</small>}
      <div className="printer-profile-actions">
       {profile.id!==settings.device.defaultPrinterId&&<Button disabled={busy||!available} onClick={()=>void setDefault(profile)}>Set as default</Button>}
       <Button disabled={busy||!available} onClick={()=>void testPrint(profile)}>Test print</Button>
       <Button disabled={busy} onClick={()=>void removePrinter(profile)}>Remove</Button>
      </div>
     </article>;
    })}
   </div>}
  </section>
  {session&&can('devices.manage',session.user)&&<section className="ui-card" aria-labelledby="offline-data-transfer">
   <h2 id="offline-data-transfer">Offline data transfer</h2>
   <p>Move a copy of local sales and operational events from a browser to another device. Export does not erase the source. Import accepts only this signed-in business and location, and never replaces conflicting records. Cloud settings and printer profiles are not included.</p>
   <div className="printer-profile-actions">
    <Button disabled={transferBusy} onClick={()=>void exportData()}>{transferBusy?'Preparing…':'Export offline data'}</Button>
    <label className="ui-button ui-button--secondary data-transfer-file">Import offline data<input type="file" accept="application/json,.json" disabled={transferBusy} onChange={event=>void importData(event)} /></label>
   </div>
   {transferMessage&&<p role="status">{transferMessage}</p>}
  </section>}
  <form className="owner-form settings-form ui-card" onSubmit={event=>void addPrinter(event)}>
   <h2>Add printer destination</h2>
   <p>Profiles are scoped to the signed-in business, location and device. Physical printer discovery is provided only by an installed platform adapter.</p>
   <label>Printer name<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} placeholder="Receipt printer"/></label>
   <label>Connection<select value={connectionType} onChange={event=>setConnectionType(event.target.value as PrinterConnection)}>{connections.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
   <label>Paper profile<select value={paperProfile} onChange={event=>setPaperProfile(event.target.value as PaperProfile)}>{paperProfiles.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
   {connectionType==='NETWORK_PRINTER'&&<label>Network address<input required maxLength={255} value={networkAddress} onChange={event=>setNetworkAddress(event.target.value)} placeholder="Printer address"/></label>}
   {message&&<p role="status">{message}</p>}
   <Button variant="primary" disabled={busy}>{busy?'Saving…':'Add printer'}</Button>
  </form>
 </section>;
}
