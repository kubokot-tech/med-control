/**
 * Built-in reference ranges for adults (docs/REFERENCE-RANGES.md), in the catalog unit of each marker (catalogSeed.js).
 * [low, high]; null is an open side («до 41» is [null, 41]). `m`/`f` are by sex, `any` is used when the sex is not given
 * or has no range of its own. A marker without an entry here, or a result in another unit, keeps its laboratory's range.
 *
 * These are common adult ranges, orientation only: laboratories differ by method, and the user can set their own range
 * for any marker (lab_ref_overrides). Markers whose range depends mostly on the method or analyzer (G6PD, D-dimer, APTT,
 * PT, MPV, PDW, UIBC, VLDL) and therapeutic drug levels (tacrolimus) are deliberately left to the laboratory.
 */
export const REFERENCE_RANGES = {
  // liver, kidney
  ALT: { any: [null, 40], m: [null, 41], f: [null, 33] },
  AST: { any: [null, 40], m: [null, 40], f: [null, 32] },
  BIL: { any: [3.4, 20.5] },
  'BIL-D': { any: [null, 5.1] },
  GGT: { any: [null, 40], m: [null, 55], f: [null, 38] },
  LDH: { any: [135, 225], m: [135, 225], f: [135, 214] },
  CREA: { m: [62, 106], f: [44, 80] },
  UREA: { any: [2.8, 7.2] },
  // glucose
  HbA1c: { any: [4.0, 6.0] },
  GLU: { any: [3.9, 6.1] },
  // red cells
  MCH: { any: [27, 34] },
  MCHC: { any: [320, 360] },
  MCV: { any: [80, 100] },
  RDW: { any: [11.5, 14.5] },
  HGB: { m: [130, 170], f: [120, 150] },
  HCT: { m: [40, 50], f: [35, 45] },
  RBC: { m: [4.3, 5.7], f: [3.8, 5.1] },
  ESR: { m: [null, 15], f: [null, 20] },
  // white cells
  WBC: { any: [4.0, 9.0] },
  'NEUT#': { any: [1.8, 7.7] },
  'NEUT%': { any: [47, 72] },
  'LYM#': { any: [1.0, 4.8] },
  'LYM%': { any: [19, 37] },
  'MONO#': { any: [0.1, 0.8] },
  'MONO%': { any: [3, 11] },
  'EO#': { any: [0.02, 0.5] },
  'EO%': { any: [0.5, 5] },
  'BASO#': { any: [null, 0.1] },
  'BASO%': { any: [null, 1] },
  // platelets
  PCT: { any: [0.15, 0.4] },
  PLT: { any: [150, 400] },
  // inflammation, iron
  CRP: { any: [null, 5] },
  FERR: { m: [30, 400], f: [13, 150] },
  FE: { m: [11.6, 31.3], f: [9.0, 30.4] },
  TIBC: { any: [45, 77] },
  TRF: { any: [2.0, 3.6] },
  // coagulation
  FIB: { any: [2.0, 4.0] },
  PTQ: { any: [70, 120] },
  AT3: { any: [80, 120] },
  // electrolytes, protein
  K: { any: [3.5, 5.1] },
  NA: { any: [136, 145] },
  CL: { any: [98, 107] },
  MG: { any: [0.66, 1.07] },
  CA: { any: [2.15, 2.55] },
  ZN: { any: [11, 18] },
  PROT: { any: [64, 83] },
  // lipids
  CHOL: { any: [null, 5.2] },
  HDL: { m: [1.0, null], f: [1.2, null] },
  LDL: { any: [null, 3.0] },
  NONHDL: { any: [null, 3.8] },
  TG: { any: [null, 1.7] },
  // thyroid
  TSH: { any: [0.4, 4.0] },
  FT4: { any: [9.0, 22.0] },
  // urine
  'U-PRO': { any: [null, 0.14] },
  'U-GLU': { any: [null, 0.8] },
  'U-SG': { any: [1.005, 1.03] },
  'U-PH': { any: [5.0, 8.0] },
};

const pair = (r) => (r ? { low: r[0], high: r[1] } : null);

/** { any, m, f } of a marker as { low, high } or null each; null when there is no built-in range. */
export function referenceRange(key) {
  const r = REFERENCE_RANGES[key];
  return r ? { any: pair(r.any), m: pair(r.m), f: pair(r.f) } : null;
}

/** The built-in range for this sex ('m' | 'f' | null): by sex first, then any sex; null when there is none. */
export function builtInRange(key, sex) {
  const r = referenceRange(key);
  if (!r) return null;
  return (sex === 'm' && r.m) || (sex === 'f' && r.f) || r.any || null;
}
