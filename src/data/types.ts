export type LineType = 'night' | 'day';

export interface Station {
  name: string;
  /** City the station belongs to (e.g. "Wien" for "Wien Meidling") */
  city: string;
  country: string;
  lon: number;
  lat: number;
  /** 1 = main station of a key city, 2 = busy station, 3 = small stop. Drives marker size and label visibility. */
  rank: 1 | 2 | 3;
}

export interface Operator {
  name: string;
  url: string;
}

export interface Call {
  station: string;
  /** false = the train passes through without stopping */
  stop: boolean;
  /** local time "HH:MM" (canonical direction only) */
  arr?: string;
  dep?: string;
}

export interface Line {
  id: string;
  name: string;
  type: LineType;
  operator: string;
  /** both directions, e.g. ["NJ 468", "NJ 469"] */
  trainNumbers: string[];
  /** running days, human readable, e.g. "Daily" or "2026/05/30-09/26: Mon, Thu, Sat" */
  days: string;
  /** only runs part of the year */
  seasonal: boolean;
  /** e.g. ["seat", "couchette", "sleeper"] */
  classes: string[];
  source: 'back-on-track' | 'manual';
  calls: Call[];
  /** invisible routing waypoints [lon, lat], inserted after the call at that index */
  hints?: Record<string, [number, number][]>;
}

export interface DataSource {
  name: string;
  url: string;
  license: string;
}

export interface Network {
  generatedAt: string;
  sources: DataSource[];
  stations: Record<string, Station>;
  operators: Record<string, Operator>;
  lines: Line[];
}

export interface LineGeometryProps {
  id: string;
  type: LineType;
  km: number;
}

export type LineGeometry = GeoJSON.FeatureCollection<GeoJSON.LineString, LineGeometryProps>;
