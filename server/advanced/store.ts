import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ActionStatus,
  AnalysisJob,
  AutomationSchedule,
  DeepAnalysisReport,
  FarmPracticeRoutine,
  NotificationRecord,
  ParsedPracticeDraft,
} from '../../src/types/advanced';
import {
  readMapsStore,
  readPortfolioStore,
  recordDomainOutboxEvent,
  writePortfolioStore,
} from '../myFarmsRouter';
import { GeoJsonPolygonGeometry } from '../../src/types/maps';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', '..', '.data');
const ADVANCED_STORE_PATH = path.join(DATA_DIR, 'advanced-analysis-store.json');

export interface AuditEventRecord {
  id: string;
  farmId: string;
  eventType: string;
  actor: string;
  detail: string;
  occurredAt: string;
}

export interface AdvancedAnalysisStore {
  reports: DeepAnalysisReport[];
  jobs: AnalysisJob[];
  schedules: AutomationSchedule[];
  routines: FarmPracticeRoutine[];
  parsedDrafts: ParsedPracticeDraft[];
  notifications: NotificationRecord[];
  auditEvents: AuditEventRecord[];
  idempotencyKeys: Record<string, string>; // key -> jobId or entityId
}

export interface HydratedFarmField {
  id: string;
  farmId: string;
  name: string;
  cropId: string | null;
  cropName: string | null;
  areaHa: number;
  geometry: GeoJsonPolygonGeometry | null;
  geometryVersionId: string;
  centroid: { lat: number; lon: number };
  soilOverrides?: Record<string, unknown>;
  waterOverrides?: Record<string, unknown>;
  previousCrops: string[];
  activeAlertsCount: number;
  status: string;
  updatedAt: string;
}

export interface HydratedFarmContext {
  farmId: string;
  name: string;
  regionLabel: string;
  timezone: string;
  primaryCrop: string | null;
  areaHa: number;
  isPrivate: boolean;
  centroid: { lat: number; lon: number } | null;
  geometry: GeoJsonPolygonGeometry | null;
  soil: {
    texture: string;
    moistureStatus: 'measured' | 'estimated' | 'unknown';
    moisturePct: number | null;
    moistureMethod: string;
    moistureDate: string;
    phStatus: 'tested' | 'not_tested';
    phValue: number | null;
    phTestDate: string;
    organicMatterPct: number | null;
    drainage: string;
    slopePct: number | null;
    elevationM: number | null;
  };
  water: {
    sources: string[];
    reliability: string;
    dailyCapacityKnown: boolean;
    dailyCapacityM3: number | null;
    qualityTested: string;
    ecDsM: number | null;
    salinityPpm: number | null;
    qualityTestDate: string;
    wateringMethod: string;
    irrigationMethod: string;
    irrigationFrequency: string;
  };
  fields: HydratedFarmField[];
  observations: Array<Record<string, unknown>>;
  irrigationLogs: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  updatedAt: string;
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Timezone/DST-safe next scheduled run computation using Intl.DateTimeFormat for IANA zone.
 */
export function computeNextRunIso(
  frequency: AutomationSchedule['frequency'],
  preferredTime: string,
  timezone: string,
  fromMs = Date.now()
): string {
  const daysMap: Record<AutomationSchedule['frequency'], number> = {
    daily: 1,
    every_3_days: 3,
    weekly: 7,
    biweekly: 14,
    monthly: 30,
  };
  const [hhRaw, mmRaw] = preferredTime.split(':').map(Number);
  const targetH = Number.isFinite(hhRaw) ? Math.max(0, Math.min(23, hhRaw)) : 9;
  const targetM = Number.isFinite(mmRaw) ? Math.max(0, Math.min(59, mmRaw)) : 0;

  const base = new Date(fromMs + daysMap[frequency] * 86400000);

  // Align hour/minute cleanly inside the target IANA timezone without breaking on DST shifts
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = Object.fromEntries(fmt.formatToParts(base).map((p) => [p.type, p.value]));
    const tzH = Number(parts.hour) % 24;
    const tzM = Number(parts.minute);
    const diffMinutes = (targetH - tzH) * 60 + (targetM - tzM);
    const aligned = new Date(base.getTime() + diffMinutes * 60000);
    aligned.setUTCSeconds(0, 0);
    if (aligned.getTime() <= fromMs + 60000) {
      return new Date(aligned.getTime() + daysMap[frequency] * 86400000).toISOString();
    }
    return aligned.toISOString();
  } catch {
    base.setUTCHours(targetH, targetM, 0, 0);
    return base.toISOString();
  }
}

