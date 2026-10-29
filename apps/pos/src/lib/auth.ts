import {API_BASE_URL} from './config';
import {AuthError,identity,type AuthSession} from './identity';

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

const OFFLINE_FIRST_SIGN_IN='First-time sign-in requires an internet connection. Reopen this device using a previously authenticated session to work offline.';
const UNABLE_TO_CONNECT='Unable to connect to the server. Check your connection and try again.';

export function signInMessage(error:AuthError):string{
  switch(error.code){
    case 'invalid_credentials':return 'Incorrect email or password.';
    case 'email_not_confirmed':return 'Confirm your email address before signing in.';
    case 'rate_limited':return 'Too many sign-in attempts. Please try again later.';
    case 'network':case 'unavailable':
      return typeof navigator!=='undefined'&&!navigator.onLine?OFFLINE_FIRST_SIGN_IN:UNABLE_TO_CONNECT;
    default:return 'Unable to sign in right now. Please try again.';
  }
}

export async function login(email:string,password:string):Promise<Session>{
  const auth=identity();
  // Ending the provider session is best effort here; its error was always ignored.
  const discard=()=>auth.signOut().catch(()=>undefined);
  let authSession:AuthSession;
  try{
    authSession=await auth.signIn(normalizeLoginEmail(email),password);
  }catch(error){
    if(error instanceof AuthError)throw new Error(signInMessage(error));
    throw error;
  }
  let response:Response;
  try{
    response=await fetch(`${API_BASE_URL}/auth/me`,{headers:{Authorization:`Bearer ${authSession.accessToken}`},signal:AbortSignal.timeout(10000)});
  }catch{
    await discard();
    throw new Error(UNABLE_TO_CONNECT);
  }
  if(!response.ok){
    await discard();
    if(response.status===401||response.status===403)throw new Error('This account has not been linked or is disabled. Contact your restaurant administrator.');
    throw new Error('Unable to load your restaurant account. Please try again.');
  }
  let user:AdminUser;
  try{
    user=await response.json();
    if(!user||typeof user.id!=='string'||typeof user.businessId!=='string'||typeof user.locationId!=='string')throw new Error('Invalid profile');
  }catch{
    await discard();
    throw new Error('Unable to load your restaurant account. Please try again.');
  }
  const data:Session={token:authSession.accessToken,expiresAt:new Date(Date.now()+7*24*60*60*1000).toISOString(),user};
  try{saveSession(data);}catch{
    memory=null;
    await discard();
    throw new Error('Your browser could not save the session. Allow site storage and try again.');
  }
  return data;
}
