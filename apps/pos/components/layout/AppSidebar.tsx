"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useState} from 'react';
import {BarChart3,Boxes,ChefHat,ChevronLeft,ChevronRight,ClipboardList,Clock3,LayoutDashboard,LogOut,Printer,ReceiptText,Settings,ShieldCheck,ShoppingCart,Truck,UserCog,Users,WalletCards,UtensilsCrossed} from 'lucide-react';
import {useConnectivity} from '../../hooks/useConnectivity';
import {useAuth} from '../auth/AuthProvider';
import {routeAllowed} from '../../src/lib/access';
import {usePos} from '../pos/PosProvider';

// Unsynced records are kept on the device (scoped to their tenant and user)
// and sync at that user's next sign-in; they are never deleted here.
function confirmSignOut(queued:number,online:boolean){
  const notes=[queued?`${queued} ${queued===1?'item has':'items have'} not synced yet. ${queued===1?'It stays':'They stay'} saved on this device and will sync the next time you sign in.`:'',online?'':'You are offline. Signing in again needs an internet connection.'].filter(Boolean);
  return !notes.length||window.confirm(`${notes.join('\n\n')}\n\nSign out anyway?`);
}

const navigation=[
  {label:'MAIN',items:[['/','Dashboard',LayoutDashboard],['/pos/','POS',ShoppingCart],['/orders/','Orders',ClipboardList],['/kitchen/','Kitchen',ChefHat]]},
  {label:'OPERATIONS',items:[['/sales/','Sales',ReceiptText],['/menu/','Menu',UtensilsCrossed],['/inventory/','Inventory',Boxes],['/purchases/','Purchases',Truck],['/expenses/','Expenses',WalletCards],['/customers/','Customers',Users]]},
  {label:'PEOPLE',items:[['/shifts/','Shifts',Clock3],['/staff/','Staff',UserCog]]},
  {label:'INSIGHTS',items:[['/reports/','Reports',BarChart3]]},
  {label:'SYSTEM',items:[['/devices/','Devices & Printers',Printer],['/audit/','Audit Log',ShieldCheck],['/settings/','Settings',Settings]]},
] as const;
export default function AppSidebar({onNavigate}:{onNavigate:()=>void}){
  const pathname=usePathname();
  const {session,signOut}=useAuth();
  const online=useConnectivity();
  const {queued}=usePos();
  const [collapsed,setCollapsed]=useState(()=>typeof window!=='undefined'&&localStorage.getItem('maknam-sidebar-collapsed')==='true');
  function toggle(){setCollapsed(value=>{const next=!value;localStorage.setItem('maknam-sidebar-collapsed',String(next));return next;});}
  return <aside className={`app-sidebar ${collapsed?'is-collapsed':''}`}>
    <div className="sidebar-brand-row"><Link href="/" className="platform-brand" onClick={onNavigate}><span className="brand-mark">M</span><span className="brand-copy"><strong>Maknam POS</strong><small>VERSION 1.0</small></span></Link><button className="sidebar-collapse" type="button" onClick={toggle} aria-label={collapsed?'Expand navigation':'Collapse navigation'} title={collapsed?'Expand navigation':'Collapse navigation'}>{collapsed?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></div>
    <div className="sidebar-location"><strong>{session?.user.businessName||'Adonai Pork'}</strong><span>{session?.user.locationName||'Dansoman'}</span></div>
    <nav aria-label="Admin navigation">{navigation.filter(group=>group.items.some(([href])=>routeAllowed(href,session?.user))).map(group=><section key={group.label}><p className="eyebrow">{group.label}</p>{group.items.filter(([href])=>routeAllowed(href,session?.user)).map(([href,title,Icon])=>{const active=pathname.replace(/\/$/,'')===href.replace(/\/$/,'');return <Link key={href} href={href} aria-current={active?'page':undefined} onClick={onNavigate} title={collapsed?title:undefined}><Icon size={18} strokeWidth={1.9} aria-hidden="true"/><span>{title}</span></Link>;})}</section>)}</nav>
    <div className="sidebar-footer"><div className="sidebar-user"><span className="sidebar-avatar">{(session?.user.name||'Owner').slice(0,1).toUpperCase()}</span><span><strong>{session?.user.name||'Owner'}</strong><small>{session?.user.roleName||session?.user.role}</small></span></div><div className={`sidebar-online ${online?"":"sidebar-offline"}`}><i/>{online?"Online":"Offline"}</div><small className="sidebar-version">Version 1.0</small><button className="sidebar-signout" type="button" onClick={()=>{if(confirmSignOut(queued,online))void signOut().catch(()=>{/* local session is already cleared */});}} title="Sign out"><LogOut size={17}/><span>Sign Out</span></button></div>
  </aside>;
}

