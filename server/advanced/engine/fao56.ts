import { CropParams } from './cropDatabase';

export const FAO56_ENGINE_VERSION = 'fao56-pm-v1.0.0';

export interface Fao56DailyInput {
  dateIso: string; // YYYY-MM-DD
  tMinC: number | null;
  tMaxC: number | null;
  rhMeanPct?: number | null;
  rhMinPct?: number | null;
  rhMaxPct?: number | null;
  tDewC?: number | null;
  windSpeedMs: number | null;
  windMeasurementHeightM?: number; // defaults to 2m if WS2M, or 10m if Open-Meteo 10m
  rsMjM2Day: number | null; // downward shortwave solar radiation MJ/m²/day
  elevationM: number; // default 0 if unknown only when marked, or require finite number
  latitudeDeg: number;
}

export interface Fao56DailyResult {
  dateIso: string;
  method: 'FAO-56 Penman-Monteith' | 'Hargreaves-Samani Approx' | 'Unavailable';
  et0MmDay: number | null;
  unavailableReason: string | null;
  intermediates?: {
    tMeanC: number;
    u2Ms: number;
    pressureKpa: number;
    gammaKpaC: number;
    deltaKpaC: number;
    esKpa: number;
    eaKpa: number;
    vpdKpa: number;
    raMjM2Day: number;
    rsoMjM2Day: number;
    rnsMjM2Day: number;
    rnlMjM2Day: number;
    rnMjM2Day: number;
  };
}

export function saturationVaporPressureKpa(tempC: number): number {
  return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

export function convertWindTo2m(windMs: number, heightM: number): number {
  if (!Number.isFinite(windMs) || windMs < 0) return 0;
  if (Math.abs(heightM - 2) < 0.05) return windMs;
  const z = Math.max(0.5, heightM);
  // FAO-56 Eq. 47: u2 = uz * 4.87 / ln(67.8 * z - 5.42)
  return windMs * (4.87 / Math.log(67.8 * z - 5.42));
}

export function dayOfYearFromIso(dateIso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso);
  if (!m) return 180;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = Date.UTC(year, month - 1, day);
  const start = Date.UTC(year, 0, 1);
  return Math.floor((dt - start) / 86400000) + 1;
}

/**
 * Computes extraterrestrial radiation Ra (MJ / m^2 / day) per FAO-56 Equations 21-25.
 */
export function computeExtraterrestrialRadiationRa(latitudeDeg: number, dayOfYear: number): number {
  const phi = (latitudeDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * dayOfYear);
  const delta = 0.409 * Math.sin(((2 * Math.PI) / 365) * dayOfYear - 1.39);
  const cosWs = Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta)));
  const ws = Math.acos(cosWs);
  const gsc = 0.0820; // MJ m^-2 min^-1
  const ra =
    ((24 * 60) / Math.PI) *
    gsc *
    dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
  return Math.max(0, ra);
}

/**
 * Exact FAO-56 Daily Penman-Monteith ET0 (mm/day) following Irrigation & Drainage Paper No. 56 Ch. 3 & Ch. 4.
 * Never claims FAO-56 Penman-Monteith if wind, humidity/dewpoint, or solar radiation inputs are missing.
 */
