import assert from 'node:assert/strict';
import {afterEach,beforeEach,it} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createSupabaseIdentity} from '../lib/supabase/identity';
import {AuthError,configureIdentityProvider,type AuthChangeEvent,type AuthSession} from '../lib/identity';
import {login,readSession} from '../lib/auth';

const SUBJECT='d6545a1b-9255-4a17-97c9-e1b62f2a1f5f';
const supabaseSession={access_token:'provider-token',expires_at:1900000000,refresh_token:'refresh',user:{id:SUBJECT,email:' Owner@Example.Test ',user_metadata:{email_verified:true}}};
const profile={id:'owner-a',businessId:'tenant-a',locationId:'branch-a',name:'Owner',email:'owner@example.test',role:'OWNER',businessName:'A',locationName:'B',terminalId:'t',terminalName:'T'};
type Result={data?:unknown;error?:{message:string;status?:number}|null};

type Fake=(...args:never[])=>unknown;
function fakeSupabase(overrides:Record<string,Fake>={}){
  const calls:Record<string,unknown[][]>={};
  let changeListener:((event:string,session:unknown)=>void)|null=null;
  let unsubscribed=0;
  const record=(name:string,result:Fake)=>(...args:unknown[])=>{(calls[name]??=[]).push(args);return result(...(args as never[]));};
  const auth={
    signInWithPassword:record('signInWithPassword',async():Promise<Result>=>({data:{session:supabaseSession},error:null})),
    signUp:record('signUp',async():Promise<Result>=>({data:{session:null},error:null})),
    signOut:record('signOut',async():Promise<Result>=>({error:null})),
    getSession:record('getSession',async():Promise<Result>=>({data:{session:supabaseSession},error:null})),
    resetPasswordForEmail:record('resetPasswordForEmail',async():Promise<Result>=>({data:{},error:null})),
    updateUser:record('updateUser',async():Promise<Result>=>({data:{},error:null})),
    onAuthStateChange:record('onAuthStateChange',(listener:(event:string,session:unknown)=>void)=>{changeListener=listener;return {data:{subscription:{unsubscribe:()=>{unsubscribed++;}}}};}),
    ...Object.fromEntries(Object.entries(overrides).map(([name,fn])=>[name,record(name,fn)])),
  };
  const provider=createSupabaseIdentity(()=>({auth}) as unknown as Pick<SupabaseClient,'auth'>);
  return {provider,calls,emit:(event:string,session:unknown)=>changeListener!(event,session),unsubscribed:()=>unsubscribed};
}

const store=new Map<string,string>();
let online=true;
beforeEach(()=>{
  store.clear();online=true;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);},removeItem:(k:string)=>{store.delete(k);}}});
  Object.defineProperty(globalThis.navigator,'onLine',{configurable:true,get:()=>online});
});
afterEach(()=>{configureIdentityProvider(null);});

function stubProfile(status=200,body:unknown=profile){
  const requests:{url:string;authorization:string|null}[]=[];
  globalThis.fetch=(async(url:string,init?:RequestInit)=>{requests.push({url:String(url),authorization:new Headers(init?.headers).get('Authorization')});return new Response(JSON.stringify(body),{status});}) as typeof fetch;
  return requests;
}

it('maps a successful sign-in to a provider-neutral session',async()=>{
  const {provider,calls}=fakeSupabase();
  const session=await provider.signIn('owner@example.test','pw');
  assert.deepEqual(session,{accessToken:'provider-token',expiresAt:1900000000,identity:{provider:'supabase',subject:SUBJECT,email:'owner@example.test',emailVerified:false}});
  assert.deepEqual(calls.signInWithPassword,[[{email:'owner@example.test',password:'pw'}]]);
  assert.equal('refreshToken' in session||'refresh_token' in session,false);
});

