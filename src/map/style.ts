import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import type { MapTheme } from './theme';
import type { CallProps, StationProps } from './features';

const OPENFREEMAP = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const FONT_ITALIC = ['Noto Sans Italic'];

export interface StyleState {
  theme: MapTheme;
  /** URL of the line geometry GeoJSON (kept as a URL so style diffs stay cheap) */
  linesUrl: string;
  stations: GeoJSON.FeatureCollection<GeoJSON.Point, StationProps>;
  /** Calls of the selected line (empty when nothing is selected) */
  calls: GeoJSON.FeatureCollection<GeoJSON.Point, CallProps>;
  /** Lines to keep at full strength; null = no focus, everything is normal */
  focusLineIds: string[] | null;
  /** The single line drawn on top with a casing (selected line) */
  selectedLineId: string | null;
  /** Lines that only run part of the year: drawn dashed */
  seasonalLineIds: string[];
}

/** Ids of layers that respond to pointer events. */
export const HIT_LAYERS = {
  lines: 'train-lines-hit',
  stations: ['calls-stop', 'calls-pass', 'stations-dot'],
};

/**
 * Line width that grows with zoom. MapLibre requires the zoom interpolation to be the
 * outermost expression, so an optional condition (e.g. hover) is applied at each stop.
 */
const zoomWidth = (base: number, when?: { cond: ExpressionSpecification; base: number }): ExpressionSpecification => {
  const at = (k: number): ExpressionSpecification | number =>
    when ? ['case', when.cond, when.base * k, base * k] : base * k;
  return ['interpolate', ['exponential', 1.5], ['zoom'], 3, at(0.7), 6, at(1.1), 10, at(2.2)];
};

