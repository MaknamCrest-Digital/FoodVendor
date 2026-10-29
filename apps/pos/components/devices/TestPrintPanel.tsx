"use client";
import {useState,type ReactNode} from 'react';
import {Button} from '../ui/primitives';
import {printer,type PrintDestination,type TestPrintResult} from '../../src/services/printer';
import type {TestPrintDetails} from '../../src/services/escpos';
import {describeTestRecord,readTestRecord,saveTestRecord,testRecordScope,type PrinterTestRecord,type TestConfirmation} from '../../src/services/printerTests';

const ANSWERS:Array<[TestConfirmation,string]>=[['PRINTED_CORRECTLY','Printed correctly'],['PRINTED_INCORRECTLY','Printed incorrectly'],['NOTHING_PRINTED','Nothing printed']];
const FOLLOW_UP:Record<TestConfirmation,string>={
 PRINTED_CORRECTLY:'Recorded: this printer is confirmed for receipts on this device.',
 PRINTED_INCORRECTLY:'Recorded. Check paper width and characters per line, then retry (PRINTING.md, Troubleshooting).',
 NOTHING_PRINTED:'Recorded. The data did not produce paper output: check power, paper, the selected printer or its print service, then retry.',
};

// Test print for one printer profile. Uses only the in-memory sample receipt: it never
// creates a sale, payment, stock movement, shift change, receipt number or outbox event.
// Never opens the Bluetooth chooser; a Bluetooth printer must already be connected.
// before/after: the printer's other actions, shown in the same row as Test print.
export default function TestPrintPanel({profile,details,before,after}:{profile:PrintDestination;details:()=>TestPrintDetails;before?:ReactNode;after?:ReactNode}){
 const [running,setRunning]=useState(false);
 const [result,setResult]=useState<TestPrintResult|null>(null);
 const [record,setRecord]=useState<PrinterTestRecord|null>(()=>readTestRecord(profile));
 const [answered,setAnswered]=useState<TestConfirmation|null>(null);

 async function run(){
  if(running)return;
  setRunning(true);setResult(null);setAnswered(null);
  const outcome=await printer.testPrint(profile,details());
  const saved:PrinterTestRecord={...testRecordScope(profile),printerName:profile.name,result:outcome.status,confirmation:null,testedAt:new Date().toISOString()};
  saveTestRecord(saved);setRecord(saved);setResult(outcome);setRunning(false);
 }

 function confirm(answer:TestConfirmation){
  if(!record)return;
  const saved={...record,confirmation:answer};
  saveTestRecord(saved);setRecord(saved);setAnswered(answer);
 }

 const delivered=result?.status==='SENT'||result?.status==='DIALOG_CLOSED';
 return <div className="test-print">
  <div className="printer-profile-actions">
   {before}
   <Button disabled={running} onClick={()=>void run()}>{running?'Printing test…':result?'Retry test':'Test print'}</Button>
   {after}
  </div>
  {result&&<p role="status">{result.message}</p>}
  {delivered&&!answered&&<div role="group" className="test-print-question" aria-label="Did the test receipt print correctly?">
   <p>Did a receipt marked TEST PRINT come out of the printer correctly?</p>
   <div className="printer-profile-actions">
    {ANSWERS.map(([value,text])=><Button key={value} onClick={()=>confirm(value)}>{text}</Button>)}
    <Button onClick={()=>void run()}>Retry test</Button>
   </div>
  </div>}
  {answered&&<p role="status">{FOLLOW_UP[answered]}</p>}
  {record&&!result&&<small>{describeTestRecord(record)}</small>}
 </div>;
}
