import { EventEmitter } from 'events';
import {
  AnalysisJob,
  AnalysisScope,
  DeepAnalysisReport,
  EvidenceRecord,
  FieldDeepAssessment,
  NotificationRecord,
  PipelineStageName,
  PipelineStageRecord,
  SoilLayerDisplayValue,
  SourceOutcome,
} from '../../src/types/advanced';
import {
  appendAuditEvent,
  hashInputPayload,
  hydrateFarmContext,
  HydratedFarmContext,
  HydratedFarmField,
  readAdvancedStore,
  syncReportSummaryToPortfolio,
  writeAdvancedStore,
} from './store';
import { CROP_DATABASE_VERSION, resolveCropParams } from './engine/cropDatabase';
import {
  computeFao56DailyEt0,
  FAO56_ENGINE_VERSION,
  resolveCropStageKc,
} from './engine/fao56';
import { computeCropWeatherExposure, GDD_ENGINE_VERSION } from './engine/gdd';
import { estimateSoilHydraulicsFromTexture, SOIL_ENGINE_VERSION } from './engine/soilEngine';
import { computeDailyWaterBalance, WATER_BALANCE_ENGINE_VERSION } from './engine/waterBalance';
import {
  aggregateFarmSummary,
  evaluateFieldRisksAndActions,
  HEALTH_MODEL_VERSION,
  RULESET_VERSION,
} from './engine/riskEngine';
import { compareImmutableReports } from './engine/comparisonEngine';
import { fetchWeatherForecastWithFallback } from './providers/weatherForecastProvider';
import { fetchHistoricalClimateWithFallback } from './providers/historicalClimateProvider';
import { fetchTerrainWithFallback } from './providers/terrainProvider';
import { fetchSoilPropertiesWithFallback } from './providers/soilPropertiesProvider';
import { fetchSoilMoistureWithFallback } from './providers/soilMoistureProvider';
import { fetchSentinel2VegetationForField } from './providers/vegetationProvider';
import { fetchEonetHazards } from './providers/hazardsProvider';
import { generateBoundedReportExplanation } from './aiLayer';

export const ADVANCED_ENGINE_VERSION = `${FAO56_ENGINE_VERSION}+${WATER_BALANCE_ENGINE_VERSION}+${HEALTH_MODEL_VERSION}`;

const jobEmitter = new EventEmitter();
jobEmitter.setMaxListeners(100);

export function subscribeJobEvents(
  runId: string,
  listener: (job: AnalysisJob) => void
): () => void {
  const evt = `job:${runId}`;
  jobEmitter.on(evt, listener);
  return () => {
    jobEmitter.off(evt, listener);
  };
}

function buildInitialStages(): PipelineStageRecord[] {
  const defs: Array<[PipelineStageName, string]> = [
    ['REQUESTED', 'Run requested & validated'],
    ['VALIDATING_SCOPE', 'Validating farm & field scope'],
    ['SNAPSHOTTING_INPUTS', 'Locking immutable input & geometry versions'],
    ['FETCHING_DATA', 'Fetching multi-provider climate, soil, satellite & hazards'],
    ['VALIDATING_AND_NORMALISING', 'Validating schemas, units & fill values'],
    ['SPATIAL_AGGREGATION', 'Resolving pixel geometry & spatial fit'],
    ['CALCULATING_INDICATORS', 'Computing FAO-56 ET₀, water balance & GDD'],
    ['EVALUATING_FIELD_RULES', 'Evaluating documented risk rules & watch points'],
    ['BUILDING_FIELD_ASSESSMENTS', 'Building field-by-field assessment profiles'],
    ['BUILDING_FARM_SUMMARY', 'Aggregating non-masking farm summary'],
    ['COMPARING_PREVIOUS_REPORT', 'Comparing against prior comparable report'],
    ['GENERATING_EXPLANATIONS', 'Generating bounded AI summary (Simple & Advanced)'],
    ['VALIDATING_REPORT', 'Running scientific integrity validation checks'],
    ['PERSISTING_REPORT', 'Saving immutable Deep Analysis report'],
  ];
  return defs.map(([stage, label], idx) => ({
    stage,
    label,
    status: idx === 0 ? 'complete' : 'queued',
    ...(idx === 0 ? { startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() } : {}),
  }));
}

function updateJobInStore(
  runId: string,
  updater: (job: AnalysisJob) => AnalysisJob
): AnalysisJob | null {
  const store = readAdvancedStore();
  const idx = store.jobs.findIndex((j) => j.id === runId);
  if (idx < 0) return null;
  const updated = updater(store.jobs[idx]);
  store.jobs[idx] = updated;
  writeAdvancedStore(store);
  jobEmitter.emit(`job:${runId}`, updated);
  return updated;
}

function isCancellationRequested(runId: string): boolean {
  const store = readAdvancedStore();
  const j = store.jobs.find((x) => x.id === runId);
  return Boolean(j?.cancellationRequested || j?.status === 'cancelled');
}

function markStage(
  job: AnalysisJob,
  stage: PipelineStageName,
  status: PipelineStageRecord['status'],
  detail?: string
): AnalysisJob {
  const now = new Date().toISOString();
  const stages = job.stages.map((s) => {
    if (s.stage !== stage) return s;
    return {
      ...s,
      status,
      startedAt: s.startedAt ?? now,
      finishedAt: status === 'running' ? undefined : now,
      detail: detail ?? s.detail,
    };
  });
  return {
    ...job,
    currentStage: status === 'running' ? stage : job.currentStage,
    stages,
  };
}

function isWithinQuietHours(quietHours: { start: string; end: string } | null, timezone: string): boolean {
  if (!quietHours) return false;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
    const curMin = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
    const [sh, sm] = quietHours.start.split(':').map(Number);
    const [eh, em] = quietHours.end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (startMin <= endMin) return curMin >= startMin && curMin <= endMin;
    return curMin >= startMin || curMin <= endMin;
  } catch {
    return false;
  }
}

export function enqueueAnalysisJob(opts: {
  farmId: string;
  scope: AnalysisScope;
  runType: 'manual' | 'scheduled';
  triggerReason: string;
  dateFrom?: string;
  dateTo?: string;
  idempotencyKey?: string;
  scheduleId?: string;
}): { job: AnalysisJob; deduplicated: boolean } {
  const store = readAdvancedStore();
  if (opts.idempotencyKey && store.idempotencyKeys[opts.idempotencyKey]) {
    const existingId = store.idempotencyKeys[opts.idempotencyKey];
    const existing = store.jobs.find((j) => j.id === existingId);
    if (existing) {
      return { job: existing, deduplicated: true };
    }
  }

  const farmCtx = hydrateFarmContext(opts.farmId);
  const toIso = opts.dateTo || new Date().toISOString().slice(0, 10);
  const fromIso =
    opts.dateFrom || new Date(Date.now() - 21 * 86400000).toISOString().slice(0, 10);

  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const job: AnalysisJob = {
    id: runId,
    scheduleId: opts.scheduleId,
    farmId: opts.farmId,
    scope: opts.scope,
    runType: opts.runType,
    triggerReason: opts.triggerReason,
    dateRange: {
      from: fromIso,
      to: toIso,
      timezone: farmCtx?.timezone || 'UTC',
    },
    requestedAt: new Date().toISOString(),
    status: 'queued',
    currentStage: 'REQUESTED',
    stages: buildInitialStages(),
    attempt: 1,
    idempotencyKey: opts.idempotencyKey || runId,
    cancellationRequested: false,
  };

  store.jobs = [job, ...store.jobs].slice(0, 120);
  if (opts.idempotencyKey) {
    store.idempotencyKeys[opts.idempotencyKey] = runId;
  }
  appendAuditEvent(
    store,
    opts.farmId,
    'ANALYSIS_RUN_QUEUED',
    `Queued ${opts.runType} analysis (${opts.scope.label})`,
    opts.runType === 'scheduled' ? 'Automation Scheduler' : 'Farm Manager'
  );
  writeAdvancedStore(store);

  // Start async execution right after queuing
  setTimeout(() => {
    void executeAnalysisJob(runId);
  }, 20);

  return { job, deduplicated: false };
}

