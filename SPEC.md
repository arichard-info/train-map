# Night Train Planner — Spec v0.1

_Draft — 2026-11-15. Working document, meant to be iterated._

## 1. Vision

A beautiful map of European night trains (plus the main long-distance lines that connect them). You open it to **explore** ("where can I wake up tomorrow if I leave Paris tonight?"), and without noticing you end up **planning** a trip: a loop of legs over several days, with times, connections and the way back home.

Audience for now: me and friends. Not a public product yet.

## 2. Core principles

1. **Engine and data are separate.**
   - **Engine** (map, styling, line rendering, cities, interactions): built to last. Fancy, smooth, scalable to thousands of lines.
   - **Data** (stations, lines, schedules, cabins, prices): quick and simple to start with. It sits behind an adapter interface, so the source can change later (static JSON → Transitous/MOTIS → official APIs) without touching the engine.
2. **Routes drawn on the real tracks**, never as straight lines between cities.
3. **Explore first, plan naturally.** No search form as the entry point. The map is the interface.
4. **Web first, small screens supported** from day one (responsive layout, touch gestures, bottom sheets).

## 3. Scope v0

### In
- **Night trains** in Western and Central Europe (seeded from the Back-on-Track database).
- **A small set of long-distance "connector" lines** that make night-train loops possible. Initial candidates:
  - Paris – Barcelona
  - Paris – Milan
  - Paris – Brussels – Amsterdam
  - Paris – Frankfurt / Stuttgart – Munich
  - Munich – Vienna – Budapest
  - Zurich – Milan
  - Vienna – Prague – Berlin
  - Berlin – Hamburg – Copenhagen
  - _List to refine based on the loops we actually want to do._
- Main stations only: departure/arrival points and major intermediate stops.

### Out (for now)
- Regional trains, urban transport, door-to-door routing.
- Real-time data and delays.
- Booking and live prices. Instead: deep links plus curated info (cabin types, typical price range, Interrail reservation needed or not).

## 4. User experience

### 4.1 The loop
```
Explore map ──► Click a city ──► See where you can go (tonight / today)
     ▲                                   │
     │                                   ▼
Trip timeline ◄── Add leg ◄── Pick a train (times, cabins)
     │
     └──► "How do I get back?" → map highlights paths back to the start
```

### 4.2 Main views
| View | Content |
|---|---|
| **Map** (always visible) | Lines on real tracks. Night trains vs day trains visually distinct (e.g. night = glowing or deep-blue palette, day = lighter). City markers sized by importance. Hover/tap highlights a line. |
| **City panel** | Departures from this city, grouped "tonight's night trains" / "day trains". Destinations reachable directly. |
| **Line panel** | Operator, stops with times, days it runs, accommodations (seat / couchette / sleeper), Interrail info, booking link. |
| **Trip timeline** | Ordered legs, day by day, with overnight legs shown as nights. Warnings: tight connection, train doesn't run that day, reservation needed. |

