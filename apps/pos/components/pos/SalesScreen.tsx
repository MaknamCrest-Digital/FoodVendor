"use client";
import Link from 'next/link';
import {usePos} from './PosProvider';
import {paymentLabel} from './display';
import {money} from '../../src/services/checkout';
import {Button, DataTable, EmptyState, Input, MetricCard, PageHeader, StatusBadge} from '../ui/primitives';
import type {LocalOrder} from '../../src/types/domain';
import {useState} from 'react';
import {useAdminData} from '../admin/AdminData';
import {corrections,currentShift} from '../../src/lib/operations';
import {can} from '../../src/lib/access';
import RecordEditor from '../admin/RecordEditor';
import {num} from '../../src/types/admin';
import {useSettings} from '../settings/SettingsProvider';

export default function SalesScreen(){
  const {records,mutate}=useAdminData();const {settings}=useSettings();const [correction,setCorrection]=useState<{order:LocalOrder;type:'REFUND'|'VOID'}|null>(null);
  const {orders,pending,historyQuery,setHistoryQuery,pendingOnly,setPendingOnly,shownOrders,setReceipt}=usePos();
  return <section className="history">
    <PageHeader title="Sales history" eyebrow="THIS DEVICE" description="Saved orders and receipts, even when offline."
      action={<Link className="secondary" href="/pos/">+ New sale</Link>}/>
    <div className="history-summary">
      <MetricCard label="Recorded sales" value={orders.length}/>
      <MetricCard label={`Total recorded (${settings.general.currency})`} value={money(orders.filter(o=>(o.currency||'GHS')===settings.general.currency).reduce((sum,order)=>sum+order.totalPesewas,0))}/>
      <MetricCard label="Awaiting sync" value={pending}/>
    </div>
    <div className="history-tools">
      <label className="search"><Input type="search" aria-label="Search sales" placeholder="Search receipt or payment?" value={historyQuery} onChange={e=>setHistoryQuery(e.target.value)}/></label>
      <label className="filter"><input type="checkbox" checked={pendingOnly} onChange={e=>setPendingOnly(e.target.checked)}/> Pending only</label>
    </div>
    {shownOrders.length>0?<DataTable<LocalOrder> label="Sales history" rows={shownOrders} rowKey={order=>order.id} columns={[
      {key:'receipt',heading:'Receipt / payment',render:order=><><strong className="receipt-number">{order.receiptNo}</strong><small>{new Date(order.occurredAt).toLocaleString()} ? {paymentLabel(order.paymentMethod)}</small></>},
      {key:'total',heading:'Amount',render:order=><><strong>{money(order.totalPesewas,order.currency||'GHS')}</strong>{corrections(records,order.id)>0&&<small>Corrected: {money(corrections(records,order.id),order.currency||'GHS')}</small>}</>},
      {key:'status',heading:'Sync status',render:order=><StatusBadge tone={order.syncStatus==='SYNCED'?'success':'warning'}>{order.syncStatus==='SYNCED'?'Synced':'Pending'}</StatusBadge>},
      {key:'action',heading:'Actions',render:order=><div className="row-actions"><Button onClick={()=>setReceipt(order)}>Receipt</Button>{corrections(records,order.id)<order.totalPesewas&&<>{can('sales.refund')&&<Button onClick={()=>setCorrection({order,type:'REFUND'})}>Refund</Button>}{can('sales.void')&&!corrections(records,order.id)&&<Button onClick={()=>setCorrection({order,type:'VOID'})}>Void</Button>}</>}</div>},
    ]}/>:<EmptyState title={orders.length?'No matching sales':'No sales yet'}><p>{orders.length?'Try a different search or filter.':'Complete your first sale and it will appear here.'}</p></EmptyState>}
    {correction&&<RecordEditor title={`${correction.type==='VOID'?'Void':'Refund'} sale`} initial={{amount:correction.order.totalPesewas-corrections(records,correction.order.id),reason:''}} fields={[{key:'amount',label:`Amount (${correction.order.currency||'GHS'})`,type:'money',min:0.01},{key:'reason',label:'Reason'}]} onClose={()=>setCorrection(null)} onSave={async data=>{const shift=currentShift(records);if(correction.order.paymentMethod==='CASH'&&!shift)throw new Error('Open your shift before returning cash from the drawer.');await mutate('correction',{...data,amount:num(data,'amount'),type:correction.type,orderId:correction.order.id,paymentMethod:correction.order.paymentMethod,shiftId:shift?.id||null},correction.type==='VOID'?'SALE_VOIDED':'SALE_REFUNDED');}}><p>The original paid sale stays unchanged. This records a separate correction. Stock returns must be counted separately.</p></RecordEditor>}
  </section>;
}
