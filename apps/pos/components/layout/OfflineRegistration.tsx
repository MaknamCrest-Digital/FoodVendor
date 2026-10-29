"use client";
import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {captureInstallOffer} from '../../src/lib/install';
import {useAuth} from '../auth/AuthProvider';

captureInstallOffer();

const CHECK_INTERVAL_MS=30*60*1000;
// Settings → About dispatches this after its own update check so the banner picks it up.
export const UPDATE_CHECKED_EVENT='pos:update-checked';
// Set when this page asks the waiting version to take over. The first install also
// changes the controller (clients.claim) and must not reload the page.
let updateRequested=false;
function applyUpdate(worker:ServiceWorker){updateRequested=true;worker.postMessage({type:'SKIP_WAITING'});}

export default function OfflineRegistration(){
  const {session,loaded}=useAuth();
  const [waiting,setWaiting]=useState<ServiceWorker|null>(null);
  const [applying,setApplying]=useState(false);

  useEffect(()=>{
    if(process.env.NODE_ENV!=='production'||!('serviceWorker' in navigator))return;
    let registration:ServiceWorkerRegistration|undefined;
    // Only an update counts: the first install has no controller and nothing to replace.
    const offer=(worker:ServiceWorker|null)=>{if(worker&&navigator.serviceWorker.controller)setWaiting(worker);};
    // A worker can still be downloading when we first see it, e.g. a phone that found the
    // release on launch before React hydrated and so before updatefound was listened for.
    const track=(worker:ServiceWorker|null)=>{
      if(!worker)return;
      if(worker.state==='installed')offer(worker);
      else worker.addEventListener('statechange',()=>{if(worker.state==='installed')offer(worker);});
    };
    const recheck=()=>{if(registration){offer(registration.waiting);track(registration.installing);}};
    const check=()=>{if(document.visibilityState==='visible'){recheck();void registration?.update().then(recheck,()=>undefined);}};
    // Retain the old scope and URL so existing installations can update in place.
    void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(registered=>{
      registration=registered;
      registered.addEventListener('updatefound',()=>track(registered.installing));
      recheck();
    }).catch(()=>{
      console.warn('Offline app installation did not finish. Reconnect before closing the POS.');
    });
    let reloaded=false;
    const reload=()=>{if(updateRequested&&!reloaded){reloaded=true;window.location.reload();}};
    navigator.serviceWorker.addEventListener('controllerchange',reload);
    document.addEventListener('visibilitychange',check);
    window.addEventListener(UPDATE_CHECKED_EVENT,recheck);
    const timer=setInterval(check,CHECK_INTERVAL_MS);
    return()=>{navigator.serviceWorker.removeEventListener('controllerchange',reload);document.removeEventListener('visibilitychange',check);window.removeEventListener(UPDATE_CHECKED_EVENT,recheck);clearInterval(timer);};
  },[]);

  // A new version never replaces the app on its own while someone is signed in, so a
  // sale in progress is not interrupted. On the sign-in screen nothing can be lost.
  useEffect(()=>{if(waiting&&loaded&&!session)applyUpdate(waiting);},[waiting,loaded,session]);

  if(!waiting||!session)return null;
  return <div className="update-banner" role="status" aria-label="New update available">
    <span className="update-banner-icon" aria-hidden="true"><RefreshCw size={20}/></span>
    <span className="update-banner-text"><strong>New update available</strong><small>Finish the current sale, then update. Saved sales are kept.</small></span>
    <button type="button" disabled={applying} onClick={()=>{setApplying(true);applyUpdate(waiting);}}>{applying?'Updating…':'Update'}</button>
  </div>;
}
