/* Cloud sync (Firebase Auth + Firestore). Optional: does nothing until data/firebase-config.js sets window.RBT_FIREBASE.
   - Your data keeps living in this device's storage; sync copies it to your account and back.
   - The first time a device signs in, its data is COMBINED with what's already in the account (nothing is dropped).
   - After that, every change is uploaded within a few seconds and other devices pick it up live.
   Exposes window.RBTSync. */
(function () {
  'use strict';
  const FB = '10.14.1';
  const KEYS = ['rbt.inventory.v1', 'rbt.mydecks.v1', 'rbt.events.v1', 'rbt.wish.v1', 'rbt.matches.v1'];
  const META = 'rbtx.sync.meta';
  const field = (k) => k.replace(/\./g, '_');
  const st = { fb: null, user: null, applying: false, timer: null, unsub: null, status: 'off', last: 0, err: '' };
  const device = (() => { let d = localStorage.getItem('rbtx.device'); if (!d) { d = Math.random().toString(36).slice(2, 10); try { localStorage.setItem('rbtx.device', d); } catch {} } return d; })();
  const meta = () => { try { return Object.assign({ t: {}, pushed: {} }, JSON.parse(localStorage.getItem(META) || '{}')); } catch { return { t: {}, pushed: {} }; } };
  const putMeta = (m) => { try { origSet.call(localStorage, META, JSON.stringify(m)); } catch {} };
  const emit = () => window.dispatchEvent(new CustomEvent('rbt-sync-status', { detail: api.state() }));

  // note when synced data changes so it can be uploaded
  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    origSet.call(this, k, v);
    if (this === localStorage && !st.applying && KEYS.includes(k)) { const m = meta(); m.t[k] = Date.now(); putMeta(m); schedulePush(); }
  };

  /* ---- merging two copies of the same kind of data (used when a device first joins an account) */
  const parse = (s, d) => { try { return JSON.parse(s) || d; } catch { return d; } };
  function merge(k, a, b) {
    const A = parse(a, null), B = parse(b, null);
    if (!A) return b; if (!B) return a;
    if (k === 'rbt.inventory.v1' || k === 'rbt.wish.v1') {
      const out = { ...B, ...A, items: { ...(B.items || {}) } };
      for (const [id, e] of Object.entries(A.items || {})) {
        const o = out.items[id];
        if (!o) { out.items[id] = e; continue; }
        if (k === 'rbt.inventory.v1') out.items[id] = { ...o, ...e, qty: Math.max(+o.qty || 0, +e.qty || 0), added: Math.min(o.added || Infinity, e.added || Infinity), cost: e.cost ?? o.cost ?? null };
        else out.items[id] = { ...o, ...e };
      }
      return JSON.stringify(out);
    }
    const listKey = k === 'rbt.mydecks.v1' ? 'decks' : k === 'rbt.events.v1' ? 'events' : k === 'rbt.matches.v1' ? 'list' : null;
    if (listKey) {
      const stamp = (x) => x.updated || x.mod || x.t || x.created || 0;
      const byId = new Map();
      for (const x of [...(B[listKey] || []), ...(A[listKey] || [])]) { const id = x.id || JSON.stringify(x); const o = byId.get(id); if (!o || stamp(x) >= stamp(o)) byId.set(id, x); }
      return JSON.stringify({ ...B, ...A, [listKey]: [...byId.values()] });
    }
    return a;
  }

  async function sdk() {
    if (st.fb) return st.fb;
    const cfg = window.RBT_FIREBASE; if (!cfg) throw new Error('not configured');
    const base = `https://www.gstatic.com/firebasejs/${FB}/`;
    const [app, auth, fs] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
    const a = app.initializeApp(cfg);
    const au = auth.getAuth(a);
    try { await auth.setPersistence(au, auth.browserLocalPersistence); } catch {}
    st.fb = { ...auth, ...fs, auth: au, db: fs.getFirestore(a) };
    return st.fb;
  }
  const ref = () => st.fb.doc(st.fb.db, 'users', st.user.uid);

  async function firstJoin() {
    // this device hasn't synced with this account before: combine, never replace
    const f = st.fb, snap = await f.getDoc(ref()), remote = (snap.exists() && snap.data().keys) || {};
    const m = meta(), now = Date.now(), up = {};
    if (window.RBTSnapshot) try { await window.RBTSnapshot('Before first sync'); } catch {}
    st.applying = true;
    try {
      for (const k of KEYS) {
        const local = localStorage.getItem(k), r = remote[field(k)];
        let v = local;
        if (r && r.v) v = local ? merge(k, local, r.v) : r.v;
        if (v != null && v !== local) origSet.call(localStorage, k, v);
        if (v != null) { up[field(k)] = { v, t: now, by: device }; m.t[k] = now; m.pushed[k] = now; }
      }
    } finally { st.applying = false; }
    if (Object.keys(up).length) await f.setDoc(ref(), { keys: up, updated: now }, { merge: true });
    m.uid = st.user.uid; putMeta(m);
    window.dispatchEvent(new Event('rbt-sync'));
  }

  function listen() {
    if (st.unsub) st.unsub();
    st.unsub = st.fb.onSnapshot(ref(), (snap) => {
      const keys = (snap.exists() && snap.data().keys) || {}, m = meta(); let changed = false;
      st.applying = true;
      try {
        for (const k of KEYS) {
          const r = keys[field(k)];
          if (r && r.v != null && r.t > (m.t[k] || 0) && r.by !== device) { origSet.call(localStorage, k, r.v); m.t[k] = r.t; m.pushed[k] = r.t; changed = true; }
        }
      } finally { st.applying = false; }
      putMeta(m); st.last = Date.now(); st.status = 'on'; emit();
      if (changed) window.dispatchEvent(new Event('rbt-sync'));
    }, (e) => { st.err = e.message; st.status = 'error'; emit(); });
  }

  function schedulePush() { if (!st.user) return; clearTimeout(st.timer); st.timer = setTimeout(push, 1500); }
  async function push() {
    if (!st.user) return;
    const m = meta(), up = {};
    for (const k of KEYS) if ((m.t[k] || 0) > (m.pushed[k] || 0)) { const v = localStorage.getItem(k); if (v != null) up[field(k)] = { v, t: m.t[k], by: device }; }
    if (!Object.keys(up).length) return;
    const size = JSON.stringify(up).length;
    if (size > 900000) { st.err = 'Your data is too large to sync in one piece'; st.status = 'error'; emit(); return; }
    try {
      st.status = 'saving'; emit();
      await st.fb.setDoc(ref(), { keys: up, updated: Date.now() }, { merge: true });
      for (const k of KEYS) if (up[field(k)]) m.pushed[k] = up[field(k)].t;
      putMeta(m); st.last = Date.now(); st.status = 'on'; st.err = ''; emit();
    } catch (e) { st.err = e.message; st.status = 'error'; emit(); }
  }

  async function onUser(u) {
    st.user = u;
    if (!u) { if (st.unsub) st.unsub(); st.unsub = null; st.status = 'signed-out'; emit(); return; }
    st.status = 'joining'; emit();
    try {
      if (meta().uid !== u.uid) await firstJoin();
      listen(); push();
    } catch (e) { st.err = e.message; st.status = 'error'; emit(); }
  }

  const api = {
    configured: () => !!window.RBT_FIREBASE,
    state: () => ({ status: st.status, email: st.user && (st.user.email || st.user.displayName), last: st.last, err: st.err, configured: !!window.RBT_FIREBASE }),
    async start() {
      if (!window.RBT_FIREBASE) { st.status = 'unconfigured'; emit(); return; }
      try {
        const f = await sdk();
        try { await f.getRedirectResult(f.auth); } catch (e) { st.err = e.message; }
        f.onAuthStateChanged(f.auth, onUser);
      } catch (e) { st.status = 'offline'; st.err = 'Sync is unavailable offline'; emit(); }
    },
    async google() {
      const f = await sdk(), p = new f.GoogleAuthProvider();
      try { await f.signInWithPopup(f.auth, p); }
      catch (e) { if (/popup|operation-not-supported|web-storage/.test(e.code || '')) await f.signInWithRedirect(f.auth, p); else throw e; }
    },
    async email(email, pw, create) { const f = await sdk(); return create ? f.createUserWithEmailAndPassword(f.auth, email, pw) : f.signInWithEmailAndPassword(f.auth, email, pw); },
    async reset(email) { const f = await sdk(); return f.sendPasswordResetEmail(f.auth, email); },
    async signOut() { const f = await sdk(); const m = meta(); delete m.uid; putMeta(m); return f.signOut(f.auth); },
    syncNow: () => push(),
    _merge: merge,
  };
  window.RBTSync = api;
})();
