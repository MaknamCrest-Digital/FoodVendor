"use client";
import {Button} from '../ui/primitives';
import Dialog from '../ui/Dialog';
import {usePos} from './PosProvider';
import ReceiptPreview from '../settings/ReceiptPreview';
import {can} from '../../src/lib/access';
export default function ReceiptDialog(){const {receipt,closeReceipt,receiptStatus,printReceipt,unprintedReceiptId}=usePos();if(!receipt)return null;const first=receipt.id===unprintedReceiptId;return <Dialog title="Sale completed" onClose={closeReceipt}><p role="status">{receiptStatus}</p><ReceiptPreview order={receipt}/><p className="muted">The receipt is saved with this sale. Printer output is reported by the selected print destination.</p>{(first?can('pos.sale.create'):can('pos.receipt.reprint'))&&<Button variant="primary" onClick={()=>void printReceipt(receipt)}>{first?'Print receipt':'Print again'}</Button>}<Button onClick={closeReceipt}>Done · New order</Button></Dialog>;}
