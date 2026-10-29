import { STOPS, SCHEDULE, dayKey, simNow, getShuttleState, formatClock, pickupTimes, STOP_OFFSETS } from './schedule.js';

const { gsap } = window;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
// `?still` renders final states without motion (handy for screenshots).
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.search).has('still');

document.documentElement.classList.add('js');

/* ---------- Map ----------
   The map (three.js plus street data) loads in the background. The rest of the app
   works without it, so nothing waits on it and a failure only shows a note. */
let map = null;
const mapEl = $('[data-map]');
// Bump ?v= with map changes: GitHub Pages lets browsers cache files for 10 minutes.
const mapReady = import('./map.js?v=3')
  .then(async (mod) => ({
    map: await mod.createMap({ container: mapEl, canvas: $('[data-map-canvas]'), labels: $('[data-map-labels]') }),
    REST: mod.REST,
  }))
  .catch((err) => {
    console.warn('Map unavailable', err);
    $('[data-map-fallback]').hidden = false;
    mapEl.classList.add('is-fallback');
    return null;
  });

/* ---------- Tabs ----------
   Each tab is a panel over the map: a bottom sheet on phones, a left column on wider screens.
   The hash (#live, #stops, #times, #pickups) is the source of truth, so links and Back work. */
const header = $('[data-header]');
const tabbar = $('[data-tabbar]');
const tabs = $$('[data-tab]');
const panels = $$('[data-panel]');
const wide = () => window.innerWidth >= 900;
let current = null;

function activePanel() { return panels.find((p) => p.dataset.panel === current) || panels[0]; }

// The part of the screen the map can use, so the camera frames the route there.
const insets = { top: 0, bottom: 0, left: 0 };
function targetInsets() {
  const panel = activePanel();
  const top = header.offsetHeight;
  if (wide()) return { top, bottom: 0, left: panel.offsetLeft + panel.offsetWidth };
  // On phones the map controls float above the Live sheet; keep the shuttle clear of them too.
  const controls = current === 'live' ? $('[data-map-controls]').offsetHeight + 12 : 0;
  return { top, bottom: panel.offsetHeight + tabbar.offsetHeight + controls, left: 0 };
}
function syncInsets(animate) {
  const live = $('[data-panel="live"]');
  document.documentElement.style.setProperty('--live-h', `${live.offsetHeight}px`);
  if (!map) return;
  const to = targetInsets();
  gsap.killTweensOf(insets);
  if (!animate || reduced) {
    Object.assign(insets, to);
    map.setInsets(insets.top, insets.bottom, insets.left);
    return;
  }
  gsap.to(insets, { ...to, duration: 0.7, ease: 'expo.out', onUpdate: () => map.setInsets(insets.top, insets.bottom, insets.left) });
}

