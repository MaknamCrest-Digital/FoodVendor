"use client";
import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import type {CartLine, LocalOrder, PaymentMethod,MenuItem,Variation} from '../../src/types/domain';
import {listOrders} from '../../src/lib/db';
import {completeSale, money} from '../../src/services/checkout';
import {configuredMenu,categories as menuCategories} from '../../src/lib/menu';
import {useAdminData} from '../admin/AdminData';
import {printer,browserFallback,type PrintDestination} from '../../src/services/printer';
import {syncPending} from '../../src/services/sync';
import {paymentLabel} from './display';
import {useConnectivity} from '../../hooks/useConnectivity';
import {useSettings} from '../settings/SettingsProvider';
import {requirePermission} from '../../src/lib/access';
import {logSystem} from '../../src/lib/operations';
import {syncStatus} from '../../src/lib/syncStatus';
import {useAuth} from '../auth/AuthProvider';

function usePosState() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [category, setCategory] = useState('');
  const admin=useAdminData();
  const {settings}=useSettings();
  const menu=configuredMenu(admin.records);
  const categories=menuCategories(admin.records).filter(c=>c.data.active!==false);
  const [query, setQuery] = useState('');
  const online = useConnectivity();
  const [orders, setOrders] = useState<LocalOrder[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>(settings.payments.defaultMethod);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncState, setSyncState] = useState('Checking sync');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [receipt, setReceipt] = useState<LocalOrder|null>(null);
  const [receiptStatus,setReceiptStatus]=useState('');
  const paying = useRef(false);
  const {session}=useAuth();
  const [lastRun,setLastRun]=useState<{synced:number;failed:number;at:string}|null>(null);
  const lastSyncKey=session?`last-sync:${session.user.businessId}:${session.user.locationId}`:'';
  const [lastSync,setLastSync]=useState<string|null>(null);

  const refresh = useCallback(async () => {
    const saved = await listOrders();
    setOrders(saved.sort((a,b) => b.occurredAt.localeCompare(a.occurredAt)));
    setReady(true);
  }, [setOrders,setReady]);
  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await syncPending();
      setSyncState(result.offline ? 'Offline · saved on device' : result.failed ? 'Sync unavailable · will retry' : 'Sync up to date');
      if(!result.offline)setLastRun({synced:result.synced,failed:result.failed,at:new Date().toISOString()});
      try{if(lastSyncKey)setLastSync(localStorage.getItem(lastSyncKey));}catch{/* storage blocked: status only */}
      await refresh();
    } catch {
      setSyncState('Local storage unavailable');
      setNotice('Unable to read local sales. Check browser storage before taking payments.');
    } finally {setSyncing(false);}
  }, [refresh,setNotice,setSyncing,setSyncState,lastSyncKey]);
  useEffect(() => {
    // Load local data immediately, even if an API request is slow or unavailable.
    let mounted=true;
    void listOrders().then(saved=>{
      if(!mounted)return;
      setOrders(saved.sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)));
      setReady(true);
      return sync();
    }).catch(()=>{if(mounted)setNotice('Local storage is unavailable. Sales are disabled until storage is restored.');});
    const on = () => {void sync();};
    const off = () => {setSyncState('Offline · saved on device');};
    // Resume: tablets sleep and installed apps are restored from the background.
    const resume = () => {if(document.visibilityState==='visible')void sync();};
    addEventListener('online', on); addEventListener('offline', off);
    addEventListener('focus', resume); addEventListener('pageshow', resume); document.addEventListener('visibilitychange', resume);
    const timer = setInterval(() => {void sync();}, 10000);
    return () => {mounted=false;clearInterval(timer); removeEventListener('online', on); removeEventListener('offline', off); removeEventListener('focus', resume); removeEventListener('pageshow', resume); document.removeEventListener('visibilitychange', resume);};
  }, [sync]);

  const total = cart.reduce((sum,item) => sum + item.pricePesewas * item.quantity, 0);
  const count = cart.reduce((sum,item) => sum + item.quantity, 0);
  const pending = orders.filter(order => order.syncStatus === 'PENDING').length;
  // Sale stock movements travel inside the sale; count every other unsynced operation by this user.
  const pendingOperations=admin.events.filter(entry=>!entry.synced&&entry.operation.actorId===session?.user.id&&!(entry.operation.kind==='stock'&&entry.operation.data.type==='SALE'));
  const queued=pending+pendingOperations.length;
  const rejected=orders.filter(order=>order.syncStatus==='PENDING'&&order.syncError).length+pendingOperations.filter(entry=>entry.syncError).length;
  const status=syncStatus({online,syncing,pending:queued,rejected,lastRunFailed:!!lastRun?.failed});
  const shownMenu = menu.filter(item => item.active&&(query.trim() ? item.name.toLowerCase().includes(query.trim().toLowerCase()) : !category||item.categoryId === category));
  const shownOrders = orders.filter(order => (!pendingOnly || order.syncStatus === 'PENDING') && `${order.receiptNo} ${order.paymentMethod}`.toLowerCase().includes(historyQuery.toLowerCase()));

  function changeQuantity(id: string, delta: number) {
    if (paying.current) return;
    if(delta>0){const line=cart.find(row=>row.id===id);if(!line)return;const item=menu.find(row=>row.id===(line.menuItemId||line.id));if(!item?.isAvailable||!item.active){setNotice('This item is unavailable. Remove it from the order.');return;}const count=cart.filter(row=>(row.menuItemId||row.id)===item.id).reduce((sum,row)=>sum+row.quantity,0);if(item.trackStock&&!settings.pos.allowNegativeStock&&count+delta>(item.stockQuantity||0)){setNotice(`Only ${item.stockQuantity} ${item.stockUnit} available.`);return;}}
    setCart(current => current.map(item => item.id === id ? {...item, quantity:item.quantity + delta} : item).filter(item => item.quantity > 0));
  }
  function addItem(item:MenuItem,variation?:Variation){
    if(paying.current||!ready||busy)return;
    if(!item.isAvailable||!item.active){setNotice(`${item.name} is sold out.`);return;}
    if(item.pricingType==='VARIATIONS'&&!variation){setNotice('Choose a variation first.');return;}
    const count=cart.filter(row=>(row.menuItemId||row.id)===item.id).reduce((sum,row)=>sum+row.quantity,0);
    if(item.trackStock&&!settings.pos.allowNegativeStock&&count+1>(item.stockQuantity||0)){setNotice(`Only ${item.stockQuantity} ${item.stockUnit} available.`);return;}
    const id=variation?`${item.id}:${variation.id}`:item.id;
    setCart(current=>current.some(row=>row.id===id)?current.map(row=>row.id===id?{...row,quantity:row.quantity+1}:row):[...current,{...item,id,menuItemId:item.id,name:variation?`${item.name} · ${variation.name}`:item.name,variationId:variation?.id,variationName:variation?.name,pricePesewas:variation?.pricePesewas??item.pricePesewas,quantity:1}]);
    setNotice('');
  }
  async function pay(options:{amountTendered?:number;paymentReference?:string}={}) {
    if (paying.current || !cart.length || !ready) return;
    paying.current = true; setBusy(true); setNotice('');
    let saved: LocalOrder;
    try {saved = await completeSale(cart, payment,options);} catch(error) {
      setNotice(`Sale was not saved. ${error instanceof Error?error.message:'Check device storage and try again.'}`);
      paying.current = false; setBusy(false); return;
    }
    setCart([]); setOrders(current => [saved, ...current]);
    void admin.refresh();window.dispatchEvent(new Event('records-changed'));
    const defaultPrinter=settings.device.printers.find(item=>item.id===settings.device.defaultPrinterId);
    setReceiptStatus(settings.pos.autoPrint?(defaultPrinter?'Preparing receipt for the configured printer…':'No default printer configured. The saved receipt is ready to print.'):'Automatic printing is disabled. The saved receipt is ready to print.');
    setReceipt(saved);
    setNotice(`Sale completed · ${money(saved.totalPesewas)} · ${paymentLabel(saved.paymentMethod)}. Receipt ready; start a fresh order when done.`);
    paying.current = false;
    setBusy(false);
    if(settings.pos.autoPrint&&defaultPrinter)void printSavedReceipt(saved,defaultPrinter);
    void sync();
    return saved;
  }

  async function printSavedReceipt(order:LocalOrder,destination:PrintDestination){
    if(!printer.isAvailable(destination)){
      setReceiptStatus(`${destination.name} is not available in this build. The sale is saved; use Print again to open the browser fallback.`);
      try{await logSystem('PRINT_FAILED','No print adapter is available for the configured default destination',order.id);}
      catch(error){console.error('Could not record the receipt print failure.',error);}
      return;
    }
    setReceiptStatus(`Sending receipt to ${destination.name}…`);
    try{
      await printer.printReceipt(order,destination);
      setReceiptStatus('Print dialog closed. Check the printer; use Print again if no receipt came out.');
      try{await logSystem('PRINT_DIALOG_CLOSED','Print dialog closed; physical output cannot be confirmed by the browser',order.id);}
      catch(error){console.error('Could not record receipt print status.',error);}
    }catch(error){
      setReceiptStatus(`Sale saved. ${error instanceof Error?error.message:'Printing failed.'} Use Print again to retry.`);
      try{await logSystem('PRINT_FAILED','Receipt printing failed after the sale was saved',order.id);}
      catch(logError){console.error('Could not record the receipt print failure.',logError);}
    }
  }

  async function reprint(order: LocalOrder) {
    try {
      requirePermission('pos.receipt.reprint');
      const destination=settings.device.printers.find(item=>item.id===settings.device.defaultPrinterId);
      const selected=destination&&printer.isAvailable(destination)?destination:null;
      const target=selected||browserFallback(order);
      setReceiptStatus(selected?'Sending saved receipt to the configured printer…':'Configured printer unavailable. Opening the browser print fallback…');
      await printer.printReceipt(order,target);
      setReceiptStatus('Print dialog closed. Check the printer; use Print again if no receipt came out.');
      await logSystem('RECEIPT_REPRINT_DIALOG_CLOSED','Print dialog closed for a saved receipt',order.id);
    } catch(error) {
      setReceiptStatus(`The sale is safe. ${error instanceof Error?error.message:'Could not open the system print dialog.'}`);
      setNotice('The sale is safe. The receipt is still available to print again.');
    }
  }


  return {status,queued,lastRun,lastSync,cart,setCart,category,setCategory,categories,query,setQuery,online,orders,payment,setPayment,busy,syncing,syncState,notice,setNotice,ready,historyQuery,setHistoryQuery,pendingOnly,setPendingOnly,receipt,setReceipt,receiptStatus,paying,total,count,pending,shownMenu,shownOrders,changeQuantity,addItem,pay,reprint,sync};
}

const PosContext = createContext<ReturnType<typeof usePosState>|null>(null);
export function PosProvider({children}:{children:ReactNode}) {
  const state=usePosState();
  return <PosContext.Provider value={state}>{children}</PosContext.Provider>;
}
export function usePos() {
  const state=useContext(PosContext);
  if (!state) throw new Error('POS components require PosProvider');
  return state;
}
