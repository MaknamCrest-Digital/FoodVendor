"use client";
import {useEffect,useState,type FormEvent} from 'react';
import {Bluetooth,Download,MonitorSmartphone,Plus,Printer,SlidersHorizontal,Sparkles,Upload} from 'lucide-react';
import {useAuth} from '../auth/AuthProvider';
import {useSettings} from '../settings/SettingsProvider';
import {can} from '../../src/lib/access';
import {Button,PageHeader,StatusBadge} from '../ui/primitives';
import {bluetoothPrinter,printer,type PrinterState} from '../../src/services/printer';
import type {PaperProfile,PrinterConnection,PrinterProfile} from '../../src/lib/settings';
import {exportLocalData,importLocalData} from '../../src/storage/dataTransfer';
import {AutomaticSetup,DeviceCapabilities,ManualSetup,type SetupMode} from './PrinterSetup';
import TestPrintPanel from './TestPrintPanel';

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
const STATE_BADGE:Record<PrinterState,{label:string;tone:'success'|'warning'|'danger'|'info'}>={
 CONNECTED:{label:'Connected',tone:'success'},DISCONNECTED:{label:'Disconnected',tone:'warning'},
 UNSUPPORTED:{label:'Unsupported',tone:'danger'},SETUP_REQUIRED:{label:'Setup required',tone:'info'},
};