it('login exchanges the identity token for the FastAPI profile and saves the POS session',async()=>{
  const {provider,calls}=fakeSupabase();configureIdentityProvider(provider);
  const requests=stubProfile();
  const saved=await login('demo-admin','pw');
  assert.equal((calls.signInWithPassword[0][0] as {email:string}).email,'demo-admin@demo.maknam.invalid');
  assert.match(requests[0].url,/\/auth\/me$/);
  assert.equal(requests[0].authorization,'Bearer provider-token');
  assert.equal(saved.token,'provider-token');
  assert.deepEqual(readSession()?.user,profile);
});

it('failed sign-in keeps every existing user-facing message and saves nothing',async()=>{
  const cases:[Result['error']|'throw'|'no-session',boolean,string][]=[
    [{message:'Invalid login credentials',status:400},true,'Incorrect email or password.'],
    [{message:'Email not confirmed',status:400},true,'Confirm your email address before signing in.'],
    [{message:'Request rate limit reached',status:429},true,'Too many sign-in attempts. Please try again later.'],
    [{message:'Internal error',status:500},true,'Unable to connect to the server. Check your connection and try again.'],
    [{message:'Failed to fetch'},true,'Unable to connect to the server. Check your connection and try again.'],
    [{message:'Failed to fetch'},false,'First-time sign-in requires an internet connection. Reopen this device using a previously authenticated session to work offline.'],
    [{message:'Unprocessable',status:422},true,'Unable to sign in right now. Please try again.'],
    ['throw',true,'Unable to connect to the server. Check your connection and try again.'],
    ['throw',false,'First-time sign-in requires an internet connection. Reopen this device using a previously authenticated session to work offline.'],
    ['no-session',true,'Unable to sign in right now. Please try again.'],
  ];
  for(const [failure,isOnline,message] of cases){
    online=isOnline;
    const signInWithPassword=failure==='throw'?async()=>{throw new TypeError('fetch failed');}:failure==='no-session'?async()=>({data:{session:null},error:null}):async()=>({data:{session:null},error:failure});
    configureIdentityProvider(fakeSupabase({signInWithPassword}).provider);
    await assert.rejects(login('owner@example.test','pw'),{message});
    assert.equal(readSession(),null);
  }
});

it('an unlinked account ends the provider session even when provider sign-out fails',async()=>{
  for(const signOutResult of [{error:null},{error:{message:'Network down'}}]){
    const {provider,calls}=fakeSupabase({signOut:async()=>signOutResult});configureIdentityProvider(provider);
    stubProfile(401,{detail:'Internal identity details'});
    await assert.rejects(login('owner@example.test','pw'),{message:'This account has not been linked or is disabled. Contact your restaurant administrator.'});
    assert.equal(calls.signOut.length,1);
    assert.equal(readSession(),null);
  }
});

it('sign-out ends the provider session and reports provider failures',async()=>{
  const ok=fakeSupabase();
  await ok.provider.signOut();
  assert.equal(ok.calls.signOut.length,1);
  const failing=fakeSupabase({signOut:async()=>({error:{message:'Logout failed',status:500}})});
  await assert.rejects(failing.provider.signOut(),(error:unknown)=>error instanceof AuthError&&error.message==='Logout failed');
});

it('restores a stored session and exposes its identity and access token',async()=>{
  const {provider}=fakeSupabase();
  assert.equal((await provider.getSession())?.identity.subject,SUBJECT);
  assert.equal((await provider.getIdentity())?.email,'owner@example.test');
  assert.equal(await provider.getAccessToken(),'provider-token');
  const empty=fakeSupabase({getSession:async()=>({data:{session:null},error:null})}).provider;
  assert.equal(await empty.getSession(),null);
  assert.equal(await empty.getAccessToken(),null);
});

it('an unreadable session (offline token refresh) rejects instead of reporting no session',async()=>{
  // Returning null here would clear the offline POS session on a device without internet.
  const {provider}=fakeSupabase({getSession:async()=>({data:{session:null},error:{message:'Failed to fetch',status:0}})});
  await assert.rejects(provider.getSession(),(error:unknown)=>error instanceof AuthError&&error.code==='unavailable');
  await assert.rejects(provider.getAccessToken(),AuthError);
});

