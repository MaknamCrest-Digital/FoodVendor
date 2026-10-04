import type {PrinterProfile} from '../lib/settings';
import {toReceiptDocument,renderReceiptHtml,type ReceiptDocument,type ReceiptOutput} from '../lib/receipt';
import type {LocalOrder} from '../types/domain';

export type PrintCapability=PrinterProfile['connectionType'];
export type PrintPlatform='BROWSER'|'ANDROID'|'IOS'|'WINDOWS'|'MACOS'|'UNKNOWN';
export type PrintDestination=PrinterProfile;
export type PrintEnvironment={platform:PrintPlatform;capabilities:PrintCapability[]};

export interface PrinterAdapter{
 readonly connectionTypes:PrinterProfile['connectionType'][];
 isAvailable():boolean;
 print(document:ReceiptDocument,destination:PrintDestination):Promise<void>;
}

export interface PrintService{
 detectCapabilities():PrintEnvironment;
 isAvailable(destination:PrintDestination):boolean;
 print(document:ReceiptDocument,destination:PrintDestination):Promise<void>;
 printReceipt(order:LocalOrder,destination:PrintDestination):Promise<void>;
 testPrint(destination:PrintDestination):Promise<void>;
}

export function browserFallback(order:LocalOrder):PrintDestination{
 const profile=order.receiptSnapshot?.paperProfile||(order.receiptSnapshot?.receipts.paperWidth===58?'THERMAL_58':'THERMAL_80');
 return {id:'browser-print-fallback',businessId:order.businessId,locationId:order.locationId,deviceId:order.terminalId,name:'Browser print fallback',printerType:profile==='A4'||profile==='LETTER'?'OFFICE':'THERMAL',connectionType:'BROWSER_PRINT',paperProfile:profile,status:'CONFIGURED',isDefault:false,capabilities:['BROWSER_PRINT'],configuration:{}};
}

function testDocument(destination:PrintDestination):ReceiptDocument{
 const now=new Date().toISOString();
 const receipts={showLogo:false,showBusinessName:true,showAddress:false,showPhone:false,showCashier:false,showPaymentMethod:false,showOrderNumber:false,showReceiptNumber:false,paperWidth:destination.paperProfile==='THERMAL_58'?58 as const:80 as const,collectionMessage:'TEST PRINT · no sale or payment was created',footer:''};
 return {business:{name:'Printer test',address:'',phone:'',logo:''},location:{name:'',address:'',phone:''},receiptNumber:'TEST',orderNumber:'TEST',dateTime:now,cashier:'',items:[],subtotal:0,discount:0,total:0,currency:'GHS',timezone:'UTC',dateFormat:'DD/MM/YYYY',timeFormat:'24h',paymentMethod:'CASH',change:0,paymentReference:'',collectionMessage:'TEST PRINT · no sale or payment was created',footer:'',template:receipts};
}

function outputFor(destination:PrintDestination):ReceiptOutput{
 return destination.paperProfile;
}

export class BrowserPrintAdapter implements PrinterAdapter{
 readonly connectionTypes:PrinterProfile['connectionType'][]=['BROWSER_PRINT','SYSTEM_PRINTER'];
 isAvailable(){return typeof window!=='undefined'&&typeof window.print==='function'&&typeof document!=='undefined';}

 async print(receipt:ReceiptDocument,destination:PrintDestination){
  if(!this.isAvailable())throw new Error('Browser printing is unavailable on this device.');
  const frame=document.createElement('iframe');
  frame.title='Receipt print preview';
  frame.setAttribute('aria-hidden','true');
  Object.assign(frame.style,{position:'fixed',right:'0',bottom:'0',width:'1px',height:'1px',border:'0',opacity:'0'});
  frame.srcdoc=renderReceiptHtml(receipt,outputFor(destination));
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

 isAvailable(destination:PrintDestination){return this.adapters.some(adapter=>adapter.connectionTypes.includes(destination.connectionType)&&adapter.isAvailable());}

 async print(document:ReceiptDocument,destination:PrintDestination){
  const adapter=this.adapters.find(candidate=>candidate.connectionTypes.includes(destination.connectionType)&&candidate.isAvailable());
  if(!adapter)throw new Error(`No print adapter is available for ${destination.connectionType.replaceAll('_',' ').toLowerCase()}.`);
  await adapter.print(document,destination);
 }

 async printReceipt(order:LocalOrder,destination:PrintDestination){await this.print(toReceiptDocument(order),destination);}

 async testPrint(destination:PrintDestination){await this.print(testDocument(destination),destination);}
}

export const printer:PrintService=new DefaultPrintService();
