"use client";
import {useSyncExternalStore} from 'react';
import {Download,X} from 'lucide-react';
import {clearInstallOffer,installOffer,onInstallOffer} from '../../src/lib/install';

const DISMISSED='maknam-install-dismissed-at';
const QUIET_DAYS=14;

function installed(){
  return window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
}
function recentlyDismissed(){
  try{const at=Number(localStorage.getItem(DISMISSED)||0);return Date.now()-at<QUIET_DAYS*864e5;}catch{return false;}
}
function dismiss(){try{localStorage.setItem(DISMISSED,String(Date.now()));}catch{/* prompt simply returns next visit */}clearInstallOffer();}

// Shown only when the browser offers installation; never once installed.
export default function InstallPrompt(){
  const offer=useSyncExternalStore(onInstallOffer,installOffer,()=>null);
  if(!offer||installed()||recentlyDismissed())return null;
  async function install(){
    clearInstallOffer();
    await offer!.prompt();
    if((await offer!.userChoice).outcome==='dismissed')dismiss();
  }
  return <span className="install-prompt"><button type="button" className="install-button" onClick={()=>void install()}><Download size={14}/>Install Maknam POS</button><button type="button" className="install-dismiss" aria-label="Not now" title="Not now" onClick={dismiss}><X size={14}/></button></span>;
}
