import { GddConfig } from '../../../src/types/advanced';
import { CropParams } from './cropDatabase';

export const GDD_ENGINE_VERSION = 'gdd-crop-v1.0.0';

export interface DailyTempPrecipPoint {
  date: string;
  tMinC: number | null;
  tMaxC: number | null;
  precipMm: number | null;
  solarMjM2: number | null;
}

export interface GddComputationResult {
  gddAccumulated: number | null;
  config: GddConfig | null;
  validDayCount: number;
  heatStressDays: number | null;
  frostDays: number | null;
  maxConsecutiveDryDays: number | null;
  currentDrySpellDays: number | null;
  periodPrecipTotalMm: number | null;
  periodMeanTempC: number | null;
  solarRadiationMeanMjM2: number | null;
  note: string;
}

/**
 * Single-sine GDD approximation (Baskerville & Emin 1969) with upper threshold cap.
 */
export function computeSingleSineDailyGdd(
  tMin: number,
  tMax: number,
  tBase: number,
  tUpper?: number
): number {
  const cap = tUpper ?? 45;
  const lo = Math.min(tMin, tMax);
  const hi = Math.max(tMin, tMax);
  const cLo = Math.min(lo, cap);
  const cHi = Math.min(hi, cap);

  if (cHi <= tBase) return 0;
  if (cLo >= tBase) {
    return Math.max(0, (cLo + cHi) / 2 - tBase);
  }
  const tMean = (cLo + cHi) / 2;
  const amp = (cHi - cLo) / 2;
  if (amp < 1e-6) return Math.max(0, tMean - tBase);
  const theta = Math.asin(Math.max(-1, Math.min(1, (tBase - tMean) / amp)));
  const gdd =
    (1 / Math.PI) * ((tMean - tBase) * (Math.PI / 2 - theta) + amp * Math.cos(theta));
  return Math.max(0, gdd);
}

/**
 * Capped mean daily GDD method: max(0, (min(Tmax, Tupper) + max(Tmin, Tbase))/2 - Tbase)
 */
export function computeCappedMeanDailyGdd(
  tMin: number,
  tMax: number,
  tBase: number,
  tUpper?: number
): number {
  const lo = Math.max(tBase, tMin);
  const hi = Math.min(tUpper ?? 45, Math.max(tBase, tMax));
  return Math.max(0, (lo + hi) / 2 - tBase);
}

export function computeCropWeatherExposure(opts: {
  days: DailyTempPrecipPoint[];
  crop: CropParams | null;
  method?: 'single_sine' | 'capped_mean';
  dryDayThresholdMm?: number;
}): GddComputationResult {
  const { days, crop, method = 'single_sine', dryDayThresholdMm = 1.0 } = opts;

  if (!days || days.length === 0) {
    return {
      gddAccumulated: null,
      config: null,
      validDayCount: 0,
      heatStressDays: null,
      frostDays: null,
      maxConsecutiveDryDays: null,
      currentDrySpellDays: null,
      periodPrecipTotalMm: null,
      periodMeanTempC: null,
      solarRadiationMeanMjM2: null,
      note: 'No valid daily meteorological series available.',
    };
  }

  let tempSum = 0;
  let tempN = 0;
  let precipSum = 0;
  let precipN = 0;
  let radSum = 0;
  let radN = 0;

  let maxDry = 0;
  let runDry = 0;

  let gddSum = 0;
  let gddN = 0;
  let heatDays = 0;
  let frostDays = 0;

  for (const d of days) {
    if (d.tMinC !== null && d.tMaxC !== null && Number.isFinite(d.tMinC) && Number.isFinite(d.tMaxC)) {
      tempSum += (d.tMinC + d.tMaxC) / 2;
      tempN++;

      if (crop) {
        gddSum +=
          method === 'single_sine'
            ? computeSingleSineDailyGdd(d.tMinC, d.tMaxC, crop.tBaseC, crop.tUpperC)
            : computeCappedMeanDailyGdd(d.tMinC, d.tMaxC, crop.tBaseC, crop.tUpperC);
        gddN++;
        if (d.tMaxC >= crop.heatThresholdC) heatDays++;
        if (d.tMinC <= crop.frostThresholdC) frostDays++;
      }
    }

    if (d.precipMm !== null && Number.isFinite(d.precipMm)) {
      precipSum += Math.max(0, d.precipMm);
      precipN++;
      if (d.precipMm < dryDayThresholdMm) {
        runDry++;
        if (runDry > maxDry) maxDry = runDry;
      } else {
        runDry = 0;
      }
    }

    if (d.solarMjM2 !== null && Number.isFinite(d.solarMjM2)) {
      radSum += d.solarMjM2;
      radN++;
    }
  }

  const config: GddConfig | null = crop
    ? {
        baseTempC: crop.tBaseC,
        upperTempC: crop.tUpperC,
        method,
        sourceId: crop.sourceRef,
        version: GDD_ENGINE_VERSION,
      }
    : null;

  return {
    gddAccumulated: crop && gddN > 0 ? Number(gddSum.toFixed(1)) : null,
    config,
    validDayCount: tempN,
    heatStressDays: crop && tempN > 0 ? heatDays : null,
    frostDays: crop && tempN > 0 ? frostDays : null,
    maxConsecutiveDryDays: precipN > 0 ? maxDry : null,
    currentDrySpellDays: precipN > 0 ? runDry : null,
    periodPrecipTotalMm: precipN > 0 ? Number(precipSum.toFixed(1)) : null,
    periodMeanTempC: tempN > 0 ? Number((tempSum / tempN).toFixed(1)) : null,
    solarRadiationMeanMjM2: radN > 0 ? Number((radSum / radN).toFixed(2)) : null,
    note: crop
      ? `Computed over ${gddN} valid daily observations using ${method} (Tbase=${crop.tBaseC}°C, Tupper=${crop.tUpperC}°C).`
      : `Temperature & rainfall statistics computed over ${tempN} valid daily observations; crop-specific GDD & stress counts skipped without confirmed crop profile.`,
  };
}
