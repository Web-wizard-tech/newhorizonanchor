import { SoilTexture } from '../../../src/types/farm';

export const SOIL_ENGINE_VERSION = 'usda-soil-v1.0.0';
export const SOC_TO_SOM_FACTOR = 1.724; // Van Bemmelen conventional factor (note: natural soils vary ~1.72-2.0)

export interface TextureClassificationResult {
  valid: boolean;
  textureClass: string;
  sandPct: number | null;
  siltPct: number | null;
  clayPct: number | null;
  normalized: boolean;
  sumOriginal: number | null;
  reason: string;
}

/**
 * Classifies sand/silt/clay fractions using the standard USDA Soil Texture Triangle boundaries.
 * Rejects missing, negative, out-of-range, or badly non-summing fractions (|sum - 100| > 3%).
 */
export function classifyUsdaTexture(
  sandRaw: number | null | undefined,
  siltRaw: number | null | undefined,
  clayRaw: number | null | undefined
): TextureClassificationResult {
  if (
    sandRaw === null ||
    sandRaw === undefined ||
    siltRaw === null ||
    siltRaw === undefined ||
    clayRaw === null ||
    clayRaw === undefined ||
    !Number.isFinite(sandRaw) ||
    !Number.isFinite(siltRaw) ||
    !Number.isFinite(clayRaw)
  ) {
    return {
      valid: false,
      textureClass: 'Unknown',
      sandPct: null,
      siltPct: null,
      clayPct: null,
      normalized: false,
      sumOriginal: null,
      reason: 'Sand, silt, and clay percentages are incomplete.',
    };
  }

  if (sandRaw < 0 || siltRaw < 0 || clayRaw < 0 || sandRaw > 100 || siltRaw > 100 || clayRaw > 100) {
    return {
      valid: false,
      textureClass: 'Unknown',
      sandPct: null,
      siltPct: null,
      clayPct: null,
      normalized: false,
      sumOriginal: Number((sandRaw + siltRaw + clayRaw).toFixed(1)),
      reason: 'Soil particle fractions outside 0-100% bounds.',
    };
  }

  const sum = sandRaw + siltRaw + clayRaw;
  if (sum < 97 || sum > 103) {
    return {
      valid: false,
      textureClass: 'Unknown',
      sandPct: sandRaw,
      siltPct: siltRaw,
      clayPct: clayRaw,
      normalized: false,
      sumOriginal: Number(sum.toFixed(1)),
      reason: `Particle sum (${sum.toFixed(1)}%) falls outside 97-103% compatibility threshold for USDA triangle classification.`,
    };
  }

  const factor = 100 / sum;
  const sand = Number((sandRaw * factor).toFixed(1));
  const silt = Number((siltRaw * factor).toFixed(1));
  const clay = Number((clayRaw * factor).toFixed(1));
  const normalized = Math.abs(sum - 100) > 0.05;

  // Standard USDA NRCS Soil Texture Triangle logic
  let cls = 'Loam';
  if (clay >= 40 && sand <= 45 && silt < 40) {
    cls = 'Clay';
  } else if (clay >= 40 && silt >= 40) {
    cls = 'Silty clay';
  } else if (clay >= 35 && sand >= 45) {
    cls = 'Sandy clay';
  } else if (clay >= 27 && clay < 40 && sand >= 20 && sand < 45) {
    cls = 'Clay loam';
  } else if (clay >= 27 && clay < 40 && sand < 20) {
    cls = 'Silty clay loam';
  } else if (clay >= 20 && clay < 35 && silt < 28 && sand >= 45) {
    cls = 'Sandy clay loam';
  } else if (silt >= 50 && ((clay >= 12 && clay < 27) || (silt < 80 && clay < 12))) {
    cls = 'Silt loam';
  } else if (silt >= 80 && clay < 12) {
    cls = 'Silt loam'; // Note: UI SoilTexture union uses 'Silt loam' for silt-dominated soils; note Silt boundary below
  } else if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand < 52) {
    cls = 'Loam';
  } else if (
    (clay >= 7 && clay < 20 && sand > 52 && clay * 2 + silt >= 30) ||
    (clay < 7 && silt < 50 && sand >= 43 && sand <= 52) ||
    (sand > 52 && sand + 0.5 * clay <= 85 && sand >= 52)
  ) {
    cls = 'Sandy loam';
  } else if (sand >= 70 && sand <= 90 && clay + 1.5 * silt < 30 && sand - clay >= 70) {
    cls = 'Loamy sand';
  } else if (sand > 85 && clay + 1.5 * silt < 15) {
    cls = 'Sand';
  } else if (sand > 70 && clay < 15) {
    cls = 'Loamy sand';
  } else if (sand >= 52) {
    cls = 'Sandy loam';
  }

  return {
    valid: true,
    textureClass: cls,
    sandPct: sand,
    siltPct: silt,
    clayPct: clay,
    normalized,
    sumOriginal: Number(sum.toFixed(1)),
    reason: `USDA Soil Texture Triangle (${SOIL_ENGINE_VERSION})`,
  };
}

/**
 * Estimates conservative soil water holding thresholds ONLY when a valid USDA texture class exists AND
 * explicitly tags them as Saxton-Rawls (2006) texture-derived approximations vs lab/SSURGO measurements.
 */
export function estimateSoilHydraulicsFromTexture(
  texture: SoilTexture | string | null | undefined,
  organicMatterPct?: number | null
): {
  thetaFc: number;
  thetaWp: number;
  awcMmPerM: number;
  methodNote: string;
} | null {
  if (!texture || texture === 'Unknown' || texture === 'Other') return null;
  const omBoost =
    typeof organicMatterPct === 'number' && Number.isFinite(organicMatterPct)
      ? Math.max(-0.02, Math.min(0.03, (organicMatterPct - 2.5) * 0.008))
      : 0;
  const table: Record<string, { fc: number; wp: number }> = {
    Sand: { fc: 0.10, wp: 0.04 },
    Sandy: { fc: 0.10, wp: 0.04 },
    'Loamy sand': { fc: 0.15, wp: 0.06 },
    'Sandy loam': { fc: 0.21, wp: 0.09 },
    Loam: { fc: 0.27, wp: 0.12 },
    'Silt loam': { fc: 0.32, wp: 0.14 },
    'Sandy clay loam': { fc: 0.27, wp: 0.15 },
    'Clay loam': { fc: 0.34, wp: 0.19 },
    'Silty clay loam': { fc: 0.36, wp: 0.20 },
    'Sandy clay': { fc: 0.34, wp: 0.21 },
    'Silty clay': { fc: 0.38, wp: 0.24 },
    Clay: { fc: 0.40, wp: 0.26 },
  };
  const entry = table[texture];
  if (!entry) return null;
  const fc = Number(Math.min(0.45, entry.fc + omBoost).toFixed(3));
  const wp = Number(entry.wp.toFixed(3));
  return {
    thetaFc: fc,
    thetaWp: wp,
    awcMmPerM: Math.round((fc - wp) * 1000),
    methodNote: `Texture-class hydraulic estimate (FAO-56 Table 19 / Saxton-Rawls baseline for ${texture}${omBoost !== 0 ? ', OM-adjusted' : ''})`,
  };
}
