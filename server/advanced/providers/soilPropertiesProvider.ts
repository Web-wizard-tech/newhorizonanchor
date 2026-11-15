import { fromArrayBuffer } from 'geotiff';
import {
  buildProviderCacheKey,
  fetchWithResilience,
  getProviderCached,
  setProviderCached,
  updateProviderRuntime,
} from './httpClient';
import { ObservationEnvelope } from '../../../src/types/advanced';
import { classifyUsdaTexture, SOC_TO_SOM_FACTOR } from '../engine/soilEngine';

export interface MappedSoilPropertySet {
  providerId: string;
  providerName: string;
  productId: string;
  spatialResolutionM: number;
  spatialLabel: string;
  depthInterval: string;
  phValue: number | null;
  sandPct: number | null;
  siltPct: number | null;
  clayPct: number | null;
  textureClassUsda: string;
  socGKg: number | null;
  somDerivedPct: number | null;
  bulkDensityKgDm3: number | null;
  cecCmolKg: number | null;
  awcMmPerM: number | null;
  drainageInferred: string | null;
  mapUnitName?: string;
  uncertaintyNote: string;
  retrievedAt: string;
  sourceUrl: string;
  observations: ObservationEnvelope<unknown>[];
  fallbackUsed: string | null;
  error?: string;
}

async function fetchSoilGridsWcsLayer(opts: {
  mapName: string;
  coverageId: string;
  lat: number;
  lon: number;
}): Promise<number | null> {
  const { mapName, coverageId, lat, lon } = opts;
  const d = 0.0025; // ~250 m SoilGrids pixel radius
  const url =
    `https://maps.isric.org/mapserv?map=/map/${encodeURIComponent(mapName)}.map` +
    `&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=${encodeURIComponent(coverageId)}` +
    `&FORMAT=GEOTIFF_INT16` +
    `&SUBSET=Long(${(lon - d).toFixed(5)},${(lon + d).toFixed(5)})` +
    `&SUBSET=Lat(${(lat - d).toFixed(5)},${(lat + d).toFixed(5)})` +
    `&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326`;

  const res = await fetchWithResilience({
    providerId: 'isric_soilgrids_wcs',
    url,
    timeoutMs: 9000,
    maxRetries: 1,
  });
  if (!res.ok) return null;

  try {
    const ct = res.response.headers.get('content-type') || '';
    if (!ct.includes('tiff') && !ct.includes('octet-stream')) return null;
    const buf = await res.response.arrayBuffer();
    if (buf.byteLength < 64) return null;
    const tiff = await fromArrayBuffer(buf);
    const img = await tiff.getImage();
    const rasters = await img.readRasters();
    const band = rasters[0] as ArrayLike<number> | undefined;
    if (!band || band.length === 0) return null;
    const noData = img.getGDALNoData();
    const valid: number[] = [];
    for (let i = 0; i < band.length; i++) {
      const v = Number(band[i]);
      if (Number.isFinite(v) && v !== -32768 && v !== 0 && (noData === null || v !== noData)) {
        valid.push(v);
      }
    }
    if (valid.length === 0) return null;
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    return mean;
  } catch {
    return null;
  }
}

