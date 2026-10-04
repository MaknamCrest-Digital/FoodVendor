"use client";
import {useEffect} from 'react';
import {captureInstallOffer} from '../../src/lib/install';

captureInstallOffer();

export default function OfflineRegistration(){
  useEffect(()=>{
    if(process.env.NODE_ENV!=='production'||!('serviceWorker' in navigator))return;
    // Retain the old scope and URL so existing installations can update in place.
    // No skipWaiting: open tills keep their current application until closed.
    void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{
      console.warn('Offline app installation did not finish. Reconnect before closing the POS.');
    });
  },[]);
  return null;
}
