// Application entry point for sign-in. Only src/lib/supabase/* uses the Supabase SDK.
import {supabaseIdentity} from '../supabase/identity';
import type {IdentityProvider} from './types';

export {AuthError} from './types';
export type {AuthChangeEvent,AuthErrorCode,AuthIdentity,AuthSession,IdentityProvider} from './types';

let provider:IdentityProvider|null=null;
export function identity():IdentityProvider{return provider??=supabaseIdentity;}
// For tests and a future provider swap.
export function configureIdentityProvider(next:IdentityProvider|null){provider=next;}
