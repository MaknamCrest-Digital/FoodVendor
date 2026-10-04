"use client";
import Image from 'next/image';
import {receiptLines,toReceiptDocument} from '../../src/lib/receipt';
import type {LocalOrder} from '../../src/types/domain';
export default function ReceiptPreview({order,preview=false}:{order:LocalOrder;preview?:boolean}){
 const document=toReceiptDocument(order);
 const profile=order.receiptSnapshot?.paperProfile||(document.template.paperWidth===58?'THERMAL_58':'THERMAL_80');
 return <div className={`receipt-paper paper-${profile}`} aria-label={preview?'Receipt preview':'Receipt'}>
  {preview&&<strong>PREVIEW · NOT A SALE</strong>}
  {document.template.showLogo&&document.business.logo&&<Image src={document.business.logo} alt="" width={80} height={80} unoptimized/>}
  {receiptLines(order).map((line,index)=><div key={index}>{line}</div>)}
 </div>;
}
