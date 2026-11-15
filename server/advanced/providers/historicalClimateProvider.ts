import { z } from 'zod';
import {
  buildProviderCacheKey,
  fetchWithResilience,
  getProviderCached,
  setProviderCached,
} from './httpClient';
import { ObservationEnvelope } from '../../../src/types/advanced';

export interface HistoricalClimateDay {
  date: string;
  tMaxC: number | null;
  tMinC: number | null;
  tMeanC: number | null;
  precipMm: number | null;
  solarMjM2: number | null;
  rhMeanPct: number | null;
  wind2mMs: number | null;
  windHeightM: number;
  gwetTopFrac: number | null; // 0-1 NASA POWER surface soil wetness
  gwetRootFrac: number | null; // 0-1 NASA POWER root-zone soil wetness
}

export interface HistoricalClimateResult {
  providerId: string;
  providerName: string;
  productId: string;
  fallbackUsed: string | null;
  retrievedAt: string;
  spatialResolutionM: number;
  spatialLabel: string;
  evidenceType: 'reanalysis' | 'modelled';
  days: HistoricalClimateDay[];
  baselinePrecipMmDay: number | null;
  baselineTempMeanC: number | null;
  crossCheckPrecipProvider: string | null;
  crossCheckPrecipTotalMm: number | null;
  precipDisagreementNote: string | null;
  observations: ObservationEnvelope<unknown>[];
  sourceUrl: string;
  error?: string;
}

const NasaPowerDailySchema = z.object({
  properties: z.object({
    parameter: z.record(z.string(), z.record(z.string(), z.number())),
  }),
});

const OpenMeteoArchiveSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    temperature_2m_mean: z.array(z.number().nullable()).optional(),
    precipitation_sum: z.array(z.number().nullable()),
    shortwave_radiation_sum: z.array(z.number().nullable()).optional(),
    wind_speed_10m_max: z.array(z.number().nullable()).optional(),
  }),
  hourly: z
    .object({
      time: z.array(z.string()),
      relative_humidity_2m: z.array(z.number().nullable()).optional(),
    })
    .optional(),
});

function toYyyymmdd(iso: string): string {
  return iso.replace(/-/g, '').slice(0, 8);
}

function cleanPowerVal(v: number | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= -900) return null;
  return v;
}

