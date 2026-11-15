import { z } from 'zod';
import {
  buildProviderCacheKey,
  fetchWithResilience,
  getProviderCached,
  setProviderCached,
} from './httpClient';
import { ObservationEnvelope } from '../../../src/types/advanced';

export interface ForecastDayEntry {
  date: string;
  tMaxC: number | null;
  tMinC: number | null;
  precipMm: number | null;
  precipProbPct: number | null;
  windSpeedMaxMs: number | null;
  windHeightM: number;
  rhMeanPct: number | null;
  solarRadiationMjM2: number | null;
  providerEt0Mm: number | null;
}

export interface WeatherForecastResult {
  providerId: string;
  providerName: string;
  productId: string;
  fallbackUsed: string | null;
  retrievedAt: string;
  timezone: string;
  spatialResolutionM: number;
  spatialLabel: string;
  currentTempC: number | null;
  currentRhPct: number | null;
  currentWindMs: number | null;
  currentPrecipMm: number | null;
  forecastDays: ForecastDayEntry[];
  rawRecordRef: string;
  sourceUrl: string;
  observations: ObservationEnvelope<unknown>[];
  error?: string;
}

const OpenMeteoForecastSchema = z.object({
  timezone: z.string().optional(),
  current: z
    .object({
      time: z.string().optional(),
      temperature_2m: z.number().nullable().optional(),
      relative_humidity_2m: z.number().nullable().optional(),
      precipitation: z.number().nullable().optional(),
      wind_speed_10m: z.number().nullable().optional(),
    })
    .optional(),
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_sum: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()).optional(),
    wind_speed_10m_max: z.array(z.number().nullable()).optional(),
    shortwave_radiation_sum: z.array(z.number().nullable()).optional(),
    et0_fao_evapotranspiration: z.array(z.number().nullable()).optional(),
  }),
  hourly: z
    .object({
      time: z.array(z.string()),
      relative_humidity_2m: z.array(z.number().nullable()).optional(),
    })
    .optional(),
});

const MetNorwaySchema = z.object({
  properties: z.object({
    meta: z.object({ updated_at: z.string().optional() }).optional(),
    timeseries: z.array(
      z.object({
        time: z.string(),
        data: z.object({
          instant: z.object({
            details: z.object({
              air_temperature: z.number().optional(),
              relative_humidity: z.number().optional(),
              wind_speed: z.number().optional(),
            }),
          }),
          next_6_hours: z
            .object({
              details: z.object({
                precipitation_amount: z.number().optional(),
              }),
            })
            .optional(),
          next_1_hours: z
            .object({
              details: z.object({
                precipitation_amount: z.number().optional(),
              }),
            })
            .optional(),
        }),
      })
    ),
  }),
});

