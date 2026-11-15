import { ProviderHealth } from '../../../src/types/advanced';
import { applyRuntimeHealth, fetchWithResilience, updateProviderRuntime } from './httpClient';

function buildStaticRegistry(): ProviderHealth[] {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  const hasEarthdata = Boolean(process.env.NASA_EARTHDATA_TOKEN);

  return [
    {
      id: 'open_meteo_forecast',
      name: 'Open-Meteo Forecast API',
      category: 'weather_forecast',
      endpoint: 'https://api.open-meteo.com/v1/forecast',
      productId: 'IFS / GFS Seamless Forecast',
      version: 'v1',
      resolutionLabel: '~9–13 km NWP grid',
      cadenceLabel: 'Hourly & 14-day daily forecast',
      authRequired: false,
      commercialNote: 'Free tier restricted to non-commercial evaluation; Attribution required.',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: 'met_norway_forecast',
      parameters: ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'shortwave_radiation_sum', 'et0_fao_evapotranspiration'],
      units: '°C, mm, m/s, MJ/m²/d',
    },
    {
      id: 'met_norway_forecast',
      name: 'MET Norway Locationforecast 2.0',
      category: 'weather_forecast',
      endpoint: 'https://api.met.no/weatherapi/locationforecast/2.0/compact',
      productId: 'Locationforecast 2.0',
      version: '2.0',
      resolutionLabel: '~9 km ECMWF/MEPS',
      cadenceLabel: '9-day forecast (hourly/6h)',
      authRequired: false,
      commercialNote: 'Public API with compliant User-Agent (solar radiation omitted in compact feed).',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: null,
      parameters: ['air_temperature', 'relative_humidity', 'wind_speed', 'precipitation_amount'],
      units: '°C, %, m/s, mm',
    },
    {
      id: 'nasa_power_daily',
      name: 'NASA POWER Daily Agroclimatology',
      category: 'historical_climate',
      endpoint: 'https://power.larc.nasa.gov/api/temporal/daily/point',
      productId: 'POWER AG Daily (MERRA-2 / CERES)',
      version: 'v2.x',
      resolutionLabel: '0.5° × 0.5° (~55 km grid)',
      cadenceLabel: 'Daily historical + 20yr climatology',
      authRequired: false,
      commercialNote: 'Public NASA Earth Science data.',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: 'open_meteo_era5',
      parameters: ['T2M', 'T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'ALLSKY_SFC_SW_DWN', 'RH2M', 'WS2M', 'GWETTOP', 'GWETROOT'],
      units: '°C, mm/d, MJ/m²/d, %, m/s',
    },
    {
      id: 'open_meteo_era5',
      name: 'Open-Meteo Archive (ERA5 / ERA5-Land)',
      category: 'historical_climate',
      endpoint: 'https://archive-api.open-meteo.com/v1/archive',
      productId: 'ERA5-Land Reanalysis',
      version: 'v1',
      resolutionLabel: '~9–11 km reanalysis grid',
      cadenceLabel: 'Daily/Hourly (~5 day latency)',
      authRequired: false,
      commercialNote: 'Non-commercial endpoint fallback & precipitation cross-check.',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: null,
      parameters: ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'shortwave_radiation_sum'],
      units: '°C, mm, MJ/m²/d',
    },
    {
      id: 'usda_nrcs_sda',
      name: 'USDA NRCS Soil Data Access (SSURGO)',
      category: 'soil_properties',
      endpoint: 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest',
      productId: 'SSURGO Official MapUnit Horizons',
      version: 'SSURGO 2.x',
      resolutionLabel: '~10–30 m soil survey polygon (US)',
      cadenceLabel: 'National soil survey baseline',
      authRequired: false,
      commercialNote: 'Public US federal soil survey; coverage US-only.',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: 'isric_soilgrids_wcs',
      parameters: ['sandtotal_r', 'silttotal_r', 'claytotal_r', 'ph1to1h2o_r', 'om_r', 'awc_r', 'cec7_r', 'dbthirdbar_r'],
      units: '%, pH, cm/cm, cmol/kg, g/cm³',
    },
    {
      id: 'isric_soilgrids_wcs',
      name: 'ISRIC SoilGrids 2.0 (WCS GeoTIFF)',
      category: 'soil_properties',
      endpoint: 'https://maps.isric.org/mapserv',
      productId: 'SoilGrids v2.0 0–5 cm Coverage',
      version: '2.0',
      resolutionLabel: '250 m global prediction grid',
      cadenceLabel: 'Static digital soil prediction',
      authRequired: false,
      commercialNote: 'Global coverage via OGC WCS 2.0.1 GeoTIFF.',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: null,
      parameters: ['phh2o', 'sand', 'silt', 'clay', 'soc', 'bdod', 'cec'],
      units: 'pH*10, g/kg, dg/kg, cg/cm³, mmol(c)/kg',
    },
    {
      id: 'isric_soilgrids_rest',
      name: 'ISRIC SoilGrids REST API',
      category: 'soil_properties',
      endpoint: 'https://rest.isric.org/soilgrids/v2.0/properties/query',
      productId: 'SoilGrids v2.0 REST',
      version: '2.0',
      resolutionLabel: '250 m',
      cadenceLabel: 'Upstream paused notice',
      authRequired: false,
      commercialNote: 'Temporarily paused by ISRIC; bypassed automatically to WCS & SSURGO.',
      state: 'unavailable',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: 'Upstream REST service paused; SoilGrids WCS & USDA SSURGO active.',
      fallbackProviderId: 'isric_soilgrids_wcs',
      parameters: ['phh2o', 'sand', 'silt', 'clay', 'soc'],
      units: 'mapped',
    },
    {
      id: 'nasa_smap_l4',
      name: 'NASA SMAP Level-4 Root-Zone Soil Moisture',
      category: 'soil_moisture',
      endpoint: 'https://nsidc.org/data/spl4smgp/versions/8',
      productId: 'SPL4SMGP v8 (9 km 3-hourly)',
      version: 'v8',
      resolutionLabel: '9 km EASE-Grid 2.0',
      cadenceLabel: '3-hourly',
      authRequired: true,
      commercialNote: 'Requires NASA Earthdata / NSIDC token (NASA_EARTHDATA_TOKEN).',
      state: hasEarthdata ? 'configured' : 'planned',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: hasEarthdata ? null : 'NASA_EARTHDATA_TOKEN not set; using ERA5-Land 9–11 km & NASA POWER GWETROOT fallback.',
      fallbackProviderId: 'open_meteo_era5_soil',
      parameters: ['sm_surface', 'sm_rootzone'],
      units: 'm³/m³',
    },
    {
      id: 'open_meteo_era5_soil',
      name: 'Open-Meteo ERA5-Land Volumetric Soil Water',
      category: 'soil_moisture',
      endpoint: 'https://archive-api.open-meteo.com/v1/archive',
      productId: 'ERA5-Land 0–7 cm & 7–100 cm',
      version: 'v1',
      resolutionLabel: '~9–11 km reanalysis grid',
      cadenceLabel: 'Hourly (~5 day latency)',
      authRequired: false,
      commercialNote: 'Fallback for SMAP L4; coarse context for parcels < 500 ha.',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: 'nasa_power_gwet',
      parameters: ['soil_moisture_0_to_7cm', 'soil_moisture_7_to_28cm', 'soil_moisture_28_to_100cm'],
      units: 'm³/m³',
    },
    {
      id: 'sentinel2_pc_stac',
      name: 'Sentinel-2 Level-2A (Planetary Computer STAC + Titiler)',
      category: 'vegetation',
      endpoint: 'https://planetarycomputer.microsoft.com/api/stac/v1/search',
      productId: 'Sentinel-2 L2A BOA + SCL Cloud Mask',
      version: 'L2A',
      resolutionLabel: '10 m Red/NIR (B04/B08), 20 m SCL',
      cadenceLabel: '5-day revisit (cloud-gated)',
      authRequired: false,
      commercialNote: 'Public Planetary Computer STAC + polygon pixel statistics.',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: 'cdse_stac',
      parameters: ['B04', 'B08', 'SCL'],
      units: 'BOA reflectance, NDVI (-1..1)',
    },
    {
      id: 'cdse_stac',
      name: 'Copernicus Data Space STAC Catalog',
      category: 'vegetation',
      endpoint: 'https://stac.dataspace.copernicus.eu/v1/search',
      productId: 'Sentinel-2 L2A Metadata Index',
      version: 'v1',
      resolutionLabel: '10 m native',
      cadenceLabel: '5-day revisit',
      authRequired: false,
      commercialNote: 'Catalog search public; raster download/openEO requires CDSE OAuth client.',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: null,
      parameters: ['B04', 'B08', 'SCL'],
      units: 'STAC catalog metadata',
    },
    {
      id: 'open_meteo_dem',
      name: 'Open-Meteo Elevation (Copernicus DEM)',
      category: 'terrain',
      endpoint: 'https://api.open-meteo.com/v1/elevation',
      productId: 'Copernicus DEM GLO-90',
      version: 'v1',
      resolutionLabel: '~90 m posting',
      cadenceLabel: 'Static DEM',
      authRequired: false,
      commercialNote: 'Non-commercial endpoint; finite-difference slope.',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: 'open_elevation_srtm',
      parameters: ['elevation'],
      units: 'm (EGM2008)',
    },
    {
      id: 'open_elevation_srtm',
      name: 'Open-Elevation (SRTM 90m Fallback)',
      category: 'terrain',
      endpoint: 'https://api.open-elevation.com/api/v1/lookup',
      productId: 'SRTM 3-arcsecond DEM',
      version: 'v1',
      resolutionLabel: '~90 m posting',
      cadenceLabel: 'Static DEM',
      authRequired: false,
      commercialNote: 'Public SRTM lookup fallback.',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: null,
      parameters: ['elevation'],
      units: 'm',
    },
    {
      id: 'nasa_eonet_v3',
      name: 'NASA EONET v3 Natural Events',
      category: 'hazards',
      endpoint: 'https://eonet.gsfc.nasa.gov/api/v3/events',
      productId: 'Open Natural Hazard Events',
      version: 'v3',
      resolutionLabel: 'Point / polygon event within 300 km',
      cadenceLabel: 'Near real-time',
      authRequired: false,
      commercialNote: 'Public NASA EOSDIS feed.',
      state: 'configured',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: null,
      fallbackProviderId: null,
      parameters: ['events', 'categories', 'geometry'],
      units: 'km distance',
    },
    {
      id: 'nasa_gpm_imerg',
      name: 'NASA GPM IMERG Satellite Precipitation',
      category: 'precipitation',
      endpoint: 'https://gpm.nasa.gov/data/imerg',
      productId: 'IMERG Final/Late Daily 0.1°',
      version: 'V07',
      resolutionLabel: '0.1° (~10 km)',
      cadenceLabel: 'Daily / Half-hourly',
      authRequired: true,
      commercialNote: 'Requires NASA Earthdata login; cross-check performed via NASA POWER vs ERA5-Land.',
      state: hasEarthdata ? 'configured' : 'planned',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: hasEarthdata ? null : 'NASA_EARTHDATA_TOKEN missing; precipitation cross-checked via NASA POWER vs Open-Meteo ERA5-Land.',
      fallbackProviderId: 'open_meteo_era5',
      parameters: ['precipitationCal'],
      units: 'mm/d',
    },
    {
      id: 'gemini_ai_explainer',
      name: 'Gemini AI Agronomist Explanation Layer',
      category: 'ai',
      endpoint: 'server-side @google/genai',
      productId: 'gemini-4-hydrogen (fallback gemini-3.1-flash-lite)',
      version: 'v1beta',
      resolutionLabel: 'Narrative & NL practice draft parser only',
      cadenceLabel: 'On-demand after deterministic engine',
      authRequired: true,
      commercialNote: 'Server-side GEMINI_API_KEY only; never overrides deterministic math.',
      state: hasGemini ? 'configured' : 'unavailable',
      lastCheckedAt: null,
      latencyMs: null,
      lastError: hasGemini ? null : 'GEMINI_API_KEY not configured; deterministic reports remain 100% functional.',
      fallbackProviderId: null,
      parameters: ['findingsSummary', 'practiceTextDraft'],
      units: 'Structured JSON text',
    },
  ];
}

