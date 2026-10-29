// Provider-neutral sign-in identity. An identity proves who signed in, never what
// they may do: tenant, location and permissions always come from FastAPI.

export type AuthIdentity={
  provider:string;
  subject:string;
  email:string|null;
  // True only on evidence the user cannot edit (never Supabase user_metadata).
  emailVerified:boolean;
};
export type AuthSession={accessToken:string;expiresAt:number|null;identity:AuthIdentity};
export type AuthChangeEvent='INITIAL_SESSION'|'SIGNED_IN'|'SIGNED_OUT'|'TOKEN_REFRESHED'|'USER_UPDATED'|'PASSWORD_RECOVERY'|'OTHER';
export type AuthErrorCode=
  |'invalid_credentials'|'email_not_confirmed'|'rate_limited'
  |'network'       // the request never reached the provider
  |'unavailable'   // the provider answered with no status or a 5xx
  |'rejected'      // any other provider refusal
  |'no_session';

export class AuthError extends Error{
  constructor(message:string,readonly code:AuthErrorCode,readonly status?:number){super(message);this.name='AuthError';}
}

export interface IdentityProvider{
  readonly name:string;
  signIn(email:string,password:string):Promise<AuthSession>;
  // Not exposed in the UI; business registration is a later, approved phase.
  signUp(email:string,password:string,redirectTo?:string):Promise<AuthSession|null>;
  // Throws AuthError when the provider could not end the session.
  signOut():Promise<void>;
  // null means no session. Throws when the session could not be read (for example
  // an offline token refresh) so callers keep the offline POS session.
  getSession():Promise<AuthSession|null>;
  getIdentity():Promise<AuthIdentity|null>;
  getAccessToken():Promise<string|null>;
  onChange(listener:(event:AuthChangeEvent,session:AuthSession|null)=>void):()=>void;
  requestPasswordReset(email:string,redirectTo:string):Promise<void>;
  updatePassword(password:string):Promise<void>;
}
