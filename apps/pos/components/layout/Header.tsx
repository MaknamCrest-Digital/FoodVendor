"use client";
import {StatusBadge} from '../ui/primitives';
import {PrinterStatus} from '../ui/SystemStatus';
import {usePos} from '../pos/PosProvider';
import {terminal} from '../../src/lib/config';
import {APP_VERSION} from '../../src/lib/version';
export default function Header(){
  const {online}=usePos();
  return <header className="topbar">
      <div className="brand"><div className="brand-mark">{terminal.brandMark}</div><div><h1>{terminal.businessName} <span>POS</span></h1><p>{terminal.locationName} <span>·</span> Terminal {terminal.terminalName}</p></div></div>
      <div className="status-group"><PrinterStatus/><StatusBadge tone={online?'success':'warning'} className={online?'':'connectivity-offline'} dot>{online?'Online':'Offline'}</StatusBadge><span className="version">v{APP_VERSION}</span></div>
    </header>;
}
