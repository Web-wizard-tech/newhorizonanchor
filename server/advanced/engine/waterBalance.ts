import { WaterBalanceDayRow } from '../../../src/types/advanced';
import { CropParams } from './cropDatabase';

export const WATER_BALANCE_ENGINE_VERSION = 'fao56-wb-v1.0.0';

/**
 * USDA Soil Conservation Service (SCS) effective rainfall method adapted for daily rainfall.
 * Distinguishes raw precipitation P from estimated effective rainfall Peff (never P === Peff).
 */
export function computeEffectiveRainfallMm(precipMm: number | null): number | null {
  if (precipMm === null || !Number.isFinite(precipMm) || precipMm < 0) return null;
  if (precipMm < 1.5) return 0; // light canopy/surface interception evaporates without root recharge
  // Daily adapted USDA SCS curve: higher storm intensity reduces infiltration efficiency
  if (precipMm <= 25) {
    return Number((precipMm * 0.85).toFixed(2));
  }
  return Number((21.25 + (precipMm - 25) * 0.65).toFixed(2));
}

export interface DailyWaterInputRow {
  date: string;
  dataKind: 'historical' | 'forecast';
  et0Mm: number | null;
  et0Method: 'FAO-56 Penman-Monteith' | 'Hargreaves-Samani Approx' | 'Unavailable';
  kc: number | null;
  precipitationMm: number | null;
  confirmedIrrigationMm: number; // strictly from farmer-confirmed irrigation events converted using field area
  surfaceMoistureVwcPct?: number | null;
}

export interface WaterBalanceOutput {
  tawMm: number | null;
  rawMm: number | null;
  tawUnavailableReason: string | null;
  effectiveRainMethod: string;
  netBalanceMm: number | null;
  et0MeanMmDay: number | null;
  etcTotalMm: number | null;
  observedPrecipTotalMm: number | null;
  effectiveRainTotalMm: number | null;
  forecastRainTotalMm: number | null;
  confirmedIrrigationTotalMm: number;
  latestDepletionMm: number | null;
  dailyRows: WaterBalanceDayRow[];
}

/**
 * Runs deterministic FAO-56 Root-Zone Water Balance:
 *   Dr(i) = clamp(0, Dr(i-1) - Peff(i) - I(i) + ETc(i), TAW)
 * Deep percolation DP(i) occurs when Peff + I exceeds previous depletion Dr(i-1) + ETc(i).
 * Strict gate: TAW, RAW, and Dr(i) are computed ONLY when valid thetaFC, thetaWP, and Zr exist.
 */
