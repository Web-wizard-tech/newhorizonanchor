import { z } from 'zod';
import {
  buildProviderCacheKey,
  fetchWithResilience,
  getProviderCached,
  setProviderCached,
  updateProviderRuntime,
} from './httpClient';
import { ObservationEnvelope } from '../../../src/types/advanced';
import { HistoricalClimateDay } from './historicalClimateProvider';

export interface SoilMoistureResult {
  providerId: string;
  providerName: string;
  productId: string;
  fallbackUsed: string | null;
  retrievedAt: string;
  spatialResolutionM: number;
  spatialLabel: string;
  surfaceMoisturePct: number | null;
  surfaceDepthLabel: string;
  rootZoneMoisturePct: number | null;
  rootZoneDepthLabel: string;
  gwetTopFrac: number | null;
  gwetRootFrac: number | null;
  observationDate: string | null;
  observations: ObservationEnvelope<unknown>[];
  sourceUrl: string;
  error?: string;
}

const EraSoilSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    soil_moisture_0_to_7cm: z.array(z.number().nullable()).optional(),
    soil_moisture_7_to_28cm: z.array(z.number().nullable()).optional(),
    soil_moisture_28_to_100cm: z.array(z.number().nullable()).optional(),
  }),
});

function avgClean(arr: Array<number | null | undefined> | undefined): number | null {
  if (!arr) return null;
  const nums = arr.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export async function fetchSoilMoistureWithFallback(opts: {
  lat: number;
  lon: number;
  powerHistoryDays?: HistoricalClimateDay[];
}): Promise<SoilMoistureResult> {
  const { lat, lon, powerHistoryDays = [] } = opts;

  // Report NASA SMAP L4 truthfully: unless NASA_EARTHDATA_TOKEN exists, SMAP L4 is unavailable -> route to ERA5-Land + POWER wetness
  const hasEarthdataToken = Boolean(process.env.NASA_EARTHDATA_TOKEN);
  if (!hasEarthdataToken) {
    updateProviderRuntime('nasa_smap_l4', {
      ok: false,
      error: 'NASA Earthdata credentials not configured (NASA_EARTHDATA_TOKEN missing). Using ERA5-Land 9–11 km & NASA POWER wetness fallback.',
      stateOverride: 'unavailable',
    });
  }

  const endDate = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);

  const cacheKey = buildProviderCacheKey({
    providerId: 'soil_moisture_ladder',
    productId: 'era5_soil_water_power_gwet',
    variable: 'vwc_root_surface',
    cellOrGeomKey: `${lat.toFixed(2)},${lon.toFixed(2)}`,
    timeWindow: `${startDate}_${endDate}`,
    version: 'v1',
  });
  const cached = getProviderCached<SoilMoistureResult>(cacheKey);
  if (cached) return cached.value;

  const latestPower = [...powerHistoryDays].reverse().find((d) => d.gwetTopFrac !== null || d.gwetRootFrac !== null);
  const gwetTop = latestPower?.gwetTopFrac ?? null;
  const gwetRoot = latestPower?.gwetRootFrac ?? null;

  // 1. Open-Meteo ERA5-Land Soil Moisture (m^3/m^3 at 0-7cm, 7-28cm, 28-100cm)
  const eraUrl =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,soil_moisture_28_to_100cm&timezone=UTC`;

  const eraRes = await fetchWithResilience({
    providerId: 'open_meteo_era5_soil',
    url: eraUrl,
    timeoutMs: 8500,
    maxRetries: 1,
  });

  if (eraRes.ok) {
    try {
      const json = await eraRes.response.json();
      const parsed = EraSoilSchema.safeParse(json);
      if (parsed.success) {
        const tail = parsed.data.hourly.time.length;
        const sliceStart = Math.max(0, tail - 24);
        const sm07 = avgClean(parsed.data.hourly.soil_moisture_0_to_7cm?.slice(sliceStart));
        const sm728 = avgClean(parsed.data.hourly.soil_moisture_7_to_28cm?.slice(sliceStart));
        const sm28100 = avgClean(parsed.data.hourly.soil_moisture_28_to_100cm?.slice(sliceStart));

        const rootVwc =
          sm728 !== null && sm28100 !== null
            ? (sm728 * 0.45 + sm28100 * 0.55)
            : sm728 ?? sm28100;

        if (sm07 !== null || rootVwc !== null) {
          const nowIso = new Date().toISOString();
          const obsDate = parsed.data.hourly.time[tail - 1]?.slice(0, 10) ?? endDate;
          const result: SoilMoistureResult = {
            providerId: 'open_meteo_era5_soil',
            providerName: 'Open-Meteo ERA5-Land Soil Water Grid (Modelled Reanalysis)',
            productId: 'ERA5-Land Volumetric Soil Water',
            fallbackUsed:
              'NASA SMAP L4 (9 km) requires Earthdata credentials; using Open-Meteo ERA5-Land (~9–11 km) volumetric water content (clearly distinct from SMAP L4).',
            retrievedAt: nowIso,
            spatialResolutionM: 11000,
            spatialLabel: '~9–11 km ERA5-Land grid cell (regional context; cannot separate adjacent small fields)',
            surfaceMoisturePct: sm07 !== null ? Number((sm07 * 100).toFixed(1)) : null,
            surfaceDepthLabel: '0–7 cm (ERA5-Land VWC)',
            rootZoneMoisturePct: rootVwc !== null ? Number((rootVwc * 100).toFixed(1)) : null,
            rootZoneDepthLabel: '7–100 cm weighted profile (ERA5-Land VWC)',
            gwetTopFrac: gwetTop,
            gwetRootFrac: gwetRoot,
            observationDate: obsDate,
            sourceUrl: 'https://open-meteo.com/en/docs/historical-weather-api',
            observations: [
              {
                observationId: `obs-era5sm-${eraRes.correlationId}`,
                providerId: 'open_meteo_era5_soil',
                productId: 'era5-land-soil-moisture',
                variable: 'soil_water_vwc_profile',
                value: rootVwc !== null ? Number((rootVwc * 100).toFixed(1)) : 0,
                unit: '% volumetric',
                evidenceType: 'reanalysis',
                observedAt: obsDate,
                retrievedAt: nowIso,
                spatialResolution: 11000,
                qualityFlags: ['coarse_context', 'smap_l4_fallback'],
                sourceUrl: eraUrl,
                rawRecordRef: `era5sm:${eraRes.correlationId}`,
                status: 'valid',
              },
            ],
          };
          setProviderCached(cacheKey, result, 3 * 60 * 60 * 1000);
          return result;
        }
      }
    } catch {
      // Fall through to NASA POWER wetness
    }
  }

  // 2. Fallback: NASA POWER MERRA-2 Wetness fraction (GWETTOP / GWETROOT)
  if (gwetTop !== null || gwetRoot !== null) {
    const nowIso = new Date().toISOString();
    const result: SoilMoistureResult = {
      providerId: 'nasa_power_gwet',
      providerName: 'NASA POWER Surface/Root-Zone Soil Wetness (MERRA-2)',
      productId: 'GWETTOP / GWETROOT (0–1 wetness fraction)',
      fallbackUsed: 'SMAP L4 & ERA5-Land unavailable -> using NASA POWER MERRA-2 wetness index (0.5° grid).',
      retrievedAt: nowIso,
      spatialResolutionM: 55000,
      spatialLabel: '0.5° × 0.5° (~55 km) MERRA-2 modelled wetness index (not volumetric SMAP VWC)',
      surfaceMoisturePct: gwetTop !== null ? Number((gwetTop * 100).toFixed(1)) : null,
      surfaceDepthLabel: '0–5 cm GWETTOP relative wetness index (%)',
      rootZoneMoisturePct: gwetRoot !== null ? Number((gwetRoot * 100).toFixed(1)) : null,
      rootZoneDepthLabel: '0–100 cm GWETROOT relative wetness index (%)',
      gwetTopFrac: gwetTop,
      gwetRootFrac: gwetRoot,
      observationDate: latestPower?.date ?? null,
      sourceUrl: 'https://power.larc.nasa.gov/docs/methodology/land/',
      observations: [],
    };
    setProviderCached(cacheKey, result, 3 * 60 * 60 * 1000);
    return result;
  }

  return {
    providerId: 'soil_moisture_unavailable',
    providerName: 'Gridded Soil Moisture Unavailable',
    productId: 'none',
    fallbackUsed: null,
    retrievedAt: new Date().toISOString(),
    spatialResolutionM: 0,
    spatialLabel: 'Unavailable',
    surfaceMoisturePct: null,
    surfaceDepthLabel: 'Unavailable',
    rootZoneMoisturePct: null,
    rootZoneDepthLabel: 'Unavailable',
    gwetTopFrac: null,
    gwetRootFrac: null,
    observationDate: null,
    sourceUrl: eraUrl,
    observations: [],
    error: 'SMAP L4 unauthenticated and ERA5-Land / POWER wetness failed.',
  };
}
