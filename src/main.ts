import maplibregl, { type LngLatBoundsLike, type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

import { StaticTrainData } from './data/adapter';
import type { LineGeometry, Network } from './data/types';
import { callFeatures, linesAtStation, stationFeatures } from './map/features';
import { buildStyle, HIT_LAYERS } from './map/style';
import { themes, type ThemeName } from './map/theme';
import { Panel } from './ui/panel';

type ThemePref = 'auto' | ThemeName;
type Selection = { kind: 'line' | 'station'; id: string } | null;

const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
  },
};

const data = new StaticTrainData();
const [network, geometry]: [Network, LineGeometry] = await Promise.all([data.network(), data.geometry()]);
const linesUrl = `${import.meta.env.BASE_URL}data/geometry.geojson`;
const stations = stationFeatures(network);
const kmByLine = new Map(geometry.features.map((f) => [f.properties.id, f.properties.km]));
const seasonalLineIds = network.lines.filter((l) => l.seasonal).map((l) => l.id);

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const state = {
  themePref: (store.get('themePref') as ThemePref | null) ?? 'auto',
  selection: null as Selection,
};

const resolvedTheme = (): ThemeName =>
  state.themePref === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : state.themePref;

function currentStyle() {
  const sel = state.selection;
  const line = sel?.kind === 'line' ? network.lines.find((l) => l.id === sel.id) : undefined;
  let focus: string[] | null = null;
  if (sel?.kind === 'line') focus = [sel.id];
  if (sel?.kind === 'station') {
    const { stopping, passing } = linesAtStation(network, sel.id);
    focus = [...stopping, ...passing].map((l) => l.id);
  }
  return buildStyle({
    theme: themes[resolvedTheme()],
    linesUrl,
    stations,
    calls: callFeatures(network, line),
    focusLineIds: focus,
    selectedLineId: line?.id ?? null,
    seasonalLineIds,
  });
}

const isMobile = () => window.matchMedia('(max-width: 720px)').matches;

const map = new maplibregl.Map({
  container: 'map',
  style: currentStyle(),
  center: [11.5, 48.6],
  zoom: isMobile() ? 3.6 : 4.6,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

// ---------- render loop: one source of truth (state) → style diff ----------
function render() {
  document.documentElement.dataset.theme = resolvedTheme();
  map.setStyle(currentStyle(), { diff: true });
  syncControls();
}

// ---------- panel ----------
const panel = new Panel(document.getElementById('panel')!, network, {
  onSelectLine: (id) => select({ kind: 'line', id }),
  onSelectStation: (id) => select({ kind: 'station', id }),
  onClose: () => select(null),
});

function panelPadding(): maplibregl.PaddingOptions {
  return isMobile()
    ? { top: 60, bottom: window.innerHeight * 0.5, left: 30, right: 30 }
    : { top: 80, bottom: 80, left: 420, right: 80 };
}

function select(sel: Selection, fly = true) {
  state.selection = sel;
  if (!sel) panel.hide();
  else if (sel.kind === 'line') {
    const line = network.lines.find((l) => l.id === sel.id);
    if (!line) return select(null);
    panel.showLine(line, kmByLine.get(line.id));
    const geom = geometry.features.find((f) => f.properties.id === sel.id);
    if (fly && geom) {
      const b = new maplibregl.LngLatBounds();
      geom.geometry.coordinates.forEach((c) => b.extend(c as [number, number]));
      map.fitBounds(b as LngLatBoundsLike, { padding: panelPadding(), duration: 1200 });
    }
  } else {
    const s = network.stations[sel.id];
    if (!s) return select(null);
    panel.showStation(sel.id);
    if (fly) map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 6), padding: panelPadding(), duration: 900 });
  }
  history.replaceState(null, '', sel ? `#${sel.kind}=${sel.id}` : location.pathname + location.search);
  render();
}

// ---------- pointer interactions ----------
let hoveredLine: string | null = null;
function setHover(id: string | null) {
  if (hoveredLine === id) return;
  if (hoveredLine) map.setFeatureState({ source: 'lines', id: hoveredLine }, { hover: false });
  hoveredLine = id;
  if (id) map.setFeatureState({ source: 'lines', id }, { hover: true });
}

function pick(point: maplibregl.Point): { station?: MapGeoJSONFeature; line?: MapGeoJSONFeature } {
  const r = isMobile() ? 12 : 6;
  const box: [maplibregl.PointLike, maplibregl.PointLike] = [[point.x - r, point.y - r], [point.x + r, point.y + r]];
  const stationLayers = HIT_LAYERS.stations.filter((id) => map.getLayer(id));
  const station = map.queryRenderedFeatures(box, { layers: stationLayers })[0];
  const line = map.queryRenderedFeatures(point, { layers: [HIT_LAYERS.lines] })[0];
  return { station, line };
}

map.on('mousemove', (e) => {
  const { station, line } = pick(e.point);
  setHover(line ? String(line.properties.id) : null);
  map.getCanvas().style.cursor = station || line ? 'pointer' : '';
});
map.on('mouseout', () => setHover(null));

map.on('click', (e) => {
  const { station, line } = pick(e.point);
  if (station) select({ kind: 'station', id: String(station.properties.id) });
  else if (line) select({ kind: 'line', id: String(line.properties.id) });
  else if (state.selection) select(null, false);
});

// ---------- controls ----------
const themeBtn = document.getElementById('btn-theme') as HTMLButtonElement;
const themeCycle: ThemePref[] = ['auto', 'light', 'dark'];
const themeLabel: Record<ThemePref, string> = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };

function syncControls() {
  themeBtn.textContent = themeLabel[state.themePref];
  themeBtn.title = `Theme: ${state.themePref} (click to change)`;
}

themeBtn.addEventListener('click', () => {
  state.themePref = themeCycle[(themeCycle.indexOf(state.themePref) + 1) % themeCycle.length];
  store.set('themePref', state.themePref);
  render();
});

darkQuery.addEventListener('change', () => state.themePref === 'auto' && render());

document.addEventListener('keydown', (e) => e.key === 'Escape' && select(null, false));

// ---------- initial state (from URL hash) ----------
map.once('load', () => {
  const m = location.hash.match(/^#(line|station)=(.+)$/);
  if (m) select({ kind: m[1] as 'line' | 'station', id: decodeURIComponent(m[2]) });
});
document.documentElement.dataset.theme = resolvedTheme();
syncControls();
