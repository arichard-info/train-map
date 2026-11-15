import type { Line, LineType, Network } from '../data/types';

export interface StationProps {
  id: string;
  name: string;
  rank: number;
  /** a night line stops here (drives marker colour) */
  night: boolean;
  /** first or last stop of at least one line */
  terminus: boolean;
  lines: number;
}

export interface CallProps {
  id: string;
  name: string;
  rank: number;
  stop: boolean;
  terminus: boolean;
  type: LineType;
}

type FC<P> = GeoJSON.FeatureCollection<GeoJSON.Point, P>;
const point = (lon: number, lat: number): GeoJSON.Point => ({ type: 'Point', coordinates: [lon, lat] });

/** Overview markers: every station where at least one line stops (pass-through-only stations are hidden). */
export function stationFeatures(network: Network): FC<StationProps> {
  const acc = new Map<string, StationProps>();
  for (const line of network.lines) {
    line.calls.forEach((call, i) => {
      if (!call.stop) return;
      const s = network.stations[call.station];
      const terminus = i === 0 || i === line.calls.length - 1;
      const prev = acc.get(call.station);
      acc.set(call.station, {
        id: call.station,
        name: s.name,
        rank: s.rank,
        night: (prev?.night ?? false) || line.type === 'night',
        terminus: (prev?.terminus ?? false) || terminus,
        lines: (prev?.lines ?? 0) + 1,
      });
    });
  }
  return {
    type: 'FeatureCollection',
    features: [...acc.values()].map((p) => {
      const s = network.stations[p.id];
      return { type: 'Feature', properties: p, geometry: point(s.lon, s.lat) };
    }),
  };
}

/** Every call of one line: stops and pass-throughs, used when that line is selected. */
export function callFeatures(network: Network, line: Line | undefined): FC<CallProps> {
  if (!line) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: line.calls.map((call, i) => {
      const s = network.stations[call.station];
      return {
        type: 'Feature',
        properties: {
          id: call.station,
          name: s.name,
          rank: s.rank,
          stop: call.stop,
          terminus: i === 0 || i === line.calls.length - 1,
          type: line.type,
        },
        geometry: point(s.lon, s.lat),
      };
    }),
  };
}

/** Lines that call at a station, split by stop / pass-through. */
export function linesAtStation(network: Network, stationId: string) {
  const stopping: Line[] = [];
  const passing: Line[] = [];
  for (const line of network.lines) {
    const call = line.calls.find((c) => c.station === stationId);
    if (!call) continue;
    (call.stop ? stopping : passing).push(line);
  }
  return { stopping, passing };
}
