export type ThemeName = 'light' | 'dark';

/** Every colour the map uses. The UI (CSS) has its own matching tokens in styles.css. */
export interface MapTheme {
  name: ThemeName;
  land: string;
  water: string;
  waterLine: string;
  wood: string;
  grass: string;
  ice: string;
  urban: string;
  boundary: string;
  railNetwork: string;
  label: string;
  labelMuted: string;
  labelHalo: string;
  hillShadow: string;
  hillHighlight: string;
  hillAccent: string;
  hillStrength: number;
  sky: string;
  horizon: string;
  /** Train lines */
  night: string;
  day: string;
  glowOpacity: number;
  stationFill: string;
}

export const themes: Record<ThemeName, MapTheme> = {
  light: {
    name: 'light',
    land: '#f2eee5',
    water: '#bed3df',
    waterLine: '#a7c1d1',
    wood: '#e2e5d2',
    grass: '#e9eadb',
    ice: '#fbfcfd',
    urban: '#e8e1d3',
    boundary: '#9c9485',
    railNetwork: '#cfc6b6',
    label: '#3f3a31',
    labelMuted: '#8a8274',
    labelHalo: '#f2eee5',
    hillShadow: '#5a5243',
    hillHighlight: '#ffffff',
    hillAccent: '#7d7462',
    hillStrength: 0.32,
    sky: '#cfe0ec',
    horizon: '#f2eee5',
    night: '#3f3cbb',
    day: '#d97706',
    glowOpacity: 0.14,
    stationFill: '#ffffff',
  },
  dark: {
    name: 'dark',
    land: '#151b26',
    water: '#0a0f17',
    waterLine: '#0f1622',
    wood: '#18202b',
    grass: '#171e29',
    ice: '#28303d',
    urban: '#1b2230',
    boundary: '#4a5366',
    railNetwork: '#283141',
    label: '#c9d1e0',
    labelMuted: '#7c869a',
    labelHalo: '#0f141d',
    hillShadow: '#030508',
    hillHighlight: '#3a465b',
    hillAccent: '#0a0e15',
    hillStrength: 0.45,
    sky: '#05070d',
    horizon: '#1c2536',
    night: '#a3a9ff',
    day: '#f4b450',
    glowOpacity: 0.3,
    stationFill: '#151b26',
  },
};
