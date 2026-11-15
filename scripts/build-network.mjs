// Builds public/data/network.json from:
//   1. the Back-on-Track Open Night Train Database (ODbL) — night trains, with real stops and times
//   2. data/manual/day-lines.json — day trains written by hand
//   3. data/manual/night-overrides.json — key cities, extra trains, routing hints
//
// Usage: node scripts/build-network.mjs [--refresh]   (--refresh re-downloads the Back-on-Track data)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'data/sources/bot');
const OUT = path.join(root, 'public/data/network.json');
const BOT_RAW = 'https://raw.githubusercontent.com/Back-on-Track-eu/night-train-data/main/data/latest';
const BOT_FILES = ['agencies', 'stops', 'trips', 'trip_stop'];
const refresh = process.argv.includes('--refresh');

const MERGE_RADIUS_KM = 0.6; // stations closer than this are the same station
const MAX_HOP_KM = 900;      // a hop longer than this means a misplaced station → skip the train

// ---------- helpers ----------
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const slug = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hhmm = (iso) => (iso && iso.length >= 16 ? iso.slice(11, 16) : undefined);
function km([lon1, lat1], [lon2, lat2]) {
  const R = 6371, r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const isSkippedStop = (id) => /Autoreisezug|Autoverlade/i.test(String(id));

// ---------- 1. load sources ----------
await mkdir(SRC, { recursive: true });
for (const f of BOT_FILES) {
  const file = path.join(SRC, `${f}.json`);
  if (refresh || !existsSync(file)) {
    console.log(`Downloading Back-on-Track ${f}.json…`);
    const res = await fetch(`${BOT_RAW}/${f}.json`);
    if (!res.ok) throw new Error(`Download failed: ${f} (${res.status})`);
    await writeFile(file, await res.text());
  }
}
const [agencies, botStops, trips, tripStops] = await Promise.all(BOT_FILES.map((f) => readJson(path.join(SRC, `${f}.json`))));
const manual = await readJson(path.join(root, 'data/manual/day-lines.json'));
const overrides = await readJson(path.join(root, 'data/manual/night-overrides.json'));

const stopsByTrip = {};
for (const s of Object.values(tripStops)) {
  s.stop_id = String(s.stop_id); // a few ids are numeric in the source
  (stopsByTrip[s.trip_id] ??= []).push(s);
}
for (const list of Object.values(stopsByTrip)) list.sort((a, b) => a.stop_sequence - b.stop_sequence);

const cityOf = (stopId) => {
  const s = botStops[stopId];
  return String(s?.stop_cityname_romanized || s?.stop_cityname || String(stopId).split(/[ ,(]/)[0]).trim();
};
const keyCityOf = (stopId) => {
  const c = cityOf(stopId);
  return overrides.keyCities.find((k) => c === k || c.startsWith(`${k} `) || c.startsWith(`${k}/`) || stopId.startsWith(`${k} `)) ?? null;
};

// ---------- 2. select night trains ----------
const candidates = [];
for (const t of Object.values(trips)) {
  if (t.is_active !== 'Y') continue;
  const stops = (stopsByTrip[t.trip_id] ?? []).filter((s) => !isSkippedStop(s.stop_id));
  if (stops.length < 2) continue;
  const keys = new Set(stops.map((s) => keyCityOf(s.stop_id)).filter(Boolean));
  if (keys.size < 2 && !overrides.include.includes(t.trip_short_name)) continue;

  // sanity check: every stop must have coordinates and no absurd jumps
  const coords = stops.map((s) => botStops[s.stop_id] && [botStops[s.stop_id].stop_lon, botStops[s.stop_id].stop_lat]);
  if (coords.some((c) => !c || c.some((v) => typeof v !== 'number'))) {
    console.warn(`  skip ${t.trip_short_name}: station without coordinates`);
    continue;
  }
  const badHop = coords.findIndex((c, i) => i > 0 && km(coords[i - 1], c) > MAX_HOP_KM);
  if (badHop > 0) {
    console.warn(`  skip ${t.trip_short_name}: ${stops[badHop - 1].stop_id} → ${stops[badHop].stop_id} is ${km(coords[badHop - 1], coords[badHop]).toFixed(0)} km (misplaced station?)`);
    continue;
  }
  candidates.push({ trip: t, stops });
}

// pair both directions of the same train into one line (same endpoints, any order)
const groups = new Map();
for (const c of candidates) {
  const ends = [cityOf(c.stops[0].stop_id), cityOf(c.stops.at(-1).stop_id)].sort().join('|');
  const key = `${c.trip.route_id}|${ends}`;
  (groups.get(key) ?? groups.set(key, []).get(key)).push(c);
}

// ---------- 3. stations (imported + manual), merged by proximity ----------
const stations = {}; // id -> { name, country, lon, lat, city }
const alias = {};    // any source name -> station id
function addStation(name, lon, lat, country, city) {
  if (alias[name]) return alias[name];
  for (const [id, s] of Object.entries(stations)) {
    if (km([lon, lat], [s.lon, s.lat]) < MERGE_RADIUS_KM) return (alias[name] = id);
  }
  let id = slug(name);
  while (stations[id]) id += '-2';
  stations[id] = { name, country, lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5, city };
  return (alias[name] = id);
}

const operators = {};
function operatorFor(agencyId) {
  if (!operators[agencyId]) {
    const parts = agencyId.split('/').map((p) => agencies[p.trim()]).filter(Boolean);
    operators[agencyId] = {
      name: parts.length ? parts.map((a) => a.agency_name_brand || a.agency_id).join(' / ') : agencyId,
      url: parts[0]?.agency_url || '',
    };
  }
  return agencyId;
}

const lines = [];
for (const group of groups.values()) {
  // canonical direction: the one with the most stops
  group.sort((a, b) => b.stops.length - a.stops.length);
  const { trip, stops } = group[0];
  const numbers = [...new Set(group.map((g) => g.trip.trip_short_name))];
  const hintsFor = overrides.hints[trip.trip_short_name] ?? {};

  const calls = [];
  const hints = {};
  for (const s of stops) {
    const b = botStops[s.stop_id];
    const id = addStation(s.stop_id, b.stop_lon, b.stop_lat, b.stop_country, cityOf(s.stop_id));
    const arr = hhmm(s.arrival_time), dep = hhmm(s.departure_time);
    const prev = calls.at(-1);
    if (prev && prev.station === id) { // same station twice in a row (merged platforms) → one call
      if (dep) prev.dep = dep;
      continue;
    }
    calls.push({ station: id, stop: true, ...(arr && { arr }), ...(dep && { dep }) });
    if (hintsFor[s.stop_id]) hints[calls.length - 1] = hintsFor[s.stop_id];
  }
  if (calls.length < 2) continue;

  const days = String(trip.service_id || '').replace(/^\d{4}:\s*/, '') || 'see operator';
  lines.push({
    id: slug(numbers.join(' ')),
    name: `${stations[calls[0].station].city} – ${stations[calls.at(-1).station].city}`,
    type: 'night',
    operator: operatorFor(trip.agency_id),
    trainNumbers: numbers,
    days,
    seasonal: /\d{4}\/\d{2}\/\d{2}|\d{2}\/\d{2}-|May-Oct/.test(trip.service_id || ''),
    classes: String(trip.classes || '').split(',').map((c) => c.trim()).filter(Boolean),
    source: 'back-on-track',
    calls,
    ...(Object.keys(hints).length && { hints }),
  });
}

// day lines
Object.assign(operators, manual.operators);
for (const l of manual.lines) {
  const calls = l.stops.map((name) => {
    const c = manual.stations[name];
    if (!c) throw new Error(`Day line ${l.id}: station "${name}" missing in day-lines.json stations`);
    return { station: addStation(name, c[0], c[1], '', name.split(/[ (]/)[0]), stop: true };
  });
  lines.push({
    id: l.id, name: l.name, type: 'day', operator: l.operator, trainNumbers: l.trainNumbers,
    days: 'Several per day', seasonal: false, classes: ['seat'], source: 'manual', calls,
    ...(l.hints && { hints: l.hints }),
  });
}

// ---------- 4. station ranks (marker size, label priority) ----------
const usage = {};
for (const l of lines) for (const c of l.calls) usage[c.station] = (usage[c.station] ?? 0) + 1;
const bestOfCity = {};
for (const [id, s] of Object.entries(stations)) {
  const k = overrides.keyCities.find((kc) => s.city === kc || s.city.startsWith(`${kc} `) || s.name.startsWith(`${kc} `) || s.name === kc);
  s.keyCity = k ?? null;
  if (k && (!bestOfCity[k] || usage[id] > usage[bestOfCity[k]])) bestOfCity[k] = id;
}
for (const [id, s] of Object.entries(stations)) {
  s.rank = bestOfCity[s.keyCity] === id ? 1 : usage[id] >= 3 ? 2 : 3;
  if (!s.country) s.country = botStops[s.name]?.stop_country ?? '';
  delete s.keyCity;
}

// ---------- 5. write ----------
lines.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'night' ? -1 : 1));
await writeFile(OUT, JSON.stringify({
  _note: 'GENERATED by scripts/build-network.mjs — do not edit by hand. Edit data/manual/*.json instead.',
  generatedAt: new Date().toISOString(),
  sources: [
    { name: 'Back-on-Track Open Night Train Database', url: 'https://github.com/Back-on-Track-eu/night-train-data', license: 'ODbL 1.0' },
    { name: 'Manual day lines (data/manual/day-lines.json)', url: '', license: '' },
  ],
  operators, stations, lines,
}, null, 1));

console.log(`\n${lines.filter((l) => l.type === 'night').length} night lines, ${lines.filter((l) => l.type === 'day').length} day lines, ${Object.keys(stations).length} stations`);
for (const l of lines) console.log(`  ${l.type === 'night' ? '☾' : '☀'} ${l.trainNumbers.join(' / ').padEnd(28)} ${l.name.padEnd(32)} ${l.calls.length} stops · ${l.days}`);
