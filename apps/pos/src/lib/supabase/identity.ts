// Supabase Auth implementation of IdentityProvider. Uses the shared browser client
// (createClient), so token refresh, cookie persistence and the single auth listener
// stay exactly as the SDK manages them. No SDK type crosses this boundary.
import type {Session,SupabaseClient,User} from '@supabase/supabase-js';
import {createClient} from './client';
import {AuthError,type AuthChangeEvent,type AuthIdentity,type AuthSession,type IdentityProvider} from '../identity/types';

type ProviderError={message:string;status?:number};
const EVENTS=new Set<AuthChangeEvent>(['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT','TOKEN_REFRESHED','USER_UPDATED','PASSWORD_RECOVERY']);

export function toIdentity(user:User):AuthIdentity{
  const email=typeof user.email==='string'&&user.email.trim()?user.email.trim().toLowerCase():null;
  // user_metadata.email_verified is editable by the user (auth.updateUser), so it is
  // not evidence of a confirmed email. Fail closed until a trusted source is chosen.
  return {provider:'supabase',subject:user.id,email,emailVerified:false};
}
export function toSession(session:Session):AuthSession{
  return {accessToken:session.access_token,expiresAt:session.expires_at??null,identity:toIdentity(session.user)};
}
// Same precedence the sign-in screen has always used.
export function toAuthError(error:ProviderError):AuthError{
  const message=error.message.toLowerCase();
  if(message.includes('invalid login credentials'))return new AuthError(error.message,'invalid_credentials',error.status);
  if(message.includes('email not confirmed'))return new AuthError(error.message,'email_not_confirmed',error.status);
  if(error.status===429)return new AuthError(error.message,'rate_limited',error.status);
  if(!error.status||error.status>=500)return new AuthError(error.message,'unavailable',error.status);
  return new AuthError(error.message,'rejected',error.status);
}
function networkError(error:unknown){return new AuthError(error instanceof Error?error.message:'Network request failed','network');}

export function createSupabaseIdentity(client:()=>Pick<SupabaseClient,'auth'>):IdentityProvider{
  // client() is called before any try block: a missing Supabase configuration
  // still fails loudly instead of looking like a network problem.
  async function getSession(){
    const {data,error}=await client().auth.getSession();
    if(error)throw toAuthError(error);
    return data.session?toSession(data.session):null;
  }
  return {
    name:'supabase',
    async signIn(email,password){
      const auth=client().auth;
      let result;
      try{result=await auth.signInWithPassword({email,password});}catch(error){throw networkError(error);}
      if(result.error)throw toAuthError(result.error);
      if(!result.data.session)throw new AuthError('No session was returned','no_session');
      return toSession(result.data.session);
    },
    async signUp(email,password,redirectTo){
      const auth=client().auth;
      let result;
      try{result=await auth.signUp({email,password,options:redirectTo?{emailRedirectTo:redirectTo}:undefined});}catch(error){throw networkError(error);}
      if(result.error)throw toAuthError(result.error);
      return result.data.session?toSession(result.data.session):null;
    },
    async signOut(){
      const {error}=await client().auth.signOut();
      if(error)throw toAuthError(error);
    },
    getSession,
    async getIdentity(){return (await getSession())?.identity??null;},
    async getAccessToken(){return (await getSession())?.accessToken??null;},
    onChange(listener){
      const {data:{subscription}}=client().auth.onAuthStateChange((event,session)=>{
        listener(EVENTS.has(event as AuthChangeEvent)?event as AuthChangeEvent:'OTHER',session?toSession(session):null);
      });
      return ()=>subscription.unsubscribe();
    },
    async requestPasswordReset(email,redirectTo){
      const {error}=await client().auth.resetPasswordForEmail(email,{redirectTo});
      if(error)throw toAuthError(error);
    },
    async updatePassword(password){
      const {error}=await client().auth.updateUser({password});
      if(error)throw toAuthError(error);
    },
  };
}

export const supabaseIdentity=createSupabaseIdentity(createClient);
