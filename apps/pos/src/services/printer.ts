import type {PrinterProfile} from '../lib/settings';
import {toReceiptDocument,renderReceiptHtml,type ReceiptDocument,type ReceiptOutput} from '../lib/receipt';
import type {LocalOrder} from '../types/domain';
import {BluetoothEscPosAdapter,PrinterError} from './bluetoothPrinter';
import {testReceiptLines,type Line,type TestPrintDetails} from './escpos';
import {printerWidth} from './printerConfig';

export type PrintCapability=PrinterProfile['connectionType'];
export type PrintPlatform='BROWSER'|'ANDROID'|'IOS'|'WINDOWS'|'MACOS'|'UNKNOWN';
export type PrintDestination=PrinterProfile;
export type PrintEnvironment={platform:PrintPlatform;capabilities:PrintCapability[]};
// DIALOG_CLOSED: a system print dialog closed (paper output cannot be confirmed).
// SENT: the receipt bytes were accepted by the printer connection.
export type PrintOutcome='DIALOG_CLOSED'|'SENT';
export type ReprintResult={outcome:PrintOutcome;destination:PrintDestination;usedFallback:boolean;failure?:string};
export type PrinterState='CONNECTED'|'DISCONNECTED'|'UNSUPPORTED'|'SETUP_REQUIRED';
export type PrinterStatus={state:PrinterState;detail:string};
// Software-level outcome of a test print; whether paper came out is confirmed by the user.
export type TestPrintResult={status:'DIALOG_CLOSED'|'SENT'|'UNSUPPORTED'|'FAILED';message:string};

export interface PrinterAdapter{
 readonly connectionTypes:PrinterProfile['connectionType'][];
 // Without a destination: whether this device can use the adapter at all.
 isAvailable(destination?:PrintDestination):boolean;
 unavailableReason?(destination:PrintDestination):string|null;
 status?(destination:PrintDestination):PrinterStatus;
 print(document:ReceiptDocument,destination:PrintDestination):Promise<PrintOutcome>;
 // The in-memory sample receipt (escpos.testReceiptLines); never uses sale data.
 printTest?(destination:PrintDestination,details:TestPrintDetails):Promise<PrintOutcome>;
}

export interface PrintService{
 detectCapabilities():PrintEnvironment;
 isAvailable(destination:PrintDestination):boolean;
 unavailableReason(destination:PrintDestination):string|null;
 status(destination:PrintDestination):PrinterStatus;
 print(document:ReceiptDocument,destination:PrintDestination):Promise<PrintOutcome>;
 printReceipt(order:LocalOrder,destination:PrintDestination):Promise<PrintOutcome>;
 reprint(order:LocalOrder,destination:PrintDestination|null):Promise<ReprintResult>;
 testPrint(destination:PrintDestination,details:TestPrintDetails):Promise<TestPrintResult>;
}

export function browserFallback(order:LocalOrder):PrintDestination{
 const profile=order.receiptSnapshot?.paperProfile||(order.receiptSnapshot?.receipts.paperWidth===58?'THERMAL_58':'THERMAL_80');
 return {id:'browser-print-fallback',businessId:order.businessId,locationId:order.locationId,deviceId:order.terminalId,name:'Browser print fallback',printerType:profile==='A4'||profile==='LETTER'?'OFFICE':'THERMAL',connectionType:'BROWSER_PRINT',paperProfile:profile,status:'CONFIGURED',isDefault:false,capabilities:['BROWSER_PRINT'],configuration:{}};
}

function outputFor(destination:PrintDestination):ReceiptOutput{
 return destination.paperProfile;
}

const label=(destination:PrintDestination)=>destination.connectionType.replaceAll('_',' ').toLowerCase();
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));

export function renderLinesHtml(lines:Line[],destination:PrintDestination):string{
 const thermal=destination.paperProfile==='THERMAL_58'||destination.paperProfile==='THERMAL_80';
 const width=destination.paperProfile==='THERMAL_58'?'58mm':destination.paperProfile==='THERMAL_80'?'80mm':'auto';
 const page=thermal?`@page{size:${width} auto;margin:4mm}`:`@page{size:${destination.paperProfile.toLowerCase()};margin:12mm}`;
 const body=lines.map(line=>`<div style="text-align:${line.center?'center':'left'};font-weight:${line.bold?700:400}">${escapeHtml(line.text)||'&nbsp;'}</div>`).join('');
 return `<!doctype html><html><head><meta charset="utf-8"><style>${page}html,body{margin:0;padding:0}body{background:#fff;color:#000;font:12px/1.5 ui-monospace,monospace;white-space:pre;width:${width}}</style></head><body>${body}</body></html>`;
}

export class BrowserPrintAdapter implements PrinterAdapter{
 readonly connectionTypes:PrinterProfile['connectionType'][]=['BROWSER_PRINT','SYSTEM_PRINTER'];
 isAvailable(){return typeof window!=='undefined'&&typeof window.print==='function'&&typeof document!=='undefined';}

 async print(receipt:ReceiptDocument,destination:PrintDestination):Promise<PrintOutcome>{
  return this.printHtml(renderReceiptHtml(receipt,outputFor(destination)));
 }

 async printTest(destination:PrintDestination,details:TestPrintDetails):Promise<PrintOutcome>{
  const width=destination.paperProfile.startsWith('THERMAL_')?printerWidth(destination.paperProfile,destination.configuration):48;
  return this.printHtml(renderLinesHtml(testReceiptLines(details,width),destination));
 }