it('an expired POS session is never restored',()=>{
  store.set('food-vendor-admin-session',JSON.stringify({token:'t',expiresAt:new Date(Date.now()-1000).toISOString(),user:profile}));
  assert.equal(readSession(),null);
  store.set('food-vendor-admin-session',JSON.stringify({token:'t',expiresAt:new Date(Date.now()+60000).toISOString(),user:profile}));
  assert.equal(readSession()?.token,'t');
});

it('maps auth state changes through one listener that unsubscribes once',async()=>{
  const {provider,calls,emit,unsubscribed}=fakeSupabase();
  const listeners=()=>calls.onAuthStateChange?.length??0;
  // Only onChange may subscribe; competing listeners would duplicate session handling.
  await provider.signIn('owner@example.test','pw');await provider.getSession();await provider.getIdentity();await provider.getAccessToken();
  await provider.signUp('new@example.test','pw');await provider.requestPasswordReset('owner@example.test','x');await provider.updatePassword('pw');await provider.signOut();
  assert.equal(listeners(),0,'no listener is registered outside onChange');
  const seen:[AuthChangeEvent,AuthSession|null][]=[];
  const stop=provider.onChange((event,session)=>seen.push([event,session]));
  emit('TOKEN_REFRESHED',{...supabaseSession,access_token:'refreshed-token'});
  emit('SIGNED_OUT',null);
  emit('MFA_CHALLENGE_VERIFIED',supabaseSession);
  assert.deepEqual(seen.map(([event,session])=>[event,session?.accessToken??null]),[['TOKEN_REFRESHED','refreshed-token'],['SIGNED_OUT',null],['OTHER','provider-token']]);
  stop();
  assert.equal(listeners(),1);
  assert.equal(unsubscribed(),1);
});

it('password recovery and update pass through and surface provider errors',async()=>{
  const {provider,calls}=fakeSupabase();
  await provider.requestPasswordReset('owner@example.test','https://pos.example/update-password/');
  await provider.updatePassword('a-new-long-password');
  assert.deepEqual(calls.resetPasswordForEmail,[['owner@example.test',{redirectTo:'https://pos.example/update-password/'}]]);
  assert.deepEqual(calls.updateUser,[[{password:'a-new-long-password'}]]);
  const failing=fakeSupabase({resetPasswordForEmail:async()=>({error:{message:'Email rate limit exceeded',status:429}}),updateUser:async()=>({error:{message:'Password is too weak',status:422}})}).provider;
  await assert.rejects(failing.requestPasswordReset('a@b.test','x'),{message:'Email rate limit exceeded',code:'rate_limited'});
  await assert.rejects(failing.updatePassword('weak'),{message:'Password is too weak',code:'rejected'});
});

it('identity mapping never trusts user-editable email_verified and normalises email',async()=>{
  const blank=fakeSupabase({getSession:async()=>({data:{session:{...supabaseSession,user:{id:SUBJECT,email:'  ',user_metadata:{email_verified:true}}}},error:null})}).provider;
  assert.deepEqual(await blank.getIdentity(),{provider:'supabase',subject:SUBJECT,email:null,emailVerified:false});
  assert.equal((await fakeSupabase().provider.getIdentity())?.emailVerified,false);
});

it('sign-up is available to code but returns no session until the provider issues one',async()=>{
  const {provider,calls}=fakeSupabase();
  assert.equal(await provider.signUp('new@example.test','pw','https://pos.example/verified/'),null);
  assert.deepEqual(calls.signUp,[[{email:'new@example.test',password:'pw',options:{emailRedirectTo:'https://pos.example/verified/'}}]]);
});

it('a missing provider configuration fails loudly instead of looking like a network error',async()=>{
  const configError=new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  const provider=createSupabaseIdentity(()=>{throw configError;});
  await assert.rejects(provider.signIn('a@b.test','pw'),(error:unknown)=>error===configError);
  configureIdentityProvider(provider);
  await assert.rejects(login('a@b.test','pw'),(error:unknown)=>error===configError);
});
