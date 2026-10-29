// ESC/POS receipt encoding for thermal printers. Output is printable ASCII plus a
// handful of universal ESC/POS commands, so it works without selecting a code page:
// "GH₵" prints as "GHS" and characters the printer cannot show become "?".
// Control characters in item names or settings are removed, so receipt text can
// never inject printer commands.
import {receiptDateTime,type ReceiptDocument} from '../lib/receipt';
import type {PaperProfile} from '../lib/settings';

const ESC=0x1b,LF=0x0a;
const INIT=[ESC,0x40];
const align=(position:'LEFT'|'CENTER')=>[ESC,0x61,position==='CENTER'?1:0];
const bold=(on:boolean)=>[ESC,0x45,on?1:0];
const feed=(lines:number)=>[ESC,0x64,lines];
// Portable 58 mm printers usually have no cutter, so receipts end with a paper feed only.
const END_FEED=4;

// Font A: 384 dots / 12 dots per character on 58 mm, 576 / 12 on 80 mm.
export const DEFAULT_CHARS_PER_LINE:Record<'THERMAL_58'|'THERMAL_80',number>={THERMAL_58:32,THERMAL_80:48};
export const MIN_CHARS_PER_LINE=24,MAX_CHARS_PER_LINE=64;

export function charsPerLineFor(paper:PaperProfile,override?:number){
  if(override!==undefined)return override;
  return paper==='THERMAL_58'?DEFAULT_CHARS_PER_LINE.THERMAL_58:DEFAULT_CHARS_PER_LINE.THERMAL_80;
}

const REPLACEMENTS:Record<string,string>={'₵':'C','×':'x','·':'-','–':'-','—':'-','‘':"'",'’':"'",'“':'"','”':'"','…':'...','€':'EUR','£':'GBP',' ':' '};

export function printerText(value:string):string{
  return [...value.normalize('NFKD').replace(/[̀-ͯ]/g,'')]
    .map(character=>REPLACEMENTS[character]??character)
    .join('')
    .replace(/[\t\r\n]+/g,' ')
    .replace(/[^\x20-\x7e]/g,'?');
}

export function printerMoney(pesewas:number,currency:string){
  const sign=pesewas<0?'-':'';
  return `${currency} ${sign}${(Math.abs(pesewas)/100).toFixed(2)}`;
}

export function wrap(value:string,width:number):string[]{
  const words=printerText(value).trim().split(/ +/).filter(Boolean);
  const lines:string[]=[];
  let line='';
  for(let word of words){
    while(word.length>width){
      if(line){lines.push(line);line='';}
      lines.push(word.slice(0,width));
      word=word.slice(width);
    }
    if(!word)continue;
    if(!line)line=word;
    else if(line.length+1+word.length<=width)line+=` ${word}`;
    else{lines.push(line);line=word;}
  }
  if(line)lines.push(line);
  return lines;
}

// Left text and a right-aligned amount on one line, or on their own lines if too long.
export function columns(left:string,right:string,width:number):string[]{
  const amount=printerText(right);
  const text=printerText(left);
  if(text.length+1+amount.length<=width)return [text+' '.repeat(width-text.length-amount.length)+amount];
  return [...wrap(text,width),amount.padStart(width)];
}

export type Line={text:string;center?:boolean;bold?:boolean};

export function encodeLines(lines:Line[]):Uint8Array{return encode(lines);}

function encode(lines:Line[]):Uint8Array{
  const bytes:number[]=[...INIT];
  let centered=false,emphasised=false;
  for(const line of lines){
    if(Boolean(line.center)!==centered){centered=Boolean(line.center);bytes.push(...align(centered?'CENTER':'LEFT'));}
    if(Boolean(line.bold)!==emphasised){emphasised=Boolean(line.bold);bytes.push(...bold(emphasised));}
    for(const character of line.text)bytes.push(character.charCodeAt(0));
    bytes.push(LF);
  }
  if(centered)bytes.push(...align('LEFT'));
  if(emphasised)bytes.push(...bold(false));
  bytes.push(...feed(END_FEED));
  return Uint8Array.from(bytes);
}

const centred=(value:string,width:number,boldText=false):Line[]=>wrap(value,width).map(text=>({text,center:true,bold:boldText}));
const plain=(values:string[]):Line[]=>values.map(text=>({text}));