export async function fetchWeatherForecastWithFallback(opts: {
  lat: number;
  lon: number;
  forecastDays?: number;
}): Promise<WeatherForecastResult> {
  const { lat, lon, forecastDays = 10 } = opts;
  const cellKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const todayIso = new Date().toISOString().slice(0, 10);
  const cacheKey = buildProviderCacheKey({
    providerId: 'weather_forecast_ladder',
    productId: `om_metno_${forecastDays}d`,
    variable: 'daily_forecast',
    cellOrGeomKey: cellKey,
    timeWindow: todayIso,
    version: 'v1',
  });

  const cached = getProviderCached<WeatherForecastResult>(cacheKey);
  if (cached) return cached.value;

  // 1. Primary: Open-Meteo Forecast API (units requested explicitly: wind_speed_unit=ms)
  const omUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,shortwave_radiation_sum,et0_fao_evapotranspiration` +
    `&hourly=relative_humidity_2m&wind_speed_unit=ms&forecast_days=${Math.min(16, forecastDays)}&timezone=auto`;

  const omRes = await fetchWithResilience({
    providerId: 'open_meteo_forecast',
    url: omUrl,
    timeoutMs: 8000,
    maxRetries: 2,
  });

  if (omRes.ok) {
    try {
      const json = await omRes.response.json();
      const parsed = OpenMeteoForecastSchema.safeParse(json);
      if (parsed.success) {
        const d = parsed.data.daily;
        const rhByDate = new Map<string, number[]>();
        if (parsed.data.hourly?.time && parsed.data.hourly.relative_humidity_2m) {
          parsed.data.hourly.time.forEach((t, idx) => {
            const day = t.slice(0, 10);
            const rh = parsed.data.hourly!.relative_humidity_2m![idx];
            if (typeof rh === 'number' && Number.isFinite(rh)) {
              const arr = rhByDate.get(day) ?? [];
              arr.push(rh);
              rhByDate.set(day, arr);
            }
          });
        }

        const days: ForecastDayEntry[] = d.time.map((date, idx) => {
          const rhArr = rhByDate.get(date) ?? [];
          const rhMean =
            rhArr.length > 0
              ? Number((rhArr.reduce((s, n) => s + n, 0) / rhArr.length).toFixed(1))
              : null;
          return {
            date,
            tMaxC: d.temperature_2m_max[idx] ?? null,
            tMinC: d.temperature_2m_min[idx] ?? null,
            precipMm: d.precipitation_sum[idx] ?? null,
            precipProbPct: d.precipitation_probability_max?.[idx] ?? null,
            windSpeedMaxMs: d.wind_speed_10m_max?.[idx] ?? null,
            windHeightM: 10,
            rhMeanPct: rhMean,
            solarRadiationMjM2: d.shortwave_radiation_sum?.[idx] ?? null,
            providerEt0Mm: d.et0_fao_evapotranspiration?.[idx] ?? null,
          };
        });

        const nowIso = new Date().toISOString();
        const result: WeatherForecastResult = {
          providerId: 'open_meteo_forecast',
          providerName: 'Open-Meteo NWP Forecast (Non-commercial endpoint)',
          productId: 'IFS / GFS / ICON Seamless',
          fallbackUsed: null,
          retrievedAt: nowIso,
          timezone: parsed.data.timezone || 'UTC',
          spatialResolutionM: 11000,
          spatialLabel: '~9–13 km NWP grid (not field weather station)',
          currentTempC: parsed.data.current?.temperature_2m ?? null,
          currentRhPct: parsed.data.current?.relative_humidity_2m ?? null,
          currentWindMs: parsed.data.current?.wind_speed_10m ?? null,
          currentPrecipMm: parsed.data.current?.precipitation ?? null,
          forecastDays: days,
          rawRecordRef: `om:${omRes.correlationId}`,
          sourceUrl: 'https://open-meteo.com/en/docs',
          observations: [
            {
              observationId: `obs-om-fc-${omRes.correlationId}`,
              providerId: 'open_meteo_forecast',
              productId: 'open-meteo-v1-forecast',
              variable: 'daily_forecast_bundle',
              value: days.length,
              unit: 'days',
              evidenceType: 'forecast',
              validFrom: days[0]?.date,
              validTo: days[days.length - 1]?.date,
              retrievedAt: nowIso,
              spatialResolution: 11000,
              temporalResolution: 'daily',
              qualityFlags: ['nwp_forecast_not_observed'],
              sourceUrl: omUrl,
              rawRecordRef: `om:${omRes.correlationId}`,
              status: 'valid',
            },
          ],
        };
        setProviderCached(cacheKey, result, 20 * 60 * 1000);
        return result;
      }
    } catch {
      // Fall through to MET Norway
    }
  }

  // 2. Fallback: MET Norway Locationforecast 2.0 (global point forecast)
  const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const metRes = await fetchWithResilience({
    providerId: 'met_norway_forecast',
    url: metUrl,
    timeoutMs: 8000,
    maxRetries: 1,
  });

  if (metRes.ok) {
    try {
      const json = await metRes.response.json();
      const parsed = MetNorwaySchema.safeParse(json);
      if (parsed.success) {
        const ts = parsed.data.properties.timeseries;
        const grouped = new Map<
          string,
          { temps: number[]; rhs: number[]; winds: number[]; precip: number }
        >();
        for (const row of ts) {
          const day = row.time.slice(0, 10);
          const b = grouped.get(day) ?? { temps: [], rhs: [], winds: [], precip: 0 };
          const d = row.data.instant.details;
          if (typeof d.air_temperature === 'number') b.temps.push(d.air_temperature);
          if (typeof d.relative_humidity === 'number') b.rhs.push(d.relative_humidity);
          if (typeof d.wind_speed === 'number') b.winds.push(d.wind_speed);
          if (typeof row.data.next_1_hours?.details.precipitation_amount === 'number') {
            b.precip += row.data.next_1_hours.details.precipitation_amount;
          } else if (typeof row.data.next_6_hours?.details.precipitation_amount === 'number') {
            b.precip += row.data.next_6_hours.details.precipitation_amount / 6;
          }
          grouped.set(day, b);
        }

        const days: ForecastDayEntry[] = Array.from(grouped.entries())
          .slice(0, forecastDays)
          .map(([date, b]) => ({
            date,
            tMaxC: b.temps.length > 0 ? Number(Math.max(...b.temps).toFixed(1)) : null,
            tMinC: b.temps.length > 0 ? Number(Math.min(...b.temps).toFixed(1)) : null,
            precipMm: Number(b.precip.toFixed(1)),
            precipProbPct: null,
            windSpeedMaxMs: b.winds.length > 0 ? Number(Math.max(...b.winds).toFixed(1)) : null,
            windHeightM: 10,
            rhMeanPct:
              b.rhs.length > 0
                ? Number((b.rhs.reduce((s, n) => s + n, 0) / b.rhs.length).toFixed(1))
                : null,
            solarRadiationMjM2: null, // MET Norway compact omits shortwave radiation
            providerEt0Mm: null,
          }));

        const first = ts[0]?.data.instant.details;
        const nowIso = new Date().toISOString();
        const result: WeatherForecastResult = {
          providerId: 'met_norway_forecast',
          providerName: 'MET Norway Locationforecast 2.0 (Fallback)',
          productId: 'ECMWF/MEPS Compact Point',
          fallbackUsed: `Primary Open-Meteo failed (${omRes.ok ? 'schema mismatch' : omRes.error}); switched to MET Norway Locationforecast 2.0.`,
          retrievedAt: nowIso,
          timezone: 'UTC',
          spatialResolutionM: 9000,
          spatialLabel: '~9 km ECMWF/MET Norway grid (solar radiation omitted in compact feed)',
          currentTempC: first?.air_temperature ?? null,
          currentRhPct: first?.relative_humidity ?? null,
          currentWindMs: first?.wind_speed ?? null,
          currentPrecipMm: ts[0]?.data.next_1_hours?.details.precipitation_amount ?? null,
          forecastDays: days,
          rawRecordRef: `metno:${metRes.correlationId}`,
          sourceUrl: 'https://api.met.no/weatherapi/locationforecast/2.0/documentation',
          observations: [
            {
              observationId: `obs-metno-fc-${metRes.correlationId}`,
              providerId: 'met_norway_forecast',
              productId: 'locationforecast-2.0-compact',
              variable: 'daily_forecast_bundle',
              value: days.length,
              unit: 'days',
              evidenceType: 'forecast',
              validFrom: days[0]?.date,
              validTo: days[days.length - 1]?.date,
              retrievedAt: nowIso,
              spatialResolution: 9000,
              temporalResolution: 'hourly_aggregated_daily',
              qualityFlags: ['fallback_provider', 'missing_solar_radiation'],
              sourceUrl: metUrl,
              rawRecordRef: `metno:${metRes.correlationId}`,
              status: 'valid',
            },
          ],
        };
        setProviderCached(cacheKey, result, 20 * 60 * 1000);
        return result;
      }
    } catch {
      // Fall through to unavailable
    }
  }

  return {
    providerId: 'weather_forecast_unavailable',
    providerName: 'Weather Forecast Providers Unavailable',
    productId: 'none',
    fallbackUsed: null,
    retrievedAt: new Date().toISOString(),
    timezone: 'UTC',
    spatialResolutionM: 0,
    spatialLabel: 'Unavailable',
    currentTempC: null,
    currentRhPct: null,
    currentWindMs: null,
    currentPrecipMm: null,
    forecastDays: [],
    rawRecordRef: `err:${omRes.correlationId}`,
    sourceUrl: omUrl,
    observations: [],
    error: `Open-Meteo failed (${omRes.ok ? 'invalid response' : omRes.error}) and MET Norway fallback failed (${metRes.ok ? 'invalid response' : metRes.error}).`,
  };
}