export default function DeviceScreen(){
 const {session}=useAuth();
 const {settings,save}=useSettings();
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [mode,setMode]=useState<SetupMode>('AUTOMATIC');
 const [,setConnections]=useState(0);
 const [transferBusy,setTransferBusy]=useState(false);
 const [transferMessage,setTransferMessage]=useState('');
 const capabilities=printer.detectCapabilities();
 const profiles=settings.device.printers;
 const manage=!!session&&can('devices.manage',session.user);
 const general=settings.general;
 const testDetails=(profile:PrinterProfile)=>()=>({printerName:profile.name,vendorName:general.businessName,dateTime:new Date().toISOString(),timezone:general.timezone,dateFormat:general.dateFormat,timeFormat:general.timeFormat});

 // Silent reconnection only: printers this browser already permitted. Never prompts.
 useEffect(()=>{
  let active=true;
  for(const profile of profiles.filter(item=>item.connectionType==='BLUETOOTH_PRINTER'))
   void bluetoothPrinter.reconnect(profile).then(connected=>{if(connected&&active)setConnections(count=>count+1);});
  return()=>{active=false;};
 },[profiles]);

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

 async function addPrinter(draft:PrinterProfile,successMessage:string){
  const supported=printer.isAvailable(draft);
  const profile={...draft,isDefault:!settings.device.defaultPrinterId&&supported,capabilities:supported?[draft.connectionType]:[]};
  await persist([...profiles,profile],profile.isDefault?profile.id:settings.device.defaultPrinterId,successMessage);
 }

 // The Bluetooth chooser opens only here, from a tap on Connect. The permitted printer is
 // remembered in device settings only by people who may manage devices.
 async function connect(profile:PrinterProfile){
  if(busy)return;
  setBusy(true);
  setMessage('');
  try{
   const paired=await bluetoothPrinter.pair(profile);
   setBusy(false);
   setConnections(count=>count+1);
   const connected=`Connected to ${paired.deviceName||profile.name}. Use Test print to check the output.`;
   if(manage){
    const updated={...profile,configuration:{...profile.configuration,deviceId:paired.deviceId,deviceName:paired.deviceName}};
    await persist(profiles.map(item=>item.id===profile.id?updated:item),settings.device.defaultPrinterId,connected);
   }else setMessage(`${connected} An owner can save this printer so it reconnects automatically.`);
  }catch(error){
   setMessage(error instanceof Error?error.message:'Could not connect to the Bluetooth printer.');
   setBusy(false);
  }
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

 async function toggleAutoPrint(){
  if(busy)return;
  setBusy(true);
  setMessage('');
  try{
   await save('pos',{...settings.pos,autoPrint:!settings.pos.autoPrint});
   setMessage(settings.pos.autoPrint?'Auto-print turned off. After payment, the sale is saved and Print receipt is offered.':'Auto-print turned on. After payment, the sale is saved first, then the receipt prints.');
  }catch(error){
   setMessage(error instanceof Error?error.message:'Could not change auto-print.');
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

 const autoPrintHint='On: the receipt prints right after the sale is saved. Off: the cashier taps Print receipt.';
 return <section className="module-page devices-page">
  <PageHeader title="Devices & Printers" description="Receipt printers and offline data for this business, location and device."/>
  <div className="devices-layout">
   <div className="devices-column">
    <section className="ui-card devices-card" aria-labelledby="available-printers">
     <header className="devices-card-head"><span className="devices-card-icon" aria-hidden="true"><Printer size={20}/></span><div><h2 id="available-printers">Printers</h2><p>Sales are always saved before anything prints. Software cannot confirm that paper came out.</p></div></header>
     {can('settings.pos')
      ?<label className="setting-toggle"><span className="setting-toggle-text"><span id="auto-print-label">Auto-print after payment</span><small id="auto-print-hint">{autoPrintHint}</small></span><input type="checkbox" role="switch" aria-labelledby="auto-print-label" aria-describedby="auto-print-hint" checked={settings.pos.autoPrint} disabled={busy} onChange={()=>void toggleAutoPrint()}/></label>
      :<p className="devices-readonly">Auto-print after payment: <strong>{settings.pos.autoPrint?'On':'Off'}</strong></p>}
     {profiles.length===0?<div className="devices-empty"><Printer size={28} aria-hidden="true"/><strong>No printer yet</strong><p>Checkout saves the sale and offers Print receipt. {manage?'Add a printer below.':'Ask an owner to add one.'}</p></div>:<div className="printer-list">
      {profiles.map(profile=>{
       const status=printer.status(profile);
       const badge=STATE_BADGE[status.state];
       const setupMode=profile.configuration.setupMode==='AUTOMATIC'?'Automatic':profile.configuration.setupMode==='MANUAL'?'Manual':'';
       const connectButton=status.state==='DISCONNECTED'&&<Button variant="primary" disabled={busy} onClick={()=>void connect(profile)}>Connect</Button>;
       const manageButtons=manage&&<>
        {profile.id!==settings.device.defaultPrinterId&&<Button disabled={busy||!printer.isAvailable(profile)} onClick={()=>void setDefault(profile)}>Set as default</Button>}
        <Button variant="quiet" className="printer-remove" disabled={busy} onClick={()=>void removePrinter(profile)}>Remove</Button>
       </>;
       return <article key={profile.id} className="printer-profile">
        <div className="printer-profile-head">
         <span className="printer-icon" aria-hidden="true">{profile.connectionType==='BLUETOOTH_PRINTER'?<Bluetooth size={20}/>:<Printer size={20}/>}</span>
         <div className="printer-profile-title"><strong>{profile.name}</strong><small>{connections.find(item=>item.value===profile.connectionType)?.label} · {paperProfiles.find(item=>item.value===profile.paperProfile)?.label}{setupMode&&` · ${setupMode} setup`}</small></div>
         <div className="printer-profile-badges"><StatusBadge tone={badge.tone} dot>{badge.label}</StatusBadge>{profile.id===settings.device.defaultPrinterId&&<StatusBadge tone="info">Default</StatusBadge>}</div>
        </div>
        <p className="printer-profile-detail">{status.detail}</p>
        {can('devices.view')?<TestPrintPanel profile={profile} details={testDetails(profile)} before={connectButton} after={manageButtons}/>:<div className="printer-profile-actions">{connectButton}{manageButtons}</div>}
       </article>;
      })}
     </div>}
     {message&&<p role="status" className="devices-message">{message}</p>}
    </section>
    {manage&&session&&<section className="ui-card devices-card" aria-labelledby="printer-setup">
     <header className="devices-card-head"><span className="devices-card-icon" aria-hidden="true"><Plus size={20}/></span><div><h2 id="printer-setup">Add a printer</h2><p>Automatic detection suits most setups. Manual configuration is for technicians with verified printer details.</p></div></header>
     <div className="setup-modes" role="group" aria-label="Printer setup mode">
      <button type="button" aria-pressed={mode==='AUTOMATIC'} onClick={()=>setMode('AUTOMATIC')}><Sparkles size={18} aria-hidden="true"/>Automatic detection (recommended)</button>
      <button type="button" aria-pressed={mode==='MANUAL'} onClick={()=>setMode('MANUAL')}><SlidersHorizontal size={18} aria-hidden="true"/>Manual configuration (advanced)</button>
     </div>
     {mode==='AUTOMATIC'?<AutomaticSetup user={session.user} busy={busy} onAdd={addPrinter}/>:<ManualSetup user={session.user} busy={busy} onAdd={addPrinter}/>}
    </section>}
   </div>
   <div className="devices-column">
    <section className="ui-card devices-card" aria-labelledby="this-device">
     <header className="devices-card-head"><span className="devices-card-icon" aria-hidden="true"><MonitorSmartphone size={20}/></span><div><h2 id="this-device">This device</h2><p>{settings.device.name} · {capabilities.platform}</p></div></header>
     <DeviceCapabilities/>
    </section>
    {manage&&<section className="ui-card devices-card" aria-labelledby="offline-data-transfer">
     <header className="devices-card-head"><span className="devices-card-icon" aria-hidden="true"><Download size={20}/></span><div><h2 id="offline-data-transfer">Offline data transfer</h2><p>Copy local sales and events to another device.</p></div></header>
     <ul className="devices-notes"><li>Export does not erase this device.</li><li>Import accepts only this signed-in business and location, and never replaces conflicting records.</li><li>Cloud settings and printer profiles are not included.</li></ul>
     <div className="printer-profile-actions">
      <Button disabled={transferBusy} onClick={()=>void exportData()}><Download size={16} aria-hidden="true"/>{transferBusy?'Preparing…':'Export offline data'}</Button>
      <label className="ui-button ui-button--secondary data-transfer-file"><Upload size={16} aria-hidden="true"/>Import offline data<input type="file" accept="application/json,.json" disabled={transferBusy} onChange={event=>void importData(event)} /></label>
     </div>
     {transferMessage&&<p role="status" className="devices-message">{transferMessage}</p>}
    </section>}
   </div>
  </div>
 </section>;
}
