import { onUser, signIn, isDemo, watchPickups, addPickup, cancelPickup, currentUser } from './auth.js';
import { pickupTimes, dateKey, formatClock } from './schedule.js';
import { showToast } from './account.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.search).has('still');
const STOP_NAMES = { stop1: 'Stop 1', stop2: 'Stop 2' };
const STOP_INDEX = { stop1: 1, stop2: 2 };

$('[data-year]').textContent = new Date().getFullYear();
$('[data-demo]').hidden = !isDemo;

const header = $('[data-header]');
const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const form = $('[data-form]');
const gate = $('[data-gate]');
const timesEl = $('[data-times]');
const timesEmpty = $('[data-times-empty]');
const nameInput = $('#pk-name');
const submitBtn = $('[data-submit]');
const statusEl = $('[data-status]');

const dayFrom = (offset) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };
const weekday = (d) => d.toLocaleDateString('en-US', { weekday: 'long' });
const timeLabel = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return formatClock(new Date(2000, 0, 1, h, m)); };
const state = { day: 0, stop: 'stop1', time: null };

$('[data-day-label="1"]').textContent = `Tomorrow, ${weekday(dayFrom(1))}`;

/* ---------- Time chips ---------- */
function renderTimes() {
  const times = pickupTimes(STOP_INDEX[state.stop], dayFrom(state.day));
  if (!times.some((t) => t.time === state.time)) state.time = times[0]?.time ?? null;
  timesEl.innerHTML = '';
  for (const t of times) {
    const label = document.createElement('label');
    label.className = 'pk-chip';
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'time', value: t.time, checked: t.time === state.time, disabled: !currentUser() });
    const span = document.createElement('span');
    span.textContent = t.label;
    label.append(input, span);
    timesEl.append(label);
  }
  timesEmpty.hidden = times.length > 0;
  timesEmpty.textContent = state.day === 0
    ? `No more pickups at ${STOP_NAMES[state.stop]} today. Try tomorrow.`
    : `The shuttle doesn’t stop at ${STOP_NAMES[state.stop]} tomorrow.`;
  updateSubmit();
}

form.addEventListener('change', (e) => {
  const { name, value } = e.target;
  if (name === 'day') { state.day = Number(value); renderTimes(); watchDay(); }
  if (name === 'stop') { state.stop = value; renderTimes(); }
  if (name === 'time') { state.time = value; updateSubmit(); }
});
nameInput.addEventListener('input', updateSubmit);

function updateSubmit() {
  submitBtn.disabled = !currentUser() || !state.time || !nameInput.value.trim();
}

/* ---------- Live data ---------- */
const byDate = { [dateKey(dayFrom(0))]: [], [dateKey(dayFrom(1))]: [] };
const failed = new Set();
function watchDay() { renderList(); }

const sortByTime = (a, b) => (a.date + a.time).localeCompare(b.date + b.time) || String(a.name).localeCompare(String(b.name));

function renderMine() {
  const user = currentUser();
  const mineEl = $('[data-mine]');
  const mine = user ? Object.values(byDate).flat().filter((p) => p.uid === user.uid).sort(sortByTime) : [];
  const existing = new Set($$('[data-id]', mineEl).map((li) => li.dataset.id));
  mineEl.innerHTML = '';
  for (const p of mine) {
    const li = document.createElement('li');
    li.className = 'pk-mine-row';
    li.dataset.id = p.id;
    const when = document.createElement('div');
    const strong = document.createElement('p');
    strong.className = 'pk-mine-time';
    strong.textContent = timeLabel(p.time);
    const sub = document.createElement('p');
    sub.className = 'pk-mine-where';
    sub.textContent = `${STOP_NAMES[p.stop]}, ${p.date === dateKey(dayFrom(0)) ? 'today' : 'tomorrow'}`;
    when.append(strong, sub);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'pk-cancel';
    cancel.textContent = 'Cancel';
    cancel.setAttribute('aria-label', `Cancel ${timeLabel(p.time)} pickup at ${STOP_NAMES[p.stop]}`);
    cancel.addEventListener('click', async () => {
      cancel.disabled = true;
      try { await cancelPickup(p.id); showToast(`Canceled your ${timeLabel(p.time)} pickup at ${STOP_NAMES[p.stop]}.`); }
      catch { cancel.disabled = false; showToast('Couldn’t cancel. Check your connection and try again.'); }
    });
    li.append(when, cancel);
    mineEl.append(li);
    if (!existing.has(p.id) && existing.size && !reduced && window.gsap) {
      gsap.from(li, { y: 12, opacity: 0, duration: 0.7, ease: 'expo.out' });
    }
  }
  $('[data-mine-empty]').hidden = mine.length > 0;
}

