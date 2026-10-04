"use client";
import Link from 'next/link';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {Eye,EyeOff,LoaderCircle} from 'lucide-react';
import {useAuth} from './AuthProvider';
import styles from './Login.module.css';
import {demoAccountsEnabled} from '../../src/lib/config';
import {isValidLoginIdentifier} from '../../src/lib/auth';

export default function LoginForm(){
  const {session,loaded,signIn}=useAuth();
  const router=useRouter();
  const [visible,setVisible]=useState(false);
  const [busy,setBusy]=useState(false);
  const [errors,setErrors]=useState<{email?:string;password?:string;form?:string}>({});
  const submitting=useRef(false);
  const emailInput=useRef<HTMLInputElement>(null);
  const passwordInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(loaded&&session)router.replace('/');},[loaded,session,router]);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(submitting.current||!loaded||session)return;
    const form=new FormData(event.currentTarget);
    const email=String(form.get('email')||'').trim();
    const password=String(form.get('password')||'');
    const nextErrors:{email?:string;password?:string}={};
    if(!email||!isValidLoginIdentifier(email))nextErrors.email='Enter a valid email address or a demo username.';
    if(!password)nextErrors.password='Password is required.';
    setErrors(nextErrors);
    if(nextErrors.email||nextErrors.password){
      (nextErrors.email?emailInput:passwordInput).current?.focus();
      return;
    }
    submitting.current=true;setBusy(true);
    try{await signIn(email,password);}
    catch(error){setErrors({form:error instanceof Error?error.message:'Something went wrong. Please try again.'});}
    finally{submitting.current=false;setBusy(false);}
  }

  return <form className={styles.card} onSubmit={submit} noValidate aria-label="Sign in" aria-busy={busy}>
    <div className={styles.field}>
      <label htmlFor="login-email">USERNAME OR EMAIL</label>
      <input ref={emailInput} id="login-email" name="email" type="text" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder="name@restaurant.com or demo-admin" disabled={busy} aria-invalid={!!errors.email} aria-describedby={errors.email?'login-email-error':undefined} onChange={()=>setErrors(current=>({...current,email:undefined,form:undefined}))}/>
      {errors.email&&<p className={styles.error} id="login-email-error">{errors.email}</p>}
    </div>
    <div className={styles.field}>
      <label htmlFor="login-password">PASSWORD</label>
      <div className={styles.password}>
        <input ref={passwordInput} id="login-password" name="password" type={visible?'text':'password'} autoComplete="current-password" required maxLength={256} placeholder="Enter your password" disabled={busy} aria-invalid={!!errors.password} aria-describedby={errors.password?'login-password-error':undefined} onChange={()=>setErrors(current=>({...current,password:undefined,form:undefined}))}/>
        <button type="button" className={styles.eye} onClick={()=>setVisible(value=>!value)} aria-label={visible?'Hide password':'Show password'} aria-pressed={visible}>
          {visible?<EyeOff size={19} aria-hidden="true"/>:<Eye size={19} aria-hidden="true"/>}
        </button>
      </div>
      {errors.password&&<p className={styles.error} id="login-password-error">{errors.password}</p>}
    </div>
    {demoAccountsEnabled&&<p className={styles.demoNote}>Demo accounts: <strong>demo-admin</strong> and <strong>demo-cashier</strong>. Ask your test organizer for the password. Demo activity is isolated from restaurant data.</p>}
    <Link className={styles.forgot} href="/forgot-password/">Forgot password?</Link>
    {errors.form&&<p className={styles.formError} role="alert">{errors.form}</p>}
    <button className={styles.submit} type="submit" disabled={busy||!loaded||!!session}>
      {busy&&<LoaderCircle className={styles.spinner} size={18} aria-hidden="true"/>}
      <span aria-live="polite">{busy?'Signing in...':session?'Opening dashboard...':'Sign in'}</span>
    </button>
  </form>;
}