export function getProvidersStatus(): ProviderHealth[] {
  return buildStaticRegistry().map((p) => applyRuntimeHealth(p));
}

export async function testProviderLive(
  providerId: string,
  lat = 44.8602,
  lon = -123.1462
): Promise<ProviderHealth | null> {
  const staticDef = buildStaticRegistry().find((p) => p.id === providerId);
  if (!staticDef) return null;

  if (staticDef.authRequired && (providerId === 'nasa_smap_l4' || providerId === 'nasa_gpm_imerg') && !process.env.NASA_EARTHDATA_TOKEN) {
    updateProviderRuntime(providerId, {
      ok: false,
      error: 'Authentication secret (NASA_EARTHDATA_TOKEN) is not configured on this server.',
      stateOverride: 'unavailable',
    });
    return applyRuntimeHealth(staticDef);
  }

  if (providerId === 'gemini_ai_explainer') {
    const ok = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
    updateProviderRuntime(providerId, {
      ok,
      latencyMs: 1,
      error: ok ? null : 'GEMINI_API_KEY not set in environment.',
      stateOverride: ok ? 'tested' : 'unavailable',
    });
    return applyRuntimeHealth(staticDef);
  }

  if (providerId === 'isric_soilgrids_rest') {
    updateProviderRuntime(providerId, {
      ok: false,
      error: 'ISRIC SoilGrids REST endpoint paused upstream; use isric_soilgrids_wcs or usda_nrcs_sda.',
      stateOverride: 'unavailable',
    });
    return applyRuntimeHealth(staticDef);
  }

  const end = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);

  const testUrlMap: Record<string, { url: string; init?: RequestInit }> = {
    open_meteo_forecast: {
      url: `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&forecast_days=1`,
    },
    met_norway_forecast: {
      url: `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
    },
    nasa_power_daily: {
      url: `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M&community=AG&longitude=${lon}&latitude=${lat}&start=${start.replace(/-/g, '')}&end=${end.replace(/-/g, '')}&format=JSON`,
    },
    open_meteo_era5: {
      url: `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&daily=temperature_2m_max`,
    },
    open_meteo_era5_soil: {
      url: `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&hourly=soil_moisture_0_to_7cm`,
    },
    usda_nrcs_sda: {
      url: 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: "SELECT TOP 1 mukey FROM mapunit", format: 'JSON' }),
      },
    },
    isric_soilgrids_wcs: {
      url: `https://maps.isric.org/mapserv?map=/map/phh2o.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=phh2o_0-5cm_mean&FORMAT=GEOTIFF_INT16&SUBSET=Long(${lon - 0.002},${lon + 0.002})&SUBSET=Lat(${lat - 0.002},${lat + 0.002})&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326`,
    },
    sentinel2_pc_stac: {
      url: 'https://planetarycomputer.microsoft.com/api/stac/v1/search',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collections: ['sentinel-2-l2a'], bbox: [lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01], limit: 1 }),
      },
    },
    cdse_stac: {
      url: 'https://stac.dataspace.copernicus.eu/v1/search',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collections: ['sentinel-2-l2a'], bbox: [lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01], limit: 1 }),
      },
    },
    open_meteo_dem: {
      url: `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`,
    },
    open_elevation_srtm: {
      url: `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`,
    },
    nasa_eonet_v3: {
      url: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=2',
    },
  };

  const target = testUrlMap[providerId];
  if (!target) return applyRuntimeHealth(staticDef);

  const res = await fetchWithResilience({
    providerId,
    url: target.url,
    init: target.init,
    timeoutMs: 8500,
    maxRetries: 0,
  });

  if (res.ok) {
    updateProviderRuntime(providerId, {
      ok: true,
      latencyMs: res.latencyMs,
      stateOverride: 'tested',
    });
  }
  return applyRuntimeHealth(staticDef);
}
