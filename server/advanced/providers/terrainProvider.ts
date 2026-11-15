import { z } from 'zod';
import {
  buildProviderCacheKey,
  fetchWithResilience,
  getProviderCached,
  setProviderCached,
} from './httpClient';
import { ObservationEnvelope } from '../../../src/types/advanced';

export interface TerrainAnalysisResult {
  providerId: string;
  providerName: string;
  productId: string;
  fallbackUsed: string | null;
  retrievedAt: string;
  elevationM: number | null;
  slopePct: number | null;
  slopeDeg: number | null;
  aspectLabel: string | null;
  spatialResolutionM: number;
  datum: string;
  observations: ObservationEnvelope<unknown>[];
  sourceUrl: string;
  error?: string;
}

const OpenMeteoElevSchema = z.object({
  elevation: z.array(z.number()),
});

const OpenElevationSchema = z.object({
  results: z.array(z.object({ elevation: z.number() })),
});

const DEG_TO_RAD = Math.PI / 180;

function computeFiniteDiffSlope(
  zNorth: number,
  zSouth: number,
  zEast: number,
  zWest: number,
  stepMeters = 94.5
): { slopePct: number; slopeDeg: number; aspectLabel: string } {
  const dzDy = (zNorth - zSouth) / (2 * stepMeters);
  const dzDx = (zEast - zWest) / (2 * stepMeters);
  const grad = Math.sqrt(dzDx * dzDx + dzDy * dzDy);
  const slopePct = Number((grad * 100).toFixed(1));
  const slopeDeg = Number(((Math.atan(grad) * 180) / Math.PI).toFixed(1));

  let aspectLabel = 'Flat (< 0.5%)';
  if (slopePct >= 0.5) {
    // Downslope direction angle clockwise from North
    const azRad = Math.atan2(-dzDx, -dzDy);
    const azDeg = ((azRad * 180) / Math.PI + 360) % 360;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    aspectLabel = `${dirs[Math.round(azDeg / 45) % 8]} (${Math.round(azDeg)}°)`;
  }
  return { slopePct, slopeDeg, aspectLabel };
}