export function computeDailyWaterBalance(opts: {
  days: DailyWaterInputRow[];
  crop: CropParams | null;
  thetaFc: number | null;
  thetaWp: number | null;
  rootDepthM: number | null;
  initialVwcPct?: number | null;
}): WaterBalanceOutput {
  const { days, crop, thetaFc, thetaWp, rootDepthM, initialVwcPct } = opts;

  const hasHydraulics =
    thetaFc !== null &&
    thetaWp !== null &&
    rootDepthM !== null &&
    Number.isFinite(thetaFc) &&
    Number.isFinite(thetaWp) &&
    Number.isFinite(rootDepthM) &&
    thetaFc > thetaWp &&
    rootDepthM > 0;

  let tawMm: number | null = null;
  let rawMm: number | null = null;
  let tawUnavailableReason: string | null = null;

  if (!hasHydraulics) {
    const missing = [
      thetaFc === null || thetaWp === null ? 'field capacity / wilting point (θFC, θWP)' : null,
      rootDepthM === null ? 'crop rooting depth (Zr)' : null,
    ]
      .filter(Boolean)
      .join(' and ');
    tawUnavailableReason = `TAW/RAW and root-zone depletion require ${missing}. Missing hydraulic or crop parameters prevent reliable depletion modelling.`;
  } else {
    tawMm = Number((1000 * (thetaFc! - thetaWp!) * rootDepthM!).toFixed(1));
    const pFrac = crop?.pBase ?? 0.5;
    rawMm = Number((pFrac * tawMm).toFixed(1));
  }

  // Initial root zone depletion Dr(0)
  let drPrev: number | null = null;
  if (hasHydraulics && tawMm !== null) {
    if (
      initialVwcPct !== null &&
      initialVwcPct !== undefined &&
      Number.isFinite(initialVwcPct)
    ) {
      const vwc = initialVwcPct / 100;
      drPrev = Math.max(0, Math.min(tawMm, 1000 * (thetaFc! - vwc) * rootDepthM!));
    } else {
      drPrev = tawMm * 0.35; // conservative non-saturated initial depletion when probe absent
    }
  }

  let et0Sum = 0;
  let et0Count = 0;
  let etcSum = 0;
  let etcCount = 0;
  let obsPrecipSum = 0;
  let obsPrecipCount = 0;
  let peffObsSum = 0;
  let forecastRainSum = 0;
  let forecastRainCount = 0;
  let irrSum = 0;

  const dailyRows: WaterBalanceDayRow[] = [];

  for (const d of days) {
    const peff = computeEffectiveRainfallMm(d.precipitationMm);
    const runoff =
      d.precipitationMm !== null && peff !== null
        ? Number(Math.max(0, d.precipitationMm - peff).toFixed(2))
        : null;
    const etc =
      d.et0Mm !== null && d.kc !== null ? Number((d.et0Mm * d.kc).toFixed(2)) : null;

    if (d.et0Mm !== null) {
      et0Sum += d.et0Mm;
      et0Count++;
    }
    if (etc !== null) {
      etcSum += etc;
      etcCount++;
    }

    if (d.dataKind === 'historical') {
      if (d.precipitationMm !== null) {
        obsPrecipSum += d.precipitationMm;
        obsPrecipCount++;
      }
      if (peff !== null) {
        peffObsSum += peff;
      }
    } else if (d.precipitationMm !== null) {
      forecastRainSum += d.precipitationMm;
      forecastRainCount++;
    }

    irrSum += d.confirmedIrrigationMm;

    let dpMm: number | null = null;
    let drNext: number | null = null;
    let status: WaterBalanceDayRow['rootZoneStatus'] = 'unavailable';

    if (hasHydraulics && tawMm !== null && rawMm !== null && drPrev !== null && etc !== null && peff !== null) {
      const rawDr = drPrev - peff - d.confirmedIrrigationMm + etc;
      if (rawDr < 0) {
        dpMm = Number(Math.abs(rawDr).toFixed(2));
        drNext = 0;
      } else {
        dpMm = 0;
        drNext = Number(Math.min(tawMm, rawDr).toFixed(2));
      }
      drPrev = drNext;
      status = drNext > rawMm ? 'stress_risk' : drNext > rawMm * 0.7 ? 'drawdown' : 'optimal';
    }

    dailyRows.push({
      date: d.date,
      dataKind: d.dataKind,
      et0Mm: d.et0Mm,
      et0Method: d.et0Method,
      kc: d.kc,
      etcMm: etc,
      precipitationMm: d.precipitationMm,
      effectiveRainMm: peff,
      confirmedIrrigationMm: Number(d.confirmedIrrigationMm.toFixed(2)),
      runoffMm: runoff,
      deepPercolationMm: dpMm,
      depletionMm: drNext,
      rootZoneStatus: status,
      sourceStatus: d.et0Mm !== null && d.precipitationMm !== null ? 'valid' : 'partial',
    });
  }

  // Sign convention: Net Root-Zone Supply = Peff(obs) + I(confirmed) - ETc (positive = surplus, negative = deficit)
  const netBalanceMm =
    etcCount > 0 && obsPrecipCount > 0
      ? Number((peffObsSum + irrSum - etcSum).toFixed(1))
      : null;

  return {
    tawMm,
    rawMm,
    tawUnavailableReason,
    effectiveRainMethod: 'USDA SCS Daily Curve Approximation (interception < 1.5 mm excluded)',
    netBalanceMm,
    et0MeanMmDay: et0Count > 0 ? Number((et0Sum / et0Count).toFixed(2)) : null,
    etcTotalMm: etcCount > 0 ? Number(etcSum.toFixed(1)) : null,
    observedPrecipTotalMm: obsPrecipCount > 0 ? Number(obsPrecipSum.toFixed(1)) : null,
    effectiveRainTotalMm: obsPrecipCount > 0 ? Number(peffObsSum.toFixed(1)) : null,
    forecastRainTotalMm: forecastRainCount > 0 ? Number(forecastRainSum.toFixed(1)) : null,
    confirmedIrrigationTotalMm: Number(irrSum.toFixed(1)),
    latestDepletionMm: drPrev !== null ? Number(drPrev.toFixed(1)) : null,
    dailyRows,
  };
}
