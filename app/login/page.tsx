"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password"), otp: form.get("otp")||undefined }) });
    if (!response.ok) { const body = await response.json().catch(() => null); setError(body?.error?.message || "Sign-in failed"); setBusy(false); return; }
    const destination = new URLSearchParams(window.location.search).get("next") || "/";
    const body=await response.json();
    router.replace(body.data?.mustChangePassword?"/change-password":destination.startsWith("/") && !destination.startsWith("//") ? destination : "/"); router.refresh();
  }
  return <main className="auth-page"><section className="auth-card"><div className="brand auth-brand"><div className="brand-mark">V</div><div><strong>Velite</strong><span>PeopleOS</span></div></div><span className="eyebrow">SECURE HR WORKSPACE</span><h1>Welcome back</h1><p>Sign in to manage people, attendance, payroll and the complete employee lifecycle.</p><form onSubmit={submit}><label>Work email<input name="email" type="email" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label>{error && <div className="form-error">{error}</div>}<button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form></section></main>;
}