function renderList() {
  const key = dateKey(dayFrom(state.day));
  $('[data-list-title]').textContent = state.day === 0 ? 'Today’s list' : `${weekday(dayFrom(1))}’s list`;
  const listEl = $('[data-list]');
  listEl.innerHTML = '';
  const note = (text) => { const p = document.createElement('p'); p.className = 'pk-muted'; p.textContent = text; listEl.append(p); };
  if (!currentUser()) return note('Sign in to see who else is on the list.');
  if (failed.has(key)) return note('Couldn’t load the list. Check your connection and refresh.');
  const runs = new Map();
  for (const p of [...byDate[key]].sort(sortByTime)) {
    const k = `${p.time}|${p.stop}`;
    if (!runs.has(k)) runs.set(k, []);
    runs.get(k).push(p);
  }
  if (!runs.size) return note('No one has signed up yet.');
  const me = currentUser().uid;
  for (const [k, people] of runs) {
    const [time, stop] = k.split('|');
    const run = document.createElement('div');
    run.className = 'pk-run';
    const head = document.createElement('div');
    head.className = 'pk-run-head';
    head.innerHTML = '<span class="pk-run-time"></span><span class="pk-run-stop"></span><span class="pk-run-count"></span>';
    head.children[0].textContent = timeLabel(time);
    head.children[1].textContent = STOP_NAMES[stop];
    head.children[2].textContent = people.length === 1 ? '1 rider' : `${people.length} riders`;
    const ul = document.createElement('ul');
    ul.className = 'pk-names';
    for (const p of people) {
      const li = document.createElement('li');
      li.textContent = p.name;
      if (p.uid === me) { const you = document.createElement('span'); you.className = 'pk-you'; you.textContent = 'You'; li.append(' ', you); }
      ul.append(li);
    }
    run.append(head, ul);
    listEl.append(run);
  }
}

/* ---------- Save ---------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = currentUser();
  const name = nameInput.value.trim();
  if (!user) return signIn();
  if (!name) { statusEl.textContent = 'Add your name so the driver knows who to look for.'; nameInput.focus(); return; }
  if (!state.time) { statusEl.textContent = 'Pick a time. If none are left today, try tomorrow.'; return; }
  const date = dateKey(dayFrom(state.day));
  const dup = byDate[date].some((p) => p.uid === user.uid && p.time === state.time && p.stop === state.stop);
  if (dup) { statusEl.textContent = `You’re already on the ${timeLabel(state.time)} list at ${STOP_NAMES[state.stop]}.`; return; }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';
  try {
    await addPickup({ stop: state.stop, date, time: state.time, name });
    statusEl.textContent = `Saved. Be at ${STOP_NAMES[state.stop]} by ${timeLabel(state.time)}.`;
  } catch {
    statusEl.textContent = 'Couldn’t save your pickup. Check your connection and try again.';
  } finally {
    submitBtn.textContent = 'Save pickup';
    updateSubmit();
  }
});

/* ---------- Entrance ---------- */
const title = $('[data-split]');
if (!reduced && window.gsap) {
  const words = title.textContent.trim().split(/\s+/);
  title.setAttribute('aria-label', title.textContent.trim());
  title.innerHTML = words.map((w) => `<span class="tw-wrap" aria-hidden="true"><span class="tw">${w}</span></span>`).join(' ');
  gsap.timeline({ defaults: { ease: 'expo.out' } })
    .from('.site-header .header-inner > *', { y: -16, opacity: 0, duration: 1.1, stagger: 0.08 }, 0)
    .from('.tw', { yPercent: 110, duration: 1.3, stagger: 0.06 }, 0.15)
    .from('.pk-sub, .pk-demo', { y: 16, opacity: 0, filter: 'blur(6px)', duration: 1.1 }, 0.5)
    .from('.pk-card', { y: 40, opacity: 0, duration: 1.2 }, 0.6)
    .from('.pk-panel', { y: 32, opacity: 0, duration: 1.2, stagger: 0.1 }, 0.75);
}

/* ---------- Sign-in gate ---------- */
let prefilled = '';
onUser((user) => {
  gate.hidden = !!user;
  form.classList.toggle('is-locked', !user);
  $$('input, button[type="submit"]', form).forEach((el) => { el.disabled = !user; });
  if (user && (!nameInput.value || nameInput.value === prefilled)) {
    nameInput.value = prefilled = user.name || '';
  }
  renderTimes();
  renderMine();
  renderList();
});
$('[data-gate-signin]').addEventListener('click', () => signIn());

for (const key of Object.keys(byDate)) {
  watchPickups(key, (list) => {
    if (list === null) failed.add(key); else { failed.delete(key); byDate[key] = list; }
    renderMine();
    renderList();
  });
}
renderTimes();
// Times roll forward as the clock passes them.
setInterval(renderTimes, 60000);