async function queryUsdaSdaSoil(lat: number, lon: number): Promise<MappedSoilPropertySet | null> {
  const sql = `SELECT TOP 3 mu.mukey, mu.muname, c.compname, c.comppct_r, ch.sandtotal_r, ch.silttotal_r, ch.claytotal_r, ch.om_r, ch.ph1to1h2o_r, ch.awc_r, ch.cec7_r, ch.dbthirdbar_r, c.drainagecl FROM mapunit mu INNER JOIN component c ON c.mukey = mu.mukey INNER JOIN chorizon ch ON ch.cokey = c.cokey WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lon.toFixed(5)} ${lat.toFixed(5)})')) AND ch.hzdept_r <= 20 AND ch.hzdepb_r >= 5 ORDER BY c.comppct_r DESC, ch.hzdept_r ASC`;

  const url = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
  const res = await fetchWithResilience({
    providerId: 'usda_nrcs_sda',
    url,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, format: 'JSON+COLUMNNAME' }),
    },
    timeoutMs: 8500,
    maxRetries: 1,
  });
  if (!res.ok) return null;

  try {
    const json = (await res.response.json()) as { Table?: string[][] };
    const rows = json.Table;
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const header = rows[0];
    const row = rows[1];
    const col = (name: string): string | null => {
      const idx = header.indexOf(name);
      return idx >= 0 && row[idx] !== undefined && row[idx] !== null ? String(row[idx]) : null;
    };
    const numCol = (name: string): number | null => {
      const raw = col(name);
      if (!raw || raw.trim() === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

    const sand = numCol('sandtotal_r');
    const silt = numCol('silttotal_r');
    const clay = numCol('claytotal_r');
    const omPct = numCol('om_r');
    const ph = numCol('ph1to1h2o_r');
    const awcFrac = numCol('awc_r'); // cm/cm (same numerically as m/m * 1000 = mm/m)
    const cec = numCol('cec7_r');
    const bd = numCol('dbthirdbar_r');
    const drainage = col('drainagecl');
    const muname = col('muname') || 'SSURGO Soil Map Unit';

    const tex = classifyUsdaTexture(sand, silt, clay);
    const nowIso = new Date().toISOString();

    return {
      providerId: 'usda_nrcs_sda',
      providerName: 'USDA NRCS Soil Data Access (SSURGO)',
      productId: `SSURGO MapUnit ${col('mukey') || ''}`.trim(),
      spatialResolutionM: 30,
      spatialLabel: 'USDA SSURGO detailed soil survey polygon (~10–30 m map unit scale; lab cores still recommended per block)',
      depthInterval: '0–20 cm surface horizon',
      phValue: ph !== null ? Number(ph.toFixed(1)) : null,
      sandPct: tex.sandPct,
      siltPct: tex.siltPct,
      clayPct: tex.clayPct,
      textureClassUsda: tex.valid ? tex.textureClass : 'Unknown',
      socGKg: omPct !== null ? Number(((omPct / SOC_TO_SOM_FACTOR) * 10).toFixed(1)) : null,
      somDerivedPct: omPct !== null ? Number(omPct.toFixed(1)) : null,
      bulkDensityKgDm3: bd !== null ? Number(bd.toFixed(2)) : null,
      cecCmolKg: cec !== null ? Number(cec.toFixed(1)) : null,
      awcMmPerM: awcFrac !== null ? Math.round(awcFrac * 1000) : null,
      drainageInferred: drainage,
      mapUnitName: muname,
      uncertaintyNote: 'Official USDA NRCS Soil Survey (SSURGO) dominant component horizon; spatially representative at parcel map-unit scale, not a substitute for recent agronomic NPK/pH testing.',
      retrievedAt: nowIso,
      sourceUrl: url,
      fallbackUsed: null,
      observations: [
        {
          observationId: `obs-usda-${res.correlationId}`,
          providerId: 'usda_nrcs_sda',
          productId: 'ssurgo-tabular',
          variable: 'soil_survey_horizon',
          value: ph ?? 0,
          unit: 'pH / % fractions',
          evidenceType: 'modelled',
          retrievedAt: nowIso,
          spatialResolution: 30,
          qualityFlags: ['national_soil_survey', 'horizon_0_20cm'],
          sourceUrl: url,
          rawRecordRef: `sda:${res.correlationId}`,
          status: 'valid',
        },
      ],
    };
  } catch {
    return null;
  }
}

export async function fetchSoilPropertiesWithFallback(opts: {
  lat: number;
  lon: number;
}): Promise<MappedSoilPropertySet> {
  const { lat, lon } = opts;
  const cacheKey = buildProviderCacheKey({
    providerId: 'soil_properties_ladder',
    productId: 'usda_ssurgo_soilgrids_wcs',
    variable: 'soil_horizon_0_20',
    cellOrGeomKey: `${lat.toFixed(4)},${lon.toFixed(4)}`,
    timeWindow: 'static_soil',
    version: 'v1',
  });
  const cached = getProviderCached<MappedSoilPropertySet>(cacheKey);
  if (cached) return cached.value;

  // Reflect ISRIC REST upstream pause status explicitly without wasting 9s on each analysis
  updateProviderRuntime('isric_soilgrids_rest', {
    ok: false,
    error: 'ISRIC SoilGrids v2 REST API paused upstream; routing via SoilGrids WCS & National Soil Survey.',
    stateOverride: 'unavailable',
  });

  // 1. Try USDA NRCS Soil Data Access (for US farms; empty table quickly outside US)
  const usda = await queryUsdaSdaSoil(lat, lon);
  if (usda) {
    setProviderCached(cacheKey, usda, 7 * 24 * 60 * 60 * 1000);
    return usda;
  }

  // 2. Global primary SoilGrids WCS (GeoTIFF 250m)
  const [phRaw, sandRaw, siltRaw, clayRaw, socRaw, bdRaw, cecRaw] = await Promise.all([
    fetchSoilGridsWcsLayer({ mapName: 'phh2o', coverageId: 'phh2o_0-5cm_mean', lat, lon }),
    fetchSoilGridsWcsLayer({ mapName: 'sand', coverageId: 'sand_0-5cm_mean', lat, lon }),
    fetchSoilGridsWcsLayer({ mapName: 'silt', coverageId: 'silt_0-5cm_mean', lat, lon }),
    fetchSoilGridsWcsLayer({ mapName: 'clay', coverageId: 'clay_0-5cm_mean', lat, lon }),
    fetchSoilGridsWcsLayer({ mapName: 'soc', coverageId: 'soc_0-5cm_mean', lat, lon }),
    fetchSoilGridsWcsLayer({ mapName: 'bdod', coverageId: 'bdod_0-5cm_mean', lat, lon }),
    fetchSoilGridsWcsLayer({ mapName: 'cec', coverageId: 'cec_0-5cm_mean', lat, lon }),
  ]);

  if (phRaw !== null || sandRaw !== null || clayRaw !== null) {
    // Explicit ISRIC SoilGrids unit conversion factors:
    // phh2o: pH*10 -> pH (/10); sand/silt/clay: g/kg -> % (/10); soc: dg/kg -> g/kg (/10); bdod: cg/cm^3 -> kg/dm^3 (/100); cec: mmol(c)/kg -> cmol(c)/kg (/10)
    const phVal = phRaw !== null ? Number((phRaw / 10).toFixed(1)) : null;
    const sandPct = sandRaw !== null ? Number((sandRaw / 10).toFixed(1)) : null;
    const siltPct = siltRaw !== null ? Number((siltRaw / 10).toFixed(1)) : null;
    const clayPct = clayRaw !== null ? Number((clayRaw / 10).toFixed(1)) : null;
    const socGKg = socRaw !== null ? Number((socRaw / 10).toFixed(1)) : null;
    const somDerivedPct =
      socGKg !== null ? Number(((socGKg / 10) * SOC_TO_SOM_FACTOR).toFixed(2)) : null;
    const bd = bdRaw !== null ? Number((bdRaw / 100).toFixed(2)) : null;
    const cec = cecRaw !== null ? Number((cecRaw / 10).toFixed(1)) : null;

    const tex = classifyUsdaTexture(sandPct, siltPct, clayPct);
    const nowIso = new Date().toISOString();

    const result: MappedSoilPropertySet = {
      providerId: 'isric_soilgrids_wcs',
      providerName: 'ISRIC SoilGrids 2.0 (WCS 250m GeoTIFF)',
      productId: 'SoilGrids v2.0 0–5 cm Mean',
      spatialResolutionM: 250,
      spatialLabel: '250 m global gridded machine-learning prediction (not a laboratory test)',
      depthInterval: '0–5 cm topsoil',
      phValue: phVal,
      sandPct: tex.sandPct ?? sandPct,
      siltPct: tex.siltPct ?? siltPct,
      clayPct: tex.clayPct ?? clayPct,
      textureClassUsda: tex.valid ? tex.textureClass : 'Unknown',
      socGKg,
      somDerivedPct,
      bulkDensityKgDm3: bd,
      cecCmolKg: cec,
      awcMmPerM: null,
      drainageInferred: null,
      uncertaintyNote:
        somDerivedPct !== null
          ? `250 m digital soil prediction. SOM derived from SOC via Van Bemmelen factor (${SOC_TO_SOM_FACTOR}); never overrides farmer lab results.`
          : '250 m digital soil prediction; treat as baseline estimate until laboratory cores are uploaded.',
      retrievedAt: nowIso,
      sourceUrl: 'https://docs.isric.org/globaldata/soilgrids/',
      fallbackUsed: 'ISRIC REST API paused upstream -> used ISRIC SoilGrids WCS 2.0.1 GeoTIFF retrieval.',
      observations: [
        {
          observationId: `obs-sg-wcs-${Date.now()}`,
          providerId: 'isric_soilgrids_wcs',
          productId: 'soilgrids-v2-wcs-0-5cm',
          variable: 'soil_mapped_grid',
          value: phVal ?? 0,
          unit: 'mapped soil properties',
          evidenceType: 'modelled',
          retrievedAt: nowIso,
          spatialResolution: 250,
          qualityFlags: ['mapped_grid_prediction', 'depth_0_5cm'],
          sourceUrl: 'https://maps.isric.org/',
          rawRecordRef: `sgwcs:${lat.toFixed(4)},${lon.toFixed(4)}`,
          status: 'valid',
        },
      ],
    };
    setProviderCached(cacheKey, result, 7 * 24 * 60 * 60 * 1000);
    return result;
  }

  return {
    providerId: 'soil_properties_unavailable',
    providerName: 'Gridded Soil Providers Unavailable',
    productId: 'none',
    spatialResolutionM: 0,
    spatialLabel: 'Unavailable',
    depthInterval: '0–20 cm',
    phValue: null,
    sandPct: null,
    siltPct: null,
    clayPct: null,
    textureClassUsda: 'Unknown',
    socGKg: null,
    somDerivedPct: null,
    bulkDensityKgDm3: null,
    cecCmolKg: null,
    awcMmPerM: null,
    drainageInferred: null,
    uncertaintyNote: 'Both national survey (USDA SDA) and ISRIC SoilGrids WCS were unreachable; farmer lab records remain untouched.',
    retrievedAt: new Date().toISOString(),
    sourceUrl: 'https://isric.org/explore/soilgrids',
    fallbackUsed: null,
    observations: [],
    error: 'SoilGrids WCS and USDA SDA failed to return valid pixel coverage.',
  };
}
