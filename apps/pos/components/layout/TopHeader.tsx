"use client";
import {usePathname} from 'next/navigation';
import {Check,Menu,Printer as PrinterIcon,RefreshCw} from 'lucide-react';
import {useAuth} from '../auth/AuthProvider';
import {usePos} from '../pos/PosProvider';
import InstallPrompt from './InstallPrompt';
import {StatusBadge} from '../ui/primitives';
import {PrinterStatus} from '../ui/SystemStatus';
import {APP_VERSION} from '../../src/lib/version';

export function ConnectivityStatus({online}:{online:boolean}){return <StatusBadge tone={online?'success':'warning'} dot>{online?'Online':'Offline'}</StatusBadge>;}export default function TopHeader({toggleMenu}:{toggleMenu:()=>void}){
  const pathname=usePathname();const {session}=useAuth();const {online,sync,syncing,status,lastSync}=usePos();
  const syncTitle=`${status.detail} ${lastSync?`Last sync ${new Date(lastSync).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.`:'Not synced yet.'} Tap to sync now.`;
  const titles:{[key:string]:string}={'/':'Dashboard','/pos':'POS','/orders':'Orders','/kitchen':'Kitchen','/sales':'Sales','/menu':'Menu','/inventory':'Inventory','/purchases':'Purchases','/expenses':'Expenses','/customers':'Customers','/shifts':'Shifts','/staff':'Staff','/reports':'Reports','/devices':'Devices & Printers','/audit':'Audit Log','/settings':'Settings'};
  const title=titles[pathname.replace(/\/$/,'')]||'Dashboard';
  return <header className="admin-header"><div className="header-title"><button className="sidebar-toggle" aria-label="Toggle navigation" onClick={toggleMenu}><Menu size={20}/></button><div><strong>{title}</strong><small>Maknam POS <span>/</span> {session?.user.locationName||'Dansoman'}</small></div></div><div className="header-status"><ConnectivityStatus online={online}/><button className={`sync-button sync-${status.phase.toLowerCase()}`} onClick={()=>void sync()} disabled={syncing||!online} title={syncTitle} aria-label={`${status.label}. Sync now`}>{status.phase==='SYNCED'?<Check size={15}/>:<RefreshCw size={15} className={syncing?'spin':''}/>}<span>{status.label}</span></button><InstallPrompt/><span className="printer-status"><PrinterIcon size={15}/><span>Printer</span><PrinterStatus/></span></div><div className="admin-identity"><span className="sidebar-avatar">{(session?.user.name||'A').slice(0,1).toUpperCase()}</span><span><strong>{session?.user.name||'Admin'}</strong><small>{session?.user.roleName||session?.user.role}</small></span><Check size={14} className="identity-check"/></div><small className="header-version">v{APP_VERSION}</small></header>;
}