### 4.3 Date awareness
- A date picker (or the trip's current day) filters the map: lines not running that day fade out.
- In the trip, each leg's date follows from the previous one.

### 4.4 Mobile
- Map full-screen, panels as bottom sheets (peek / half / full).
- The trip timeline is a collapsible sheet.
- Touch targets for lines and cities are at least 44px.

## 5. Engine (the "fancy" part)

### 5.1 Stack (proposal)
- **TypeScript + Vite**, with **React** for the UI (or Svelte, to decide).
- **MapLibre GL JS** for map rendering (WebGL, vector tiles, custom styles).
- **Basemap**: a custom muted/dark style on OpenFreeMap or Protomaps (PMTiles, self-hostable as a static file). No API key needed.
- Optional later: **deck.gl** for animated trains or big data layers.
- Hosting: static site (GitHub Pages, Netlify, Cloudflare Pages).

### 5.2 Rendering
- Lines are stored as precomputed geometries (GeoJSON in v0, vector tiles once there are many).
- **Shared track sections**: several lines on the same track are drawn side by side (offset), not on top of each other, like a metro map on real geography. To be designed; this is the hardest visual problem.
- Simplified geometry at low zoom, full detail at high zoom.
- Day/night theme for the map itself, matching the train type being explored.
- Smooth transitions: fade lines by date, animate the selected route, fly-to on selection.

### 5.3 Geometry pipeline (offline, run once per data update)
```
Stations + stop sequences (our JSON)
        │
        ▼
Route on the OSM rail network  ──  OpenRailRouting (GraphHopper)  or  pfaedle (GTFS map-matching)
        │
        ▼
Simplify / clean  ──►  lines.geojson  (later: vector tiles via tippecanoe)
```
- Input: OSM rail extract for Europe (Geofabrik).
- Output is committed to the repo or published as a static asset. The browser never routes.
- Manual override possible for a line when the automatic route is wrong.

## 6. Data

### 6.1 Model (first draft)
```ts
Station      { id, name, country, lat, lon, importance }
Operator     { id, name, website, bookingUrl }
Line         { id, name, trainNumbers[], operatorId, type: 'night' | 'day',
               stops: StopTime[], geometryId,
               calendar: { from, to, weekdays[], exceptions[] },
               accommodations: Accommodation[],
               interrail: { covered, reservationRequired, reservationFee? },
               notes?, sourceUrl }
StopTime     { stationId, arr?, dep?, dayOffset }   // dayOffset handles overnight
Accommodation{ kind: 'seat' | 'couchette' | 'sleeper' | 'private',
               berths?, priceFrom?, currency? }
Trip         { id, name, legs: Leg[] }               // stored in localStorage / URL
Leg          { lineId, date, fromStationId, toStationId }
```

### 6.2 Sources — "easy way" for v0
| Need | v0 source | Later |
|---|---|---|
| Night train lines, stops, operators | Back-on-Track GitHub database (check licence) + manual edits | Same, kept in sync |
| Connector lines | Hand-written JSON | National GTFS feeds / Transitous |
| Schedules & running days | Hand-entered from operator sites (patterns, not dated runs) | Transitous / MOTIS API, then GTFS feeds |
| Cabins, typical prices | Curated by hand (Seat61, operator sites) | Operator APIs / OSDM where available |
| Interrail info | Curated by hand | Same (open data is poor) |
| Track geometry | OSM via OpenRailRouting / pfaedle | Same, automated |

All data lives in the repo as JSON files, validated by a schema at build time.

### 6.3 Data adapter
The engine only talks to an interface such as:
```ts
interface TrainData {
  stations(): Station[]
  lines(filter?: { date?: string; type?: 'night' | 'day' }): Line[]
  departures(stationId: string, date: string): Departure[]
}
```
v0 implementation = static JSON. A future `TransitousAdapter` implements the same interface.

## 7. Milestones
| # | Goal | Done when |
|---|---|---|
| **M0** ✅ | Geometry proof | 3 night lines + 1 day line drawn on real tracks in a MapLibre page that looks good. Done 2026-11-15: Paris–Briançon, Paris–Latour-de-Carol, Brussels–Prague (European Sleeper), Paris–Barcelona (day). |
| **M1** | The map | All v0 night lines + connectors, styled, clickable, responsive. |
| **M2** | Time | Schedules and running days; date filter; city panel "tonight from here". |
| **M3** | The trip | Trip timeline, add/remove legs, connection checks, "way back home", shareable URL. |
| **M4** | Comfort | Cabins, typical prices, Interrail info, booking deep links. |

## 8. Decisions log
- **Themes**: light and dark, plus "auto" (follows the OS). Colours per line *type* (night = indigo/lavender with a glow, day = amber).
- **Shared track**: lines are drawn merged, not side by side. Ways to tell them apart:
  - stop vs pass-through: each call has `stop: true/false`. Stops get a ring marker. Pass-throughs get a small hollow dot and an italic label, shown only when the line is selected.
  - two lines on the same track: selecting a line dims all the others and redraws it on top with a casing.
  - discontinuous line: _not yet handled_. Idea: dashed segments, or separate features with terminus markers.
- **Map**: MapLibre GL 5, globe projection when zoomed out, hillshade always on. 3D relief mode tried in M0 and dropped (2026-11-15): the flat map with hillshade reads better.
- **Basemap**: custom style on OpenFreeMap vector tiles (no API key). Terrain from AWS Terrain Tiles (Terrarium encoding).
- **Data pipeline (POC, 2026-11-15)**: `npm run data` = `network` + `geometry`.
  - `npm run network` (scripts/build-network.mjs): imports the **Back-on-Track Open Night Train Database** (GitHub `Back-on-Track-eu/night-train-data`, ODbL, updated daily). It keeps every active train serving ≥ 2 key cities (list in `data/manual/night-overrides.json`), merges both directions into one line, and merges stations closer than 600 m. Trains with absurd jumps (misplaced stations) are skipped. Day lines come from `data/manual/day-lines.json` (hand-written, with our own coordinates: Back-on-Track coordinates are wrong for some stations that no night train uses).
  - `npm run geometry` (scripts/build-geometry.mjs): routes each hop on the public BRouter server (`rail` profile, OSM data). Results are cached in `scripts/.cache`. When a station point snaps onto an isolated piece of track (the server then times out), the script nudges the point by 100–200 m and retries. Invisible routing `hints` keep trains on the right line when the database only lists a few stops (e.g. French Intercités de nuit). The output is simplified (~10 m tolerance).
  - Result: 32 night lines + 13 day lines, 208 stations. Only Brașov → București is still drawn as a straight line.
- **Seasonal lines** are drawn dashed.
- **UI framework**: vanilla TypeScript for M0. Revisit (React/Svelte) when the trip timeline arrives in M3.
- Note: the ÖBB Nightjets Paris–Vienna and Paris–Berlin were withdrawn (Dec 2025), so they were not used as M0 examples.

## 9. Open questions
- Discontinuous lines / branches (a train that splits, e.g. Paris → Toulouse with portions): how to model and draw them?
- Geometry at scale: the public BRouter server rate-limits. With 100+ lines, should we self-host BRouter or OpenRailRouting, or use pfaedle on GTFS?
- Size: geometry.geojson is ~1.3 MB for 45 lines (~300 KB gzipped) even after simplification. Switch to vector tiles (or per-zoom simplification) when the network grows.
- Times are stored for one direction only (the canonical trip). M2 needs both directions.
- Day lines have no times yet.
- How do we handle a line whose schedule changes by season or by day? (Store several calendar variants?)
- Trip storage: URL only, localStorage, or a small backend later for sharing with friends?
- Back-on-Track data licence: can we reuse it as is?
- Should the "way back home" feature be a real router (graph search over our lines) from M3?
