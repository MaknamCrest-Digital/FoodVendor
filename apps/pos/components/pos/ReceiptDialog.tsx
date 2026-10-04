"use client";
import {Button} from '../ui/primitives';
import Dialog from '../ui/Dialog';
import {usePos} from './PosProvider';
import ReceiptPreview from '../settings/ReceiptPreview';
import {can} from '../../src/lib/access';
export default function ReceiptDialog(){const {receipt,setReceipt,receiptStatus,reprint}=usePos();if(!receipt)return null;return <Dialog title="Sale completed" onClose={()=>setReceipt(null)}><p role="status">{receiptStatus}</p><ReceiptPreview order={receipt}/><p className="muted">The receipt is saved with this sale. Printer output is reported by the selected print destination.</p>{can('pos.receipt.reprint')&&<Button variant="primary" onClick={()=>void reprint(receipt)}>Print again</Button>}<Button onClick={()=>setReceipt(null)}>Done · New order</Button></Dialog>;}
