"use client";
import type {FormEvent} from 'react';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {UtensilsCrossed} from 'lucide-react';
import {identity} from '../../src/lib/identity';
import styles from '../../components/auth/Login.module.css';

export default function UpdatePasswordPage(){
  const [ready,setReady]=useState(false);
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    // Opening the provider client also completes the session carried by the reset link.
    void identity().getSession().then(session=>{
      setReady(Boolean(session));
      if(!session)setMessage('This reset link is invalid or expired. Request a new link.');
    }).catch((error:unknown)=>setMessage(error instanceof Error?error.message:'Unable to verify this reset link.'));
  },[]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setMessage('');
    try{
      await identity().updatePassword(password);
      setMessage('Password updated. You can now sign in with your new password.');
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to update the password. Please try again.');}
    finally{setBusy(false);}
  }
  return <main className={styles.page}><div className={styles.container}>
    <header className={styles.brand}><div className={styles.mark}><UtensilsCrossed size={30} aria-hidden="true"/></div><h1>Maknam POS</h1><p>Set a new password</p></header>
    <section className={`${styles.card} ${styles.help}`} aria-labelledby="password-update-title">
      <h2 id="password-update-title">Update password</h2>
      {ready&&<form className="owner-form" onSubmit={submit}><label>New password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={event=>setPassword(event.target.value)}/></label><button className={styles.submit} type="submit" disabled={busy}>{busy?'Updating…':'Update password'}</button></form>}
      {message&&<p role="status">{message}</p>}
      <Link href="/login/" className={styles.forgot}>Back to sign in</Link>
    </section>
    <footer className={styles.footer}><strong>Maknam POS</strong><p>Restaurant operations, simplified.</p></footer>
  </div></main>;
}
