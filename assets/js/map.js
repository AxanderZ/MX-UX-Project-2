// 3D night map of the shuttle route, built from OpenStreetMap data baked into
// assets/data/concord.json (streets, building footprints, water, and the route itself).
// Everything is at true scale: 1 scene unit = 10 m, x east, z south.
//
// Camera framing works like a ride app's trip view:
//   'trip'    frames the shuttle and the road to its next stop (default)
//   'shuttle' follows the shuttle at street level
//   'route'   shows the whole route, campus to town
// Lines, stops, and the shuttle keep a minimum on-screen size so they stay readable when
// zoomed out, and grow to their real size when zoomed in.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const RED = 0xd31245;
// Resting camera angle; main.js tweens to these after the intro.
export const REST = { polar: 0.66, azimuth: 0.1 };

const STOP_NAMES = ['Curtis Center', 'Stop 1', 'Stop 2'];
const DM = 100; // data is in decimeters

// Street classes from the bake step: 0 major, 1 tertiary, 2 residential, 3 service.
const ROAD_STYLE = [
  { color: 0x343434, real: 1.1, minPx: 2.4, y: 0.04 },
  { color: 0x2c2c2c, real: 0.9, minPx: 1.8, y: 0.03 },
  { color: 0x252525, real: 0.7, minPx: 1.1, y: 0.02 },
  { color: 0x1c1c1c, real: 0.4, minPx: 0, y: 0.01 },
];
const STREET_LABELS = [
  'Lowell Road', 'Keyes Road', 'Main Street', 'Thoreau Street', 'Sudbury Road', 'Belknap Street',
  'Middle Street', 'Walden Street', 'Lexington Road', 'Bedford Street', 'Elm Street',
  'Nashawtuc Road', 'Academy Lane', 'Hubbard Street', 'Stow Street', 'Monument Street',
];
const abbreviate = (n) => n.replace(/ Street$/, ' St').replace(/ Road$/, ' Rd').replace(/ Lane$/, ' Ln');

const toPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i] / DM, flat[i + 1] / DM));
  return out;
};

