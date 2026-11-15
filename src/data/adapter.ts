import type { LineGeometry, Network } from './types';

/**
 * The only door between the engine and the data.
 * v0: static JSON files. Later: a Transitous/MOTIS adapter, GTFS, operator APIs…
 */
export interface TrainData {
  network(): Promise<Network>;
  geometry(): Promise<LineGeometry>;
}

export class StaticTrainData implements TrainData {
  constructor(private base = `${import.meta.env.BASE_URL}data/`) {}

  async network(): Promise<Network> {
    return this.fetchJson<Network>('network.json');
  }

  async geometry(): Promise<LineGeometry> {
    return this.fetchJson<LineGeometry>('geometry.geojson');
  }

  private async fetchJson<T>(file: string): Promise<T> {
    const res = await fetch(this.base + file);
    if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
    return res.json() as Promise<T>;
  }
}
