// Chrome/Edge fire beforeinstallprompt once per page load, possibly before the
// header mounts (e.g. on the login page). Keep it until the header can offer it.
export type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
let deferred:InstallEvent|null=null;
const listeners=new Set<()=>void>();
let listening=false;

export function captureInstallOffer(){
  if(listening||typeof window==='undefined')return;
  listening=true;
  addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event as InstallEvent;listeners.forEach(notify=>notify());});
  addEventListener('appinstalled',()=>{deferred=null;listeners.forEach(notify=>notify());});
}
export function installOffer(){return deferred;}
export function clearInstallOffer(){deferred=null;listeners.forEach(notify=>notify());}
export function onInstallOffer(notify:()=>void){listeners.add(notify);return()=>{listeners.delete(notify);};}
