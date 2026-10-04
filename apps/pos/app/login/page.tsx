import type {Metadata} from 'next';
import {UtensilsCrossed} from 'lucide-react';
import LoginForm from '../../components/auth/LoginForm';
import styles from '../../components/auth/Login.module.css';

export const metadata:Metadata={title:'Sign in | Maknam POS',description:'Sign in to manage your restaurant operations.'};

export default function LoginPage(){
  return <main className={styles.page}><div className={styles.container}>
    <header className={styles.brand}>
      <div className={styles.mark}><UtensilsCrossed size={30} strokeWidth={1.8} aria-hidden="true"/></div>
      <h1>Maknam POS</h1><p>Sign in to manage your restaurant operations.</p>
    </header>
    <LoginForm/>
    <footer className={styles.footer}><strong>Maknam POS</strong><p>Restaurant operations, simplified.</p><span>Version 1.0</span></footer>
  </div></main>;
}
