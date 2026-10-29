// Chrome/Edge fire beforeinstallprompt once per page load, possibly before the
// header mounts (e.g. on the login page). Keep it until the header can offer it.
export type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
let deferred:InstallEvent|null=null;
const listeners=new Set<()=>void>();
let listening=false;

// Runs inline in <head>, before any app script: the offer can fire before the bundle
// that calls captureInstallOffer() has loaded (common when served from the offline cache).
export const EARLY_INSTALL_CAPTURE="addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__maknamInstallOffer=e;});";

export function captureInstallOffer(){
  if(listening||typeof window==='undefined')return;
  listening=true;
  const early=(window as Window&{__maknamInstallOffer?:InstallEvent}).__maknamInstallOffer;
  if(early)deferred=early;
  addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event as InstallEvent;listeners.forEach(notify=>notify());});
  addEventListener('appinstalled',()=>{deferred=null;(window as Window&{__maknamInstallOffer?:InstallEvent}).__maknamInstallOffer=undefined;listeners.forEach(notify=>notify());});
}
export function installOffer(){return deferred;}
export function clearInstallOffer(){deferred=null;(window as Window&{__maknamInstallOffer?:InstallEvent}).__maknamInstallOffer=undefined;listeners.forEach(notify=>notify());}
export function onInstallOffer(notify:()=>void){listeners.add(notify);return()=>{listeners.delete(notify);};}
