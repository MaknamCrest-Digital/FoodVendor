import {API_BASE_URL} from './config';
import {createClient} from './supabase/client';

export type AdminUser={id:string;businessId:string;locationId:string;name:string;email:string;role:string;roleId?:string;roleName?:string;permissions?:string[];businessName:string;locationName:string;terminalId:string;terminalName:string};
export type Session={token:string;expiresAt:string;user:AdminUser};
const KEY='food-vendor-admin-session';
let memory:Session|null=null;

export function readSession():Session|null{
  if(typeof localStorage!=='undefined'){
    try{memory=JSON.parse(localStorage.getItem(KEY)||'null');}catch{memory=null;}
  }
  if(memory&&typeof memory.token==='string'&&memory.user&&typeof memory.user.id==='string'&&typeof memory.user.businessId==='string'&&typeof memory.user.locationId==='string'&&Date.parse(memory.expiresAt)>Date.now())return memory;
  return null;
}
export function saveSession(session:Session|null){
  memory=session;
  if(typeof localStorage!=='undefined'){if(session)localStorage.setItem(KEY,JSON.stringify(session));else localStorage.removeItem(KEY);}
}
export function requireUser():AdminUser{
  const session=readSession();
  if(!session)throw new Error('Sign in to continue. Saved records are retained.');
  return session.user;
}
export function authHeaders():Record<string,string>{const session=readSession();return session?{Authorization:`Bearer ${session.token}`}:{ };}

export function normalizeLoginEmail(identifier:string):string{
  const normalized=identifier.trim().toLowerCase();
  if(normalized==='demo-admin'||normalized==='demo-cashier')return `${normalized}@demo.maknam.invalid`;
  return normalized;
}

export function isValidLoginIdentifier(identifier:string):boolean{
  const normalized=identifier.trim();
  return normalized==='demo-admin'||normalized==='demo-cashier'||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export async function login(email:string,password:string):Promise<Session>{
  const supabase=createClient();
  let result;
  try{
    result=await supabase.auth.signInWithPassword({email:normalizeLoginEmail(email),password});
  }catch{
    if(typeof navigator!=='undefined'&&!navigator.onLine)throw new Error('First-time sign-in requires an internet connection. Reopen this device using a previously authenticated session to work offline.');
    throw new Error('Unable to connect to the server. Check your connection and try again.');
  }
  if(result.error){
    const message=result.error.message.toLowerCase();
    if(message.includes('invalid login credentials'))throw new Error('Incorrect email or password.');
    if(message.includes('email not confirmed'))throw new Error('Confirm your email address before signing in.');
    if(result.error.status===429)throw new Error('Too many sign-in attempts. Please try again later.');
    if(!result.error.status||result.error.status>=500){
      if(typeof navigator!=='undefined'&&!navigator.onLine)throw new Error('First-time sign-in requires an internet connection. Reopen this device using a previously authenticated session to work offline.');
      throw new Error('Unable to connect to the server. Check your connection and try again.');
    }
    throw new Error('Unable to sign in right now. Please try again.');
  }
  const authSession=result.data.session;
  if(!authSession)throw new Error('Unable to sign in right now. Please try again.');
  let response:Response;
  try{
    response=await fetch(`${API_BASE_URL}/auth/me`,{headers:{Authorization:`Bearer ${authSession.access_token}`},signal:AbortSignal.timeout(10000)});
  }catch{
    await supabase.auth.signOut();
    throw new Error('Unable to connect to the server. Check your connection and try again.');
  }
  if(!response.ok){
    await supabase.auth.signOut();
    if(response.status===401||response.status===403)throw new Error('This account has not been linked or is disabled. Contact your restaurant administrator.');
    throw new Error('Unable to load your restaurant account. Please try again.');
  }
  let user:AdminUser;
  try{
    user=await response.json();
    if(!user||typeof user.id!=='string'||typeof user.businessId!=='string'||typeof user.locationId!=='string')throw new Error('Invalid profile');
  }catch{
    await supabase.auth.signOut();
    throw new Error('Unable to load your restaurant account. Please try again.');
  }
  const data:Session={token:authSession.access_token,expiresAt:new Date(Date.now()+7*24*60*60*1000).toISOString(),user};
  try{saveSession(data);}catch{
    memory=null;
    await supabase.auth.signOut();
    throw new Error('Your browser could not save the session. Allow site storage and try again.');
  }
  return data;
}
