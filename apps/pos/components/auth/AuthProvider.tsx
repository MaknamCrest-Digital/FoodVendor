"use client";
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {readSession,saveSession,login,type Session} from '../../src/lib/auth';
import {API_BASE_URL} from '../../src/lib/config';
import {AuthError,identity} from '../../src/lib/identity';

type Auth={session:Session|null;loaded:boolean;signIn:(email:string,password:string)=>Promise<void>;signOut:()=>Promise<void>};
const Context=createContext<Auth|null>(null);

export function AuthProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<Session|null>(null);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    const restore=()=>{setSession(readSession());setLoaded(true);};
    const auth=identity();
    const refreshProfile=async(accessToken:string)=>{
      const saved=readSession();
      if(!saved||!navigator.onLine)return;
      try{
        const response=await fetch(`${API_BASE_URL}/auth/me`,{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(10000)});
        if((response.status===401||response.status===403)&&readSession()?.user.id===saved.user.id){
          // A revoked account loses the POS session even if the provider sign-out fails.
          await auth.signOut().catch(()=>undefined);
          saveSession(null);restore();
        }else if(response.ok&&readSession()?.user.id===saved.user.id){
          saveSession({...saved,token:accessToken,user:await response.json()});restore();
        }else if(!response.ok){
          console.error(`Unable to refresh the Maknam POS profile (HTTP ${response.status}).`);
        }
      }catch(error){
        if(navigator.onLine)console.error('Unable to refresh the Maknam POS profile.',error);
      }
    };
    queueMicrotask(restore);
    // getSession() rejects when the session cannot be read (e.g. an offline token
    // refresh); the saved POS session is then kept so the device keeps selling.
    void auth.getSession().then(authSession=>{
      if(authSession)void refreshProfile(authSession.accessToken);
      else{saveSession(null);restore();}
    }).catch((error:unknown)=>{console.error('Unable to restore the Supabase session.',error);restore();});
    const unsubscribe=auth.onChange((event,authSession)=>{
      if(event==='SIGNED_OUT'){saveSession(null);restore();return;}
      if(authSession){
        const saved=readSession();
        if(saved){const updated={...saved,token:authSession.accessToken};saveSession(updated);setSession(updated);}
      }
    });
    const verify=async()=>{
      if(!navigator.onLine)return;
      const authSession=await auth.getSession();
      if(authSession)await refreshProfile(authSession.accessToken);
    };
    const verifyOnline=()=>{void verify().catch(error=>console.error('Unable to refresh the Supabase session.',error));};
    const timer=setInterval(()=>{restore();verifyOnline();},30000);
    window.addEventListener('storage',restore);
    window.addEventListener('online',verifyOnline);
    return()=>{unsubscribe();clearInterval(timer);window.removeEventListener('storage',restore);window.removeEventListener('online',verifyOnline);};
  },[]);
  async function signIn(email:string,password:string){setSession(await login(email,password));}
  async function signOut(){
    try{await identity().signOut();}
    catch(error){
      if(!(error instanceof AuthError))throw error;
      saveSession(null);setSession(null);
      throw new Error(error.message);
    }
    saveSession(null);setSession(null);
  }
  return <Context.Provider value={{session,loaded,signIn,signOut}}>{children}</Context.Provider>;
}
export function useAuth(){const value=useContext(Context);if(!value)throw new Error('AuthProvider required');return value;}
export function AuthRequired({children}:{children:ReactNode}){
  const {session,loaded}=useAuth();
  const router=useRouter();
  useEffect(()=>{if(loaded&&!session)router.replace('/login/');},[loaded,session,router]);
  if(!loaded||!session)return <div className="auth-loading" role="status">Opening Maknam POS…</div>;
  return children;
}
