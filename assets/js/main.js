import { STOPS, SCHEDULE, dayKey, simNow, getShuttleState, formatClock } from './schedule.js';

const { gsap, ScrollTrigger } = window;
gsap.registerPlugin(ScrollTrigger);

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
// `?still` renders final states without motion (handy for screenshots).
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.search).has('still');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

document.documentElement.classList.add('js');
$('[data-year]').textContent = new Date().getFullYear();

/* ---------- Smooth scroll (desktop only; touch keeps native momentum) ---------- */
let lenis = null;
if (!reduced && finePointer && window.Lenis) {
  lenis = new window.Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4) });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

function scrollToTarget(target) {
  if (lenis) lenis.scrollTo(target, { offset: 0, duration: 1.4 });
  else (typeof target === 'number' ? window.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' }) : $(target).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }));
}
$$('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length < 2 || !$(id)) return;
    e.preventDefault();
    scrollToTarget(id === '#top' ? 0 : id);
  });
});

/* ---------- Header state ---------- */
const header = $('[data-header]');
ScrollTrigger.create({
  start: 24,
  end: 'max',
  onToggle: (self) => header.classList.toggle('is-scrolled', self.isActive),
});
ScrollTrigger.create({
  trigger: '#install',
  start: 'top 40px',
  end: 'bottom 40px',
  onToggle: (self) => header.classList.toggle('is-light', self.isActive),
});

/* ---------- Map ---------- */
let map = null;
let REST = { polar: 0.72, azimuth: 0.18 };
const mapEl = $('[data-map]');
try {
  const mod = await import('./map.js');
  const { createMap } = mod;
  REST = mod.REST;
  map = await createMap({ container: mapEl, canvas: $('[data-map-canvas]'), labels: $('[data-map-labels]') });
} catch (err) {
  console.warn('Map unavailable', err);
  $('[data-map-fallback]').hidden = false;
  mapEl.classList.add('is-fallback');
}

const sheet = $('[data-sheet]');
const heroCopy = $('[data-hero-copy]');
function updateInsets() {
  document.documentElement.style.setProperty('--sheet-h', `${sheet.offsetHeight}px`);
  if (!map) return;
  // Layout boxes (offset*), not getBoundingClientRect: intro/scroll transforms must not shift the map.
  const heroH = $('.hero').offsetHeight;
  const wide = window.innerWidth >= 1100;
  // Wide screens: the headline sits beside the loop. Narrower: the loop sits below it.
  const top = wide ? 96 : heroCopy.offsetTop + heroCopy.offsetHeight + 8;
  const left = wide ? heroCopy.offsetLeft + heroCopy.offsetWidth : 0;
  // Below wide layouts the view controls sit just above the sheet; keep the map clear of both.
  const controls = $('[data-map-controls]');
  const bottomEdge = wide ? sheet.offsetTop : Math.min(sheet.offsetTop, controls.offsetTop);
  map.setInsets(top, heroH - bottomEdge + 16, left);
}
new ResizeObserver(updateInsets).observe(sheet);
window.addEventListener('resize', updateInsets);
updateInsets();

/* Map view switcher */
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
placeThumb();
window.addEventListener('resize', placeThumb);
document.fonts?.ready.then(placeThumb);

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
let last = { stop: '', num: '' };