export async function executeAnalysisJob(runId: string): Promise<DeepAnalysisReport | null> {
  const initialStore = readAdvancedStore();
  const jobSnapshot = initialStore.jobs.find((j) => j.id === runId);
  if (!jobSnapshot) return null;

  let curJob = updateJobInStore(runId, (j) =>
    markStage({ ...j, status: 'running', startedAt: new Date().toISOString() }, 'VALIDATING_SCOPE', 'running')
  );
  if (!curJob) return null;

  const checkCancelled = (): boolean => {
    if (!isCancellationRequested(runId)) return false;
    updateJobInStore(runId, (j) => ({
      ...j,
      status: 'cancelled',
      currentStage: 'CANCELLED',
      finishedAt: new Date().toISOString(),
      errorMessage: 'Cancelled by user during execution.',
    }));
    return true;
  };

  if (!curJob) return null;

  try {
    // Stage: VALIDATING_SCOPE
    const farmCtx: HydratedFarmContext | null = hydrateFarmContext(curJob.farmId);
    if (!farmCtx || !farmCtx.centroid) {
      updateJobInStore(runId, (j) => ({
        ...markStage(j, 'VALIDATING_SCOPE', 'failed', 'Farm or coordinates missing.'),
        status: 'failed',
        currentStage: 'FAILED',
        finishedAt: new Date().toISOString(),
        errorCode: 'MISSING_FARM_OR_COORDS',
        errorMessage: 'Selected farm does not exist or lacks valid GPS centroid coordinates.',
      }));
      return null;
    }

    const scopedFields: HydratedFarmField[] =
      curJob.scope.type === 'whole_farm' || curJob.scope.type === 'all_fields' || curJob.scope.fieldIds.length === 0
        ? farmCtx.fields
        : farmCtx.fields.filter((f) => curJob!.scope.fieldIds.includes(f.id));

    if (scopedFields.length === 0) {
      updateJobInStore(runId, (j) => ({
        ...markStage(j, 'VALIDATING_SCOPE', 'failed', 'No matching fields found in selected scope.'),
        status: 'failed',
        currentStage: 'FAILED',
        finishedAt: new Date().toISOString(),
        errorCode: 'EMPTY_SCOPE',
        errorMessage: 'None of the selected fields matched the farm workspace.',
      }));
      return null;
    }

    curJob = updateJobInStore(runId, (j) =>
      markStage(
        markStage(j, 'VALIDATING_SCOPE', 'complete', `${scopedFields.length} parcel(s) in scope`),
        'SNAPSHOTTING_INPUTS',
        'running'
      )
    )!;
    if (checkCancelled()) return null;

    // Stage: SNAPSHOTTING_INPUTS
    const geometryVersionIds: Record<string, string> = {};
    const profileVersionIds: Record<string, string> = {};
    for (const f of scopedFields) {
      geometryVersionIds[f.id] = f.geometryVersionId;
      profileVersionIds[f.id] = f.updatedAt;
    }
    const inputSnapshotId = `snapin-${hashInputPayload({
      farmUpdatedAt: farmCtx.updatedAt,
      soil: farmCtx.soil,
      water: farmCtx.water,
      fields: scopedFields.map((f) => ({
        id: f.id,
        crop: f.cropName,
        geom: f.geometryVersionId,
        soil: f.soilOverrides,
        water: f.waterOverrides,
      })),
      irrigationCount: farmCtx.irrigationLogs.length,
    })}`;

    curJob = updateJobInStore(runId, (j) =>
      markStage(
        markStage(j, 'SNAPSHOTTING_INPUTS', 'complete', `Snapshot ${inputSnapshotId}`),
        'FETCHING_DATA',
        'running',
        'Querying Open-Meteo, NASA POWER, Soil Surveys/WCS, ERA5-Land, DEM, EONET & Sentinel-2'
      )
    )!;
    if (checkCancelled()) return null;

    // Stage: FETCHING_DATA (real APIs with fallbacks; non-blocking Promise.allSettled)
    const { lat, lon } = farmCtx.centroid;
    const [fcSettled, histSettled, terrainSettled, soilPropsSettled, hazardsSettled] =
      await Promise.allSettled([
        fetchWeatherForecastWithFallback({ lat, lon, forecastDays: 10 }),
        fetchHistoricalClimateWithFallback({
          lat,
          lon,
          fromIso: curJob.dateRange.from,
          toIso: curJob.dateRange.to,
        }),
        fetchTerrainWithFallback({ lat, lon }),
        fetchSoilPropertiesWithFallback({ lat, lon }),
        fetchEonetHazards({ lat, lon, radiusKm: 300 }),
      ]);

    const fcRes = fcSettled.status === 'fulfilled' ? fcSettled.value : null;
    const histRes = histSettled.status === 'fulfilled' ? histSettled.value : null;
    const terrainRes = terrainSettled.status === 'fulfilled' ? terrainSettled.value : null;
    const soilPropsRes = soilPropsSettled.status === 'fulfilled' ? soilPropsSettled.value : null;
    const hazardsRes = hazardsSettled.status === 'fulfilled' ? hazardsSettled.value : null;

    const soilMoistureRes = await fetchSoilMoistureWithFallback({
      lat,
      lon,
      powerHistoryDays: histRes?.days ?? [],
    }).catch(() => null);

    // Fetch per-field cloud-masked Sentinel-2 optical NDVI
    const vegSettled = await Promise.allSettled(
      scopedFields.map((f) =>
        fetchSentinel2VegetationForField({
          farmId: farmCtx.farmId,
          fieldId: f.id,
          fieldName: f.name,
          areaHa: f.areaHa,
          geometry: f.geometry,
          centroid: f.centroid,
          geometryVersionId: f.geometryVersionId,
        })
      )
    );

    if (checkCancelled()) return null;

    curJob = updateJobInStore(runId, (j) =>
      markStage(
        markStage(j, 'FETCHING_DATA', 'complete', 'All external providers queried'),
        'VALIDATING_AND_NORMALISING',
        'running'
      )
    )!;

    // Stage: VALIDATING_AND_NORMALISING + SPATIAL_AGGREGATION
    const nowIso = new Date().toISOString();
    const allObservations = [
      ...(fcRes?.observations ?? []),
      ...(histRes?.observations ?? []),
      ...(terrainRes?.observations ?? []),
      ...(soilPropsRes?.observations ?? []),
      ...(soilMoistureRes?.observations ?? []),
      ...(hazardsRes?.observations ?? []),
      ...vegSettled.flatMap((v) => (v.status === 'fulfilled' ? v.value.observations : [])),
    ];

    const sourceOutcomes: SourceOutcome[] = [
      {
        providerId: fcRes?.providerId || 'open_meteo_forecast',
        providerName: fcRes?.providerName || 'Weather Forecast',
        productId: fcRes?.productId || 'Forecast',
        category: 'weather_forecast',
        status: !fcRes || fcRes.error ? 'unavailable' : fcRes.fallbackUsed ? 'fallback' : 'complete',
        resolutionLabel: fcRes?.spatialLabel || '~11 km NWP grid',
        spatialFit: 'coarse_context',
        retrievedAt: fcRes?.retrievedAt || nowIso,
        observationWindow:
          fcRes && fcRes.forecastDays.length > 0
            ? `${fcRes.forecastDays[0].date} to ${fcRes.forecastDays[fcRes.forecastDays.length - 1].date}`
            : 'Unavailable',
        note: fcRes?.fallbackUsed || fcRes?.error || 'Live daily/hourly NWP forecast synchronized.',
        fallbackUsed: fcRes?.fallbackUsed,
        errorMessage: fcRes?.error ?? null,
      },
      {
        providerId: histRes?.providerId || 'nasa_power_daily',
        providerName: histRes?.providerName || 'Historical Climate',
        productId: histRes?.productId || 'POWER Daily AG',
        category: 'historical_climate',
        status: !histRes || histRes.error ? 'unavailable' : histRes.fallbackUsed ? 'fallback' : 'complete',
        resolutionLabel: histRes?.spatialLabel || '0.5° (~55 km) grid',
        spatialFit: 'coarse_context',
        retrievedAt: histRes?.retrievedAt || nowIso,
        observationWindow:
          histRes && histRes.days.length > 0
            ? `${histRes.days[0].date} to ${histRes.days[histRes.days.length - 1].date}`
            : 'Unavailable',
        note:
          histRes?.precipDisagreementNote ||
          histRes?.fallbackUsed ||
          histRes?.error ||
          'Daily agroclimatology + 20-year seasonal baseline loaded.',
        fallbackUsed: histRes?.fallbackUsed,
        errorMessage: histRes?.error ?? null,
      },
      {
        providerId: soilPropsRes?.providerId || 'isric_soilgrids_wcs',
        providerName: soilPropsRes?.providerName || 'Mapped Soil Properties',
        productId: soilPropsRes?.productId || 'SSURGO / SoilGrids',
        category: 'soil_properties',
        status: !soilPropsRes || soilPropsRes.error ? 'unavailable' : soilPropsRes.fallbackUsed ? 'fallback' : 'complete',
        resolutionLabel: soilPropsRes?.spatialLabel || '30 m – 250 m',
        spatialFit:
          soilPropsRes && soilPropsRes.spatialResolutionM > 0 && soilPropsRes.spatialResolutionM <= 50
            ? 'field_scale'
            : 'coarse_context',
        retrievedAt: soilPropsRes?.retrievedAt || nowIso,
        observationWindow: 'Static soil horizon (0–20 cm)',
        note: soilPropsRes?.uncertaintyNote || soilPropsRes?.error || 'Soil property baseline loaded.',
        fallbackUsed: soilPropsRes?.fallbackUsed,
        errorMessage: soilPropsRes?.error ?? null,
      },
      {
        providerId: soilMoistureRes?.providerId || 'open_meteo_era5_soil',
        providerName: soilMoistureRes?.providerName || 'Gridded Soil Moisture',
        productId: soilMoistureRes?.productId || 'ERA5-Land Volumetric Soil Water',
        category: 'soil_moisture',
        status: !soilMoistureRes || soilMoistureRes.error ? 'unavailable' : soilMoistureRes.fallbackUsed ? 'fallback' : 'complete',
        resolutionLabel: soilMoistureRes?.spatialLabel || '~9–11 km grid',
        spatialFit: 'coarse_context',
        retrievedAt: soilMoistureRes?.retrievedAt || nowIso,
        observationWindow: soilMoistureRes?.observationDate || 'Unavailable',
        note: soilMoistureRes?.fallbackUsed || soilMoistureRes?.error || 'Surface and root-zone VWC loaded.',
        fallbackUsed: soilMoistureRes?.fallbackUsed,
        errorMessage: soilMoistureRes?.error ?? null,
      },
      {
        providerId: terrainRes?.providerId || 'open_meteo_dem',
        providerName: terrainRes?.providerName || 'Terrain DEM',
        productId: terrainRes?.productId || 'Copernicus DEM 90m',
        category: 'terrain',
        status: !terrainRes || terrainRes.error ? 'unavailable' : terrainRes.fallbackUsed ? 'fallback' : 'complete',
        resolutionLabel: terrainRes ? `${terrainRes.spatialResolutionM} m DEM (${terrainRes.datum})` : 'Unavailable',
        spatialFit: 'field_scale',
        retrievedAt: terrainRes?.retrievedAt || nowIso,
        observationWindow: 'Static elevation baseline',
        note: terrainRes?.error || `Finite-difference 5-point slope (${terrainRes?.slopePct ?? '—'}%).`,
        fallbackUsed: terrainRes?.fallbackUsed,
        errorMessage: terrainRes?.error ?? null,
      },
      {
        providerId: hazardsRes?.providerId || 'nasa_eonet_v3',
        providerName: hazardsRes?.providerName || 'NASA EONET v3 Hazards',
        productId: 'Open Events (300 km buffer)',
        category: 'hazards',
        status: !hazardsRes || hazardsRes.error ? 'unavailable' : 'complete',
        resolutionLabel: '300 km radial buffer',
        spatialFit: 'coarse_context',
        retrievedAt: hazardsRes?.retrievedAt || nowIso,
        observationWindow: 'Last 30 days open events',
        note: hazardsRes?.error || `${hazardsRes?.nearbyEvents.length ?? 0} nearby hazard event(s) detected.`,
        errorMessage: hazardsRes?.error ?? null,
      },
    ];

    const anyVegValid = vegSettled.some(
      (v) => v.status === 'fulfilled' && v.value.summary.status === 'valid'
    );
    sourceOutcomes.push({
      providerId: 'sentinel2_pc_stac',
      providerName: 'Sentinel-2 Level-2A (Microsoft Planetary Computer)',
      productId: 'B04/B08 NDVI + SCL Cloud Mask',
      category: 'vegetation',
      status: anyVegValid ? 'complete' : 'partial',
      resolutionLabel: '10 m optical pixels (20 m SCL mask)',
      spatialFit: anyVegValid ? 'field_scale' : 'insufficient',
      retrievedAt: nowIso,
      observationWindow: 'Latest 90 days clear overpass',
      note: anyVegValid
        ? 'Cloud-masked field polygon NDVI statistics computed from B04/B08 pixels.'
        : 'Recent Sentinel-2 passes exceeded polygon cloud/shadow threshold or were unreachable.',
    });

    curJob = updateJobInStore(runId, (j) =>
      markStage(
        markStage(
          markStage(j, 'VALIDATING_AND_NORMALISING', 'complete'),
          'SPATIAL_AGGREGATION',
          'complete',
          `Aggregated ${sourceOutcomes.filter((s) => s.status !== 'unavailable').length}/${sourceOutcomes.length} feeds`
        ),
        'CALCULATING_INDICATORS',
        'running'
      )
    )!;
    if (checkCancelled()) return null;

    // Build routines active note (NEVER treated as completed irrigation!)
    const storeState = readAdvancedStore();
    const farmRoutines = storeState.routines.filter(
      (r) => r.farmId === farmCtx.farmId && r.category === 'irrigation_routine'
    );

    const evidenceById: Record<string, EvidenceRecord> = {};
    const fieldAssessments: FieldDeepAssessment[] = [];
    const allFindings: DeepAnalysisReport['findings'] = [];
    const allWatchPoints: DeepAnalysisReport['watchPoints'] = [];
    const allRecs: DeepAnalysisReport['recommendations'] = [];

    const elevForEt0 = farmCtx.soil.elevationM ?? terrainRes?.elevationM ?? 60;
    const elevSource =
      farmCtx.soil.elevationM !== null ? 'Farm profile' : terrainRes?.providerName ?? 'DEM';

    // Stage: CALCULATING_INDICATORS + EVALUATING_FIELD_RULES + BUILDING_FIELD_ASSESSMENTS per field
    for (let fIdx = 0; fIdx < scopedFields.length; fIdx++) {
      const fl = scopedFields[fIdx];
      const crop = resolveCropParams(fl.cropName || fl.cropId);
      const cropConfirmed = Boolean(fl.cropName && fl.cropName !== 'Unknown');
      const vegSettledItem = vegSettled[fIdx];
      const vegRes =
        vegSettledItem?.status === 'fulfilled'
          ? vegSettledItem.value.summary
          : {
              fieldId: fl.id,
              fieldName: fl.name,
              status: 'unavailable' as const,
              productId: 'Sentinel-2 L2A',
              providerName: 'Planetary Computer',
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
              spatialFit: 'insufficient' as const,
              note: 'Satellite provider unreachable during this run.',
              evidenceId: `ev-veg-${fl.id}`,
            };

      // Map confirmed irrigation events strictly (exclude saved unconfirmed routines!)
      const irrByDate = new Map<string, number>();
      const areaM2 = Math.max(1000, fl.areaHa * 10000);
      for (const l of farmCtx.irrigationLogs) {
        const lFieldId = (l.fieldId as string | null) ?? null;
        if (lFieldId === null || lFieldId === fl.id) {
          const dt = String(l.date || '').slice(0, 10);
          const volM3 = Number(l.volumeM3);
          if (dt && Number.isFinite(volM3) && volM3 > 0) {
            // Convert m3 applied to mm depth: (volume_m3 * 1000 L/m3) / area_m2 = mm (if whole farm, apportion proportionally to total area)
            const effAreaM2 =
              lFieldId === null ? Math.max(areaM2, farmCtx.areaHa * 10000) : areaM2;
            const mm = (volM3 * 1000) / effAreaM2;
            irrByDate.set(dt, (irrByDate.get(dt) ?? 0) + mm);
          }
        }
      }

      // Build combined historical (last 14–21d) + forecast (next 7d) series & compute FAO-56 ET0 cleanly
      const histDays = (histRes?.days ?? []).slice(-14);
      const fcDays = (fcRes?.forecastDays ?? []).slice(0, 7);

      const stageKc = resolveCropStageKc({
        crop,
        dateIso: curJob.dateRange.to,
        u2Ms: histDays[histDays.length - 1]?.wind2mMs ?? null,
        rhMinPct: null,
      });

      const wbInputs = [
        ...histDays.map((d) => {
          const et0 = computeFao56DailyEt0({
            dateIso: d.date,
            tMinC: d.tMinC,
            tMaxC: d.tMaxC,
            rhMeanPct: d.rhMeanPct,
            windSpeedMs: d.wind2mMs,
            windMeasurementHeightM: d.windHeightM,
            rsMjM2Day: d.solarMjM2,
            elevationM: elevForEt0,
            latitudeDeg: fl.centroid.lat,
          });
          return {
            date: d.date,
            dataKind: 'historical' as const,
            et0Mm: et0.et0MmDay,
            et0Method: et0.method,
            kc: stageKc.kc,
            precipitationMm: d.precipMm,
            confirmedIrrigationMm: irrByDate.get(d.date) ?? 0,
          };
        }),
        ...fcDays.map((d) => {
          const et0 = computeFao56DailyEt0({
            dateIso: d.date,
            tMinC: d.tMinC,
            tMaxC: d.tMaxC,
            rhMeanPct: d.rhMeanPct,
            windSpeedMs: d.windSpeedMaxMs,
            windMeasurementHeightM: d.windHeightM,
            rsMjM2Day: d.solarRadiationMjM2,
            elevationM: elevForEt0,
            latitudeDeg: fl.centroid.lat,
          });
          return {
            date: d.date,
            dataKind: 'forecast' as const,
            et0Mm: et0.et0MmDay ?? d.providerEt0Mm,
            et0Method:
              et0.et0MmDay !== null
                ? et0.method
                : d.providerEt0Mm !== null
                  ? ('FAO-56 Penman-Monteith' as const)
                  : ('Unavailable' as const),
            kc: stageKc.kc,
            precipitationMm: d.precipMm,
            confirmedIrrigationMm: 0,
          };
        }),
      ];

      // Determine soil texture & hydraulics (Farmer/lab ALWAYS stays prioritized over mapped grid)
      const overrideTex = fl.soilOverrides?.texture as string | undefined;
      const farmerTex = overrideTex || (farmCtx.soil.texture !== 'Unknown' ? farmCtx.soil.texture : null);
      const effectiveTex = farmerTex || soilPropsRes?.textureClassUsda || 'Unknown';
      const texSource = farmerTex
        ? 'Farmer soil record'
        : soilPropsRes?.textureClassUsda && soilPropsRes.textureClassUsda !== 'Unknown'
          ? soilPropsRes.providerName
          : 'Unavailable';

      const hydraulics = estimateSoilHydraulicsFromTexture(
        effectiveTex,
        farmCtx.soil.organicMatterPct ?? soilPropsRes?.somDerivedPct
      );
      const rootDepthM = crop ? Number(((crop.zrMinM + crop.zrMaxM) / 2).toFixed(2)) : null;

      const overrideMoisture = fl.soilOverrides?.moisturePct as number | undefined;
      const overrideMoistureStatus = (fl.soilOverrides?.moistureStatus as 'measured' | 'estimated' | 'unknown' | undefined) ?? farmCtx.soil.moistureStatus;
      const probeMoisturePct =
        typeof overrideMoisture === 'number'
          ? overrideMoisture
          : farmCtx.soil.moistureStatus !== 'unknown'
            ? farmCtx.soil.moisturePct
            : null;

      const wbOut = computeDailyWaterBalance({
        days: wbInputs,
        crop,
        thetaFc: hydraulics?.thetaFc ?? null,
        thetaWp: hydraulics?.thetaWp ?? null,
        rootDepthM,
        initialVwcPct: probeMoisturePct ?? soilMoistureRes?.rootZoneMoisturePct ?? null,
      });

      const weatherExp = computeCropWeatherExposure({
        days: histDays.map((d) => ({
          date: d.date,
          tMinC: d.tMinC,
          tMaxC: d.tMaxC,
          precipMm: d.precipMm,
          solarMjM2: d.solarMjM2,
        })),
        crop,
      });

      const baselineRainTotal =
        histRes?.baselinePrecipMmDay !== null &&
        histRes?.baselinePrecipMmDay !== undefined &&
        histDays.length > 0
          ? histRes.baselinePrecipMmDay * histDays.length
          : null;
      const rainfallAnomalyMm =
        weatherExp.periodPrecipTotalMm !== null && baselineRainTotal !== null
          ? Number((weatherExp.periodPrecipTotalMm - baselineRainTotal).toFixed(1))
          : null;
      const rainfallAnomalyPct =
        rainfallAnomalyMm !== null && baselineRainTotal !== null && baselineRainTotal > 0.5
          ? Math.round((rainfallAnomalyMm / baselineRainTotal) * 100)
          : null;

      // Soil Lab vs Mapped comparison (strictly separate, NEVER merged blindly!)
      const labValues: SoilLayerDisplayValue[] = [];
      const mappedEstimates: SoilLayerDisplayValue[] = [];

      const overridePh = fl.soilOverrides?.phValue as number | undefined;
      const farmerPh =
        typeof overridePh === 'number'
          ? overridePh
          : farmCtx.soil.phStatus === 'tested'
            ? farmCtx.soil.phValue
            : null;
      const evSoilId = `ev-soil-${fl.id}`;
      const evWaterId = `ev-water-${fl.id}`;
      const evWeatherId = `ev-weather-${fl.id}`;
      const evTerrainId = `ev-terrain-${fl.id}`;
      const evVegId = vegRes.evidenceId;
      const evEonetId = `ev-eonet-${fl.id}`;

      if (farmerPh !== null) {
        labValues.push({
          property: 'Soil pH',
          depthInterval: '0–20 cm composite',
          valueDisplay: farmerPh.toFixed(1),
          unit: 'pH',
          sourceType: 'farmer_lab',
          providerLabel: 'Farmer Laboratory Sample',
          dateLabel: farmCtx.soil.phTestDate || 'Recorded in profile',
          uncertaintyNote: 'Direct farm test (highest authority for this field).',
          evidenceId: evSoilId,
        });
      }
      if (probeMoisturePct !== null) {
        labValues.push({
          property: 'Topsoil Moisture',
          depthInterval: '0–20 cm probe zone',
          valueDisplay: `${probeMoisturePct}%`,
          unit: '% VWC',
          sourceType: overrideMoistureStatus === 'measured' ? 'farmer_lab' : 'mapped_grid',
          providerLabel: farmCtx.soil.moistureMethod || 'Farm Probe / Field Record',
          dateLabel: farmCtx.soil.moistureDate || 'Recorded in profile',
          uncertaintyNote:
            overrideMoistureStatus === 'measured'
              ? 'Measured volumetric moisture at field probe depth.'
              : 'Estimated field value entered by farmer.',
          evidenceId: evWaterId,
        });
      }
      if (farmCtx.soil.organicMatterPct !== null) {
        labValues.push({
          property: 'Organic Matter',
          depthInterval: '0–20 cm',
          valueDisplay: `${farmCtx.soil.organicMatterPct.toFixed(1)}%`,
          unit: '% SOM',
          sourceType: 'farmer_lab',
          providerLabel: 'Farmer Soil Assay',
          dateLabel: farmCtx.soil.phTestDate || 'Recorded',
          uncertaintyNote: 'Laboratory loss-on-ignition / wet oxidation organic matter.',
          evidenceId: evSoilId,
        });
      }

      if (soilPropsRes && soilPropsRes.error === undefined) {
        const stype = soilPropsRes.providerId === 'usda_nrcs_sda' ? 'national_survey' : 'mapped_grid';
        if (soilPropsRes.phValue !== null) {
          mappedEstimates.push({
            property: 'Soil pH (Mapped)',
            depthInterval: soilPropsRes.depthInterval,
            valueDisplay: soilPropsRes.phValue.toFixed(1),
            unit: 'pH',
            sourceType: stype,
            providerLabel: soilPropsRes.providerName,
            dateLabel: soilPropsRes.retrievedAt.slice(0, 10),
            uncertaintyNote: soilPropsRes.spatialLabel,
            evidenceId: evSoilId,
          });
        }
        if (soilPropsRes.somDerivedPct !== null) {
          mappedEstimates.push({
            property: 'Organic Matter (Derived/Survey)',
            depthInterval: soilPropsRes.depthInterval,
            valueDisplay: `${soilPropsRes.somDerivedPct}%`,
            unit: '% SOM',
            sourceType: stype,
            providerLabel: soilPropsRes.providerName,
            dateLabel: soilPropsRes.retrievedAt.slice(0, 10),
            uncertaintyNote: soilPropsRes.uncertaintyNote,
            evidenceId: evSoilId,
          });
        }
        if (soilPropsRes.sandPct !== null && soilPropsRes.clayPct !== null) {
          mappedEstimates.push({
            property: 'Particle Fractions (Sand/Silt/Clay)',
            depthInterval: soilPropsRes.depthInterval,
            valueDisplay: `${soilPropsRes.sandPct}/${soilPropsRes.siltPct ?? '—'}/${soilPropsRes.clayPct}%`,
            unit: '%',
            sourceType: stype,
            providerLabel: soilPropsRes.providerName,
            dateLabel: soilPropsRes.retrievedAt.slice(0, 10),
            uncertaintyNote: `USDA Texture: ${soilPropsRes.textureClassUsda}`,
            evidenceId: evSoilId,
          });
        }
        if (soilPropsRes.cecCmolKg !== null) {
          mappedEstimates.push({
            property: 'Cation Exchange Capacity (CEC)',
            depthInterval: soilPropsRes.depthInterval,
            valueDisplay: `${soilPropsRes.cecCmolKg}`,
            unit: 'cmol(c)/kg',
            sourceType: stype,
            providerLabel: soilPropsRes.providerName,
            dateLabel: soilPropsRes.retrievedAt.slice(0, 10),
            uncertaintyNote: soilPropsRes.spatialLabel,
            evidenceId: evSoilId,
          });
        }
      }

      const labVsMapDiscrepancyNote =
        farmerPh !== null &&
        soilPropsRes?.phValue !== null &&
        soilPropsRes?.phValue !== undefined &&
        Math.abs(farmerPh - soilPropsRes.phValue) >= 0.7
          ? `Lab pH (${farmerPh.toFixed(1)}) differs from ${soilPropsRes.providerName} estimate (${soilPropsRes.phValue.toFixed(1)}) by ${Math.abs(farmerPh - soilPropsRes.phValue).toFixed(1)} pH — laboratory core value takes precedence.`
          : null;

      // Evidence coverage & confidence computation (HONESTLY separate from Health Score!)
      let coveragePts = 0;
      if (histDays.length >= 7) coveragePts += 20;
      if (fcDays.length >= 3) coveragePts += 12;
      if (terrainRes && terrainRes.elevationM !== null) coveragePts += 10;
      if (soilPropsRes && !soilPropsRes.error) coveragePts += 14;
      if (farmerPh !== null) coveragePts += 14;
      if (probeMoisturePct !== null) coveragePts += 12;
      else if (soilMoistureRes && soilMoistureRes.rootZoneMoisturePct !== null) coveragePts += 6;
      if (vegRes.status === 'valid') coveragePts += 12;
      if (cropConfirmed) coveragePts += 6;
      const coveragePct = Math.min(100, coveragePts);

      let confPts = 32;
      if (histRes && !histRes.error) confPts += 16;
      if (wbOut.dailyRows.some((d) => d.et0Method === 'FAO-56 Penman-Monteith')) confPts += 10;
      if (farmerPh !== null) confPts += 14;
      if (probeMoisturePct !== null && overrideMoistureStatus === 'measured') confPts += 12;
      if (vegRes.status === 'valid') confPts += 10;
      if (cropConfirmed) confPts += 6;
      const confidencePct = Math.min(96, confPts);

      const fc7Slice = fcDays.slice(0, 7);
      const fcHi = fc7Slice
        .map((d) => d.tMaxC)
        .filter((v): v is number => v !== null);
      const fcLo = fc7Slice
        .map((d) => d.tMinC)
        .filter((v): v is number => v !== null);
      const forecastHighLow7d =
        fcHi.length > 0 && fcLo.length > 0
          ? `${Math.max(...fcHi).toFixed(1)}° / ${Math.min(...fcLo).toFixed(1)}°`
          : 'Unavailable';

      const fieldRoutine = farmRoutines.find(
        (r) => r.fieldId === null || r.fieldId === fl.id
      );

      const partialAssessment: FieldDeepAssessment = {
        fieldId: fl.id,
        fieldName: fl.name,
        areaHa: fl.areaHa,
        geometryVersionId: fl.geometryVersionId,
        centroid: fl.centroid,
        cropName: fl.cropName,
        cropConfirmed,
        cropStage: stageKc.stageLabel,
        conditionLabel: 'Good',
        healthScore: null,
        coveragePct,
        confidencePct,
        leadingFinding: 'Evaluating field indicators…',
        recommendedNextAction: 'Continue monitoring',
        lastUpdatedAt: nowIso,
        waterSummary: {
          et0MeanMmDay: wbOut.et0MeanMmDay,
          et0Method:
            wbOut.dailyRows.find((d) => d.et0Mm !== null)?.et0Method ?? 'Unavailable',
          kcApplied: stageKc.kc,
          etcPeriodMm: wbOut.etcTotalMm,
          observedPrecipMm: wbOut.observedPrecipTotalMm,
          effectiveRainMm: wbOut.effectiveRainTotalMm,
          forecastRain7dMm: wbOut.forecastRainTotalMm,
          confirmedIrrigationMm: wbOut.confirmedIrrigationTotalMm,
          savedRoutineLabel: fieldRoutine
            ? `${fieldRoutine.description} (${fieldRoutine.needsReconfirmation ? 'Needs reconfirmation' : 'Saved routine — unconfirmed until logged'})`
            : null,
          netBalanceMm: wbOut.netBalanceMm,
          tawMm: wbOut.tawMm,
          rawMm: wbOut.rawMm,
          latestDepletionMm: wbOut.latestDepletionMm,
          tawUnavailableReason: wbOut.tawUnavailableReason,
          surfaceMoisturePct:
            probeMoisturePct ?? soilMoistureRes?.surfaceMoisturePct ?? null,
          surfaceMoistureSource:
            probeMoisturePct !== null
              ? `Farmer ${overrideMoistureStatus}: ${farmCtx.soil.moistureMethod || 'Probe'}`
              : soilMoistureRes?.surfaceDepthLabel ?? 'Unavailable',
          rootZoneMoisturePct: soilMoistureRes?.rootZoneMoisturePct ?? null,
          rootZoneMoistureSource: soilMoistureRes?.providerName ?? 'Unavailable',
          dailyRows: wbOut.dailyRows,
        },
        soilSummary: {
          labValues,
          mappedEstimates,
          textureClass: effectiveTex,
          textureSource: texSource,
          elevationM: farmCtx.soil.elevationM ?? terrainRes?.elevationM ?? null,
          slopePct: farmCtx.soil.slopePct ?? terrainRes?.slopePct ?? null,
          terrainSource:
            farmCtx.soil.elevationM !== null ? 'Farmer profile + DEM' : terrainRes?.providerName ?? 'Unavailable',
          labVsMapDiscrepancyNote,
        },
        vegetationSummary: vegRes,
        weatherSummary: {
          currentTempC: fcRes?.currentTempC ?? null,
          forecastHighLow7d,
          periodMeanTempC: weatherExp.periodMeanTempC,
          periodPrecipTotalMm: weatherExp.periodPrecipTotalMm,
          drySpellDays: weatherExp.maxConsecutiveDryDays,
          rainfallAnomalyMm,
          rainfallAnomalyPct,
          gddAccumulated: weatherExp.gddAccumulated,
          gddConfig: weatherExp.config,
          gddNote: weatherExp.note,
          heatStressDays: weatherExp.heatStressDays,
          frostDays: weatherExp.frostDays,
          solarRadiationMeanMjM2: weatherExp.solarRadiationMeanMjM2,
        },
      };

      const farmerPestNotes = farmCtx.observations
        .filter(
          (o) =>
            o.category === 'pest_disease' &&
            (o.fieldId === null || o.fieldId === undefined || o.fieldId === fl.id)
        )
        .map((o) => `${String(o.title)}: ${String(o.detail)}`);

      const evalOut = evaluateFieldRisksAndActions({
        farmId: farmCtx.farmId,
        fieldId: fl.id,
        fieldName: fl.name,
        crop,
        cropConfirmed,
        cropStage: stageKc.stageLabel,
        coveragePct,
        confidencePct,
        probeMoisturePct,
        probeMoistureStatus: overrideMoistureStatus,
        phValue: farmerPh ?? soilPropsRes?.phValue ?? null,
        phIsLab: farmerPh !== null,
        ecDsM: farmCtx.water.ecDsM,
        waterReliability: farmCtx.water.reliability,
        fieldAssessment: partialAssessment,
        eonetNearbyTitles: hazardsRes?.nearbyEvents.map((e) => `${e.title} (${e.distanceKm} km)`) ?? [],
        evidenceIds: {
          water: evWaterId,
          soilPh: evSoilId,
          terrain: evTerrainId,
          weather: evWeatherId,
          vegetation: evVegId,
          ec: evWaterId,
          eonet: evEonetId,
        },
        farmerPestWatchNotes: farmerPestNotes,
      });

      partialAssessment.conditionLabel = evalOut.conditionLabel;
      partialAssessment.healthScore = evalOut.healthScore;
      partialAssessment.leadingFinding =
        evalOut.findings[0]?.title ||
        evalOut.watchPoints[0]?.title ||
        (coveragePct < 40
          ? 'Awaiting soil lab / field profile entries'
          : 'No risk thresholds exceeded');
      partialAssessment.recommendedNextAction =
        evalOut.recommendations[0]?.title || 'Maintain standard scouting & irrigation logs';

      fieldAssessments.push(partialAssessment);
      allFindings.push(...evalOut.findings);
      allWatchPoints.push(...evalOut.watchPoints);
      allRecs.push(...evalOut.recommendations);

      // Register detailed EvidenceRecords for Section J Explorer Drawer
      evidenceById[evWaterId] = {
        evidenceId: evWaterId,
        metricName: 'Root-Zone Water Balance & Moisture Deficit',
        valueDisplay:
          wbOut.netBalanceMm !== null
            ? `${wbOut.netBalanceMm > 0 ? '+' : ''}${wbOut.netBalanceMm} mm`
            : 'Unavailable',
        unit: 'mm water depth',
        farmId: farmCtx.farmId,
        fieldId: fl.id,
        fieldName: fl.name,
        geometryVersionId: fl.geometryVersionId,
        observationPeriod: `${histDays[0]?.date ?? curJob.dateRange.from} to ${histDays[histDays.length - 1]?.date ?? curJob.dateRange.to}`,
        retrievedAt: nowIso,
        providerId: histRes?.providerId || 'nasa_power_daily',
        providerName: `${histRes?.providerName || 'NASA POWER'} + ${fcRes?.providerName || 'Open-Meteo'}`,
        productId: `${partialAssessment.waterSummary.et0Method} + USDA SCS + FAO-56 Dr(i)`,
        sourceUrl: histRes?.sourceUrl || 'https://power.larc.nasa.gov/',
        sourceType: 'calculated',
        spatialResolution: histRes?.spatialLabel || '0.5° (~55 km)',
        qualityFlags: [
          partialAssessment.waterSummary.et0Method,
          farmRoutines.length > 0 ? 'routines_kept_separate_from_confirmed_logs' : 'confirmed_logs_only',
        ],
        missingValueHandling: wbOut.tawUnavailableReason || 'Missing hydraulic inputs leave TAW/Dr unavailable rather than 0.',
        formulaDisplay:
          'FAO-56 Penman-Monteith ET₀ -> ETc = Kc × ET₀ -> Peff (USDA SCS) -> Dr(i) = Dr(i-1) - Peff - I_confirmed + ETc',
        formulaVersion: WATER_BALANCE_ENGINE_VERSION,
        inputsUsed: [
          {
            name: 'Mean Daily ET₀',
            value: wbOut.et0MeanMmDay !== null ? `${wbOut.et0MeanMmDay} mm/d` : 'Unavailable',
            source: partialAssessment.waterSummary.et0Method,
          },
          {
            name: 'Crop Coefficient (Kc)',
            value: stageKc.kc !== null ? String(stageKc.kc) : 'N/A',
            source: stageKc.sourceNote,
          },
          {
            name: 'Effective Rainfall / Confirmed Irrigation',
            value: `${wbOut.effectiveRainTotalMm ?? '—'} mm / ${wbOut.confirmedIrrigationTotalMm} mm`,
            source: 'USDA SCS Peff + Field Shift irrigationLogs',
          },
          {
            name: 'TAW / RAW',
            value: wbOut.tawMm !== null ? `${wbOut.tawMm} mm / ${wbOut.rawMm} mm` : 'Unavailable',
            source: hydraulics?.methodNote || 'Missing soil/root params',
          },
        ],
        modelVersions: {
          engineVersion: ADVANCED_ENGINE_VERSION,
          cropKnowledgeVersion: CROP_DATABASE_VERSION,
          ruleSetVersion: RULESET_VERSION,
        },
        confidencePct,
        confidenceLabel: confidencePct >= 75 ? 'High' : confidencePct >= 50 ? 'Moderate' : 'Low',
        limitations:
          wbOut.tawUnavailableReason ||
          'Gridded meteorology (~9–55 km) does not capture local micro-sprinkler drift or unlogged irrigation passes.',
      };

      evidenceById[evSoilId] = {
        evidenceId: evSoilId,
        metricName: 'Soil Reaction (pH), Texture & Survey Profile',
        valueDisplay:
          farmerPh !== null
            ? `Lab pH ${farmerPh.toFixed(1)} (${effectiveTex})`
            : soilPropsRes?.phValue !== null && soilPropsRes?.phValue !== undefined
              ? `Mapped pH ${soilPropsRes.phValue.toFixed(1)} (${effectiveTex})`
              : 'Lab soil test required',
        unit: 'pH / USDA Texture',
        farmId: farmCtx.farmId,
        fieldId: fl.id,
        fieldName: fl.name,
        geometryVersionId: fl.geometryVersionId,
        observationPeriod: farmCtx.soil.phTestDate || 'Static Soil Survey',
        retrievedAt: soilPropsRes?.retrievedAt || nowIso,
        providerId: soilPropsRes?.providerId || 'usda_nrcs_sda',
        providerName: farmerPh !== null ? 'Farmer Lab Assay + Mapped Survey Reference' : soilPropsRes?.providerName || 'Unavailable',
        productId: soilPropsRes?.productId || 'Soil Baseline',
        sourceUrl: soilPropsRes?.sourceUrl || 'https://sdmdataaccess.sc.egov.usda.gov/',
        sourceType: farmerPh !== null ? 'farmer_reported' : 'modelled',
        spatialResolution: soilPropsRes?.spatialLabel || '250 m',
        qualityFlags: [
          farmerPh !== null ? 'farmer_lab_prioritized' : 'mapped_survey_only',
          labVsMapDiscrepancyNote ? 'lab_vs_map_discrepancy_flagged' : 'consistent',
        ],
        missingValueHandling: 'Farmer lab unknowns remain Untested; ISRIC REST timeout bypassed cleanly to USDA SDA / SoilGrids WCS.',
        formulaDisplay:
          'USDA Soil Texture Triangle (sand+silt+clay within 97–103%); SOM = SOC × 1.724 (Van Bemmelen)',
        formulaVersion: SOIL_ENGINE_VERSION,
        inputsUsed: [
          { name: 'Lab Soil pH', value: farmerPh !== null ? farmerPh.toFixed(1) : 'Not tested', source: 'Farmer Profile' },
          { name: 'Survey / WCS pH', value: soilPropsRes?.phValue?.toFixed(1) ?? 'Unavailable', source: soilPropsRes?.providerName || 'Mapped' },
          { name: 'Texture Class', value: effectiveTex, source: texSource },
        ],
        modelVersions: {
          engineVersion: ADVANCED_ENGINE_VERSION,
          cropKnowledgeVersion: CROP_DATABASE_VERSION,
          ruleSetVersion: RULESET_VERSION,
        },
        confidencePct: farmerPh !== null ? 88 : 54,
        confidenceLabel: farmerPh !== null ? 'High' : 'Moderate',
        limitations: soilPropsRes?.uncertaintyNote || 'Composite soil lab samples every 2–3 years remain authoritative.',
      };

      evidenceById[evWeatherId] = {
        evidenceId: evWeatherId,
        metricName: 'Growing Degree Days (GDD), Dry Spell & Rainfall Anomaly',
        valueDisplay:
          weatherExp.gddAccumulated !== null
            ? `${weatherExp.gddAccumulated} °C·d`
            : `${weatherExp.periodPrecipTotalMm ?? '—'} mm rain`,
        unit: weatherExp.gddAccumulated !== null ? 'GDD (°C·days)' : 'mm',
        farmId: farmCtx.farmId,
        fieldId: fl.id,
        fieldName: fl.name,
        geometryVersionId: fl.geometryVersionId,
        observationPeriod: `${histDays[0]?.date ?? curJob.dateRange.from} to ${histDays[histDays.length - 1]?.date ?? curJob.dateRange.to}`,
        retrievedAt: histRes?.retrievedAt || nowIso,
        providerId: histRes?.providerId || 'nasa_power_daily',
        providerName: histRes?.providerName || 'NASA POWER',
        productId: histRes?.productId || 'POWER AG Daily',
        sourceUrl: histRes?.sourceUrl || 'https://power.larc.nasa.gov/',
        sourceType: histRes?.evidenceType || 'reanalysis',
        spatialResolution: histRes?.spatialLabel || '0.5° (~55 km)',
        qualityFlags: [
          weatherExp.config ? `gdd_${weatherExp.config.method}` : 'no_crop_gdd_skipped',
          histRes?.precipDisagreementNote ? 'cross_check_precip_divergence' : 'cross_check_ok',
        ],
        missingValueHandling: 'Fill values (-999) stripped prior to summation; days missing Tmin/Tmax excluded.',
        formulaDisplay:
          weatherExp.config
            ? `Single-Sine GDD (Baskerville-Emin 1969), Tbase=${weatherExp.config.baseTempC}°C, Tupper=${weatherExp.config.upperTempC}°C`
            : 'Daily mean temperature and dry-day (<1 mm/d) spell length',
        formulaVersion: GDD_ENGINE_VERSION,
        inputsUsed: [
          { name: 'Period Mean Temp', value: weatherExp.periodMeanTempC !== null ? `${weatherExp.periodMeanTempC} °C` : '—', source: histRes?.providerName || 'Climate grid' },
          { name: 'Period Precipitation', value: weatherExp.periodPrecipTotalMm !== null ? `${weatherExp.periodPrecipTotalMm} mm` : '—', source: histRes?.providerName || 'Climate grid' },
          { name: 'Cross-Check Total', value: histRes?.crossCheckPrecipTotalMm !== null && histRes?.crossCheckPrecipTotalMm !== undefined ? `${histRes.crossCheckPrecipTotalMm} mm` : '—', source: histRes?.crossCheckPrecipProvider || 'ERA5-Land' },
        ],
        modelVersions: {
          engineVersion: ADVANCED_ENGINE_VERSION,
          cropKnowledgeVersion: CROP_DATABASE_VERSION,
          ruleSetVersion: RULESET_VERSION,
        },
        confidencePct: histRes && !histRes.error ? 78 : 30,
        confidenceLabel: histRes && !histRes.error ? 'Moderate' : 'Low',
        limitations: histRes?.precipDisagreementNote || '0.5° (~55 km) climate grid cannot resolve isolated local thunderstorms.',
      };

      evidenceById[evVegId] = {
        evidenceId: evVegId,
        metricName: 'Satellite Canopy Reflectance (Sentinel-2 L2A NDVI)',
        valueDisplay:
          vegRes.ndviMean !== null ? `${vegRes.ndviMean.toFixed(3)} NDVI` : vegRes.status.toUpperCase(),
        unit: 'NDVI (-1 to +1)',
        farmId: farmCtx.farmId,
        fieldId: fl.id,
        fieldName: fl.name,
        geometryVersionId: fl.geometryVersionId,
        observationPeriod: vegRes.sceneDate || 'Last 90 days scan',
        retrievedAt: nowIso,
        providerId: 'sentinel2_pc_stac',
        providerName: vegRes.providerName,
        productId: vegRes.sceneId || vegRes.productId,
        sourceUrl: 'https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a',
        sourceType: 'satellite_derived',
        spatialResolution: '10 m Red/NIR (B04/B08), 20 m SCL cloud mask',
        spatialCoverage: {
          fieldAreaM2: Math.round(fl.areaHa * 10000),
          sourcePixelSizeM: 10,
          intersectingPixelCount: vegRes.sclBreakdown?.totalPixels ?? vegRes.validPixelCount,
          validPixelCount: vegRes.validPixelCount,
          validAreaM2: vegRes.validPixelCount * 100,
          validCoveragePct: vegRes.validCoveragePct,
          aggregation: 'area_weighted_mean',
          spatialFit: vegRes.spatialFit,
          geometryVersionId: fl.geometryVersionId,
        },
        qualityFlags: [
          `scl_valid_${vegRes.validCoveragePct}pct`,
          vegRes.status,
        ],
        missingValueHandling: 'Cloud, cirrus, cloud shadow & nodata pixels masked via Sentinel-2 SCL; scenes <45% valid pixels marked cloudy/insufficient.',
        formulaDisplay: 'NDVI = (B08 - B04) / (B08 + B04) masked to SCL classes {4 Vegetation, 5 Bare Soil, 6 Water}',
        formulaVersion: 's2-l2a-scl-v1.0',
        inputsUsed: [
          { name: 'NDVI Mean / Median', value: vegRes.ndviMean !== null ? `${vegRes.ndviMean} / ${vegRes.ndviMedian}` : 'Unavailable', source: vegRes.sceneId || 'Sentinel-2' },
          { name: 'Baseline Scene NDVI', value: vegRes.baselineNdviMean !== null ? `${vegRes.baselineNdviMean} (${vegRes.baselineSceneDate})` : 'None < 90d', source: 'Planetary Computer STAC' },
          { name: 'Valid Clear Pixels', value: `${vegRes.validPixelCount} (${vegRes.validCoveragePct}%)`, source: 'SCL Polygon Mask' },
        ],
        modelVersions: {
          engineVersion: ADVANCED_ENGINE_VERSION,
          cropKnowledgeVersion: CROP_DATABASE_VERSION,
          ruleSetVersion: RULESET_VERSION,
        },
        confidencePct: vegRes.status === 'valid' ? 84 : 30,
        confidenceLabel: vegRes.status === 'valid' ? 'High' : 'Low',
        limitations: 'Optical NDVI measures green canopy reflectance only and cannot diagnose specific pests, nutrient deficiency, or harvest vs stress without scouting.',
      };

      evidenceById[evTerrainId] = {
        evidenceId: evTerrainId,
        metricName: 'Terrain Elevation & Slope Gradient',
        valueDisplay:
          partialAssessment.soilSummary.elevationM !== null
            ? `${partialAssessment.soilSummary.elevationM} m (${partialAssessment.soilSummary.slopePct ?? '—'}% slope)`
            : 'Unavailable',
        unit: 'm / % slope',
        farmId: farmCtx.farmId,
        fieldId: fl.id,
        fieldName: fl.name,
        geometryVersionId: fl.geometryVersionId,
        observationPeriod: 'Static DEM Baseline',
        retrievedAt: terrainRes?.retrievedAt || nowIso,
        providerId: terrainRes?.providerId || 'open_meteo_dem',
        providerName: terrainRes?.providerName || 'Copernicus DEM',
        productId: terrainRes?.productId || 'GLO-90',
        sourceUrl: terrainRes?.sourceUrl || 'https://open-meteo.com/en/docs/elevation-api',
        sourceType: 'satellite_derived',
        spatialResolution: `${terrainRes?.spatialResolutionM ?? 90} m DEM`,
        qualityFlags: ['5_point_finite_difference'],
        missingValueHandling: 'Retains farm-entered elevation/slope if DEM unreachable.',
        formulaDisplay: 'Central finite difference: slope% = 100 × √((ΔZ_NS/2d)² + (ΔZ_EW/2d)²)',
        formulaVersion: 'dem-fd-v1.0',
        inputsUsed: [
          { name: 'Center Elevation', value: `${partialAssessment.soilSummary.elevationM ?? '—'} m`, source: elevSource },
          { name: 'Slope Gradient', value: `${partialAssessment.soilSummary.slopePct ?? '—'}%`, source: terrainRes?.aspectLabel || 'DEM' },
        ],
        modelVersions: {
          engineVersion: ADVANCED_ENGINE_VERSION,
          cropKnowledgeVersion: CROP_DATABASE_VERSION,
          ruleSetVersion: RULESET_VERSION,
        },
        confidencePct: terrainRes && !terrainRes.error ? 86 : 40,
        confidenceLabel: terrainRes && !terrainRes.error ? 'High' : 'Low',
        limitations: '90 m DEM smooths micro-berms or laser-leveled ditches under ~45 m scale.',
      };

      evidenceById[evEonetId] = {
        evidenceId: evEonetId,
        metricName: 'Regional Natural Hazard Scan (NASA EONET v3)',
        valueDisplay: `${hazardsRes?.nearbyEvents.length ?? 0} event(s) within 300 km`,
        unit: 'open events',
        farmId: farmCtx.farmId,
        fieldId: fl.id,
        fieldName: fl.name,
        geometryVersionId: fl.geometryVersionId,
        observationPeriod: 'Active / Last 30 days',
        retrievedAt: hazardsRes?.retrievedAt || nowIso,
        providerId: 'nasa_eonet_v3',
        providerName: 'NASA EONET v3',
        productId: 'Open Natural Events',
        sourceUrl: hazardsRes?.sourceUrl || 'https://eonet.gsfc.nasa.gov/api/v3/events',
        sourceType: 'observed',
        spatialResolution: '300 km haversine buffer around field centroid',
        qualityFlags: hazardsRes?.error ? ['provider_unavailable'] : ['live_checked'],
        missingValueHandling: 'Returns empty list on unavailable feed with explicit warning.',
        formulaDisplay: 'Great-circle Haversine distance ≤ 300 km from field centroid',
        formulaVersion: 'eonet-v3',
        inputsUsed: [
          {
            name: 'Nearest Hazard',
            value: hazardsRes?.nearbyEvents[0]
              ? `${hazardsRes.nearbyEvents[0].title} (${hazardsRes.nearbyEvents[0].distanceKm} km)`
              : 'None within 300 km',
            source: 'NASA EONET v3',
          },
        ],
        modelVersions: {
          engineVersion: ADVANCED_ENGINE_VERSION,
          cropKnowledgeVersion: CROP_DATABASE_VERSION,
          ruleSetVersion: RULESET_VERSION,
        },
        confidencePct: hazardsRes && !hazardsRes.error ? 85 : 25,
        confidenceLabel: hazardsRes && !hazardsRes.error ? 'High' : 'Low',
        limitations: 'Regional satellite hazard points do not substitute for county emergency advisories.',
      };
    }

    curJob = updateJobInStore(runId, (j) =>
      markStage(
        markStage(
          markStage(j, 'CALCULATING_INDICATORS', 'complete'),
          'EVALUATING_FIELD_RULES',
          'complete',
          `${allFindings.length} finding(s), ${allWatchPoints.length} watch point(s)`
        ),
        'BUILDING_FIELD_ASSESSMENTS',
        'complete'
      )
    )!;
    if (checkCancelled()) return null;

    // Stage: BUILDING_FARM_SUMMARY (non-masking)
    const overallSummary = aggregateFarmSummary({
      farmName: farmCtx.name,
      fieldAssessments,
      findings: allFindings,
      watchPoints: allWatchPoints,
      recommendations: allRecs,
      evidenceRegistry: evidenceById,
    });

    curJob = updateJobInStore(runId, (j) =>
      markStage(
        markStage(j, 'BUILDING_FARM_SUMMARY', 'complete', overallSummary.conditionLabel),
        'COMPARING_PREVIOUS_REPORT',
        'running'
      )
    )!;

    // Stage: COMPARING_PREVIOUS_REPORT
    const currentStore = readAdvancedStore();
    const prevReport = currentStore.reports.find(
      (r) =>
        r.farmId === farmCtx.farmId &&
        (r.status === 'complete' || r.status === 'partial')
    ) ?? null;

    const draftReportForCompare: DeepAnalysisReport = {
      id: `rep-${runId}`,
      farmId: farmCtx.farmId,
      farmName: farmCtx.name,
      fieldIds: scopedFields.map((f) => f.id),
      scope: curJob.scope,
      runType: curJob.runType,
      triggerReason: curJob.triggerReason,
      dateRange: curJob.dateRange,
      createdAt: curJob.requestedAt,
      completedAt: new Date().toISOString(),
      status:
        sourceOutcomes.some((s) => s.status === 'unavailable') &&
        sourceOutcomes.some((s) => s.status !== 'unavailable')
          ? 'partial'
          : 'complete',
      inputSnapshotId,
      geometryVersionIds,
      profileVersionIds,
      dataObservationIds: allObservations.map((o) => o.observationId),
      engineVersion: ADVANCED_ENGINE_VERSION,
      cropKnowledgeVersion: CROP_DATABASE_VERSION,
      ruleSetVersion: RULESET_VERSION,
      reportHash: '',
      previousComparableReportId: prevReport?.id ?? null,
      overallSummary,
      fieldAssessments,
      findings: allFindings,
      watchPoints: allWatchPoints,
      recommendations: allRecs,
      sourceOutcomes,
      observations: allObservations,
      evidenceById,
      warnings: sourceOutcomes
        .filter((s) => s.status === 'unavailable' || s.status === 'fallback')
        .map((s) => `${s.providerName}: ${s.note}`),
      aiExplanation: {
        available: false,
        modelUsed: null,
        simpleSummary: null,
        advancedSummary: null,
        keyDrivers: [],
      },
      comparisonWithPrevious: null,
    };

    if (prevReport) {
      const actionsBetween = (prevReport.recommendations || [])
        .filter((a) => a.status === 'Completed' || a.status === 'Scheduled')
        .map((a) => ({ title: a.title, status: a.status }));
      draftReportForCompare.comparisonWithPrevious = compareImmutableReports(
        prevReport,
        draftReportForCompare,
        actionsBetween
      );
    }

    curJob = updateJobInStore(runId, (j) =>
      markStage(
        markStage(j, 'COMPARING_PREVIOUS_REPORT', 'complete'),
        'GENERATING_EXPLANATIONS',
        'running'
      )
    )!;
    if (checkCancelled()) return null;

    // Stage: GENERATING_EXPLANATIONS (Gemini bounded explainer — never modifies findings)
    draftReportForCompare.aiExplanation = await generateBoundedReportExplanation(
      draftReportForCompare
    );

    curJob = updateJobInStore(runId, (j) =>
      markStage(
        markStage(j, 'GENERATING_EXPLANATIONS', 'complete'),
        'VALIDATING_REPORT',
        'running'
      )
    )!;

    // Stage: VALIDATING_REPORT (scientific integrity audit before immutable save)
    const missingCriticalFeeds = sourceOutcomes.filter((s) => s.status === 'unavailable').length;
    if (missingCriticalFeeds === sourceOutcomes.length) {
      draftReportForCompare.status = 'failed';
      updateJobInStore(runId, (j) => ({
        ...markStage(j, 'VALIDATING_REPORT', 'failed', 'All external telemetry providers failed.'),
        status: 'failed',
        currentStage: 'FAILED',
        finishedAt: new Date().toISOString(),
        errorCode: 'ALL_PROVIDERS_UNAVAILABLE',
        errorMessage: 'Every external telemetry source failed; existing good report preserved intact.',
      }));
      return null;
    }

    draftReportForCompare.completedAt = new Date().toISOString();
    draftReportForCompare.reportHash = hashInputPayload({
      id: draftReportForCompare.id,
      summary: draftReportForCompare.overallSummary,
      findings: draftReportForCompare.findings.map((f) => f.id),
      obsIds: draftReportForCompare.dataObservationIds,
    });

    curJob = updateJobInStore(runId, (j) =>
      markStage(
        markStage(j, 'VALIDATING_REPORT', 'complete', 'Scientific checks passed'),
        'PERSISTING_REPORT',
        'running'
      )
    )!;

    // Stage: PERSISTING_REPORT (append-only immutable persistence + deduplicated notifications)
    const latestStore = readAdvancedStore();
    latestStore.reports = [draftReportForCompare, ...latestStore.reports].slice(0, 60);

    // Update schedule lastRunAt if linked or default
    const finishedJobRef = curJob!;
    const sched = latestStore.schedules.find(
      (s) => s.id === finishedJobRef.scheduleId || s.farmId === farmCtx.farmId
    );
    const shouldEvaluateNotifs =
      finishedJobRef.runType === 'scheduled' ||
      allFindings.some((f) => f.severity === 'high' || f.severity === 'critical');

    if (shouldEvaluateNotifs) {
      const quiet = isWithinQuietHours(sched?.quietHours ?? null, farmCtx.timezone);
      const notifyEnabled = sched ? sched.notifyOnImportantChanges : true;
      const newNotifs: NotificationRecord[] = [];
      const addDedupNotif = (n: Omit<NotificationRecord, 'id' | 'createdAt' | 'read'>) => {
        if (!notifyEnabled && n.severity !== 'critical') return;
        const alreadySentToday = latestStore.notifications.some(
          (x) =>
            x.dedupeKey === n.dedupeKey &&
            Date.now() - Date.parse(x.createdAt) < 12 * 3600 * 1000
        );
        if (!alreadySentToday) {
          newNotifs.push({
            ...n,
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            createdAt: new Date().toISOString(),
            read: quiet && n.severity === 'info',
          });
        }
      };

      const highFinding = allFindings.find(
        (f) => f.severity === 'high' || f.severity === 'critical'
      );
      if (highFinding) {
        addDedupNotif({
          farmId: farmCtx.farmId,
          scheduleId: curJob.scheduleId ?? null,
          jobId: runId,
          reportId: draftReportForCompare.id,
          kind: 'new_high_finding',
          severity: highFinding.severity === 'critical' ? 'critical' : 'warning',
          title: `${farmCtx.name}: ${highFinding.title}`,
          message: `${highFinding.fieldName} — ${highFinding.triggerMetricSummary}. Next step: ${draftReportForCompare.overallSummary.priorityNextAction}`,
          dedupeKey: `finding:${farmCtx.farmId}:${highFinding.ruleId}:${highFinding.fieldId}`,
        });
      }

      if (
        curJob.runType === 'scheduled' &&
        draftReportForCompare.status === 'complete' &&
        !quiet
      ) {
        addDedupNotif({
          farmId: farmCtx.farmId,
          scheduleId: curJob.scheduleId ?? null,
          jobId: runId,
          reportId: draftReportForCompare.id,
          kind: 'scheduled_complete',
          severity: 'info',
          title: `Scheduled Deep Analysis completed — ${farmCtx.name}`,
          message: `${draftReportForCompare.overallSummary.conditionLabel}${
            draftReportForCompare.overallSummary.healthScore !== null
              ? ` (${draftReportForCompare.overallSummary.healthScore}%)`
              : ''
          } across ${scopedFields.length} field(s).`,
          dedupeKey: `sched_ok:${farmCtx.farmId}:${draftReportForCompare.completedAt.slice(0, 10)}`,
        });
      }

      if (newNotifs.length > 0) {
        latestStore.notifications = [...newNotifs, ...latestStore.notifications].slice(0, 100);
      }
    }

    appendAuditEvent(
      latestStore,
      farmCtx.farmId,
      'DEEP_ANALYSIS_COMPLETED',
      `Report ${draftReportForCompare.id} persisted (${draftReportForCompare.status}, ${overallSummary.conditionLabel})`,
      curJob.runType === 'scheduled' ? 'Automation Scheduler' : 'Farm Manager'
    );
    writeAdvancedStore(latestStore);

    // Sync lightweight summary card to portfolio store
    syncReportSummaryToPortfolio(draftReportForCompare);

    updateJobInStore(runId, (j) => ({
      ...markStage(j, 'PERSISTING_REPORT', 'complete', `Report ${draftReportForCompare.id} saved`),
      status: draftReportForCompare.status === 'partial' ? 'partial' : 'complete',
      currentStage: draftReportForCompare.status === 'partial' ? 'PARTIAL' : 'COMPLETE',
      finishedAt: draftReportForCompare.completedAt,
      reportId: draftReportForCompare.id,
    }));

    return draftReportForCompare;
  } catch (err) {
    updateJobInStore(runId, (j) => ({
      ...j,
      status: 'failed',
      currentStage: 'FAILED',
      finishedAt: new Date().toISOString(),
      errorCode: 'PIPELINE_EXCEPTION',
      errorMessage: err instanceof Error ? err.message : 'Unexpected analysis pipeline failure',
    }));
    return null;
  }
}