export async function fetchTerrainWithFallback(opts: {
  lat: number;
  lon: number;
}): Promise<TerrainAnalysisResult> {
  const { lat, lon } = opts;
  const cacheKey = buildProviderCacheKey({
    providerId: 'terrain_ladder',
    productId: 'copernicus_dem_srtm',
    variable: 'elevation_slope',
    cellOrGeomKey: `${lat.toFixed(4)},${lon.toFixed(4)}`,
    timeWindow: 'static_dem',
    version: 'v1',
  });
  const cached = getProviderCached<TerrainAnalysisResult>(cacheKey);
  if (cached) return cached.value;

  const dLat = 0.00085; // ~94.5 m
  const dLon = 0.00085 / Math.max(0.2, Math.cos(lat * DEG_TO_RAD));
  const lats = [lat, lat + dLat, lat - dLat, lat, lat];
  const lons = [lon, lon, lon, lon + dLon, lon - dLon];

  // 1. Primary: Open-Meteo Elevation (Copernicus DEM GLO-90/30, EGM2008 vertical datum)
  const omUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lats
    .map((v) => v.toFixed(5))
    .join(',')}&longitude=${lons.map((v) => v.toFixed(5)).join(',')}`;
  const omRes = await fetchWithResilience({
    providerId: 'open_meteo_dem',
    url: omUrl,
    timeoutMs: 6500,
    maxRetries: 2,
  });

  if (omRes.ok) {
    try {
      const json = await omRes.response.json();
      const parsed = OpenMeteoElevSchema.safeParse(json);
      if (parsed.success && parsed.data.elevation.length >= 5) {
        const [zc, zn, zs, ze, zw] = parsed.data.elevation;
        const slope = computeFiniteDiffSlope(zn, zs, ze, zw, 94.5);
        const nowIso = new Date().toISOString();
        const result: TerrainAnalysisResult = {
          providerId: 'open_meteo_dem',
          providerName: 'Open-Meteo Elevation (Copernicus DEM GLO-90)',
          productId: 'Copernicus DEM 90m',
          fallbackUsed: null,
          retrievedAt: nowIso,
          elevationM: Math.round(zc),
          slopePct: slope.slopePct,
          slopeDeg: slope.slopeDeg,
          aspectLabel: slope.aspectLabel,
          spatialResolutionM: 90,
          datum: 'WGS84 / EGM2008 orthometric height',
          sourceUrl: 'https://open-meteo.com/en/docs/elevation-api',
          observations: [
            {
              observationId: `obs-dem-${omRes.correlationId}`,
              providerId: 'open_meteo_dem',
              productId: 'copernicus-dem-90',
              variable: 'elevation_slope',
              value: slope.slopePct,
              unit: '% slope',
              evidenceType: 'satellite_derived',
              observedAt: 'Static DEM Baseline',
              retrievedAt: nowIso,
              spatialResolution: 90,
              qualityFlags: ['finite_difference_5pt'],
              sourceUrl: omUrl,
              rawRecordRef: `dem:${omRes.correlationId}`,
              status: 'valid',
            },
          ],
        };
        setProviderCached(cacheKey, result, 7 * 24 * 60 * 60 * 1000);
        return result;
      }
    } catch {
      // fall through
    }
  }

  // 2. Fallback: Open-Elevation SRTM 90m
  const locs = lats.map((la, i) => `${la.toFixed(5)},${lons[i].toFixed(5)}`).join('|');
  const oeUrl = `https://api.open-elevation.com/api/v1/lookup?locations=${locs}`;
  const oeRes = await fetchWithResilience({
    providerId: 'open_elevation_srtm',
    url: oeUrl,
    timeoutMs: 7000,
    maxRetries: 1,
  });

  if (oeRes.ok) {
    try {
      const json = await oeRes.response.json();
      const parsed = OpenElevationSchema.safeParse(json);
      if (parsed.success && parsed.data.results.length >= 5) {
        const [zc, zn, zs, ze, zw] = parsed.data.results.map((r) => r.elevation);
        const slope = computeFiniteDiffSlope(zn, zs, ze, zw, 94.5);
        const nowIso = new Date().toISOString();
        const result: TerrainAnalysisResult = {
          providerId: 'open_elevation_srtm',
          providerName: 'Open-Elevation (SRTM 90m DEM Fallback)',
          productId: 'SRTM 3-arcsecond',
          fallbackUsed: `Primary Copernicus DEM failed (${omRes.ok ? 'schema' : omRes.error}); switched to Open-Elevation SRTM 90m.`,
          retrievedAt: nowIso,
          elevationM: Math.round(zc),
          slopePct: slope.slopePct,
          slopeDeg: slope.slopeDeg,
          aspectLabel: slope.aspectLabel,
          spatialResolutionM: 90,
          datum: 'WGS84 / EGM96',
          sourceUrl: 'https://open-elevation.com/',
          observations: [
            {
              observationId: `obs-srtm-${oeRes.correlationId}`,
              providerId: 'open_elevation_srtm',
              productId: 'srtm-90m',
              variable: 'elevation_slope',
              value: slope.slopePct,
              unit: '% slope',
              evidenceType: 'satellite_derived',
              observedAt: 'Static DEM Baseline',
              retrievedAt: nowIso,
              spatialResolution: 90,
              qualityFlags: ['fallback_provider', 'finite_difference_5pt'],
              sourceUrl: oeUrl,
              rawRecordRef: `srtm:${oeRes.correlationId}`,
              status: 'valid',
            },
          ],
        };
        setProviderCached(cacheKey, result, 7 * 24 * 60 * 60 * 1000);
        return result;
      }
    } catch {
      // fail
    }
  }

  return {
    providerId: 'terrain_unavailable',
    providerName: 'Terrain DEM Unavailable',
    productId: 'none',
    fallbackUsed: null,
    retrievedAt: new Date().toISOString(),
    elevationM: null,
    slopePct: null,
    slopeDeg: null,
    aspectLabel: null,
    spatialResolutionM: 0,
    datum: 'Unknown',
    sourceUrl: omUrl,
    observations: [],
    error: `Copernicus DEM & Open-Elevation SRTM both unavailable.`,
  };
}
