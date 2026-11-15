// Builds real-track geometry for every line in public/data/network.json.
// Each hop between consecutive waypoints (stops + invisible routing hints) is routed on the
// OSM rail network via BRouter (profile "rail"), then stitched into one LineString per line,
// simplified, and written to public/data/geometry.geojson.
//
// Usage: node scripts/build-geometry.mjs [--refresh]
//   --refresh  ignore the local cache and re-query BRouter

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NETWORK = path.join(root, 'public/data/network.json');
const OUT = path.join(root, 'public/data/geometry.geojson');
const CACHE = path.join(root, 'scripts/.cache');
const BROUTER = 'https://brouter.de/brouter';
const SIMPLIFY_DEG = 0.00012; // ~10 m: invisible on screen, divides the file size a lot
const refresh = process.argv.includes('--refresh');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n * 1e5) / 1e5;

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Ramer–Douglas–Peucker (iterative), on lon/lat degrees — fine at this tolerance.
function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

let requests = 0;
async function routeHop(a, b) {
  const lonlats = `${a[0]},${a[1]}|${b[0]},${b[1]}`;
  const key = createHash('sha1').update(lonlats).digest('hex').slice(0, 16);
  const file = path.join(CACHE, `${key}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));

  // 1. the exact points
  let result = await query(a, b);
  // 2. a station point can snap onto an isolated piece of track (siding, platform, narrow gauge):
  //    the router then searches until the server kills it. Nudge each end by ~100–200 m and retry.
  for (const [end, d] of result ? [] : JITTER) {
    const a2 = end === 'a' ? [a[0] + d[0], a[1] + d[1]] : a;
    const b2 = end === 'b' ? [b[0] + d[0], b[1] + d[1]] : b;
    result = await query(a2, b2, 2);
    if (result) { console.log(`    routed after nudging ${end === 'a' ? 'start' : 'end'} by ${JSON.stringify(d)}`); break; }
  }
  if (result) await writeFile(file, JSON.stringify(result)); // cached under the ORIGINAL points
  return result;
}

const JITTER = [
  ['b', [-0.0012, 0]], ['b', [0.0012, 0]], ['b', [0, 0.0009]], ['b', [0, -0.0009]],
  ['a', [-0.0012, 0]], ['a', [0.0012, 0]], ['a', [0, 0.0009]], ['a', [0, -0.0009]],
];

/** One BRouter query. Retries rate limits; gives up quickly on "watchdog" (usually a bad snap). */
async function query(a, b, maxWatchdog = 2) {
  const url = `${BROUTER}?lonlats=${a[0]},${a[1]}|${b[0]},${b[1]}&profile=rail&alternativeidx=0&format=geojson`;
  let watchdogs = 0;
  for (let attempt = 1; attempt <= 6; attempt++) {
    requests++;
    let res;
    try { res = await fetch(url, { signal: AbortSignal.timeout(90_000) }); }
    catch (e) { console.warn(`    network error (attempt ${attempt}): ${e.message}`); await sleep(5000 * attempt); continue; }
    if (res.ok) {
      const f = (await res.json()).features[0];
      await sleep(1500); // be gentle with the public server
      return {
        coords: f.geometry.coordinates.map(([x, y]) => [round(x), round(y)]),
        km: Number(f.properties['track-length']) / 1000,
      };
    }
    const body = (await res.text()).slice(0, 140).replace(/\s+/g, ' ');
    if (body.includes('watchdog')) {
      if (++watchdogs >= maxWatchdog) return null;
      await sleep(3000);
      continue;
    }
    if (res.status === 403 || res.status === 429 || res.status >= 500) { // rate limited: back off
      console.warn(`    BRouter ${res.status} (attempt ${attempt}): ${body}`);
      await sleep(10_000 * attempt);
      continue;
    }
    console.warn(`    BRouter ${res.status}: ${body}`);
    return null; // unroutable (e.g. point too far from any track)
  }
  return null;
}

const network = JSON.parse(await readFile(NETWORK, 'utf8'));
await mkdir(CACHE, { recursive: true });

const features = [];
const problems = [];
for (const line of network.lines) {
  // waypoints = stations, with routing hints inserted after the call they follow
  const wps = [];
  line.calls.forEach((call, i) => {
    const s = network.stations[call.station];
    wps.push({ c: [s.lon, s.lat], label: s.name });
    for (const h of line.hints?.[i] ?? []) wps.push({ c: h, label: '(hint)' });
  });

  console.log(`\n${line.name} [${line.trainNumbers.join(' / ')}]`);
  const coords = [];
  let totalKm = 0, approx = false;
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1];
    const crow = haversineKm(a.c, b.c);
    const seg = await routeHop(a.c, b.c);
    let pts;
    if (seg) {
      const ratio = seg.km / Math.max(crow, 0.1);
      const flag = ratio > 1.8 && seg.km > 20 ? '  <-- detour, check' : '';
      if (flag) problems.push(`${line.name}: ${a.label} → ${b.label} ×${ratio.toFixed(2)}`);
      console.log(`  ${a.label} → ${b.label}: ${seg.km.toFixed(0)} km (×${ratio.toFixed(2)})${flag}`);
      totalKm += seg.km;
      pts = seg.coords;
    } else {
      problems.push(`${line.name}: ${a.label} → ${b.label} not routable, straight line used`);
      console.log(`  ${a.label} → ${b.label}: NOT ROUTABLE, straight line`);
      totalKm += crow;
      approx = true;
      pts = [a.c, b.c];
    }
    coords.push(...(coords.length ? pts.slice(1) : pts));
  }
  const simplified = simplify(coords, SIMPLIFY_DEG);
  features.push({
    type: 'Feature',
    properties: { id: line.id, type: line.type, km: Math.round(totalKm), ...(approx && { approx: true }) },
    geometry: { type: 'LineString', coordinates: simplified },
  });
}

await writeFile(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
const pts = features.reduce((n, f) => n + f.geometry.coordinates.length, 0);
console.log(`\nWrote ${path.relative(root, OUT)}: ${features.length} lines, ${pts} points, ${requests} BRouter requests`);
if (problems.length) console.log(`\n${problems.length} to check:\n  ${problems.join('\n  ')}`);
