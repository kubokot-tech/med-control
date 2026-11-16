// Types for units.js (plain JavaScript so that the gateway runs it without a build step).
export const LAB_UNIT_SYSTEMS: string[];
export const TEMPERATURE_UNITS: string[];
export const WEIGHT_UNITS: string[];
export const CONVENTIONAL: Record<string, { unit: string; factor: number; digits: number }>;
export function displayUnit(unit: string | null | undefined, language?: string): string | null;
export interface LabUnits {
  system: string;
  language: string;
  unit(key: string, storedUnit?: string | null): string | null;
  toDisplay(key: string, value: number | string | null | undefined, storedUnit?: string | null): { value: number | null; unit: string | null };
  fromDisplay(key: string, value: number | string | null | undefined): number | null;
  delta(key: string, d: number | null, storedUnit?: string | null): number | null;
}
export function labUnits(system: string, catalogUnit: (key: string) => string | null | undefined, language?: string): LabUnits;
export interface BodyUnits {
  temperatureUnit: string; weightUnit: string;
  temperature(c: number | null): number | null; temperatureIn(v: number | null): number | null;
  weight(kg: number | null): number | null; weightIn(v: number | null): number | null;
}
export function bodyUnits(opts?: { temperature?: string; weight?: string; language?: string }): BodyUnits;
