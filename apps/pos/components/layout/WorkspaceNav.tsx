"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {usePos} from '../pos/PosProvider';
import Sidebar from './Sidebar';

export default function WorkspaceNav(){
  const pathname=usePathname();
  const {pending,syncing,sync}=usePos();
  return <nav className="workspace-nav" aria-label="Workspace">
    <div className="tabs">
      <Link className={pathname.startsWith('/pos')?'selected':''} aria-current={pathname.startsWith('/pos')?'page':undefined} href="/pos/">New sale</Link>
      <Link className={pathname.startsWith('/sales')?'selected':''} aria-current={pathname.startsWith('/sales')?'page':undefined} href="/sales/">Sales history {pending>0&&<span className="count">{pending}</span>}</Link>
      <Sidebar/>
    </div>
    <button className="sync-button" onClick={()=>void sync()} disabled={syncing}><span className={pending?'pending-dot':'sync-dot'}/>{syncing?'Syncing…':pending?`${pending} pending · Sync now`:'Sync now'}</button>
  </nav>;
}