export function receiptLines(document:ReceiptDocument,width:number):Line[]{
  const fields=document.template;
  const money=(value:number)=>printerMoney(value,document.currency);
  const rule={text:'-'.repeat(width)};
  const lines:Line[]=[];
  if(fields.showBusinessName)lines.push(...centred(document.business.name,width,true));
  if(fields.showAddress&&(document.location.address||document.business.address))lines.push(...centred(document.location.address||document.business.address,width));
  if(fields.showPhone&&(document.location.phone||document.business.phone))lines.push(...centred(document.location.phone||document.business.phone,width));
  lines.push(rule);
  if(fields.showReceiptNumber)lines.push(...plain(wrap(`Receipt: ${document.receiptNumber}`,width)));
  if(fields.showOrderNumber)lines.push(...plain(wrap(`Order: ${document.orderNumber}`,width)));
  lines.push(...plain(wrap(receiptDateTime(document),width)));
  if(fields.showCashier)lines.push(...plain(wrap(`Cashier: ${document.cashier||'-'}`,width)));
  if(document.terminal)lines.push(...plain(wrap(`Terminal: ${document.terminal}`,width)));
  lines.push(rule);
  for(const item of document.items){
    lines.push(...plain(wrap(item.variation?`${item.name} (${item.variation})`:item.name,width)));
    lines.push(...plain(columns(`  ${item.quantity} x ${money(item.unitPrice)}`,money(item.lineTotal),width)));
  }
  lines.push(rule);
  lines.push(...plain(columns('Subtotal',money(document.subtotal),width)));
  if(document.discount>0)lines.push(...plain(columns('Discount',`-${money(document.discount)}`,width)));
  lines.push(...columns('TOTAL',money(document.total),width).map(text=>({text,bold:true})));
  if(fields.showPaymentMethod)lines.push(...plain(columns('Payment',document.paymentMethod,width)));
  if(document.amountTendered!=null)lines.push(...plain([...columns('Tendered',money(document.amountTendered),width),...columns('Change',money(document.change),width)]));
  if(document.paymentReference)lines.push(...plain(wrap(`Reference: ${document.paymentReference}`,width)));
  if(document.collectionMessage||document.footer)lines.push(rule);
  if(document.collectionMessage)lines.push(...centred(document.collectionMessage,width));
  if(document.footer)lines.push(...centred(document.footer,width));
  return lines;
}

export function encodeReceipt(document:ReceiptDocument,width:number):Uint8Array{return encode(receiptLines(document,width));}

export type TestPrintDetails={
  printerName:string;vendorName:string;dateTime:string;
  timezone:string;dateFormat:ReceiptDocument['dateFormat'];timeFormat:ReceiptDocument['timeFormat'];
};
export const SAMPLE_ITEM_PESEWAS=1000;

// The sample receipt used by every adapter's test print. It is built in memory from
// display settings only: no order, payment, stock, shift or receipt number is involved.
export function testReceiptLines(details:TestPrintDetails,width:number):Line[]{
  const ruler=Array.from({length:width},(_,index)=>String((index+1)%10)).join('');
  const sample=printerMoney(SAMPLE_ITEM_PESEWAS,'GHS');
  const rule={text:'-'.repeat(width)};
  return [
    ...centred('MAKNAM POS',width,true),
    ...(details.vendorName.trim()?centred(details.vendorName,width):[]),
    ...centred('TEST PRINT - NOT A SALE',width,true),
    ...centred('No payment, stock or receipt number',width),
    rule,
    ...plain(wrap(`Printer: ${details.printerName}`,width)),
    ...plain(wrap(receiptDateTime(details),width)),
    rule,
    ...plain(wrap('Sample item (test only)',width)),
    ...plain(columns(`  1 x ${sample}`,sample,width)),
    ...columns('SAMPLE TOTAL',sample,width).map(text=>({text,bold:true})),
    rule,
    ...plain(wrap(`Width test: ${width} characters`,width)),
    {text:ruler},
    ...plain(wrap('ABC abc 0123456789',width)),
    ...plain(wrap('# @ % & * ( ) - + = / : .',width)),
    {text:'Left'},
    {text:'Centre',center:true},
    ...plain(columns('Left','Right',width)),
    rule,
    ...centred('*** END OF TEST ***',width,true),
  ];
}

export function encodeTestPrint(details:TestPrintDetails,width:number):Uint8Array{return encode(testReceiptLines(details,width));}

export function decodePrintable(bytes:Uint8Array):string[]{
  // Test helper: the text lines of an encoded job, with ESC sequences removed.
  const lines:string[]=[];let line='';
  for(let index=0;index<bytes.length;index++){
    const byte=bytes[index];
    if(byte===ESC){index+=bytes[index+1]===0x40?1:2;continue;}
    if(byte===LF){lines.push(line);line='';continue;}
    line+=String.fromCharCode(byte);
  }
  return lines;
}