export function computeFao56DailyEt0(input: Fao56DailyInput): Fao56DailyResult {
  const { tMinC, tMaxC, windSpeedMs, rsMjM2Day, elevationM, latitudeDeg, dateIso } = input;
  const heightM = input.windMeasurementHeightM ?? 2;

  if (
    tMinC === null ||
    tMaxC === null ||
    !Number.isFinite(tMinC) ||
    !Number.isFinite(tMaxC) ||
    !Number.isFinite(latitudeDeg)
  ) {
    return {
      dateIso,
      method: 'Unavailable',
      et0MmDay: null,
      unavailableReason: 'Daily minimum/maximum air temperature or latitude is missing.',
    };
  }

  const hasRhPair =
    input.rhMinPct !== null &&
    input.rhMinPct !== undefined &&
    Number.isFinite(input.rhMinPct) &&
    input.rhMaxPct !== null &&
    input.rhMaxPct !== undefined &&
    Number.isFinite(input.rhMaxPct);
  const hasRhMean =
    input.rhMeanPct !== null &&
    input.rhMeanPct !== undefined &&
    Number.isFinite(input.rhMeanPct);
  const hasDew =
    input.tDewC !== null && input.tDewC !== undefined && Number.isFinite(input.tDewC);

  const hasHumidity = hasRhPair || hasRhMean || hasDew;
  const hasWind = windSpeedMs !== null && Number.isFinite(windSpeedMs) && windSpeedMs >= 0;
  const hasRad = rsMjM2Day !== null && Number.isFinite(rsMjM2Day) && rsMjM2Day >= 0;

  if (!hasHumidity || !hasWind || !hasRad) {
    // Only return Hargreaves-Samani (temperature + extraterrestrial radiation) separately labeled — NEVER call it FAO-56 PM!
    const doy = dayOfYearFromIso(dateIso);
    const ra = computeExtraterrestrialRadiationRa(latitudeDeg, doy);
    const tMean = (tMaxC + tMinC) / 2;
    const tr = Math.max(0, tMaxC - tMinC);
    const et0Hs = 0.0023 * (tMean + 17.8) * Math.sqrt(tr) * (0.408 * ra);
    const missingParts = [
      !hasHumidity ? 'relative humidity/dewpoint' : null,
      !hasWind ? 'wind speed' : null,
      !hasRad ? 'solar radiation' : null,
    ]
      .filter(Boolean)
      .join(', ');
    return {
      dateIso,
      method: 'Hargreaves-Samani Approx',
      et0MmDay: Number(Math.max(0, et0Hs).toFixed(2)),
      unavailableReason: `FAO-56 Penman-Monteith requires ${missingParts}; calculated Hargreaves-Samani temperature-only approximation instead.`,
    };
  }

  const elev = Number.isFinite(elevationM) ? elevationM : 0;
  const tMeanC = (tMaxC + tMinC) / 2;
  const u2Ms = convertWindTo2m(windSpeedMs!, heightM);

  // FAO-56 Eq. 7 & Eq. 8: Atmospheric pressure & psychrometric constant
  const pressureKpa = 101.3 * Math.pow((293 - 0.0065 * elev) / 293, 5.26);
  const gammaKpaC = 0.000665 * pressureKpa;

  // FAO-56 Eq. 11 & Eq. 12: Mean saturation vapour pressure es
  const eTmax = saturationVaporPressureKpa(tMaxC);
  const eTmin = saturationVaporPressureKpa(tMinC);
  const esKpa = (eTmax + eTmin) / 2;

  // FAO-56 Eq. 14 / 17 / 19: Actual vapour pressure ea
  let eaKpa: number;
  if (hasDew) {
    eaKpa = saturationVaporPressureKpa(input.tDewC!);
  } else if (hasRhPair) {
    eaKpa = (eTmin * (input.rhMaxPct! / 100) + eTmax * (input.rhMinPct! / 100)) / 2;
  } else {
    eaKpa = esKpa * (Math.max(0, Math.min(100, input.rhMeanPct!)) / 100);
  }

  const vpdKpa = Math.max(0, esKpa - eaKpa);

  // FAO-56 Eq. 13: Slope of saturation vapour pressure curve Δ
  const deltaKpaC =
    (4098 * saturationVaporPressureKpa(tMeanC)) / Math.pow(tMeanC + 237.3, 2);

  // Radiation terms: FAO-56 Eq. 21-39
  const doy = dayOfYearFromIso(dateIso);
  const raMjM2Day = computeExtraterrestrialRadiationRa(latitudeDeg, doy);
  const rsoMjM2Day = Math.max(0.01, (0.75 + 2e-5 * elev) * raMjM2Day);
  const rnsMjM2Day = (1 - 0.23) * rsMjM2Day!;

  const sigma = 4.903e-9; // MJ K^-4 m^-2 day^-1
  const tMaxK4 = Math.pow(tMaxC + 273.16, 4);
  const tMinK4 = Math.pow(tMinC + 273.16, 4);
  const relShortwave = Math.max(0.25, Math.min(1.0, rsMjM2Day! / rsoMjM2Day));
  const rnlMjM2Day =
    sigma *
    ((tMaxK4 + tMinK4) / 2) *
    (0.34 - 0.14 * Math.sqrt(Math.max(0.01, eaKpa))) *
    (1.35 * relShortwave - 0.35);

  const rnMjM2Day = rnsMjM2Day - rnlMjM2Day;
  const gMjM2Day = 0; // FAO-56 daily soil heat flux ~ 0

  // FAO-56 Eq. 6: Daily Penman-Monteith
  const numerator =
    0.408 * deltaKpaC * (rnMjM2Day - gMjM2Day) +
    gammaKpaC * (900 / (tMeanC + 273)) * u2Ms * vpdKpa;
  const denominator = deltaKpaC + gammaKpaC * (1 + 0.34 * u2Ms);
  const et0 = Math.max(0, numerator / denominator);

  return {
    dateIso,
    method: 'FAO-56 Penman-Monteith',
    et0MmDay: Number(et0.toFixed(2)),
    unavailableReason: null,
    intermediates: {
      tMeanC: Number(tMeanC.toFixed(2)),
      u2Ms: Number(u2Ms.toFixed(2)),
      pressureKpa: Number(pressureKpa.toFixed(2)),
      gammaKpaC: Number(gammaKpaC.toFixed(5)),
      deltaKpaC: Number(deltaKpaC.toFixed(4)),
      esKpa: Number(esKpa.toFixed(3)),
      eaKpa: Number(eaKpa.toFixed(3)),
      vpdKpa: Number(vpdKpa.toFixed(3)),
      raMjM2Day: Number(raMjM2Day.toFixed(2)),
      rsoMjM2Day: Number(rsoMjM2Day.toFixed(2)),
      rnsMjM2Day: Number(rnsMjM2Day.toFixed(2)),
      rnlMjM2Day: Number(rnlMjM2Day.toFixed(2)),
      rnMjM2Day: Number(rnMjM2Day.toFixed(2)),
    },
  };
}

