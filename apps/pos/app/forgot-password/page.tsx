"use client";
import type {FormEvent} from 'react';
import {useState} from 'react';
import Link from 'next/link';
import {UtensilsCrossed} from 'lucide-react';
import {identity} from '../../src/lib/identity';
import styles from '../../components/auth/Login.module.css';

export default function ForgotPasswordPage(){
  const [email,setEmail]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setMessage('');
    try{
      await identity().requestPasswordReset(email.trim(),`${window.location.origin}/update-password/`);
      setMessage('If an account exists for that email, Supabase will send a password reset link.');
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to send a reset email. Please try again.');}
    finally{setBusy(false);}
  }
  return <main className={styles.page}><div className={styles.container}>
    <header className={styles.brand}><div className={styles.mark}><UtensilsCrossed size={30} aria-hidden="true"/></div><h1>Maknam POS</h1><p>Help with signing in</p></header>
    <section className={`${styles.card} ${styles.help}`} aria-labelledby="password-help-title">
      <h2 id="password-help-title">Forgot your password?</h2>
      <p>Enter your account email and Supabase will send a reset link.</p>
      <form className="owner-form" onSubmit={submit}>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></label>
        {message&&<p role="status">{message}</p>}
        <button className={styles.submit} type="submit" disabled={busy}>{busy?'Sending…':'Send reset link'}</button>
      </form>
      <Link href="/login/" className={styles.forgot}>Back to sign in</Link>
    </section>
    <footer className={styles.footer}><strong>Maknam POS</strong><p>Restaurant operations, simplified.</p></footer>
  </div></main>;
}