function show(name, { animate = true } = {}) {
  if (!panels.some((p) => p.dataset.panel === name)) name = 'live';
  if (name === current) return;
  current = name;
  document.body.dataset.view = name;
  tabs.forEach((t) => {
    if (t.dataset.tab === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  panels.forEach((p) => {
    const on = p.dataset.panel === name;
    p.classList.toggle('is-active', on);
    p.inert = !on;
    if (on) p.scrollTop = 0;
  });
  if (name === 'stops') renderStops();
  if (name === 'times') renderTimes();
  requestAnimationFrame(() => syncInsets(animate));
}
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

/* ---------- Map view switcher ---------- */
const modeBtns = $$('[data-mode]');
const modeThumb = $('[data-mode-thumb]');
let mapMode = 'trip';
function placeThumb() {
  const on = modeBtns.find((b) => b.dataset.mode === mapMode);
  modeThumb.style.width = `${on.offsetWidth}px`;
  modeThumb.style.transform = `translateX(${on.offsetLeft}px)`;
}
modeBtns.forEach((b) => b.addEventListener('click', () => {
  mapMode = b.dataset.mode;
  modeBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  placeThumb();
  map?.setMode(mapMode);
}));
new ResizeObserver(placeThumb).observe($('[data-map-modes]'));

/* ---------- Live sheet ---------- */
const els = {
  label: $('[data-status-label]'),
  stop: $('[data-next-stop]'),
  num: $('[data-eta-num]'),
  unit: $('[data-eta-unit]'),
  time: $('[data-eta-time]'),
  fill: $('[data-trip-fill]'),
  bus: $('[data-trip-bus]'),
  tripStops: $$('[data-trip-stop]'),
};
const last = { stop: '', num: '', unit: '' };

function rollText(el, value, animate = true) {
  if (el.textContent === value) return;
  el.textContent = value;
  gsap.killTweensOf(el);
  if (reduced || !animate) { gsap.set(el, { clearProps: 'all' }); return; }
  gsap.fromTo(el,
    { yPercent: 70, opacity: 0, filter: 'blur(6px)' },
    { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out', clearProps: 'filter' });
}

let state = getShuttleState(simNow());
function renderState() {
  const s = (state = getShuttleState(simNow()));
  let label, stop, num, unit, time;
  if (s.mode === 'boarding') {
    label = 'Boarding at';
    stop = STOPS[s.atStop].name;
    num = String(Math.ceil(s.secondsToNext));
    unit = 'sec';
    time = `Leaves ${formatClock(s.departsAt)}`;
  } else {
    label = 'Next stop';
    stop = STOPS[s.nextStop].name;
    if (s.secondsToNext < 45) {
      num = 'Now';
      unit = '';
      time = 'Pulling in';
    } else {
      num = String(Math.ceil(s.secondsToNext / 60));
      unit = 'min';
      time = `Arrives ${formatClock(s.arrivesAt)}`;
    }
  }

  els.label.textContent = label;
  if (stop !== last.stop) { rollText(els.stop, stop); last.stop = stop; }
  // Seconds tick every frame-ish; only roll when the unit or minute changes.
  if (num !== last.num) { rollText(els.num, num, unit !== 'sec' || last.unit !== 'sec'); last.num = num; last.unit = unit; }
  els.unit.textContent = unit;
  els.time.textContent = time;

  const pct = (s.progress * 100).toFixed(2) + '%';
  els.fill.style.width = pct;
  els.bus.style.left = pct;
  const reachedIdx = Math.floor(s.progress * 3 + 0.0001);
  els.tripStops.forEach((li, i) => {
    li.classList.toggle('is-passed', i <= reachedIdx);
    li.classList.toggle('is-next', s.mode === 'driving' && i === s.leg + 1);
    li.classList.toggle('is-here', s.mode === 'boarding' && i === s.leg + 1);
  });

  if (map) {
    map.setShuttle(s.progress);
    map.setNextStop(s.mode === 'boarding' ? s.atStop : s.nextStop);
  }
}

/* ---------- Stops panel ---------- */
const minutesUntil = (hhmm, now) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m - (now.getHours() * 60 + now.getMinutes());
};
function nextAt(stopIndex) {
  const today = new Date();
  const t = pickupTimes(stopIndex, today, today)[0];
  if (t) return { label: t.label, in: minutesUntil(t.time, today) };
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const first = pickupTimes(stopIndex, tomorrow, today)[0];
  return first ? { label: first.label, tomorrow: true } : null;
}
function renderStops() {
  const s = state;
  const here = s.mode === 'boarding' ? s.atStop : null;
  $$('[data-stop-row]').forEach((row) => {
    const i = Number(row.dataset.stopRow);
    const n = nextAt(i);
    $('[data-stop-next]', row).textContent = n ? n.label : '';
    $('[data-stop-in]', row).textContent = !n ? 'No more runs' : n.tomorrow ? 'Tomorrow' : n.in <= 1 ? 'Now' : `in ${n.in} min`;
    const isHere = here === i;
    const isNext = s.mode === 'driving' && s.nextStop === i;
    row.classList.toggle('is-here', isHere);
    row.classList.toggle('is-next', isNext);
    $('[data-stop-badge]', row).textContent = isHere ? 'Shuttle is here' : isNext ? 'Shuttle heading here' : '';
  });
}

/* ---------- Times panel ---------- */
const clock = (mins) => formatClock(new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60));
function renderTimes() {
  const now = new Date();
  const key = dayKey(now);
  $$('[data-day]').forEach((row) => row.classList.toggle('is-today', row.dataset.day === key));
  const { open, close } = SCHEDULE[key];
  const mins = now.getHours() * 60 + now.getMinutes();
  const o = open[0] * 60 + open[1], c = close[0] * 60 + close[1];
  const running = mins >= o && mins < c;
  const status = $('[data-times-status]');
  status.textContent = running ? `Running now until ${clock(c)}.` : mins < o ? `Starts today at ${clock(o)}.` : 'Done for today.';
  status.classList.toggle('is-running', running);

  // Departures from Curtis Center, with when each run reaches Stop 1 and Stop 2.
  let deps = pickupTimes(0, now, now);
  let label = 'Next runs';
  if (!deps.length) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    deps = pickupTimes(0, tomorrow, now);
    label = 'First runs tomorrow';
  }
  $('[data-runs-title]').textContent = label;
  const body = $('[data-runs]');
  body.innerHTML = '';
  for (const d of deps.slice(0, 6)) {
    const [h, m] = d.time.split(':').map(Number);
    const dep = h * 60 + m;
    const tr = document.createElement('tr');
    for (const t of [dep, dep + STOP_OFFSETS[1], dep + STOP_OFFSETS[2]]) {
      const td = document.createElement('td');
      td.textContent = clock(t);
      tr.append(td);
    }
    body.append(tr);
  }
}

renderState();
gsap.ticker.add(renderState);
show(location.hash.slice(1) || 'live', { animate: false });
new ResizeObserver(() => syncInsets(false)).observe($('[data-panel="live"]'));
window.addEventListener('resize', () => syncInsets(false));
setInterval(() => {
  if (current === 'stops') renderStops();
  if (current === 'times') renderTimes();
}, 15000);

/* ---------- Intro ---------- */
// The app chrome appears right away; the Live sheet slides in through its CSS transition.
document.documentElement.classList.add('is-ready');
if (!reduced) {
  gsap.timeline({ defaults: { ease: 'expo.out' } })
    .from('.site-header .brand, .site-header .account', { y: -16, opacity: 0, duration: 1.2, stagger: 0.08 }, 0.1)
    .from(tabbar, wide() ? { y: -16, opacity: 0, duration: 1.2 } : { yPercent: 100, duration: 1.2 }, 0.2)
    .from('[data-map-controls] > *', { y: -10, opacity: 0, duration: 1, stagger: 0.08 }, 0.6);
}

// When the map is ready: the route draws itself, then the camera settles on the shuttle's trip.
mapReady.then((res) => {
  if (!res) return;
  map = res.map;
  renderState();
  syncInsets(false);
  if (reduced) { map.setMode(mapMode); return; }
  const { REST } = res;
  Object.assign(map.view, { polar: 0.05, azimuth: -0.4, zoom: 1.35, draw: 0, stops: 0, rise: 0, shuttle: 0 });
  gsap.timeline()
    .to(map.view, { polar: REST.polar, azimuth: REST.azimuth, zoom: 1, duration: 3.2, ease: 'expo.inOut' }, 0)
    .to(map.view, { rise: 1, duration: 2.4, ease: 'power3.out' }, 0.5)
    .to(map.view, { draw: 1, duration: 2.2, ease: 'power2.inOut' }, 1.1)
    .to(map.view, { stops: 1, duration: 1.2, ease: 'power2.out' }, 1.7)
    .to(map.view, { shuttle: 1, duration: 0.9, ease: 'back.out(2.2)' }, 2.6)
    .add(() => map.setMode(mapMode), 3.4);
});

window.addEventListener('load', () => syncInsets(false));
document.fonts?.ready.then(() => { placeThumb(); syncInsets(false); });
