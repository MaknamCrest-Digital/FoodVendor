import type {PaperProfile,Settings} from './settings';
import {money} from './settings';
import type {LocalOrder} from '../types/domain';

export type ReceiptSnapshot={general:Settings['general'];location:Settings['location'];receipts:Settings['receipts'];terminalName:string;paperProfile?:PaperProfile};
export type ReceiptDocument={
 business:{name:string;address:string;phone:string;logo:string};
 location:{name:string;address:string;phone:string};
 receiptNumber:string;
 orderNumber:string;
 dateTime:string;
 cashier:string;
 items:Array<{name:string;variation?:string;quantity:number;unitPrice:number;lineTotal:number}>;
 subtotal:number;
 discount:number;
 total:number;
 currency:NonNullable<LocalOrder['currency']>;
 timezone:string;
 dateFormat:Settings['general']['dateFormat'];
 timeFormat:Settings['general']['timeFormat'];
 paymentMethod:LocalOrder['paymentMethod'];
 amountTendered?:number;
 change:number;
 paymentReference:string;
 collectionMessage:string;
 footer:string;
 template:Settings['receipts'];
};
export type ReceiptOutput='SCREEN'|'THERMAL'|'THERMAL_58'|'THERMAL_80'|'A4'|'LETTER';

const defaultTemplate:Settings['receipts']={showLogo:false,showBusinessName:true,showAddress:true,showPhone:true,showCashier:true,showPaymentMethod:true,showOrderNumber:true,showReceiptNumber:true,paperWidth:80,collectionMessage:'',footer:'Thank you for your purchase.'};

export function toReceiptDocument(order:LocalOrder):ReceiptDocument{
 const snapshot=order.receiptSnapshot;
 const general=snapshot?.general;
 const items=order.items.map(item=>({name:item.name,variation:item.variationName,quantity:item.quantity,unitPrice:item.unitPricePesewas,lineTotal:item.quantity*item.unitPricePesewas}));
 const subtotal=items.reduce((sum,item)=>sum+item.lineTotal,0);
 return {
  business:{name:general?.businessName||'Sale receipt',address:general?.address||'',phone:general?.phone||'',logo:general?.logo||''},
  location:{name:snapshot?.location.name||'',address:snapshot?.location.address||'',phone:snapshot?.location.phone||''},
  receiptNumber:order.receiptNo,orderNumber:order.id.slice(0,8),dateTime:order.occurredAt,cashier:order.cashierName||'',
  items,subtotal,discount:Math.max(0,subtotal-order.totalPesewas),total:order.totalPesewas,currency:order.currency||'GHS',
  timezone:general?.timezone||'Africa/Accra',dateFormat:general?.dateFormat||'DD/MM/YYYY',timeFormat:general?.timeFormat||'24h',
  paymentMethod:order.paymentMethod,amountTendered:order.amountTendered,change:order.change||0,paymentReference:order.paymentReference||'',
  collectionMessage:snapshot?.receipts.collectionMessage||'',footer:snapshot?.receipts.footer||defaultTemplate.footer,template:snapshot?.receipts||defaultTemplate,
 };
}

export function renderReceipt(document:ReceiptDocument):string[]{
 const fields=document.template;
 const date=new Date(document.dateTime);
 const dateParts=new Intl.DateTimeFormat('en-GB',{timeZone:document.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const part=(type:string)=>dateParts.find(value=>value.type===type)?.value||'';
 const day=document.dateFormat.replace('DD',part('day')).replace('MM',part('month')).replace('YYYY',part('year'));
 const lines:string[]=[];
 if(fields.showBusinessName)lines.push(document.business.name);
 if(fields.showAddress)lines.push(document.location.address||document.business.address);
 if(fields.showPhone)lines.push(document.location.phone||document.business.phone);
 if(fields.showReceiptNumber)lines.push(`Receipt: ${document.receiptNumber}`);
 if(fields.showOrderNumber)lines.push(`Order: ${document.orderNumber}`);
 lines.push(`${day} ${date.toLocaleTimeString('en-GB',{timeZone:document.timezone,hour12:document.timeFormat==='12h'})}`);
 if(fields.showCashier)lines.push(`Cashier: ${document.cashier||'—'}`);
 lines.push(...document.items.map(item=>`${item.quantity} × ${item.name}  ${money(item.lineTotal,document.currency)}`));
 lines.push(`Subtotal: ${money(document.subtotal,document.currency)}`);
 if(document.discount>0)lines.push(`Discount: ${money(document.discount,document.currency)}`);
 lines.push(`Total: ${money(document.total,document.currency)}`);
 if(fields.showPaymentMethod)lines.push(`Payment: ${document.paymentMethod}`);
 if(document.amountTendered!=null)lines.push(`Tendered: ${money(document.amountTendered,document.currency)}`,`Change: ${money(document.change,document.currency)}`);
 if(document.paymentReference)lines.push(`Reference: ${document.paymentReference}`);
 if(document.collectionMessage)lines.push(document.collectionMessage);
 if(document.footer)lines.push(document.footer);
 return lines.filter(Boolean);
}

export function receiptLines(order:LocalOrder){return renderReceipt(toReceiptDocument(order));}

function escapeHtml(value:string){return value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));}
export function renderReceiptHtml(document:ReceiptDocument,output:ReceiptOutput='SCREEN'){
 const profile=output==='THERMAL'?'THERMAL_80':output;
 const width=profile==='THERMAL_58'?'58mm':profile==='THERMAL_80'?'80mm':profile==='A4'?'210mm':profile==='LETTER'?'8.5in':'auto';
 const maxWidth=profile==='THERMAL_58'?'50mm':profile==='THERMAL_80'?'72mm':profile==='A4'?'190mm':profile==='LETTER'?'7.5in':'100%';
 const content=renderReceipt(document).map(line=>`<div>${escapeHtml(line)}</div>`).join('');
 const logo=document.template.showLogo&&document.business.logo?`<img src="${escapeHtml(document.business.logo)}" alt="" style="display:block;max-width:35mm;max-height:25mm;margin:0 auto 4mm">`:'';
 const pageRule=output==='SCREEN'?'@page{margin:0}':profile.startsWith('THERMAL_')?`@page{size:${width} auto;margin:4mm}`:`@page{size:${profile.toLowerCase()};margin:12mm}`;
 return `<!doctype html><html><head><meta charset="utf-8"><style>${pageRule}html,body{margin:0;padding:0}body{box-sizing:border-box;background:#fff;color:#18222b;font:12px/1.55 ui-monospace,monospace;width:${width};max-width:${maxWidth};padding:4mm;overflow-wrap:anywhere}body>div{margin:3px 0;white-space:pre-wrap}</style></head><body>${logo}${content}</body></html>`;
}
