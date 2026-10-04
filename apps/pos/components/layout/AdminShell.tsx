"use client";
import {useState,type ReactNode} from 'react';
import AppSidebar from './AppSidebar';
import TopHeader from './TopHeader';
import Notice from './Notice';
import ReceiptDialog from '../pos/ReceiptDialog';
import {usePathname} from 'next/navigation';
import {useAuth} from '../auth/AuthProvider';
import {routeAllowed} from '../../src/lib/access';
export default function AdminShell({children}:{children:ReactNode}){
  const [open,setOpen]=useState(false);
  const path=usePathname();const {session}=useAuth();
  return <div className={`admin-shell ${open?'nav-open':''}`}><AppSidebar onNavigate={()=>setOpen(false)}/>{open&&<button className="sidebar-scrim" aria-label="Close navigation" onClick={()=>setOpen(false)}/>}<div className="admin-main"><TopHeader toggleMenu={()=>setOpen(!open)}/><Notice/><main>{routeAllowed(path,session?.user)?children:<section className="module-page"><h1>Access restricted</h1><p>Your role does not allow this page. Contact your Owner if you need access.</p></section>}</main></div><ReceiptDialog/></div>;
}
