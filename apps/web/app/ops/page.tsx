'use client';
import { useState } from 'react';

/** Ops sign-in: trades the ops key for an httpOnly session cookie, then returns to the page that asked. */
export default function OpsSignIn() {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const next = new URLSearchParams(location.search).get('next') ?? '/cockpit';
    const r = await fetch('/api/ops/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, next }) });
    const j = (await r.json().catch(() => ({}))) as { data?: { next: string }; error?: { message?: string } };
    if (r.ok && j.data) location.assign(j.data.next); else setErr(j.error?.message ?? `Sign-in failed (${r.status})`);
  }
  return (
    <main style={{ maxWidth: 380, margin: '15vh auto', padding: 16, display: 'grid', gap: 12, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>DockClock ops sign-in</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
        <label htmlFor="ops-key">Ops key</label>
        <input id="ops-key" type="password" autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)} style={{ minHeight: 44, padding: '0 12px', border: '2px solid #2B2F33', borderRadius: 8 }} />
        <button type="submit" style={{ minHeight: 44, fontWeight: 700, background: '#00573F', color: '#fff', border: 0, borderRadius: 8 }}>Sign in</button>
        {err && <p role="alert" style={{ color: '#B3261E', margin: 0 }}>{err}</p>}
      </form>
    </main>
  );
}
