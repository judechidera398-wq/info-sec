'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { LibraryConsole } from '@/components/library-console';

type Identity = { id:number; username:string; role:'admin'|'manager'|'inputer'|'user' };
type AuthView = 'login'|'register'|'mfa'|'recovery';

function GoogleMark() {
  return <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.8 6.1-14.9Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8V33A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.6 27.8a12 12 0 0 1 0-7.6v-5H5.8a20 20 0 0 0 0 17.6l6.8-5Z"/><path fill="#EA4335" d="M24 11.8c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 5.8 29.5 4 24 4A20 20 0 0 0 5.8 15.2l6.8 5C14.2 15.4 18.7 11.8 24 11.8Z"/></svg>;
}

async function api<T>(path:string, init:RequestInit = {}):Promise<T> {
  const response = await fetch(path, {credentials:'same-origin', ...init,
    headers:{'Content-Type':'application/json', ...(init.headers || {})}});
  const body = await response.json().catch(()=>({})) as {error?:string};
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body as T;
}

export function AccessApp() {
  const [view,setView] = useState<AuthView>('login');
  const [identity,setIdentity] = useState<Identity|null>(null);
  const [enrollment,setEnrollment] = useState<{secret:string;qr:string}|null>(null);
  const [codes,setCodes] = useState<string[]>([]);
  const [notice,setNotice] = useState('');
  const [error,setError] = useState(false);
  const [busy,setBusy] = useState(false);

  const flash=useCallback((text:string,isError=false)=>{setNotice(text);setError(isError);},[]);
  const googleSignIn=()=>window.location.assign('/api/auth/google');
  const refresh=useCallback(async()=>{
    try { setIdentity(await api<Identity>('/api/auth/me')); }
    catch { setIdentity(null); }
  },[]);

  useEffect(()=>{
    const query=new URLSearchParams(window.location.search);
    const googleStep=query.get('google');
    if(googleStep){
      window.history.replaceState(null,'',window.location.pathname);
      if(googleStep==='setup'){
        void api<{secret:string;qr:string}>('/api/auth/mfa-setup').then((result)=>{
          setEnrollment(result);setView('mfa');flash('Enroll an authenticator to finish signing in with Google.');
        }).catch((cause)=>flash(cause instanceof Error?cause.message:'Could not start two-factor setup.',true));
      }else if(googleStep==='verify'){
        setView('mfa');flash('Enter your authenticator code to finish signing in with Google.');
      }else{
        flash(googleStep==='unconfigured'?'Google sign-in is not configured. Add its credentials in the hosting environment settings.':'Google sign-in could not be completed. Please try again.',true);
      }
      return;
    }
    void refresh();
  },[refresh,flash]);

  async function submit(event:FormEvent<HTMLFormElement>,action:(data:FormData)=>Promise<void>) {
    event.preventDefault(); setBusy(true); flash('');
    try { await action(new FormData(event.currentTarget)); }
    catch (cause) { flash(cause instanceof Error ? cause.message : 'Request failed',true); }
    finally { setBusy(false); }
  }

  async function signIn(data:FormData) {
    const result=await api<{mfaEnrolled:boolean}>('/api/auth/login',{method:'POST',body:JSON.stringify({username:data.get('username'),password:data.get('password')})});
    if(result.mfaEnrolled){setEnrollment(null);setView('mfa');flash('Enter an authenticator code or a one-time recovery code.');}
    else {setEnrollment(await api('/api/auth/mfa-setup'));setView('mfa');flash('Enroll an authenticator to finish signing in.');}
  }

  async function verify(data:FormData) {
    const path=enrollment?'/api/auth/mfa-setup':'/api/auth/verify';
    const result=await api<{recoveryCodes?:string[];message:string}>(path,{method:'POST',body:JSON.stringify({code:data.get('code')})});
    setEnrollment(null);
    if(result.recoveryCodes){setCodes(result.recoveryCodes);setView('recovery');flash('Two-factor authentication is enabled.');}
    else {flash('Signed in.');await refresh();}
  }

  async function register(data:FormData) {
    await api('/api/register',{method:'POST',body:JSON.stringify({username:data.get('username'),password:data.get('password')})});
    setView('login');flash('Account created. Sign in to enroll two-factor authentication.');
  }

  async function signOut() {
    try { await api('/api/auth/logout',{method:'POST'}); }
    finally { setIdentity(null);setView('login');flash('Signed out.'); }
  }

  return <main className="page-shell">
    <header className="brand"><span className="brand-mark">LM</span><div><p className="eyebrow">LIBRARY OPERATIONS</p><h1>Library Management</h1></div><span className="local-pill"><i/> Secure access</span></header>
    {notice&&<div className={`notice ${error?'notice-error':''}`} role={error?'alert':'status'}>{notice}</div>}
    {!identity ? <div className="auth-layout">
      <aside className="auth-visual" aria-label="Library Management security overview">
        <div className="visual-orbit orbit-one"/><div className="visual-orbit orbit-two"/>
        <div className="visual-content">
          <span className="visual-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M16 3.5 26 7v7.3c0 6.3-4.1 11.8-10 14.2C10.1 26.1 6 20.6 6 14.3V7l10-3.5Z" stroke="currentColor" strokeWidth="1.7"/><path d="m11.5 15.5 3 3 6.3-6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
          <p className="visual-kicker">YOUR LIBRARY, ORGANIZED</p>
          <h2>Discover more.<br/><span>Keep track.</span></h2>
          <p className="visual-copy">One secure place to manage books, members, and circulation. Each staff role has the tools it needs.</p>
          <div className="visual-points"><div><span className="point-icon">01</span><span><b>Live catalogue</b><small>Find titles and track available copies</small></span></div><div><span className="point-icon">02</span><span><b>Simple circulation</b><small>Check out books and record returns</small></span></div></div>
          <div className="visual-foot"><span className="live-dot"/>Secure library access · Role-based staff tools</div>
        </div>
        <div className="visual-grid" aria-hidden="true"/>
      </aside>
      <section className="auth-card">
      {view==='login'&&<><div className="section-kicker">Welcome back</div><h2>Sign in to your account</h2><p className="muted">Your account is protected with two-step verification.</p>
        <form onSubmit={(e)=>void submit(e,signIn)}><label>Username<input name="username" autoComplete="username" required minLength={3}/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label><button className="primary" disabled={busy}>Continue <span>→</span></button></form>
        <div className="auth-divider"><span>or</span></div>
        <button type="button" className="google-button" onClick={googleSignIn}><GoogleMark/>Continue with Google</button>
        <p className="switcher">New here? <button type="button" className="link-button" onClick={()=>{setView('register');flash('');}}>Create an account</button></p></>}
      {view==='register'&&<><div className="section-kicker">Create access</div><h2>Register an account</h2><p className="muted">New registrations receive read-only catalogue access.</p>
        <form onSubmit={(e)=>void submit(e,register)}><label>Username<input name="username" autoComplete="username" required minLength={3} maxLength={64} pattern="[A-Za-z0-9_.-]+"/></label><label>Password <small>At least 12 characters</small><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256}/></label><button className="primary" disabled={busy}>Create account <span>→</span></button></form>
        <div className="auth-divider"><span>or</span></div>
        <button type="button" className="google-button" onClick={googleSignIn}><GoogleMark/>Continue with Google</button>
        <p className="switcher">Already registered? <button className="link-button" onClick={()=>{setView('login');flash('');}}>Sign in</button></p></>}
      {view==='mfa'&&<><div className="section-kicker">Second step</div><h2>{enrollment?'Set up an authenticator':'Verify it’s you'}</h2>
        {enrollment?<div className="enroll-box"><p>Scan this QR code with your authenticator app, or enter the key manually.</p><img className="qr" src={enrollment.qr} alt="Authenticator setup QR code"/><code className="secret-key">{enrollment.secret}</code></div>:<p className="muted">Enter your current six-digit app code, or use a saved one-time recovery code.</p>}
        <form onSubmit={(e)=>void submit(e,verify)}><label>{enrollment?'Authenticator code':'Verification code'}<input name="code" autoComplete="one-time-code" inputMode="numeric" required autoFocus/></label><button className="primary" disabled={busy}>Verify and continue <span>→</span></button></form>
        <button className="link-button" onClick={()=>void signOut()}>Cancel</button></>}
      {view==='recovery'&&<><div className="section-kicker">Save these codes</div><h2>Recovery codes</h2><p className="muted">Each code works once. Store these somewhere private. They will not be shown again.</p><pre className="recovery-codes">{codes.join('\n')}</pre><button className="primary full" onClick={()=>{setCodes([]);void refresh();}}>Continue to account <span>→</span></button></>}
      </section>
    </div> : <LibraryConsole identity={identity} onSignOut={()=>void signOut()} />}
    <footer><span>LIBRARY MANAGEMENT</span><span>Secure access to your collection.</span></footer>
  </main>;
}
