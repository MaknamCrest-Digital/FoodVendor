"use client";
import {useState} from 'react';
import Dialog from '../ui/Dialog';
import {Button,DataTable,StatusBadge} from '../ui/primitives';
import {useAdminData} from '../admin/AdminData';
import {menuMovements,updateStock} from '../../src/lib/menu';
import {num,str} from '../../src/types/admin';
import type {MenuItem} from '../../src/types/domain';
export function StockDialog({item,onClose,initialMode='ADD'}:{item:MenuItem;onClose:()=>void;initialMode?:'ADD'|'REMOVE'|'SET'}){
  const {refresh}=useAdminData();const [mode,setMode]=useState(initialMode);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <Dialog title={`Update stock · ${item.name}`} onClose={onClose} busy={busy}><p className="owner-intro">Current stock: <strong>{item.stockQuantity} {item.stockUnit}</strong></p><form className="owner-form" onSubmit={async event=>{
    event.preventDefault();if(busy)return;setBusy(true);setError('');const form=new FormData(event.currentTarget);
    try{await updateStock(item.id,mode,Number(form.get('quantity')),String(form.get('reason')||''),item.stockQuantity||0,mode==='REMOVE'&&form.get('wastage')==='on'?'WASTAGE':undefined);await refresh();window.dispatchEvent(new Event('records-changed'));onClose();}catch(error){setError(error instanceof Error?error.message:'Unable to update stock.');}finally{setBusy(false);}
  }}><div className="owner-segment" role="group" aria-label="Stock action">{(['ADD','REMOVE','SET'] as const).map(value=><Button key={value} type="button" variant={mode===value?'primary':'secondary'} aria-pressed={mode===value} onClick={()=>setMode(value)}>{value==='ADD'?'Add stock':value==='REMOVE'?'Remove stock':'Set count'}</Button>)}</div><label>{mode==='SET'?'Counted quantity':'Quantity'}<input name="quantity" type="number" min={mode==='SET'?0:1} step="1" required autoFocus/></label><label>Reason {mode==='ADD'?'(optional)':''}<input name="reason" required={mode!=='ADD'} maxLength={500}/></label>{mode==='REMOVE'&&<label className="owner-check"><input name="wastage" type="checkbox"/>Record as wastage</label>}{error&&<p role="alert" className="form-error">{error}</p>}<div className="form-actions"><Button type="button" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy?'Saving…':'Save stock update'}</Button></div></form></Dialog>;
}
export function MovementHistory({item,onClose}:{item:MenuItem;onClose:()=>void}){
  const {records,events}=useAdminData();const rows=menuMovements(records,item.id);
  return <Dialog title={`Movement history · ${item.name}`} onClose={onClose} wide><p className="owner-intro">{item.stockQuantity} {item.stockUnit} on hand. Every change remains in this history.</p><DataTable label="Stock movements" rows={rows} rowKey={r=>r.id} columns={[
    {key:'time',heading:'Time / recorded by',render:r=><>{new Date(r.updatedAt).toLocaleString()}<small>{events.find(e=>e.operation.entityId===r.id)?.operation.actorId.slice(0,8)}</small></>},
    {key:'type',heading:'Type',render:r=>str(r.data,'type')},
    {key:'delta',heading:'Change',render:r=><strong>{num(r.data,'quantityDelta')>0?'+':''}{num(r.data,'quantityDelta')}</strong>},
    {key:'before',heading:'Before → after',render:r=>`${r.data.balanceBefore} → ${r.data.balanceAfter}`},
    {key:'reason',heading:'Reason / reference',render:r=><>{str(r.data,'reason','—')}<small>{str(r.data,'referenceId')}</small></>},
    {key:'sync',heading:'Sync',render:r=><StatusBadge tone={r.error?'danger':r.pending?'warning':'success'}>{r.error?'Needs review':r.pending?'Pending':'Synced'}</StatusBadge>},
  ]}/>{rows.length===0&&<p className="owner-intro">No stock movements yet.</p>}</Dialog>;
}
