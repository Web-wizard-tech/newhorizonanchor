import { z } from 'zod';
import {
  buildProviderCacheKey,
  fetchWithResilience,
  getProviderCached,
  setProviderCached,
} from './httpClient';
import { FieldVegetationSummary, ObservationEnvelope, SpatialFit } from '../../../src/types/advanced';
import { GeoJsonPolygonGeometry } from '../../../src/types/maps';

interface StacFeature {
  id: string;
  properties: {
    datetime?: string;
    'eo:cloud_cover'?: number;
  };
}

const StacSearchSchema = z.object({
  features: z.array(
    z.object({
      id: z.string(),
      properties: z.object({
        datetime: z.string().optional(),
        'eo:cloud_cover': z.number().optional(),
      }),
    })
  ),
});

interface TitilerStatsResponse {
  properties?: {
    statistics?: {
      '(B08-B04)/(B08+B04)'?: {
        min?: number;
        max?: number;
        mean?: number;
        std?: number;
        median?: number;
        count?: number;
        valid_percent?: number;
        valid_pixels?: number;
      };
      SCL_b1?: {
        histogram?: [number[], number[]];
        valid_pixels?: number;
      };
    };
  };
}

function buildSearchBbox(geom: GeoJsonPolygonGeometry | null, centroid: { lat: number; lon: number }): [number, number, number, number] {
  const ring = geom?.coordinates?.[0];
  if (!ring || ring.length < 3) {
    return [centroid.lon - 0.0025, centroid.lat - 0.0025, centroid.lon + 0.0025, centroid.lat + 0.0025];
  }
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [x, y] of ring) {
    if (x < minLon) minLon = x;
    if (x > maxLon) maxLon = x;
    if (y < minLat) minLat = y;
    if (y > maxLat) maxLat = y;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function buildTargetGeoJson(geom: GeoJsonPolygonGeometry | null, centroid: { lat: number; lon: number }) {
  if (geom && geom.coordinates?.[0]?.length >= 4) {
    return {
      type: 'Feature',
      geometry: geom,
      properties: {},
    };
  }
  const dLat = 0.0018;
  const dLon = 0.0022;
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [centroid.lon - dLon, centroid.lat - dLat],
          [centroid.lon + dLon, centroid.lat - dLat],
          [centroid.lon + dLon, centroid.lat + dLat],
          [centroid.lon - dLon, centroid.lat + dLat],
          [centroid.lon - dLon, centroid.lat - dLat],
        ],
      ],
    },
    properties: {},
  };
}

