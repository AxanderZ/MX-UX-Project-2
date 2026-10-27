// Sign-in and pickup storage. Uses Firebase (Google sign-in + Firestore) when
// firebase-config.js is filled in, and a browser-only demo backend until then,
// so the pages work the same either way.

import { firebaseConfig, ALLOWED_DOMAIN } from './firebase-config.js';

export const isDemo = !firebaseConfig.apiKey;
export const allowedDomain = ALLOWED_DOMAIN;

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const listeners = new Set();
let current = null;
let known = false;
let fb = null;

function emit(user, error = null) {
  current = user;
  known = true;
  listeners.forEach((fn) => fn(user, error));
}

/** Calls fn(user, error) now (once the sign-in state is known) and on every change. */
export function onUser(fn) {
  listeners.add(fn);
  if (known) fn(current, null);
  return () => listeners.delete(fn);
}
export const currentUser = () => current;

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

const ready = (async () => {
  if (isDemo) { emit(read('striperide.demoUser', null)); return; }
  const [app, auth, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
  ]);
  const instance = app.initializeApp(firebaseConfig);
  fb = { auth, fs, a: auth.getAuth(instance), db: fs.getFirestore(instance) };
  auth.onAuthStateChanged(fb.a, async (u) => {
    if (u && ALLOWED_DOMAIN && !u.email?.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
      await auth.signOut(fb.a);
      emit(null, `Sign in with your @${ALLOWED_DOMAIN} account.`);
      return;
    }
    emit(u ? { uid: u.uid, name: u.displayName || u.email, email: u.email, photo: u.photoURL } : null);
  });
  auth.getRedirectResult(fb.a).catch((e) => emit(null, friendlyError(e)));
})();

function friendlyError(e) {
  if (e?.code === 'auth/unauthorized-domain') return 'This web address isn’t allowed to sign in yet. Add it under Firebase → Authentication → Settings → Authorized domains.';
  if (e?.code === 'auth/network-request-failed') return 'Couldn’t reach Google. Check your connection and try again.';
  return 'Sign-in didn’t finish. Try again.';
}

export async function signIn() {
  await ready;
  if (isDemo) {
    const user = { uid: 'demo-student', name: 'Demo Student', email: 'demo@example.com', photo: null };
    write('striperide.demoUser', user);
    emit(user);
    return;
  }
  const provider = new fb.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account', ...(ALLOWED_DOMAIN ? { hd: ALLOWED_DOMAIN } : {}) });
  try {
    await fb.auth.signInWithPopup(fb.a, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await fb.auth.signInWithRedirect(fb.a, provider);
    } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      emit(null, friendlyError(e));
    }
  }
}

export async function signOut() {
  await ready;
  if (isDemo) {
    try { localStorage.removeItem('striperide.demoUser'); } catch { /* ignore */ }
    emit(null);
    return;
  }
  await fb.auth.signOut(fb.a);
}

/* ---------- Pickups ----------
   One document per request: { uid, name, email, stop: 'stop1' | 'stop2',
   date: 'YYYY-MM-DD', time: 'HH:MM', createdAt }. */

const demoBus = new Set();
const demoAll = () => read('striperide.pickups', []);
const demoSave = (list) => { write('striperide.pickups', list); demoBus.forEach((fn) => fn()); };
window.addEventListener('storage', (e) => { if (e.key === 'striperide.pickups') demoBus.forEach((fn) => fn()); });

/** Live list of every pickup on `date`. Returns an unsubscribe function. */
export function watchPickups(date, cb) {
  if (isDemo) {
    const push = () => cb(demoAll().filter((p) => p.date === date));
    demoBus.add(push);
    push();
    return () => demoBus.delete(push);
  }
  let unsub = () => {};
  let stopped = false;
  ready.then(() => {
    if (stopped) return;
    const { fs, db } = fb;
    const q = fs.query(fs.collection(db, 'pickups'), fs.where('date', '==', date));
    unsub = fs.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb(null));
  });
  return () => { stopped = true; unsub(); };
}

export async function addPickup({ stop, date, time, name }) {
  await ready;
  const user = current;
  if (!user) throw new Error('Sign in to save a pickup.');
  const entry = { uid: user.uid, name: name.trim().slice(0, 60), email: user.email, stop, date, time };
  if (isDemo) {
    demoSave([...demoAll(), { ...entry, id: `demo-${Date.now()}`, createdAt: Date.now() }]);
    return;
  }
  const { fs, db } = fb;
  await fs.addDoc(fs.collection(db, 'pickups'), { ...entry, createdAt: fs.serverTimestamp() });
}

export async function cancelPickup(id) {
  await ready;
  if (isDemo) { demoSave(demoAll().filter((p) => p.id !== id)); return; }
  const { fs, db } = fb;
  await fs.deleteDoc(fs.doc(db, 'pickups', id));
}
