"use client";
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {readSession,saveSession,login,type Session} from '../../src/lib/auth';
import {API_BASE_URL} from '../../src/lib/config';
import {createClient} from '../../src/lib/supabase/client';

type Auth={session:Session|null;loaded:boolean;signIn:(email:string,password:string)=>Promise<void>;signOut:()=>Promise<void>};
const Context=createContext<Auth|null>(null);

export function AuthProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<Session|null>(null);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    const restore=()=>{setSession(readSession());setLoaded(true);};
    const supabase=createClient();
    const refreshProfile=async(accessToken:string)=>{
      const saved=readSession();
      if(!saved||!navigator.onLine)return;
      try{
        const response=await fetch(`${API_BASE_URL}/auth/me`,{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(10000)});
        if((response.status===401||response.status===403)&&readSession()?.user.id===saved.user.id){
          await supabase.auth.signOut();
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
    void supabase.auth.getSession().then(({data,error})=>{
      if(error)throw error;
      if(data.session)void refreshProfile(data.session.access_token);
      else{saveSession(null);restore();}
    }).catch((error:unknown)=>{console.error('Unable to restore the Supabase session.',error);restore();});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,authSession)=>{
      if(event==='SIGNED_OUT'){saveSession(null);restore();return;}
      if(authSession){
        const saved=readSession();
        if(saved){const updated={...saved,token:authSession.access_token};saveSession(updated);setSession(updated);}
      }
    });
    const verify=async()=>{
      if(!navigator.onLine)return;
      const {data,error}=await supabase.auth.getSession();
      if(error)throw error;
      if(data.session)await refreshProfile(data.session.access_token);
    };
    const verifyOnline=()=>{void verify().catch(error=>console.error('Unable to refresh the Supabase session.',error));};
    const timer=setInterval(()=>{restore();verifyOnline();},30000);
    window.addEventListener('storage',restore);
    window.addEventListener('online',verifyOnline);
    return()=>{subscription.unsubscribe();clearInterval(timer);window.removeEventListener('storage',restore);window.removeEventListener('online',verifyOnline);};
  },[]);
  async function signIn(email:string,password:string){setSession(await login(email,password));}
  async function signOut(){
    const {error}=await createClient().auth.signOut();
    saveSession(null);setSession(null);
    if(error)throw new Error(error.message);
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
