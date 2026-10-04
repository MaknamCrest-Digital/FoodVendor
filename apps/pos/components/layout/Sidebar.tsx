"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useRef} from 'react';
import {modules} from '../../src/lib/modules';

// The supplied UI had a category sidebar, not an ERP sidebar. Keep the cashier
// layout intact and expose the complete module navigation in a compact drawer.
export default function Sidebar(){
  const pathname=usePathname();
  const details=useRef<HTMLDetailsElement>(null);
  return <details className="module-menu" ref={details}>
    <summary>Modules</summary>
    <aside className="module-drawer" aria-label="Version 1 modules">
      <span className="eyebrow">FOOD VENDOR OS · VERSION 1</span>
      {modules.map(module=><Link key={module.href} href={module.href} aria-current={pathname.replace(/\/$/,'')===module.href.replace(/\/$/,'')?'page':undefined} onClick={()=>{if(details.current)details.current.open=false;}}>{module.title}</Link>)}
    </aside>
  </details>;
}