function getDefaultAdvancedStore(): AdvancedAnalysisStore {
  const nowIso = new Date().toISOString();
  const nextWeekIso = computeNextRunIso('weekly', '09:00', 'America/Los_Angeles', Date.now());
  return {
    reports: [],
    jobs: [],
    schedules: [
      {
        id: 'sched-gv-default',
        farmId: 'farm-green-valley',
        name: 'Weekly Deep Farm Monitor',
        enabled: true,
        status: 'active',
        scope: {
          type: 'all_fields',
          farmId: 'farm-green-valley',
          fieldIds: [],
          label: 'All Fields',
        },
        frequency: 'weekly',
        preferredTime: '09:00',
        timezone: 'America/Los_Angeles',
        refreshProviders: ['all'],
        useSavedRoutines: true,
        routineReconfirmDays: 14,
        notifyOnImportantChanges: true,
        quietHours: { start: '21:00', end: '06:00' },
        consent: {
          allowRemoteProviderRequests: true,
          allowRemoteJobProcessing: true,
          consentedAt: '2026-11-01T09:00:00.000Z',
          disclosedProviders: [
            'Open-Meteo Forecast & ERA5-Land',
            'NASA POWER & EONET v3',
            'USDA NRCS SSURGO / ISRIC SoilGrids WCS',
            'Sentinel-2 L2A (Planetary Computer)',
          ],
        },
        nextRunAt: nextWeekIso,
        lastRunAt: '2026-11-15T09:00:00.000Z',
        lastJobId: null,
        lastJobStatus: null,
        createdAt: '2026-10-25T09:00:00.000Z',
        updatedAt: nowIso,
      },
    ],
    routines: [
      {
        id: 'rtn-gv-drip-weekly',
        farmId: 'farm-green-valley',
        fieldId: 'field-gv-2',
        fieldName: 'East Creek Block 2',
        category: 'irrigation_routine',
        description: 'Weekly drip header check & ~4-hour maintenance flush when rainfall < 10 mm.',
        cadenceLabel: 'Weekly (Sunday morning)',
        assumedMethod: 'Drip irrigation',
        assumedVolumePerEventM3: null,
        lastConfirmedAt: '2026-10-22T08:00:00.000Z', // > 14 days old -> surfaces honest reconfirm prompt!
        needsReconfirmation: true,
        userConfirmed: true,
        createdAt: '2026-10-22T08:00:00.000Z',
      },
    ],
    parsedDrafts: [],
    notifications: [],
    auditEvents: [],
    idempotencyKeys: {},
  };
}