export function buildStyle(s: StyleState): StyleSpecification {
  const t = s.theme;
  const lineColor: ExpressionSpecification = ['match', ['get', 'type'], 'night', t.night, t.day];
  const focus = s.focusLineIds;
  const inFocus: ExpressionSpecification | boolean = focus ? ['in', ['get', 'id'], ['literal', focus]] : true;
  const focusOpacity = (on: number, off: number): ExpressionSpecification | number =>
    focus ? ['case', inFocus, on, off] : on;
  const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
  const hasSelection = s.selectedLineId !== null;
  const isSeasonal: ExpressionSpecification = ['in', ['get', 'id'], ['literal', s.seasonalLineIds]];

  const basemap: LayerSpecification[] = [
    { id: 'land', type: 'background', paint: { 'background-color': t.land } },
    {
      id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'],
      paint: { 'fill-color': t.wood, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 8, 0.8] },
    },
    {
      id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'wetland']]],
      paint: { 'fill-color': t.grass, 'fill-opacity': 0.5 },
    },
    {
      id: 'landcover-ice', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'ice'],
      paint: { 'fill-color': t.ice, 'fill-opacity': 0.85 },
    },
    {
      id: 'urban', type: 'fill', source: 'omt', 'source-layer': 'landuse', minzoom: 5,
      filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]],
      paint: { 'fill-color': t.urban, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 8, 0.7] },
    },
    {
      id: 'hillshade', type: 'hillshade', source: 'dem-hs',
      paint: {
        'hillshade-shadow-color': t.hillShadow,
        'hillshade-highlight-color': t.hillHighlight,
        'hillshade-accent-color': t.hillAccent,
        'hillshade-exaggeration': t.hillStrength,
        'hillshade-illumination-direction': 315,
      },
    },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': t.water } },
    {
      id: 'rivers', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 5,
      filter: ['==', ['get', 'class'], 'river'],
      paint: { 'line-color': t.waterLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 10, 1.6] },
    },
    {
      id: 'borders', type: 'line', source: 'omt', 'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': t.boundary,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 1.4],
        'line-dasharray': [3, 2],
        'line-opacity': 0.7,
      },
    },
    {
      // The whole rail network, very faint: gives context ("there are tracks here") without noise.
      id: 'rail-network', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 5,
      filter: ['all', ['==', ['get', 'class'], 'rail'], ['!', ['has', 'service']]],
      paint: {
        'line-color': t.railNetwork,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.4],
      },
    },
    {
      id: 'place-country', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 7,
      filter: ['==', ['get', 'class'], 'country'],
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 6, 13],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.18,
        'text-max-width': 8,
      },
      paint: { 'text-color': t.labelMuted, 'text-halo-color': t.labelHalo, 'text-halo-width': 1.2, 'text-opacity': 0.75 },
    },
    {
      id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 5,
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 13],
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': t.labelMuted, 'text-halo-color': t.labelHalo, 'text-halo-width': 1.2, 'text-opacity': 0.8 },
    },
  ];

  const trains: LayerSpecification[] = [
    {
      // Soft glow under night lines — the "night" signature of the map.
      id: 'train-glow', type: 'line', source: 'lines',
      filter: ['==', ['get', 'type'], 'night'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': t.night,
        'line-width': zoomWidth(10),
        'line-blur': zoomWidth(8),
        'line-opacity': focusOpacity(t.glowOpacity, t.glowOpacity * 0.25),
      },
    },
    {
      id: 'train-lines', type: 'line', source: 'lines',
      filter: ['!', isSeasonal],
      layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['match', ['get', 'type'], 'night', 2, 1] },
      paint: {
        'line-color': lineColor,
        'line-width': zoomWidth(2.8, { cond: hovered, base: 4.2 }),
        'line-opacity': focusOpacity(1, 0.22),
      },
    },
    {
      // Seasonal lines (e.g. summer trains to Split): dashed, so they read as "not all year".
      id: 'train-lines-seasonal', type: 'line', source: 'lines',
      filter: isSeasonal,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': lineColor,
        'line-width': zoomWidth(2.8, { cond: hovered, base: 4.2 }),
        'line-opacity': focusOpacity(1, 0.22),
        'line-dasharray': [2, 1.4],
      },
    },
    {
      // Selected line: casing + full-strength stroke on top of everything else,
      // so it reads clearly even where it shares track with other lines.
      id: 'train-selected-casing', type: 'line', source: 'lines',
      filter: ['==', ['get', 'id'], s.selectedLineId ?? ''],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': t.labelHalo, 'line-width': zoomWidth(7) },
    },
    {
      id: 'train-selected', type: 'line', source: 'lines',
      filter: ['==', ['get', 'id'], s.selectedLineId ?? ''],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': lineColor, 'line-width': zoomWidth(4) },
    },
    {
      // Invisible, wide: makes lines easy to hover/tap, especially on touch screens.
      id: HIT_LAYERS.lines, type: 'line', source: 'lines',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 },
    },
  ];

  const rankRadius = (r1: number, r2: number, r3: number): ExpressionSpecification => [
    'interpolate', ['linear'], ['zoom'],
    3, ['match', ['get', 'rank'], 1, r1 * 0.75, 2, r2 * 0.7, r3 * 0.6],
    8, ['match', ['get', 'rank'], 1, r1 * 1.3, 2, r2 * 1.3, r3 * 1.3],
  ];

  const stationLabelLayout = {
    'text-font': FONT,
    'text-size': ['match', ['get', 'rank'], 1, 13, 2, 12, 11] as ExpressionSpecification,
    'text-variable-anchor': ['left', 'right', 'top', 'bottom'] as ('left' | 'right' | 'top' | 'bottom')[],
    'text-radial-offset': 0.7,
    'text-justify': 'auto' as const,
    'symbol-sort-key': ['get', 'rank'] as ExpressionSpecification,
  };

  const stations: LayerSpecification[] = [
    {
      // Overview: stations where at least one train stops.
      id: 'stations-dot', type: 'circle', source: 'stations',
      layout: { visibility: hasSelection ? 'none' : 'visible' },
      paint: {
        'circle-radius': rankRadius(5, 4, 3),
        'circle-color': t.stationFill,
        'circle-stroke-color': ['case', ['get', 'night'], t.night, t.day],
        'circle-stroke-width': ['case', ['get', 'terminus'], 2.2, 1.6],
        'circle-opacity': focus ? 0.6 : 1,
        'circle-stroke-opacity': focus ? 0.6 : 1,
      },
    },
    {
      id: 'stations-label-major', type: 'symbol', source: 'stations',
      filter: ['any', ['<=', ['get', 'rank'], 2], ['get', 'terminus']],
      layout: { ...stationLabelLayout, 'text-field': ['get', 'name'], visibility: hasSelection ? 'none' : 'visible' },
      paint: { 'text-color': t.label, 'text-halo-color': t.labelHalo, 'text-halo-width': 1.6 },
    },
    {
      id: 'stations-label-minor', type: 'symbol', source: 'stations', minzoom: 6.5,
      filter: ['all', ['>', ['get', 'rank'], 2], ['!', ['get', 'terminus']]],
      layout: { ...stationLabelLayout, 'text-field': ['get', 'name'], visibility: hasSelection ? 'none' : 'visible' },
      paint: { 'text-color': t.label, 'text-halo-color': t.labelHalo, 'text-halo-width': 1.6 },
    },
    // Selected line: every call, with a clear difference between stops and pass-throughs.
    {
      id: 'calls-pass', type: 'circle', source: 'calls',
      filter: ['!', ['get', 'stop']],
      paint: {
        'circle-radius': 2.6,
        'circle-color': t.labelHalo,
        'circle-stroke-color': t.labelMuted,
        'circle-stroke-width': 1.2,
      },
    },
    {
      id: 'calls-stop', type: 'circle', source: 'calls',
      filter: ['get', 'stop'],
      paint: {
        'circle-radius': ['case', ['get', 'terminus'], 6.5, 4.6],
        'circle-color': t.stationFill,
        'circle-stroke-color': lineColor,
        'circle-stroke-width': ['case', ['get', 'terminus'], 3, 2.2],
      },
    },
    {
      id: 'calls-label', type: 'symbol', source: 'calls',
      layout: {
        ...stationLabelLayout,
        'text-field': ['get', 'name'],
        'text-font': ['case', ['get', 'stop'], ['literal', FONT_BOLD], ['literal', FONT_ITALIC]],
        'text-size': ['case', ['get', 'stop'], 12.5, 11],
        'symbol-sort-key': ['case', ['get', 'terminus'], 0, ['get', 'stop'], 1, 2],
      },
      paint: {
        'text-color': ['case', ['get', 'stop'], t.label, t.labelMuted],
        'text-halo-color': t.labelHalo,
        'text-halo-width': 1.8,
      },
    },
  ];

  return {
    version: 8,
    glyphs: GLYPHS,
    projection: { type: 'globe' },
    sky: {
      'sky-color': t.sky,
      'horizon-color': t.horizon,
      'fog-color': t.land,
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.85,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 2, 0.9, 5, 0.4, 7, 0],
    },
    sources: {
      omt: {
        type: 'vector',
        url: OPENFREEMAP,
        attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
      'dem-hs': {
        type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 13,
        attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen / AWS Open Data</a>',
      },      lines: {
        type: 'geojson', data: s.linesUrl, promoteId: 'id', tolerance: 0.6,
        attribution: 'Night trains: <a href="https://github.com/Back-on-Track-eu/night-train-data">Back-on-Track</a> (ODbL) · Routes: <a href="https://brouter.de">BRouter</a> on OSM',
      },
      stations: { type: 'geojson', data: s.stations },
      calls: { type: 'geojson', data: s.calls },
    },
    layers: [...basemap, ...trains, ...stations],
  };
}