// Flat polylines whose width is applied in the vertex shader, so it can respond to zoom.
function lineGeometry(lines, y) {
  const pos = [], side = [], idx = [];
  for (const pts of lines) {
    const n = pts.length;
    if (n < 2) continue;
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let nx, nz, scale = 1;
      if (i === 0 || i === n - 1) {
        const dx = b.x - a.x, dz = b.y - a.y, l = Math.hypot(dx, dz) || 1;
        nx = -dz / l; nz = dx / l;
      } else {
        // Miter join
        const l1 = Math.hypot(p.x - a.x, p.y - a.y) || 1, l2 = Math.hypot(b.x - p.x, b.y - p.y) || 1;
        const n1x = -(p.y - a.y) / l1, n1z = (p.x - a.x) / l1;
        const n2x = -(b.y - p.y) / l2, n2z = (b.x - p.x) / l2;
        nx = n1x + n2x; nz = n1z + n2z;
        const l = Math.hypot(nx, nz);
        if (l < 1e-4) { nx = n1x; nz = n1z; } else {
          nx /= l; nz /= l;
          scale = Math.min(2.5, 1 / Math.max(nx * n1x + nz * n1z, 0.4));
        }
      }
      pos.push(p.x, y, p.y, p.x, y, p.y);
      side.push(nx * scale, 0, nz * scale, -nx * scale, 0, -nz * scale);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2, b = a + 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('side', new THREE.Float32BufferAttribute(side, 3));
  g.setIndex(idx);
  return g;
}

function buildingGeometry(list) {
  const pos = [], nor = [];
  for (const b of list) {
    let ring = toPts(b.p);
    if (ring.length < 3) continue;
    if (THREE.ShapeUtils.isClockWise(ring)) ring = ring.reverse();
    const h = b.h / DM;
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring, [])) {
      const A = ring[i], B = ring[j], C = ring[k];
      const up = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y) > 0;
      for (const P of up ? [A, B, C] : [A, C, B]) { pos.push(P.x, h, P.y); nor.push(0, 1, 0); }
    }
    for (let i = 0; i < ring.length; i++) {
      const P = ring[i], Q = ring[(i + 1) % ring.length];
      const dx = Q.x - P.x, dz = Q.y - P.y, l = Math.hypot(dx, dz) || 1;
      const nx = dz / l, nz = -dx / l;
      pos.push(P.x, 0, P.y, Q.x, h, Q.y, Q.x, 0, Q.y, P.x, 0, P.y, P.x, h, P.y, Q.x, h, Q.y);
      for (let k = 0; k < 6; k++) nor.push(nx, 0, nz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export async function createMap({ container, canvas, labels }) {
  const data = await fetch(new URL('../data/concord.json', import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`Map data ${r.status}`);
    return r.json();
  });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 60, 200);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 4000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-0.5, 1, 0.35);
  scene.add(sun);

  // Uniforms shared by every zoom-aware line.
  const shared = { uWpp: { value: 0.05 }, uFogNear: { value: 60 }, uFogFar: { value: 200 } };
  function lineMaterial({ color, real, minPx, opacity = 1, additive = false, overlay = false, fog = true }) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uWpp: shared.uWpp, uFogNear: shared.uFogNear, uFogFar: shared.uFogFar,
        uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
        uReal: { value: real }, uMinPx: { value: minPx }, uFog: { value: fog ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 side;
        uniform float uReal, uMinPx, uWpp;
        varying float vDepth;
        void main() {
          float w = max(uReal, uMinPx * uWpp);
          vec4 mv = modelViewMatrix * vec4(position + side * (w * 0.5), 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity, uFogNear, uFogFar, uFog;
        varying float vDepth;
        void main() {
          float f = uFog * smoothstep(uFogNear, uFogFar, vDepth);
          gl_FragColor = vec4(mix(uColor, vec3(0.0), f), uOpacity);
          #include <colorspace_fragment>
        }`,
      transparent: opacity < 1 || additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthTest: !overlay,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  const addLine = (geo, mat, order) => {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = order;
    scene.add(m);
    return m;
  };

  // Ground and water draw first and never write depth, so streets can't z-fight them.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: 0x0a0a0a, depthWrite: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = -10;
  scene.add(ground);

  const waterColor = 0x0d131b;
  const shapes = data.water.areas.map((flat) => new THREE.Shape(toPts(flat).map((p) => new THREE.Vector2(p.x, -p.y))));
  const water = new THREE.Mesh(new THREE.ShapeGeometry(shapes), new THREE.MeshBasicMaterial({ color: waterColor, depthWrite: false }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.005;
  water.renderOrder = -9;
  scene.add(water);
  for (const w of [3, 18]) {
    const lines = data.water.lines.filter((l) => l.w === w).map((l) => toPts(l.p));
    addLine(lineGeometry(lines, 0.006), lineMaterial({ color: waterColor, real: w / 10, minPx: w > 3 ? 2 : 0.8 }), -8);
  }

  // Streets
  const byClass = [[], [], [], []];
  const named = new Map();
  for (const r of data.roads) {
    const pts = toPts(r.p);
    byClass[r.c].push(pts);
    if (r.n && STREET_LABELS.includes(r.n)) {
      if (!named.has(r.n)) named.set(r.n, []);
      named.get(r.n).push(pts);
    }
  }
  [3, 2, 1, 0].forEach((c, i) => {
    const s = ROAD_STYLE[c];
    addLine(lineGeometry(byClass[c], s.y), lineMaterial(s), -7 + i);
  });

  // Buildings, extruded from their real footprints
  const city = new THREE.Mesh(buildingGeometry(data.buildings), new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.9 }));
  scene.add(city);

  // Route. The shuttle's path covers the whole trip; the drawn line is only the runs of
  // road not already drawn, so streets driven in both directions show once.
  const pathPts = toPts(data.route.p);
  const pathLen = [0];
  for (let i = 1; i < pathPts.length; i++) pathLen.push(pathLen[i - 1] + pathPts[i].distanceTo(pathPts[i - 1]));
  const total = pathLen[pathLen.length - 1];
  const stopIdx = data.route.stops;
  const stopU = stopIdx.map((i) => pathLen[i] / total);
  const stopVecs = stopIdx.map((i) => new THREE.Vector3(pathPts[i].x, 0, pathPts[i].y));
  const drawn = data.route.runs.map(([from, to]) => pathPts.slice(from, to + 1));
  const routeGlowGeo = lineGeometry(drawn, 0.06);
  const routeGeo = lineGeometry(drawn, 0.07);
  addLine(routeGlowGeo, lineMaterial({ color: RED, real: 0.8, minPx: 14, opacity: 0.14, additive: true, overlay: true, fog: false }), 10);
  addLine(routeGeo, lineMaterial({ color: RED, real: 0.32, minPx: 4.5, overlay: true, fog: false }), 11);
  const routeIndexCount = routeGeo.index.count;

  // Stops
  const overlay = { fog: false, depthTest: false, depthWrite: false, side: THREE.DoubleSide };
  const STOP_R = 0.32;
  const stopMeshes = stopVecs.map((p, i) => {
    const g = new THREE.Group();
    const r = i === 0 ? STOP_R * 1.25 : STOP_R;
    const outer = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, ...overlay }));
    const inner = new THREE.Mesh(new THREE.CircleGeometry(r * 0.42, 32), new THREE.MeshBasicMaterial({ color: 0x000000, ...overlay }));
    outer.rotation.x = inner.rotation.x = -Math.PI / 2;
    outer.position.y = 0.08; inner.position.y = 0.09;
    outer.renderOrder = 12; inner.renderOrder = 13;
    g.add(outer, inner);
    g.position.copy(p);
    scene.add(g);
    return g;
  });

  // Shuttle: unlit and fog-free so it reads as the brightest thing on the map.
  const shuttle = new THREE.Group();
  const solid = { fog: false, depthTest: false };
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.5, 1.3, 4, 0.16), new THREE.MeshBasicMaterial({ color: 0xffffff, ...solid }));
  body.position.y = 0.32;
  const roof = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.06, 1.08, 2, 0.03), new THREE.MeshBasicMaterial({ color: 0xeaeaea, ...solid }));
  roof.position.y = 0.58;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.11, 1.22), new THREE.MeshBasicMaterial({ color: RED, ...solid }));
  band.position.y = 0.3;
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.04), new THREE.MeshBasicMaterial({ color: 0x111111, ...solid }));
  windshield.position.set(0, 0.45, 0.645);
  [body, band, windshield, roof].forEach((m, i) => { m.renderOrder = 30 + i; });
  shuttle.add(body, band, windshield, roof);
  const pulseMat = new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.5, ...overlay });
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 64), pulseMat);
  pulse.rotation.x = -Math.PI / 2;
  pulse.position.y = 0.04;
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 48),
    new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, ...overlay })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.035;
  pulse.renderOrder = 20;
  halo.renderOrder = 20;
  const shuttleRoot = new THREE.Group();
  shuttleRoot.add(shuttle, pulse, halo);
  scene.add(shuttleRoot);
  const SHUTTLE_LEN = 1.3;

  // DOM labels: stops, plus street names when zoomed in
  const labelEls = STOP_NAMES.map((name, i) => {
    const el = document.createElement('div');
    el.className = 'map-label' + (i === 0 ? ' is-home' : '');
    el.innerHTML = `<span>${name}</span>`;
    labels.appendChild(el);
    return el;
  });
  const streetLabels = [];
  for (const [name, lines] of named) {
    // Anchor on the piece of the street closest to Stop 1, in the middle of town.
    let best = null, bestD = Infinity;
    for (const pts of lines) {
      const mid = pts[Math.floor(pts.length / 2)];
      const d = Math.hypot(mid.x - stopVecs[1].x, mid.y - stopVecs[1].z);
      if (d < bestD && pts.length > 1) { bestD = d; best = pts; }
    }
    if (!best) continue;
    let len = 0;
    for (let i = 1; i < best.length; i++) len += best[i].distanceTo(best[i - 1]);
    let acc = 0, k = 1;
    for (; k < best.length - 1; k++) { acc += best[k].distanceTo(best[k - 1]); if (acc >= len / 2) break; }
    const a = best[k - 1], b = best[k];
    const el = document.createElement('div');
    el.className = 'street-label';
    el.textContent = abbreviate(name);
    labels.appendChild(el);
    streetLabels.push({
      el,
      p: new THREE.Vector3((a.x + b.x) / 2, 0, (a.y + b.y) / 2),
      d: new THREE.Vector3(b.x - a.x, 0, b.y - a.y).normalize(),
    });
  }

  // Animatable view state (tweened from main.js)
  const view = {
    polar: REST.polar,
    azimuth: REST.azimuth,
    zoom: 1,     // multiplier on the framed distance
    draw: 1,     // route reveal 0..1
    stops: 1,    // stop marker scale 0..1
    rise: 1,     // building height 0..1
    shuttle: 1,  // shuttle visibility 0..1
    drift: true,
  };

  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const insets = { top: 0, bottom: 0, left: 0 };
  let width = 1, height = 1;
  let progress = 0;
  let mode = 'route';
  let visible = true;
  let raf = 0;
  const cam = { x: 0, z: 0, dist: 300, ready: false };
  const shuttlePos = new THREE.Vector3();
  const target = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tangent = new THREE.Vector2();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.search).has('still');
  const routeSample = pathPts.filter((_, i) => i % 3 === 0);
  let routeFrame = null;

  function resize() {
    const r = container.getBoundingClientRect();
    width = Math.max(1, r.width);
    height = Math.max(1, r.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, width < 700 ? 1.75 : 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const shift = (insets.bottom - insets.top) / 2;
    camera.setViewOffset(width, height, -insets.left / 2, shift, width, height);
    camera.updateProjectionMatrix();
    routeFrame = frame2D(routeSample, 0);
  }

  function placeCamera(dist, polar, az, tgt) {
    camera.position.set(
      tgt.x + dist * Math.sin(polar) * Math.sin(az),
      tgt.y + dist * Math.cos(polar),
      tgt.z + dist * Math.sin(polar) * Math.cos(az)
    );
    camera.lookAt(tgt);
    camera.updateMatrixWorld();
  }

  // Center and distance that keep `pts` (Vector2 x/z) inside the free part of the screen.
  function frame2D(pts, minDist) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y);
    }
    tmp2.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const pad = Math.min(56, width * 0.08);
    const x0 = insets.left + pad, x1 = width - pad;
    const y0 = insets.top + pad, y1 = height - insets.bottom - pad * 0.6;
    let lo = 4, hi = 3000;
    for (let k = 0; k < 22; k++) {
      const mid = Math.sqrt(lo * hi);
      placeCamera(mid, REST.polar, REST.azimuth, tmp2);
      const fits = pts.every((p) => {
        tmp.set(p.x, 0, p.y).project(camera);
        const x = (tmp.x * 0.5 + 0.5) * width, y = (-tmp.y * 0.5 + 0.5) * height;
        return tmp.z < 1 && x >= x0 && x <= x1 && y >= y0 && y <= y1;
      });
      if (fits) hi = mid; else lo = mid;
    }
    return { x: tmp2.x, z: tmp2.z, dist: Math.max(hi, minDist) };
  }

  function distanceAt(p) {
    // Back at Curtis Center the next trip has begun: frame the run to Stop 1.
    if (p >= 1) return { d: 0, nextD: stopU[1] * total };
    const segF = Math.min(2.99999, Math.max(0, p * 3));
    const seg = Math.floor(segF);
    const f = segF - seg;
    const a = stopU[seg], b = seg === 2 ? 1 : stopU[seg + 1];
    return { d: (a + (b - a) * f) * total, nextD: b * total };
  }

  function pointAt(d, out) {
    let lo = 0, hi = pathLen.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pathLen[m] <= d) lo = m; else hi = m; }
    const k = (d - pathLen[lo]) / Math.max(1e-6, pathLen[hi] - pathLen[lo]);
    out.set(pathPts[lo].x + (pathPts[hi].x - pathPts[lo].x) * k, 0, pathPts[lo].y + (pathPts[hi].y - pathPts[lo].y) * k);
    tangent.subVectors(pathPts[hi], pathPts[lo]).normalize();
    return out;
  }

  const tripPts = Array.from({ length: 37 }, () => new THREE.Vector2());
  function desiredFrame(d, nextD) {
    if (mode === 'route') return routeFrame;
    if (mode === 'shuttle') return { x: shuttlePos.x, z: shuttlePos.z, dist: 30 };
    // Trip: the shuttle plus the road ahead to its next stop.
    tripPts.forEach((v, i) => {
      pointAt(d + ((nextD - d) * i) / (tripPts.length - 1), tmp);
      v.set(tmp.x, tmp.z);
    });
    pointAt(d, shuttlePos);
    return frame2D(tripPts, 42);
  }

  function project(vec, el, rotate) {
    tmp.copy(vec).project(camera);
    const x = (tmp.x * 0.5 + 0.5) * width;
    const y = (-tmp.y * 0.5 + 0.5) * height;
    const off = tmp.z > 1 || x < -80 || x > width + 80 || y < -40 || y > height + 40;
    const anchor = rotate === null ? 'translate(-50%, -100%)' : `translate(-50%, -50%) rotate(${rotate.toFixed(3)}rad)`;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) ${anchor}`;
    el.style.visibility = off ? 'hidden' : '';
    return { x, y };
  }

  const clock = new THREE.Clock();
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const dt = Math.min(0.1, clock.getDelta());
    const t = clock.elapsedTime;

    pointer.sx += (pointer.x - pointer.sx) * 0.04;
    pointer.sy += (pointer.y - pointer.sy) * 0.04;

    // Ease the camera toward the framing for the current mode.
    const { d, nextD } = distanceAt(progress);
    const want = desiredFrame(d, nextD);
    if (!cam.ready) Object.assign(cam, want, { ready: true });
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 2.4);
    // Following the shuttle needs a tighter hold on position than the framed views.
    const kp = mode === 'shuttle' && Math.abs(Math.log(cam.dist / want.dist)) < 0.3 ? 1 - Math.exp(-dt * 8) : k;
    cam.x += (want.x - cam.x) * kp;
    cam.z += (want.z - cam.z) * kp;
    cam.dist = Math.exp(Math.log(cam.dist) + (Math.log(want.dist) - Math.log(cam.dist)) * k);

    // Shuttle position along the real path
    pointAt(d, shuttlePos);
    shuttleRoot.position.copy(shuttlePos);
    shuttle.rotation.y = Math.atan2(tangent.x, tangent.y);

    const dist = cam.dist * view.zoom;
    target.set(cam.x, 0, cam.z);
    const az = view.azimuth + (view.drift && !reducedMotion ? Math.sin(t * 0.05) * 0.05 : 0) + pointer.sx * 0.05;
    const polar = THREE.MathUtils.clamp(view.polar + pointer.sy * 0.03, 0.02, 1.2);
    placeCamera(dist, polar, az, target);
    camera.near = Math.max(0.2, dist * 0.02);
    camera.far = dist * 8;
    camera.updateProjectionMatrix();

    // World units per CSS pixel at the target; drives the zoom-aware sizes.
    const wpp = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height;
    shared.uWpp.value = wpp;
    shared.uFogNear.value = scene.fog.near = dist * 1.1;
    shared.uFogFar.value = scene.fog.far = dist * 3.2;

    // Screen-size floors: the shuttle is at least ~30 px long, stops at least ~8 px wide.
    const s = Math.max(1, (30 * wpp) / SHUTTLE_LEN) * Math.max(0.0001, view.shuttle);
    shuttleRoot.scale.setScalar(s);
    if (!reducedMotion) {
      const p = (t % 2.2) / 2.2;
      pulse.scale.setScalar(1 + p * 2.4);
      pulseMat.opacity = 0.55 * (1 - p);
    } else {
      pulse.visible = false;
    }
    const stopScale = Math.max(1, (8 * wpp) / STOP_R);
    stopMeshes.forEach((g, i) => {
      const reveal = THREE.MathUtils.clamp(view.stops * 3 - i, 0, 1);
      g.scale.setScalar(Math.max(0.001, reveal * stopScale));
    });

    const count = Math.floor((routeIndexCount * view.draw) / 6) * 6;
    routeGeo.setDrawRange(0, count);
    routeGlowGeo.setDrawRange(0, count);
    city.scale.y = Math.max(0.001, view.rise);

    renderer.render(scene, camera);

    labelEls.forEach((el, i) => {
      el.style.opacity = THREE.MathUtils.clamp(view.stops * 3 - i, 0, 1);
      project(stopVecs[i], el, null);
    });
    // Street names fade in once the view is close enough to read them (under ~4 m per pixel).
    const streetAlpha = THREE.MathUtils.clamp((0.42 - wpp) / 0.18, 0, 1) * view.stops;
    for (const st of streetLabels) {
      if (streetAlpha <= 0) { st.el.style.visibility = 'hidden'; continue; }
      tmp.copy(st.p).add(st.d).project(camera);
      const bx = (tmp.x * 0.5 + 0.5) * width, by = (-tmp.y * 0.5 + 0.5) * height;
      tmp.copy(st.p).project(camera);
      const ax = (tmp.x * 0.5 + 0.5) * width, ay = (-tmp.y * 0.5 + 0.5) * height;
      let ang = Math.atan2(by - ay, bx - ax);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      project(st.p, st.el, ang);
      st.el.style.opacity = streetAlpha;
    }
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
  io.observe(container);

  if (matchMedia('(hover: hover)').matches) {
    window.addEventListener('pointermove', (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  frame();

  return {
    view,
    setShuttle(p) { progress = p; },
    setNextStop(i) { labelEls.forEach((el, k) => el.classList.toggle('is-next', k === i)); },
    setMode(m) { mode = m; },
    setInsets(top, bottom, left = 0) { Object.assign(insets, { top, bottom, left }); resize(); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); },
  };
}