function rollText(el, value, animate = true) {
  if (el.textContent === value) return;
  el.textContent = value;
  gsap.killTweensOf(el);
  if (reduced || !animate) { gsap.set(el, { clearProps: 'all' }); return; }
  gsap.fromTo(el,
    { yPercent: 70, opacity: 0, filter: 'blur(6px)' },
    { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out', clearProps: 'filter' });
}

function renderState() {
  const s = getShuttleState(simNow());
  let label, stop, num, unit, time;
  if (s.mode === 'boarding') {
    label = 'Boarding at';
    stop = STOPS[s.atStop].name;
    const sec = Math.ceil(s.secondsToNext);
    num = String(sec);
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
renderState();
gsap.ticker.add(renderState);

/* ---------- Hours: mark today ---------- */
(function markToday() {
  const now = new Date();
  const key = dayKey(now);
  const row = $(`[data-day="${key}"]`);
  if (row) row.classList.add('is-today');
  const { open, close } = SCHEDULE[key];
  const mins = now.getHours() * 60 + now.getMinutes();
  const o = open[0] * 60 + open[1], c = close[0] * 60 + close[1];
  const fmt = ([h, m]) => formatClock(new Date(2000, 0, 1, h, m));
  $('[data-today]').textContent =
    mins >= o && mins < c ? `Running now until ${fmt(close)}.` :
    mins < o ? `Starts today at ${fmt(open)}.` : 'Done for today. See you tomorrow.';
})();

/* ---------- Copy link ---------- */
const copyBtn = $('[data-copy]');
const copyLabel = $('[data-copy-label]');
copyBtn.addEventListener('click', async () => {
  const url = location.origin + location.pathname;
  try {
    await navigator.clipboard.writeText(url);
    copyLabel.textContent = 'Link copied';
    copyBtn.classList.add('is-done');
  } catch {
    copyLabel.textContent = 'Copy failed. Use Share instead.';
  }
  setTimeout(() => { copyLabel.textContent = 'Copy link'; copyBtn.classList.remove('is-done'); }, 2200);
});

/* ---------- Word splitting ---------- */
function splitWords(el, cls = 'w') {
  const words = el.textContent.trim().split(/\s+/);
  el.setAttribute('aria-label', el.textContent.trim());
  el.innerHTML = words.map((w) => `<span class="${cls}-wrap" aria-hidden="true"><span class="${cls}">${w}</span></span>`).join(' ');
  return $$(`.${cls}`, el);
}

/* ---------- Motion ---------- */
if (reduced) {
  document.documentElement.classList.add('is-ready');
  map?.setMode(mapMode);
} else {
  // 1. Page-load moment: the city rises, the loop draws itself, the shuttle arrives.
  const titleWords = splitWords($('[data-split]'), 'tw');
  // The intro shows the whole route, then glides down to the shuttle's trip view.
  if (map) Object.assign(map.view, { polar: 0.05, azimuth: -0.4, zoom: 1.35, draw: 0, stops: 0, rise: 0, shuttle: 0 });

  const intro = gsap.timeline({ defaults: { ease: 'expo.out' }, onStart: () => document.documentElement.classList.add('is-ready') });
  if (map) {
    intro
      .to(map.view, { polar: REST.polar, azimuth: REST.azimuth, zoom: 1, duration: 3.2, ease: 'expo.inOut' }, 0)
      .to(map.view, { rise: 1, duration: 2.4, ease: 'power3.out' }, 0.5)
      .to(map.view, { draw: 1, duration: 2.2, ease: 'power2.inOut' }, 1.1)
      .to(map.view, { stops: 1, duration: 1.2, ease: 'power2.out' }, 1.7)
      .to(map.view, { shuttle: 1, duration: 0.9, ease: 'back.out(2.2)' }, 2.6)
      .add(() => map.setMode(mapMode), 3.4);
  }
  intro
    .from('.site-header .header-inner > *', { y: -16, opacity: 0, duration: 1.2, stagger: 0.08 }, 0.4)
    .from(titleWords, { yPercent: 110, duration: 1.4, stagger: 0.06 }, 0.9)
    .from('.hero-sub', { y: 16, opacity: 0, filter: 'blur(6px)', duration: 1.2 }, 1.4)
    .from(sheet, { yPercent: 120, duration: 1.4 }, 2.0)
    .from('[data-map-controls] > *', { y: -10, opacity: 0, duration: 1, stagger: 0.08 }, 2.3);

  // 2. Leaving the hero: camera lifts to a top-down view, copy drifts away.
  const heroTl = gsap.timeline({
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.6 },
  });
  heroTl
    .to(heroCopy, { yPercent: -40, opacity: 0, filter: 'blur(8px)', ease: 'none' }, 0)
    .to('[data-map]', { yPercent: 28, ease: 'none' }, 0)
    .to(sheet, { y: 60, opacity: 0, ease: 'power1.in' }, 0.25)
    .to('[data-map-controls]', { opacity: 0, ease: 'none' }, 0);
  if (map) {
    // Scrub a proxy so the intro tween keeps ownership of map.view until it finishes.
    const lift = { p: 0 };
    let base = null;
    heroTl.to(lift, {
      p: 1, ease: 'none',
      onUpdate: () => {
        if (intro.isActive()) return;
        base ??= { polar: map.view.polar, zoom: map.view.zoom };
        map.view.polar = base.polar + (0.2 - base.polar) * lift.p;
        map.view.zoom = base.zoom + 0.5 * lift.p;
      },
    }, 0);
  }

  // 3. Statement: words light up as you scroll (after Magic UI's Text Reveal).
  const words = splitWords($('[data-reveal-words]'), 'rw');
  gsap.timeline({
    scrollTrigger: { trigger: '[data-statement]', start: 'top top', end: '+=140%', pin: true, scrub: 0.5 },
  }).fromTo(words, { opacity: 0.14 }, { opacity: 1, stagger: 0.1, ease: 'none' })
    .to({}, { duration: 0.6 });

  // 4. The loop: the red rail fills stop to stop.
  const rail = $('[data-loop-stops]');
  const stops = $$('[data-loop-stop]');
  const mm = gsap.matchMedia();
  mm.add('(min-width: 900px)', () => {
    const tl = gsap.timeline({
      scrollTrigger: { trigger: '[data-loop]', start: 'top top', end: '+=160%', pin: true, scrub: 0.6 },
    });
    tl.from('.loop-head > *', { y: 40, opacity: 0, stagger: 0.1, duration: 0.4 }, 0)
      .fromTo(rail, { '--rail': 0 }, { '--rail': 1, ease: 'none', duration: 2 }, 0.3);
    stops.forEach((st, i) => {
      const at = 0.3 + (i / (stops.length - 1)) * 2;
      tl.fromTo(st, { opacity: 0.2, y: 24 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }, at - 0.05);
      tl.fromTo($('.loop-dot', st), { scale: 0.5 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, at);
    });
    tl.to({}, { duration: 0.4 });
  });
  mm.add('(max-width: 899px)', () => {
    gsap.fromTo(rail, { '--rail': 0 }, {
      '--rail': 1, ease: 'none',
      scrollTrigger: { trigger: rail, start: 'top 70%', end: 'bottom 60%', scrub: 0.5 },
    });
    stops.forEach((st) => {
      gsap.from(st, { opacity: 0.2, x: -12, duration: 0.8, ease: 'expo.out', scrollTrigger: { trigger: st, start: 'top 75%', toggleActions: 'play none none reverse' } });
    });
  });

  // 5. Marquee that speeds up and leans with scroll velocity (after Magic UI's Scroll Based Velocity).
  const band = $('[data-band]');
  const row = $('.band-row', band);
  band.append(row.cloneNode(true), row.cloneNode(true));
  let x = 0, skew = 0;
  const setX = gsap.quickSetter(band, 'x', 'px');
  const setSkew = gsap.quickSetter(band, 'skewX', 'deg');
  const bandST = ScrollTrigger.create({ trigger: '.band', start: 'top bottom', end: 'bottom top' });
  gsap.ticker.add((_, dt) => {
    if (!bandST.isActive) return;
    const v = bandST.getVelocity();
    const boost = gsap.utils.clamp(-6, 6, v / 300);
    x -= (0.6 + Math.abs(boost) * 1.6) * (dt / 16.67) * (boost < -0.2 ? -1 : 1);
    const w = row.offsetWidth;
    if (x <= -w) x += w;
    if (x > 0) x -= w;
    setX(x);
    skew += (gsap.utils.clamp(-8, 8, -v / 220) - skew) * 0.1;
    setSkew(skew);
  });

  // 6. Hours rows wipe in.
  gsap.from('.hours-row', {
    clipPath: 'inset(0 0 100% 0)', y: 20, duration: 1.1, ease: 'expo.out', stagger: 0.1,
    scrollTrigger: { trigger: '[data-hours]', start: 'top 80%' },
  });

  // 7. Install: the steps count in.
  gsap.from('.steps li', {
    y: 24, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.12,
    scrollTrigger: { trigger: '.steps', start: 'top 85%' },
  });

  // 8. Footer wordmark rises letter by letter.
  const fw = $('[data-footer-word]');
  fw.innerHTML = [...fw.textContent].map((c) => `<span>${c}</span>`).join('');
  gsap.from($$('span', fw), {
    yPercent: 100, ease: 'none', stagger: 0.04,
    scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: 0.6 },
  });
}

window.addEventListener('load', () => { updateInsets(); ScrollTrigger.refresh(); });
document.fonts?.ready.then(() => ScrollTrigger.refresh());