export function resolveCropStageKc(opts: {
  crop: CropParams | null;
  stage?: 'initial' | 'development' | 'mid_season' | 'late_season' | null;
  dateIso?: string;
  u2Ms?: number | null;
  rhMinPct?: number | null;
}): {
  kc: number | null;
  stageLabel: string | null;
  sourceNote: string;
} {
  const { crop, stage, u2Ms, rhMinPct } = opts;
  if (!crop) {
    return {
      kc: null,
      stageLabel: null,
      sourceNote: 'No confirmed crop profile mapped to resolve FAO-56 Kc.',
    };
  }

  let effectiveStage = stage ?? null;
  if (!effectiveStage) {
    // Infer conservative seasonal canopy phase only as documented mid/late/initial hint if month matches; otherwise default mid/dev note
    const month = opts.dateIso ? Number(opts.dateIso.slice(5, 7)) : 6;
    if (month >= 11 || month <= 2) {
      effectiveStage = crop.id === 'wheat' || crop.id === 'barley' ? 'initial' : 'late_season';
    } else if (month >= 3 && month <= 5) {
      effectiveStage = 'development';
    } else if (month >= 6 && month <= 8) {
      effectiveStage = 'mid_season';
    } else {
      effectiveStage = 'late_season';
    }
  }

  let kc =
    effectiveStage === 'initial'
      ? crop.kcIni
      : effectiveStage === 'development'
        ? Number(((crop.kcIni + crop.kcMid) / 2).toFixed(2))
        : effectiveStage === 'mid_season'
          ? crop.kcMid
          : crop.kcEnd;

  // FAO-56 Eq. 62 climate adjustment for Kc_mid when wind and RHmin deviate from standard (u2 = 2 m/s, RHmin = 45%)
  let adjNote = '';
  if (
    effectiveStage === 'mid_season' &&
    typeof u2Ms === 'number' &&
    typeof rhMinPct === 'number' &&
    Number.isFinite(u2Ms) &&
    Number.isFinite(rhMinPct)
  ) {
    const h = Math.max(0.2, Math.min(3.0, crop.zrMaxM));
    const adj = (0.04 * (u2Ms - 2) - 0.004 * (rhMinPct - 45)) * Math.pow(h / 3, 0.3);
    kc = Number(Math.max(0.2, Math.min(1.4, kc + adj)).toFixed(2));
    adjNote = ' with FAO-56 Eq. 62 wind/RH adjustment';
  }

  const stageLabelMap: Record<string, string> = {
    initial: 'Initial',
    development: 'Development',
    mid_season: 'Mid-season',
    late_season: 'Late season',
  };

  return {
    kc,
    stageLabel: stageLabelMap[effectiveStage] ?? 'Development',
    sourceNote: `${crop.sourceRef} (${crop.name}, ${stageLabelMap[effectiveStage]}${adjNote})`,
  };
}
