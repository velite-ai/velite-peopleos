"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupPage() {
  const router = useRouter(); const [message,setMessage]=useState(""); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError("");const f=new FormData(event.currentTarget);const response=await fetch('/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setupKey:f.get('setupKey'),fullName:f.get('fullName'),email:f.get('email'),password:f.get('password')})});const body=await response.json().catch(()=>null);if(!response.ok){setError(body?.error?.message||'Setup failed');setBusy(false);return;}setMessage('Administrator created. Redirecting to sign in…');setTimeout(()=>router.replace('/login'),900);}
  return <main className="auth-page"><section className="auth-card wide"><div className="brand auth-brand"><div className="brand-mark">V</div><div><strong>Velite</strong><span>PeopleOS</span></div></div><span className="eyebrow">ONE-TIME INSTALLATION</span><h1>Create the first administrator</h1><p>Use the setup key configured in Coolify. This screen automatically closes after the first account is created.</p><form onSubmit={submit}><label>Full name<input name="fullName" required minLength={2}/></label><label>Work email<input name="email" type="email" required/></label><label>Strong password<input name="password" type="password" minLength={12} required/></label><label>Setup key<input name="setupKey" type="password" minLength={16} required/></label>{error&&<div className="form-error">{error}</div>}{message&&<div className="form-success">{message}</div>}<button className="primary" disabled={busy}>{busy?'Creating…':'Create administrator'}</button></form><small><a href="/login">Return to sign in</a></small></section></main>;
}