export async function fetchHistoricalClimateWithFallback(opts: {
  lat: number;
  lon: number;
  fromIso: string;
  toIso: string;
}): Promise<HistoricalClimateResult> {
  const { lat, lon, fromIso, toIso } = opts;
  // Cap historical query end to yesterday (reanalysis/POWER latency ~2-4 days; Archive covers through ~5 days ago, POWER daily covers up to ~2 days ago)
  const safeEndMs = Math.min(Date.parse(`${toIso}T00:00:00Z`), Date.now() - 2 * 86400000);
  const effectiveTo = new Date(safeEndMs).toISOString().slice(0, 10);
  const startIso = fromIso <= effectiveTo ? fromIso : new Date(safeEndMs - 21 * 86400000).toISOString().slice(0, 10);

  const cellKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cacheKey = buildProviderCacheKey({
    providerId: 'historical_climate_ladder',
    productId: 'power_ag_daily_era5',
    variable: 'daily_agroclim',
    cellOrGeomKey: cellKey,
    timeWindow: `${startIso}_${effectiveTo}`,
    version: 'v1',
  });
  const cached = getProviderCached<HistoricalClimateResult>(cacheKey);
  if (cached) return cached.value;

  // 1. Primary: NASA POWER Daily Point API (Community=AG -> MJ/m^2/day for ALLSKY_SFC_SW_DWN, 2m wind speed WS2M!)
  const powerUrl =
    `https://power.larc.nasa.gov/api/temporal/daily/point` +
    `?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M,GWETTOP,GWETROOT` +
    `&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}` +
    `&start=${toYyyymmdd(startIso)}&end=${toYyyymmdd(effectiveTo)}&format=JSON`;

  // Also fetch ERA5-Land archive for cross-check (and primary fallback if NASA POWER fails!)
  const archiveSafeEnd = new Date(Math.min(safeEndMs, Date.now() - 5 * 86400000))
    .toISOString()
    .slice(0, 10);
  const eraUrl =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start_date=${startIso}&end_date=${archiveSafeEnd}` +
    `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,shortwave_radiation_sum,wind_speed_10m_max` +
    `&hourly=relative_humidity_2m&wind_speed_unit=ms&timezone=UTC`;

  // NASA POWER Climatology endpoint for seasonal precipitation & temp baseline (multi-year 2001-2020)
  const climUrl =
    `https://power.larc.nasa.gov/api/temporal/climatology/point` +
    `?parameters=T2M,PRECTOTCORR&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;

  const [powerRes, eraRes, climRes] = await Promise.all([
    fetchWithResilience({ providerId: 'nasa_power_daily', url: powerUrl, timeoutMs: 9500, maxRetries: 2 }),
    fetchWithResilience({ providerId: 'open_meteo_era5', url: eraUrl, timeoutMs: 8500, maxRetries: 1 }),
    fetchWithResilience({ providerId: 'nasa_power_clim', url: climUrl, timeoutMs: 7500, maxRetries: 1 }),
  ]);

  // Parse baseline climatology for target month(s)
  let baselinePrecipMmDay: number | null = null;
  let baselineTempMeanC: number | null = null;
  if (climRes.ok) {
    try {
      const cJson = await climRes.response.json();
      const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const monthIdx = new Date(`${effectiveTo}T00:00:00Z`).getUTCMonth();
      const mKey = monthNames[monthIdx] || 'ANN';
      const pVal = cJson?.properties?.parameter?.PRECTOTCORR?.[mKey];
      const tVal = cJson?.properties?.parameter?.T2M?.[mKey];
      if (typeof pVal === 'number' && pVal > -900) baselinePrecipMmDay = Number(pVal.toFixed(2));
      if (typeof tVal === 'number' && tVal > -900) baselineTempMeanC = Number(tVal.toFixed(1));
    } catch {
      // Optional climatology baseline
    }
  }

  // Parse ERA5-Land cross-check / fallback
  let eraDays: HistoricalClimateDay[] = [];
  if (eraRes.ok) {
    try {
      const eJson = await eraRes.response.json();
      const parsed = OpenMeteoArchiveSchema.safeParse(eJson);
      if (parsed.success) {
        const rhMap = new Map<string, number[]>();
        parsed.data.hourly?.time.forEach((t, idx) => {
          const val = parsed.data.hourly!.relative_humidity_2m?.[idx];
          if (typeof val === 'number' && Number.isFinite(val)) {
            const k = t.slice(0, 10);
            const arr = rhMap.get(k) ?? [];
            arr.push(val);
            rhMap.set(k, arr);
          }
        });
        eraDays = parsed.data.daily.time.map((date, idx) => {
          const rhs = rhMap.get(date) ?? [];
          return {
            date,
            tMaxC: parsed.data.daily.temperature_2m_max[idx] ?? null,
            tMinC: parsed.data.daily.temperature_2m_min[idx] ?? null,
            tMeanC: parsed.data.daily.temperature_2m_mean?.[idx] ?? null,
            precipMm: parsed.data.daily.precipitation_sum[idx] ?? null,
            solarMjM2: parsed.data.daily.shortwave_radiation_sum?.[idx] ?? null,
            rhMeanPct: rhs.length > 0 ? Number((rhs.reduce((a, b) => a + b, 0) / rhs.length).toFixed(1)) : null,
            wind2mMs:
              parsed.data.daily.wind_speed_10m_max?.[idx] !== null &&
              parsed.data.daily.wind_speed_10m_max?.[idx] !== undefined
                ? Number((parsed.data.daily.wind_speed_10m_max[idx]! * 0.748).toFixed(2)) // 10m -> 2m FAO Eq. 47
                : null,
            windHeightM: 2,
            gwetTopFrac: null,
            gwetRootFrac: null,
          };
        });
      }
    } catch {
      // ignore
    }
  }

  // Try primary NASA POWER
  if (powerRes.ok) {
    try {
      const pJson = await powerRes.response.json();
      const parsed = NasaPowerDailySchema.safeParse(pJson);
      if (parsed.success) {
        const params = parsed.data.properties.parameter;
        const keys = Object.keys(params.T2M || params.T2M_MAX || {}).sort();
        const days: HistoricalClimateDay[] = [];
        for (const k of keys) {
          const iso = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
          const tMeanC = cleanPowerVal(params.T2M?.[k]);
          const tMaxC = cleanPowerVal(params.T2M_MAX?.[k]);
          const tMinC = cleanPowerVal(params.T2M_MIN?.[k]);
          const precipMm = cleanPowerVal(params.PRECTOTCORR?.[k]);
          const solarMjM2 = cleanPowerVal(params.ALLSKY_SFC_SW_DWN?.[k]);
          const rhMeanPct = cleanPowerVal(params.RH2M?.[k]);
          const wind2mMs = cleanPowerVal(params.WS2M?.[k]);
          const gwetTopFrac = cleanPowerVal(params.GWETTOP?.[k]);
          const gwetRootFrac = cleanPowerVal(params.GWETROOT?.[k]);
          if (tMaxC !== null || tMinC !== null || precipMm !== null) {
            days.push({
              date: iso,
              tMaxC,
              tMinC,
              tMeanC,
              precipMm,
              solarMjM2,
              rhMeanPct,
              wind2mMs,
              windHeightM: 2,
              gwetTopFrac,
              gwetRootFrac,
            });
          }
        }

        if (days.length > 0) {
          // Cross-check precipitation totals on overlapping dates between NASA POWER & ERA5-Land without blending!
          const eraMap = new Map(eraDays.map((e) => [e.date, e.precipMm]));
          let pOverlap = 0;
          let eOverlap = 0;
          let overlapN = 0;
          for (const d of days) {
            const ep = eraMap.get(d.date);
            if (d.precipMm !== null && ep !== null && ep !== undefined) {
              pOverlap += d.precipMm;
              eOverlap += ep;
              overlapN++;
            }
          }
          const disagreement =
            overlapN >= 5 && Math.abs(pOverlap - eOverlap) > Math.max(15, 0.35 * Math.max(pOverlap, eOverlap))
              ? `Precipitation cross-check divergence on ${overlapN} overlapping days: NASA POWER ${pOverlap.toFixed(1)} mm vs ERA5-Land ${eOverlap.toFixed(1)} mm (coarse grid vs reanalysis model difference; NASA POWER retained as primary).`
              : null;

          const nowIso = new Date().toISOString();
          const result: HistoricalClimateResult = {
            providerId: 'nasa_power_daily',
            providerName: 'NASA POWER Daily Agroclimatology (MERRA-2 / CERES)',
            productId: 'POWER Daily Point AG v2',
            fallbackUsed: null,
            retrievedAt: nowIso,
            spatialResolutionM: 55000,
            spatialLabel: '0.5° × 0.5° global grid (~55 km — regional climate grid, not field station)',
            evidenceType: 'reanalysis',
            days,
            baselinePrecipMmDay,
            baselineTempMeanC,
            crossCheckPrecipProvider: overlapN > 0 ? 'Open-Meteo ERA5-Land (~9–11 km)' : null,
            crossCheckPrecipTotalMm: overlapN > 0 ? Number(eOverlap.toFixed(1)) : null,
            precipDisagreementNote: disagreement,
            observations: [
              {
                observationId: `obs-power-${powerRes.correlationId}`,
                providerId: 'nasa_power_daily',
                productId: 'power-daily-ag',
                variable: 'daily_agroclimatology',
                value: days.length,
                unit: 'days',
                evidenceType: 'reanalysis',
                validFrom: days[0]?.date,
                validTo: days[days.length - 1]?.date,
                retrievedAt: nowIso,
                spatialResolution: 55000,
                temporalResolution: 'daily',
                qualityFlags: ['coarse_climate_grid'],
                sourceUrl: powerUrl,
                rawRecordRef: `power:${powerRes.correlationId}`,
                status: 'valid',
              },
            ],
            sourceUrl: 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/',
          };
          setProviderCached(cacheKey, result, 6 * 60 * 60 * 1000);
          return result;
        }
      }
    } catch {
      // Fall back to ERA5-Land below
    }
  }

  // Fallback: Open-Meteo ERA5-Land Archive
  if (eraDays.length > 0) {
    const nowIso = new Date().toISOString();
    const result: HistoricalClimateResult = {
      providerId: 'open_meteo_era5',
      providerName: 'Open-Meteo Historical Archive (ERA5 / ERA5-Land)',
      productId: 'ERA5-Land Reanalysis',
      fallbackUsed: `Primary NASA POWER failed (${powerRes.ok ? 'empty daily window' : powerRes.error}); switched to Open-Meteo ERA5-Land archive.`,
      retrievedAt: nowIso,
      spatialResolutionM: 11000,
      spatialLabel: '~9–11 km ERA5-Land reanalysis grid (not field weather station)',
      evidenceType: 'reanalysis',
      days: eraDays,
      baselinePrecipMmDay,
      baselineTempMeanC,
      crossCheckPrecipProvider: null,
      crossCheckPrecipTotalMm: null,
      precipDisagreementNote: null,
      observations: [
        {
          observationId: `obs-era5-${eraRes.correlationId}`,
          providerId: 'open_meteo_era5',
          productId: 'era5-land-archive',
          variable: 'daily_reanalysis',
          value: eraDays.length,
          unit: 'days',
          evidenceType: 'reanalysis',
          validFrom: eraDays[0]?.date,
          validTo: eraDays[eraDays.length - 1]?.date,
          retrievedAt: nowIso,
          spatialResolution: 11000,
          temporalResolution: 'daily',
          qualityFlags: ['fallback_provider', 'reanalysis'],
          sourceUrl: eraUrl,
          rawRecordRef: `era5:${eraRes.correlationId}`,
          status: 'valid',
        },
      ],
      sourceUrl: 'https://open-meteo.com/en/docs/historical-weather-api',
    };
    setProviderCached(cacheKey, result, 6 * 60 * 60 * 1000);
    return result;
  }

  return {
    providerId: 'historical_climate_unavailable',
    providerName: 'Historical Climate Providers Unavailable',
    productId: 'none',
    fallbackUsed: null,
    retrievedAt: new Date().toISOString(),
    spatialResolutionM: 0,
    spatialLabel: 'Unavailable',
    evidenceType: 'reanalysis',
    days: [],
    baselinePrecipMmDay,
    baselineTempMeanC,
    crossCheckPrecipProvider: null,
    crossCheckPrecipTotalMm: null,
    precipDisagreementNote: null,
    observations: [],
    sourceUrl: powerUrl,
    error: `NASA POWER failed (${powerRes.ok ? 'no daily fill values' : powerRes.error}) and ERA5 fallback unavailable.`,
  };
}