export function readAdvancedStore(): AdvancedAnalysisStore {
  try {
    if (!fs.existsSync(ADVANCED_STORE_PATH)) {
      const def = getDefaultAdvancedStore();
      writeJsonAtomic(ADVANCED_STORE_PATH, def);
      return def;
    }
    const raw = fs.readFileSync(ADVANCED_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AdvancedAnalysisStore>;
    const def = getDefaultAdvancedStore();
    return {
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      schedules: Array.isArray(parsed.schedules) ? parsed.schedules : def.schedules,
      routines: Array.isArray(parsed.routines) ? parsed.routines : def.routines,
      parsedDrafts: Array.isArray(parsed.parsedDrafts) ? parsed.parsedDrafts : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : [],
      idempotencyKeys:
        parsed.idempotencyKeys && typeof parsed.idempotencyKeys === 'object'
          ? parsed.idempotencyKeys
          : {},
    };
  } catch {
    return getDefaultAdvancedStore();
  }
}

export function writeAdvancedStore(store: AdvancedAnalysisStore): void {
  writeJsonAtomic(ADVANCED_STORE_PATH, store);
}

export function appendAuditEvent(
  store: AdvancedAnalysisStore,
  farmId: string,
  eventType: string,
  detail: string,
  actor = 'Farm Manager'
): void {
  store.auditEvents = [
    {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      farmId,
      eventType,
      actor,
      detail,
      occurredAt: new Date().toISOString(),
    },
    ...store.auditEvents,
  ].slice(0, 300);
}

export function hydrateFarmContext(farmId: string): HydratedFarmContext | null {
  const maps = readMapsStore();
  const port = readPortfolioStore();
  const mapFarm = maps.farms.find((f) => f.id === farmId && !f.deletedAt) ?? null;
  const meta = port.farmMeta[farmId] ?? null;
  if (!mapFarm && !meta) return null;

  const centroid = mapFarm?.centroid ?? meta?.centroid ?? null;
  const farmGeom: GeoJsonPolygonGeometry | null =
    mapFarm?.geometry && mapFarm.geometry.type === 'Polygon'
      ? (mapFarm.geometry as GeoJsonPolygonGeometry)
      : mapFarm?.geometry && mapFarm.geometry.type === 'MultiPolygon' && mapFarm.geometry.coordinates?.[0]
        ? { type: 'Polygon', coordinates: mapFarm.geometry.coordinates[0] }
        : null;

  const mapFields = maps.fields.filter((f) => f.farmId === farmId);
  const fields: HydratedFarmField[] = mapFields.map((fl) => {
    const fMeta = port.fieldMeta[fl.id];
    const ver = fl.versions?.[0];
    return {
      id: fl.id,
      farmId: fl.farmId,
      name: fl.name,
      cropId: fl.cropId ?? null,
      cropName: fl.cropName ?? meta?.primaryCrop ?? null,
      areaHa: ver?.netAreaHectares ?? 10,
      geometry: (ver?.geometry as GeoJsonPolygonGeometry) ?? farmGeom,
      geometryVersionId: fl.currentVersionId || ver?.geometryVersionId || `${fl.id}-v1`,
      centroid: ver?.centroid ?? centroid ?? { lat: 0, lon: 0 },
      soilOverrides: fMeta?.soilOverrides,
      waterOverrides: fMeta?.waterOverrides,
      previousCrops: fMeta?.previousCrops ?? [],
      activeAlertsCount: fMeta?.activeAlertsCount ?? 0,
      status: fl.status,
      updatedAt: fl.updatedAt,
    };
  });

  // If farm has no separate sub-field polygons yet, represent Whole Farm parcel as an explicit field unit cleanly
  if (fields.length === 0 && centroid) {
    fields.push({
      id: `${farmId}-whole`,
      farmId,
      name: `${mapFarm?.name || meta?.name || 'Main'} Parcel`,
      cropId: mapFarm?.crop?.toLowerCase() ?? meta?.primaryCrop?.toLowerCase() ?? null,
      cropName: mapFarm?.crop ?? meta?.primaryCrop ?? null,
      areaHa: mapFarm?.areaHa || meta?.declaredAreaHa || 20,
      geometry: farmGeom,
      geometryVersionId: `${farmId}-v${mapFarm?.versionNumber ?? meta?.versionNumber ?? 1}`,
      centroid,
      previousCrops: [],
      activeAlertsCount: 0,
      status: 'Active',
      updatedAt: mapFarm?.updatedAt ?? meta?.updatedAt ?? new Date().toISOString(),
    });
  }

  return {
    farmId,
    name: mapFarm?.name ?? meta?.name ?? 'Selected Farm',
    regionLabel: meta?.regionLabel ?? mapFarm?.locationLabel ?? 'Unassigned Region',
    timezone: meta?.timezone || 'UTC',
    primaryCrop: mapFarm?.crop ?? meta?.primaryCrop ?? null,
    areaHa: mapFarm?.areaHa || meta?.declaredAreaHa || fields.reduce((s, f) => s + f.areaHa, 0),
    isPrivate: meta?.isPrivate ?? true,
    centroid,
    geometry: farmGeom,
    soil: {
      texture: meta?.soil?.texture ?? 'Unknown',
      moistureStatus: meta?.soil?.moistureStatus ?? 'unknown',
      moisturePct: meta?.soil?.moisturePct ?? null,
      moistureMethod: meta?.soil?.moistureMethod ?? '',
      moistureDate: meta?.soil?.moistureDate ?? '',
      phStatus: meta?.soil?.phStatus ?? 'not_tested',
      phValue: meta?.soil?.phValue ?? null,
      phTestDate: meta?.soil?.phTestDate ?? '',
      organicMatterPct: meta?.soil?.organicMatterPct ?? null,
      drainage: meta?.soil?.drainage ?? 'Unknown',
      slopePct: meta?.soil?.slopePct ?? null,
      elevationM: meta?.soil?.elevationM ?? null,
    },
    water: {
      sources: meta?.water?.sources ?? ['Unknown'],
      reliability: meta?.water?.reliability ?? 'Unknown',
      dailyCapacityKnown: meta?.water?.dailyCapacityKnown ?? false,
      dailyCapacityM3: meta?.water?.dailyCapacityM3 ?? null,
      qualityTested: meta?.water?.qualityTested ?? 'Unknown',
      ecDsM: meta?.water?.ecDsM ?? null,
      salinityPpm: meta?.water?.salinityPpm ?? null,
      qualityTestDate: meta?.water?.qualityTestDate ?? '',
      wateringMethod: meta?.water?.wateringMethod ?? '',
      irrigationMethod: meta?.water?.irrigationMethod ?? 'Unknown',
      irrigationFrequency: meta?.water?.irrigationFrequency ?? 'Unknown',
    },
    fields,
    observations: port.observations.filter((o) => o.farmId === farmId),
    irrigationLogs: port.irrigationLogs.filter((l) => l.farmId === farmId),
    tasks: port.tasks.filter((t) => t.farmId === farmId),
    updatedAt: meta?.updatedAt ?? mapFarm?.updatedAt ?? new Date().toISOString(),
  };
}

export function hashInputPayload(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

/**
 * Syncs a completed DeepAnalysisReport summary into `my-farms-portfolio.json` snapshots
 * without mutating any existing immutable reports or past snapshots.
 */
export function syncReportSummaryToPortfolio(report: DeepAnalysisReport): void {
  const port = readPortfolioStore();
  const meanTemp =
    report.fieldAssessments
      .map((f) => f.weatherSummary.periodMeanTempC)
      .find((v) => v !== null) ?? null;
  const meanEt0 =
    report.fieldAssessments
      .map((f) => f.waterSummary.et0MeanMmDay)
      .find((v) => v !== null) ?? null;
  const obsPrecipDays = report.fieldAssessments[0]?.waterSummary.dailyRows.filter(
    (d) => d.dataKind === 'historical' && d.precipitationMm !== null
  );
  const precipMmDay =
    obsPrecipDays && obsPrecipDays.length > 0
      ? Number(
          (
            obsPrecipDays.reduce((s, d) => s + (d.precipitationMm ?? 0), 0) / obsPrecipDays.length
          ).toFixed(2)
        )
      : null;

  const labMoisture = report.fieldAssessments
    .map((f) => f.waterSummary.surfaceMoisturePct)
    .find((v) => v !== null) ?? null;
  const mappedArea = Number(
    report.fieldAssessments.reduce((s, f) => s + f.areaHa, 0).toFixed(1)
  );

  const hasPower = report.sourceOutcomes.some(
    (s) => s.providerId === 'nasa_power_daily' && s.status !== 'unavailable'
  );
  const hasMeteo = report.sourceOutcomes.some(
    (s) => s.category === 'weather_forecast' && s.status !== 'unavailable'
  );
  const hasEonet = report.sourceOutcomes.some(
    (s) => s.providerId === 'nasa_eonet_v3' && s.status !== 'unavailable'
  );

  const snap = {
    id: `snap-${report.id}`,
    reportId: report.id,
    farmId: report.farmId,
    fieldId: report.fieldIds.length === 1 ? report.fieldIds[0] : null,
    fieldName: report.scope.label,
    fieldScopeLabel: report.scope.label,
    fieldsCount: report.fieldAssessments.length,
    generatedAt: report.completedAt,
    modelVersion: report.engineVersion,
    triggerReason: report.triggerReason,
    suitabilityScore: report.overallSummary.healthScore,
    confidencePct: report.overallSummary.confidencePct,
    completenessPct: report.overallSummary.coveragePct,
    weatherWindowSummary: report.overallSummary.plainLanguageSummary,
    dataAvailability: {
      nasaPower: hasPower ? 'available' : 'unavailable',
      openMeteo: hasMeteo ? 'available' : 'unavailable',
      nasaEonet: hasEonet ? 'available' : 'unavailable',
      soilLab: report.fieldAssessments.some((f) =>
        f.soilSummary.labValues.some((v) => v.sourceType === 'farmer_lab')
      )
        ? 'measured'
        : 'estimated',
    },
    keyMetrics: {
      meanTempC: meanTemp,
      precipMmDay,
      et0MmDay: meanEt0,
      soilMoisturePct: labMoisture,
      phValue: null,
      mappedAreaHa: mappedArea,
    },
    recommendations: report.recommendations.slice(0, 5).map((r) => r.title),
    aiSummary:
      report.aiExplanation.simpleSummary || report.overallSummary.plainLanguageSummary,
    keyDrivers: report.aiExplanation.keyDrivers.length > 0
      ? report.aiExplanation.keyDrivers
      : report.overallSummary.strengths,
    risksDetected: report.findings.map((f) => `${f.fieldName}: ${f.title}`),
  };

  port.snapshots = [snap, ...port.snapshots.filter((s) => s.reportId !== report.id)].slice(0, 100);
  const meta = port.farmMeta[report.farmId];
  if (meta) {
    meta.lastAssessedAt = report.completedAt;
    if (report.overallSummary.healthScore !== null) {
      meta.suitabilityScore = report.overallSummary.healthScore;
    }
    meta.updatedAt = report.completedAt;
  }
  recordDomainOutboxEvent(port, {
    eventName: 'AnalysisCompleted',
    farmId: report.farmId,
    fieldIds: report.fieldIds,
    startDate: report.dateRange.from,
    endDate: report.dateRange.to,
  });
  writePortfolioStore(port);
}

export function updateActionStatusAndMaybeCreateTask(opts: {
  reportId: string;
  actionId: string;
  status: ActionStatus;
  note?: string;
  createTask?: boolean;
  dueDate?: string;
}): {
  action: DeepAnalysisReport['recommendations'][number] | null;
  createdTaskId: string | null;
} {
  const store = readAdvancedStore();
  const rIdx = store.reports.findIndex((r) => r.id === opts.reportId);
  if (rIdx < 0) return { action: null, createdTaskId: null };

  const report = store.reports[rIdx];
  const aIdx = report.recommendations.findIndex((a) => a.id === opts.actionId);
  if (aIdx < 0) return { action: null, createdTaskId: null };

  const action = { ...report.recommendations[aIdx] };
  action.status = opts.status;
  if (opts.note !== undefined) action.note = opts.note;

  let createdTaskId: string | null = action.linkedTaskId ?? null;
  if (opts.createTask && !createdTaskId) {
    const port = readPortfolioStore();
    const now = new Date().toISOString();
    const farmTz = port.farmMeta[report.farmId]?.timezone || 'UTC';
    const taskId = `task-adv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const taskRec = {
      id: taskId,
      farmId: report.farmId,
      fieldId: action.fieldId,
      fieldName: action.fieldName,
      title: action.title,
      category: action.verb.toLowerCase().includes('irrig')
        ? 'irrigation'
        : action.verb.toLowerCase().includes('sample')
          ? 'soil'
          : 'scouting',
      dueDate: opts.dueDate || new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      priority: action.priority,
      status: 'scheduled',
      timezone: farmTz,
      sourceType: 'deep_analysis_action',
      notes: `${action.whySuggested} (Report ${report.id})`,
      completed: false,
      completedAt: null,
      createdBy: 'Deep Analysis',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    port.tasks = [taskRec, ...port.tasks];
    recordDomainOutboxEvent(port, {
      eventName: 'TaskCreated',
      farmId: report.farmId,
      fieldIds: action.fieldId ? [action.fieldId] : [],
      startDate: taskRec.dueDate,
      endDate: taskRec.dueDate,
    });
    writePortfolioStore(port);
    createdTaskId = taskId;
    action.linkedTaskId = taskId;
    if (action.status === 'Suggested' || action.status === 'Accepted') {
      action.status = 'Scheduled';
    }
  }

  // Note: updating action workflow state ONLY edits mutable workflow status/linkedTaskId metadata; historical metrics & findings stay strictly immutable!
  report.recommendations[aIdx] = action;
  store.reports[rIdx] = report;
  appendAuditEvent(
    store,
    report.farmId,
    'ACTION_STATUS_UPDATED',
    `Action "${action.title}" -> ${action.status}`
  );
  writeAdvancedStore(store);
  return { action, createdTaskId };
}