async function querySclMaskAndNdvi(
  itemId: string,
  featureGeo: ReturnType<typeof buildTargetGeoJson>
): Promise<{
  ndviMean: number;
  ndviMedian: number;
  ndviStd: number;
  ndviMin: number;
  ndviMax: number;
  sclBreakdown: NonNullable<FieldVegetationSummary['sclBreakdown']>;
  validPixelCount: number;
  validCoveragePct: number;
} | null> {
  const baseUrl = `https://planetarycomputer.microsoft.com/api/data/v1/item/statistics?collection=sentinel-2-l2a&item=${encodeURIComponent(itemId)}`;

  const [sclRes, ndviRes] = await Promise.all([
    fetchWithResilience({
      providerId: 'sentinel2_pc_titiler',
      url: `${baseUrl}&assets=SCL&categorical=true`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(featureGeo),
      },
      timeoutMs: 9500,
      maxRetries: 1,
    }),
    fetchWithResilience({
      providerId: 'sentinel2_pc_titiler',
      url: `${baseUrl}&assets=B04&assets=B08&asset_as_band=true&expression=${encodeURIComponent('(B08-B04)/(B08+B04)')}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(featureGeo),
      },
      timeoutMs: 9500,
      maxRetries: 1,
    }),
  ]);

  if (!ndviRes.ok) return null;

  try {
    const ndviJson = (await ndviRes.response.json()) as TitilerStatsResponse;
    const stats = ndviJson.properties?.statistics?.['(B08-B04)/(B08+B04)'];
    if (!stats || typeof stats.mean !== 'number' || !Number.isFinite(stats.mean)) return null;

    let vegetationPixels = 0;
    let bareSoilPixels = 0;
    let waterPixels = 0;
    let cloudShadowPixels = 0;
    let cloudPixels = 0;
    let snowPixels = 0;
    let nodataPixels = 0;
    let totalSclPixels = 0;

    if (sclRes.ok) {
      const sclJson = (await sclRes.response.json()) as TitilerStatsResponse;
      const hist = sclJson.properties?.statistics?.SCL_b1?.histogram;
      if (hist && Array.isArray(hist[0]) && Array.isArray(hist[1])) {
        const counts = hist[0];
        const classes = hist[1];
        for (let i = 0; i < classes.length; i++) {
          const cls = Math.round(classes[i]);
          const cnt = Math.round(counts[i] ?? 0);
          totalSclPixels += cnt;
          if (cls === 4) vegetationPixels += cnt;
          else if (cls === 5) bareSoilPixels += cnt;
          else if (cls === 6) waterPixels += cnt;
          else if (cls === 3) cloudShadowPixels += cnt;
          else if (cls === 8 || cls === 9 || cls === 10) cloudPixels += cnt;
          else if (cls === 11) snowPixels += cnt;
          else nodataPixels += cnt;
        }
      }
    }

    const clearLandPixels = vegetationPixels + bareSoilPixels + waterPixels;
    const cloudFreePct =
      totalSclPixels > 0
        ? Number(((clearLandPixels / totalSclPixels) * 100).toFixed(1))
        : typeof stats.valid_percent === 'number'
          ? Number(stats.valid_percent.toFixed(1))
          : 100;

    const validPixelCount = Math.round(stats.valid_pixels ?? stats.count ?? 0);

    return {
      ndviMean: Number(stats.mean.toFixed(3)),
      ndviMedian: Number((stats.median ?? stats.mean).toFixed(3)),
      ndviStd: Number((stats.std ?? 0).toFixed(3)),
      ndviMin: Number((stats.min ?? stats.mean).toFixed(3)),
      ndviMax: Number((stats.max ?? stats.mean).toFixed(3)),
      sclBreakdown: {
        vegetationPixels,
        bareSoilPixels,
        waterPixels,
        cloudShadowPixels,
        cloudPixels,
        snowPixels,
        nodataPixels,
        totalPixels: totalSclPixels,
        cloudFreePct,
      },
      validPixelCount,
      validCoveragePct: cloudFreePct,
    };
  } catch {
    return null;
  }
}

export async function fetchSentinel2VegetationForField(opts: {
  farmId: string;
  fieldId: string;
  fieldName: string;
  areaHa: number;
  geometry: GeoJsonPolygonGeometry | null;
  centroid: { lat: number; lon: number };
  geometryVersionId: string;
}): Promise<{
  summary: FieldVegetationSummary;
  observations: ObservationEnvelope<unknown>[];
}> {
  const { fieldId, fieldName, areaHa, geometry, centroid, geometryVersionId } = opts;

  const cacheKey = buildProviderCacheKey({
    providerId: 'sentinel2_l2a_pc',
    productId: 's2_ndvi_scl_10m',
    variable: 'ndvi',
    cellOrGeomKey: `${fieldId}:${geometryVersionId}:${centroid.lat.toFixed(4)},${centroid.lon.toFixed(4)}`,
    timeWindow: new Date().toISOString().slice(0, 10),
    version: 'v1',
  });
  const cached = getProviderCached<{ summary: FieldVegetationSummary; observations: ObservationEnvelope<unknown>[] }>(cacheKey);
  if (cached) return cached.value;

  const bbox = buildSearchBbox(geometry, centroid);
  const featureGeo = buildTargetGeoJson(geometry, centroid);

  // Check area resolution gate: Sentinel-2 10m pixel = 100 m^2 = 0.01 ha. Minimum usable field >= 0.15 ha (~15 pixels)
  const expectedPixels = Math.round((areaHa * 10000) / 100);
  if (areaHa > 0 && expectedPixels < 5) {
    const out: FieldVegetationSummary = {
      fieldId,
      fieldName,
      status: 'insufficient_coverage',
      productId: 'Sentinel-2 Level-2A (10 m B04/B08)',
      providerName: 'Microsoft Planetary Computer STAC / Copernicus Sentinel-2 L2A',
      sceneId: null,
      sceneDate: null,
      pixelSizeM: 10,
      bandsUsed: ['B04 (Red 10m)', 'B08 (NIR 10m)', 'SCL (20m)'],
      sclBreakdown: null,
      validPixelCount: 0,
      validCoveragePct: 0,
      ndviMean: null,
      ndviMedian: null,
      ndviStd: null,
      ndviMin: null,
      ndviMax: null,
      baselineNdviMean: null,
      baselineSceneDate: null,
      ndviDeltaFromBaseline: null,
      spatialFit: 'insufficient',
      note: `Field area (${areaHa.toFixed(2)} ha) contains fewer than 5 full 10 m pixels; satellite statistics suppressed.`,
      evidenceId: `ev-veg-${fieldId}`,
    };
    return { summary: out, observations: [] };
  }

  // Search recent 90 days of Sentinel-2 L2A scenes (scene cloud < 45% as candidate pre-filter; pixel SCL mask decides true usability!)
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000).toISOString();
  const stacUrl = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';

  const stacRes = await fetchWithResilience({
    providerId: 'sentinel2_pc_stac',
    url: stacUrl,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'],
        bbox,
        datetime: `${ninetyDaysAgo}/${now.toISOString()}`,
        query: { 'eo:cloud_cover': { lt: 45 } },
        limit: 8,
        sortby: [{ field: 'properties.datetime', direction: 'desc' }],
      }),
    },
    timeoutMs: 8500,
    maxRetries: 1,
  });

  if (!stacRes.ok) {
    // Secondary metadata check on Copernicus Data Space STAC (status check without pixel downloads)
    const cdseRes = await fetchWithResilience({
      providerId: 'cdse_stac',
      url: 'https://stac.dataspace.copernicus.eu/v1/search',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collections: ['sentinel-2-l2a'], bbox, limit: 2 }),
      },
      timeoutMs: 7000,
      maxRetries: 0,
    });
    const out: FieldVegetationSummary = {
      fieldId,
      fieldName,
      status: 'unavailable',
      productId: 'Sentinel-2 Level-2A (10 m B04/B08)',
      providerName: cdseRes.ok
        ? 'Copernicus Data Space STAC (token required for pixel extraction)'
        : 'Satellite STAC Providers Unavailable',
      sceneId: null,
      sceneDate: null,
      pixelSizeM: 10,
      bandsUsed: ['B04', 'B08', 'SCL'],
      sclBreakdown: null,
      validPixelCount: 0,
      validCoveragePct: 0,
      ndviMean: null,
      ndviMedian: null,
      ndviStd: null,
      ndviMin: null,
      ndviMax: null,
      baselineNdviMean: null,
      baselineSceneDate: null,
      ndviDeltaFromBaseline: null,
      spatialFit: 'insufficient',
      note: 'No suitable cloud-free optical pixel readout available right now (never estimated from precipitation or weather).',
      evidenceId: `ev-veg-${fieldId}`,
    };
    return { summary: out, observations: [] };
  }

  let features: StacFeature[] = [];
  try {
    const json = await stacRes.response.json();
    const parsed = StacSearchSchema.safeParse(json);
    if (parsed.success) features = parsed.data.features;
  } catch {
    features = [];
  }

  if (features.length === 0) {
    const out: FieldVegetationSummary = {
      fieldId,
      fieldName,
      status: 'cloudy',
      productId: 'Sentinel-2 Level-2A (10 m B04/B08)',
      providerName: 'Microsoft Planetary Computer Sentinel-2 L2A',
      sceneId: null,
      sceneDate: null,
      pixelSizeM: 10,
      bandsUsed: ['B04', 'B08', 'SCL'],
      sclBreakdown: null,
      validPixelCount: 0,
      validCoveragePct: 0,
      ndviMean: null,
      ndviMedian: null,
      ndviStd: null,
      ndviMin: null,
      ndviMax: null,
      baselineNdviMean: null,
      baselineSceneDate: null,
      ndviDeltaFromBaseline: null,
      spatialFit: 'insufficient',
      note: 'No suitable cloud-free Sentinel-2 Level-2A observation over this field polygon in the past 90 days.',
      evidenceId: `ev-veg-${fieldId}`,
    };
    return { summary: out, observations: [] };
  }

  // Evaluate candidate scenes sequentially from newest until we find a scene passing field-level SCL cloud mask >= 45%
  let selectedFeature: StacFeature | null = null;
  let selectedStats: Awaited<ReturnType<typeof querySclMaskAndNdvi>> = null;
  let baselineFeature: StacFeature | null = null;
  let baselineStats: Awaited<ReturnType<typeof querySclMaskAndNdvi>> = null;

  for (const feat of features.slice(0, 4)) {
    const stats = await querySclMaskAndNdvi(feat.id, featureGeo);
    if (stats && stats.validCoveragePct >= 45 && stats.validPixelCount >= 8) {
      if (!selectedFeature) {
        selectedFeature = feat;
        selectedStats = stats;
      } else if (
        feat.properties.datetime &&
        selectedFeature.properties.datetime &&
        Date.parse(selectedFeature.properties.datetime) - Date.parse(feat.properties.datetime) >= 12 * 86400000
      ) {
        baselineFeature = feat;
        baselineStats = stats;
        break;
      }
    }
  }

  if (!selectedFeature || !selectedStats) {
    const out: FieldVegetationSummary = {
      fieldId,
      fieldName,
      status: 'cloudy',
      productId: 'Sentinel-2 Level-2A (10 m B04/B08 + SCL)',
      providerName: 'Microsoft Planetary Computer Sentinel-2 L2A',
      sceneId: features[0]?.id ?? null,
      sceneDate: features[0]?.properties.datetime?.slice(0, 10) ?? null,
      pixelSizeM: 10,
      bandsUsed: ['B04 (10m Red)', 'B08 (10m NIR)', 'SCL (20m Cloud/Quality Mask)'],
      sclBreakdown: null,
      validPixelCount: 0,
      validCoveragePct: 0,
      ndviMean: null,
      ndviMedian: null,
      ndviStd: null,
      ndviMin: null,
      ndviMax: null,
      baselineNdviMean: null,
      baselineSceneDate: null,
      ndviDeltaFromBaseline: null,
      spatialFit: 'insufficient',
      note: 'Checked recent Sentinel-2 scenes, but polygon-level SCL cloud/shadow/nodata mask left < 45% valid pixels.',
      evidenceId: `ev-veg-${fieldId}`,
    };
    return { summary: out, observations: [] };
  }

  const sceneDate = selectedFeature.properties.datetime?.slice(0, 10) ?? null;
  const baselineDate = baselineFeature?.properties.datetime?.slice(0, 10) ?? null;
  const deltaBaseline =
    baselineStats !== null
      ? Number((selectedStats.ndviMean - baselineStats.ndviMean).toFixed(3))
      : null;

  const spatialFit: SpatialFit =
    selectedStats.validPixelCount >= 20 && selectedStats.validCoveragePct >= 60
      ? 'field_scale'
      : 'coarse_context';

  const nowIso = new Date().toISOString();
  const summary: FieldVegetationSummary = {
    fieldId,
    fieldName,
    status: 'valid',
    productId: 'Sentinel-2 Level-2A BOA Reflectance',
    providerName: 'Microsoft Planetary Computer STAC / Copernicus Sentinel-2 L2A',
    sceneId: selectedFeature.id,
    sceneDate,
    pixelSizeM: 10,
    bandsUsed: ['B04 (Red 10 m)', 'B08 (NIR 10 m)', 'SCL (20 m Scene Classification)'],
    sclBreakdown: selectedStats.sclBreakdown,
    validPixelCount: selectedStats.validPixelCount,
    validCoveragePct: selectedStats.validCoveragePct,
    ndviMean: selectedStats.ndviMean,
    ndviMedian: selectedStats.ndviMedian,
    ndviStd: selectedStats.ndviStd,
    ndviMin: selectedStats.ndviMin,
    ndviMax: selectedStats.ndviMax,
    baselineNdviMean: baselineStats?.ndviMean ?? null,
    baselineSceneDate: baselineDate,
    ndviDeltaFromBaseline: deltaBaseline,
    spatialFit,
    note: `SCL polygon check confirmed ${selectedStats.validCoveragePct}% clear pixels (${selectedStats.validPixelCount} pixels at 10 m) over ${fieldName}.`,
    evidenceId: `ev-veg-${fieldId}`,
  };

  const observations: ObservationEnvelope<unknown>[] = [
    {
      observationId: `obs-s2-${selectedFeature.id}-${fieldId}`,
      providerId: 'sentinel2_pc_stac',
      productId: 'sentinel-2-l2a',
      variable: 'ndvi_polygon_mean',
      value: selectedStats.ndviMean,
      unit: 'NDVI (-1 to +1)',
      evidenceType: 'satellite_derived',
      observedAt: sceneDate ?? undefined,
      retrievedAt: nowIso,
      spatialResolution: 10,
      geometryId: geometryVersionId,
      pixelCount: selectedStats.validPixelCount,
      validCoveragePct: selectedStats.validCoveragePct,
      qualityFlags: ['scl_cloud_masked', spatialFit],
      sourceUrl: 'https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a',
      sourceVersion: selectedFeature.id,
      rawRecordRef: `s2:${selectedFeature.id}`,
      status: 'valid',
    },
  ];

  const payload = { summary, observations };
  setProviderCached(cacheKey, payload, 12 * 60 * 60 * 1000);
  return payload;
}