 private async printHtml(html:string):Promise<PrintOutcome>{
  if(!this.isAvailable())throw new Error('Browser printing is unavailable on this device.');
  const frame=document.createElement('iframe');
  frame.title='Receipt print preview';
  frame.setAttribute('aria-hidden','true');
  Object.assign(frame.style,{position:'fixed',right:'0',bottom:'0',width:'1px',height:'1px',border:'0',opacity:'0'});
  frame.srcdoc=html;
  await new Promise<void>((resolve,reject)=>{
   let settled=false;
   const finish=(error?:Error)=>{
    if(settled)return;
    settled=true;
    clearTimeout(timeout);
    frame.remove();
    if(error)reject(error);else resolve();
   };
   const timeout=setTimeout(()=>finish(new Error('The print dialog did not finish. The sale is saved; use the receipt preview to try again.')),120000);
   frame.addEventListener('load',()=>{
    const printWindow=frame.contentWindow;
    if(!printWindow){finish(new Error('Could not open the browser print dialog.'));return;}
    printWindow.addEventListener('afterprint',()=>finish(),{once:true});
    try{printWindow.focus();printWindow.print();}
    catch(error){finish(error instanceof Error?error:new Error('Could not open the browser print dialog.'));}
   },{once:true});
   document.body.append(frame);
  });
  return 'DIALOG_CLOSED';
 }
}

export class DefaultPrintService implements PrintService{
 constructor(private readonly adapters:PrinterAdapter[]=[new BrowserPrintAdapter()]){}

 detectCapabilities():PrintEnvironment{
  const agent=typeof navigator==='undefined'?'':navigator.userAgent;
  const platform:PrintPlatform=/android/i.test(agent)?'ANDROID':/iphone|ipad|ipod/i.test(agent)?'IOS':/windows/i.test(agent)?'WINDOWS':/macintosh|mac os/i.test(agent)?'MACOS':agent?'BROWSER':'UNKNOWN';
  const capabilities=this.adapters.filter(adapter=>adapter.isAvailable()).flatMap(adapter=>adapter.connectionTypes);
  return {platform,capabilities:[...new Set(capabilities)]};
 }

 private adapterFor(destination:PrintDestination){return this.adapters.find(adapter=>adapter.connectionTypes.includes(destination.connectionType));}

 unavailableReason(destination:PrintDestination):string|null{
  const adapter=this.adapterFor(destination);
  if(!adapter)return `No print adapter is available for ${label(destination)} in this build.`;
  const reason=adapter.unavailableReason?.(destination);
  if(reason)return reason;
  return adapter.isAvailable(destination)?null:`${label(destination)} printing is not available on this device.`;
 }

 isAvailable(destination:PrintDestination){return this.unavailableReason(destination)===null;}

 status(destination:PrintDestination):PrinterStatus{
  const adapter=this.adapterFor(destination);
  if(adapter?.status)return adapter.status(destination);
  const reason=this.unavailableReason(destination);
  return reason?{state:'UNSUPPORTED',detail:reason}:{state:'CONNECTED',detail:'Ready. Receipts open the device print dialog.'};
 }

 async print(document:ReceiptDocument,destination:PrintDestination){
  const reason=this.unavailableReason(destination);
  if(reason)throw new Error(reason);
  return this.adapterFor(destination)!.print(document,destination);
 }

 async printReceipt(order:LocalOrder,destination:PrintDestination){return this.print(toReceiptDocument(order),destination);}

 // Print a saved sale again. If the configured printer is unavailable or fails, the
 // browser print dialog is offered instead. Never creates or changes a sale.
 async reprint(order:LocalOrder,destination:PrintDestination|null):Promise<ReprintResult>{
  let failure:string|undefined;
  if(destination){
   failure=this.unavailableReason(destination)??undefined;
   if(!failure){
    try{return {outcome:await this.printReceipt(order,destination),destination,usedFallback:false};}
    catch(error){
     if(destination.connectionType==='BROWSER_PRINT'||destination.connectionType==='SYSTEM_PRINTER')throw error;
     failure=error instanceof Error?error.message:'Printing failed.';
    }
   }
  }
  const fallback=browserFallback(order);
  return {outcome:await this.printReceipt(order,fallback),destination:fallback,usedFallback:true,failure};
 }

 // Never throws and never touches sales: the result says what software can know.
 async testPrint(destination:PrintDestination,details:TestPrintDetails):Promise<TestPrintResult>{
  const reason=this.unavailableReason(destination);
  const adapter=this.adapterFor(destination);
  if(reason||!adapter?.printTest)return {status:'UNSUPPORTED',message:reason||'This printer type cannot print a test page.'};
  try{
   const outcome=await adapter.printTest(destination,details);
   return outcome==='SENT'
    ?{status:'SENT',message:`Test page sent to ${destination.name}. The printer accepted the data; check the paper.`}
    :{status:'DIALOG_CLOSED',message:'Print dialog closed. The browser cannot confirm paper output; check the printer.'};
  }catch(error){
   if(error instanceof PrinterError&&error.code==='UNSUPPORTED')return {status:'UNSUPPORTED',message:error.message};
   return {status:'FAILED',message:error instanceof Error?error.message:'The test page could not be sent.'};
  }
 }
}

export const bluetoothPrinter=new BluetoothEscPosAdapter();
export const printer:PrintService=new DefaultPrintService([new BrowserPrintAdapter(),bluetoothPrinter]);
