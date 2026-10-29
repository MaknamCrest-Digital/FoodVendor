"use client";
import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {captureInstallOffer} from '../../src/lib/install';
import {useAuth} from '../auth/AuthProvider';

captureInstallOffer();

const CHECK_INTERVAL_MS=30*60*1000;
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
    const check=()=>{if(document.visibilityState==='visible')void registration?.update().catch(()=>undefined);};
    // Retain the old scope and URL so existing installations can update in place.
    void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(registered=>{
      registration=registered;
      offer(registered.waiting);
      registered.addEventListener('updatefound',()=>{
        const worker=registered.installing;
        worker?.addEventListener('statechange',()=>{if(worker.state==='installed')offer(worker);});
      });
    }).catch(()=>{
      console.warn('Offline app installation did not finish. Reconnect before closing the POS.');
    });
    let reloaded=false;
    const reload=()=>{if(updateRequested&&!reloaded){reloaded=true;window.location.reload();}};
    navigator.serviceWorker.addEventListener('controllerchange',reload);
    document.addEventListener('visibilitychange',check);
    const timer=setInterval(check,CHECK_INTERVAL_MS);
    return()=>{navigator.serviceWorker.removeEventListener('controllerchange',reload);document.removeEventListener('visibilitychange',check);clearInterval(timer);};
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
