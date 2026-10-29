import type {Metadata,Viewport} from 'next';
import type {ReactNode} from 'react';
import {AuthProvider} from '../components/auth/AuthProvider';
import OfflineRegistration from '../components/layout/OfflineRegistration';
import {EARLY_INSTALL_CAPTURE} from '../src/lib/install';
import './globals.css';
export const metadata:Metadata={
  title:'Maknam POS',
  description:'Offline-first POS for food vendors.',
  applicationName:'Maknam POS',
  manifest:'/manifest.webmanifest',
  icons:{icon:[{url:'/icons/icon-192.png',sizes:'192x192',type:'image/png'},{url:'/icons/icon.svg',type:'image/svg+xml'}],apple:'/icons/apple-touch-icon.png'},
  appleWebApp:{capable:true,title:'Maknam POS',statusBarStyle:'default'},
};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#0F586E'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><head><script dangerouslySetInnerHTML={{__html:EARLY_INSTALL_CAPTURE}}/></head><body><AuthProvider>{children}<OfflineRegistration/></AuthProvider></body></html>;}
