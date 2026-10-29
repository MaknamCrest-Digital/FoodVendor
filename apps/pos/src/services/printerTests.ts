// Device-local record of the last printer test. Kept in localStorage (never in the
// IndexedDB outbox), so it is not synced and cannot affect sales or audit history.
// The software-level result and the person's confirmation are stored separately:
// "sent" or "dialog closed" never means the receipt is known to have printed.
// Records are scoped to the tenant and terminal as well as the printer, so signing in to
// another business on the same browser never shows or reuses its test results.
import type {PrintDestination,TestPrintResult} from './printer';

export type TestConfirmation='PRINTED_CORRECTLY'|'PRINTED_INCORRECTLY'|'NOTHING_PRINTED';
export type PrinterScope=Pick<PrintDestination,'id'|'businessId'|'deviceId'>;
export type PrinterTestRecord={businessId:string;deviceId:string;printerId:string;printerName:string;result:TestPrintResult['status'];confirmation:TestConfirmation|null;testedAt:string};
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;

const key=(scope:{businessId:string;deviceId:string;printerId:string})=>`maknam-printer-test:${scope.businessId}:${scope.deviceId}:${scope.printerId}`;
export const testRecordScope=(printer:PrinterScope)=>({businessId:printer.businessId,deviceId:printer.deviceId,printerId:printer.id});
const store=():Storage|null=>{try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}};

export function readTestRecord(printer:PrinterScope,storage:Storage|null=store()):PrinterTestRecord|null{
  const scope=testRecordScope(printer);
  try{
    const value=JSON.parse(storage?.getItem(key(scope))||'null');
    return value&&value.businessId===scope.businessId&&value.deviceId===scope.deviceId&&value.printerId===scope.printerId&&typeof value.result==='string'?value as PrinterTestRecord:null;
  }catch{return null;}
}

export function saveTestRecord(record:PrinterTestRecord,storage:Storage|null=store()){
  try{storage?.setItem(key(record),JSON.stringify(record));}catch{/* storage blocked: the result is shown but not kept */}
}

const RESULT:Record<PrinterTestRecord['result'],string>={DIALOG_CLOSED:'print dialog closed',SENT:'data sent to printer',UNSUPPORTED:'unsupported',FAILED:'connection or write failed'};
const CONFIRMATION:Record<TestConfirmation,string>={PRINTED_CORRECTLY:'confirmed printed correctly',PRINTED_INCORRECTLY:'reported printed incorrectly',NOTHING_PRINTED:'reported nothing printed'};

export function describeTestRecord(record:PrinterTestRecord){
  const when=new Date(record.testedAt).toLocaleString();
  const confirmation=record.confirmation?CONFIRMATION[record.confirmation]:(record.result==='SENT'||record.result==='DIALOG_CLOSED'?'paper not confirmed':'');
  return `Last test ${when}: ${RESULT[record.result]}${confirmation?` · ${confirmation}`:''}.`;
}
