"use client";
import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import {journal,project,saveRecord} from '../../src/lib/operations';
import {listOrders} from '../../src/lib/db';
import type {AdminRecord,Data,EntityKind,JournalEntry} from '../../src/types/admin';
import type {LocalOrder} from '../../src/types/domain';
import {can} from '../../src/lib/access';
import {requireUser} from '../../src/lib/auth';

export function visibleEvents(entries:JournalEntry[],sales:LocalOrder[]){
 const user=requireUser();const ids=new Set(sales.map(s=>s.id));
 return entries.filter(({operation:e})=>{
  if(can('audit.view'))return true;
  if(['menu','category'].includes(e.kind))return can('menu.view')||can('pos.view');
  if(e.kind==='stock')return can('inventory.view')||can('pos.view');
  if(e.kind==='shift')return can('shifts.view_all')||can('shifts.view_own')&&(e.data.operatorId===user.id||e.actorId===user.id);
  if(e.kind==='cash')return can('shifts.view_all')||can('shifts.view_own')&&e.actorId===user.id;
  if(['payment','correction','workflow'].includes(e.kind)&&ids.has(String(e.data.orderId)))return true;
  if(e.kind==='workflow')return can('orders.view')||can('kitchen.view');
  if(e.kind==='expense')return can('expenses.view');
  if(['purchase','supplier'].includes(e.kind))return can('purchases.view');
  if(e.kind==='customer')return can('customers.view');
  if(e.kind==='staff')return can('team.view');
  if(e.kind==='device')return can('devices.view');
  return e.actorId===user.id&&['hold','system'].includes(e.kind);
 });
}

function useData(){
  const [records,setRecords]=useState<AdminRecord[]>([]);const [events,setEvents]=useState<JournalEntry[]>([]);const [orders,setOrders]=useState<LocalOrder[]>([]);const [error,setError]=useState('');
  const refresh=useCallback(async()=>{const [entries,sales]=await Promise.all([journal(),listOrders()]);const visible=visibleEvents(entries,sales);setEvents(visible);setRecords(project(visible));setOrders(sales.sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)));},[]);
  useEffect(()=>{const listener=()=>{void refresh().catch(error=>setError(String(error)));};queueMicrotask(listener);window.addEventListener('records-changed',listener);const timer=setInterval(listener,5000);return()=>{clearInterval(timer);window.removeEventListener('records-changed',listener);};},[refresh]);
  async function mutate(kind:EntityKind,data:Data,action:string,id?:string,revision?:number){
    await saveRecord(kind,data,action,id,revision);await refresh();window.dispatchEvent(new Event('records-changed'));
  }
  return {records,events,orders,error,refresh,mutate};
}
const Context=createContext<ReturnType<typeof useData>|null>(null);
export function AdminDataProvider({children}:{children:ReactNode}){const value=useData();return <Context.Provider value={value}>{children}</Context.Provider>;}
export function useAdminData(){const value=useContext(Context);if(!value)throw new Error('AdminDataProvider required');return value;}
