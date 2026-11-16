// Types for medCodes.js (plain JavaScript so that the gateway runs it without a build step).
export const MODALITY_CT: string;
export const MODALITY_PET_CT: string;
export const MODALITIES: string[];
export function modalityCode(value: string | null | undefined): 'ct' | 'mri' | 'petCt' | 'us' | 'xray' | 'nm' | null;
export const ROUTE_IV_DRIP: string;
export const ROUTE_OTHER: string;
export const DEFAULT_DOSE_UNIT: string;
export const ROUTES: string[];
export function routeCode(value: string | null | undefined): 'ivDrip' | 'ivPush' | 'im' | 'sc' | 'other' | null;
export function isShotRoute(route: string | null | undefined): boolean;
