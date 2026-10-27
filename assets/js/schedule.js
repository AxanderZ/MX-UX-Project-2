// Shuttle timing model.
// Until real GPS is wired in, the shuttle's position is derived from the clock:
// it leaves Curtis Center at :00, :20, and :40 and runs the loop below.
// Swap `getShuttleState` for a GPS feed later; the UI only reads its return value.

export const STOPS = [
  { id: 'curtis', name: 'Curtis Center' },
  { id: 'stop1', name: 'Stop 1' },
  { id: 'stop2', name: 'Stop 2' },
];

// Minutes per leg, from Google Maps drive times (about 17 min of driving per loop).
// Each leg: drive to the next stop, then dwell there.
export const LEGS = [
  { from: 0, to: 1, drive: 7, dwell: 1 }, // Curtis Center -> Stop 1 (parking lot) via Lowell Rd
  { from: 1, to: 2, drive: 3, dwell: 1 }, // Stop 1 -> Stop 2 (117 Thoreau St)
  { from: 2, to: 0, drive: 7, dwell: 1 }, // Stop 2 -> Curtis Center (boarding for next loop)
];

export const LOOP_MIN = LEGS.reduce((t, l) => t + l.drive + l.dwell, 0); // 20

// Placeholder service hours, 24h clock. Keep in sync with the Hours section in index.html.
export const SCHEDULE = {
  weekday: { open: [15, 30], close: [21, 30] },
  sat: { open: [10, 0], close: [23, 0] },
  sun: { open: [10, 0], close: [20, 0] },
};

export function dayKey(date) {
  const d = date.getDay();
  return d === 0 ? 'sun' : d === 6 ? 'sat' : 'weekday';
}

// `?speed=20` runs the simulated clock 20x faster, handy for previewing motion.
const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Math.min(120, Number(params.get('speed')) || 1));
// `?offset=12` shifts the simulated clock by 12 minutes, to preview a point in the loop.
const OFFSET = (Number(params.get('offset')) || 0) * 60000;
const T0 = Date.now();
export const simNow = () => new Date(T0 + OFFSET + (Date.now() - T0) * SPEED);

const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

/**
 * Where the shuttle is in its loop.
 * `progress` is 0..1 around the loop measured in stop-to-stop segments
 * (0 = Curtis Center, 1/3 = Stop 1, 2/3 = Stop 2, 1 = back at Curtis Center),
 * which the map maps onto the drawn route.
 */
export function getShuttleState(now = simNow()) {
  const secs = now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
  let t = (secs / 60) % LOOP_MIN; // minutes into the current loop

  for (let i = 0; i < LEGS.length; i++) {
    const leg = LEGS[i];
    if (t < leg.drive) {
      const f = t / leg.drive;
      const remainingSec = (leg.drive - t) * 60;
      return {
        mode: 'driving',
        leg: i,
        nextStop: leg.to,
        progress: (i + ease(f)) / LEGS.length,
        legFraction: f,
        secondsToNext: remainingSec,
        arrivesAt: new Date(now.getTime() + remainingSec * 1000),
      };
    }
    t -= leg.drive;
    if (t < leg.dwell) {
      const remainingSec = (leg.dwell - t) * 60;
      return {
        mode: 'boarding',
        leg: i,
        atStop: leg.to,
        nextStop: LEGS[(i + 1) % LEGS.length].to,
        progress: (i + 1) / LEGS.length,
        legFraction: 1,
        secondsToNext: remainingSec,
        departsAt: new Date(now.getTime() + remainingSec * 1000),
      };
    }
    t -= leg.dwell;
  }
  return getShuttleState(new Date(now.getTime() + 1));
}

export function formatClock(date) {
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
