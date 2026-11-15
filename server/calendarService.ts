import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CROP_KNOWLEDGE_LIBRARY, CropKnowledgeEntry } from '../src/lib/fieldAgronomyEngine';
import type { FarmTaskItem } from '../src/types/myFarms';
import type {
  CalendarConflictWarning,
  CalendarDayGroups,
  CalendarDayResponse,
  CalendarEventDetailResponse,
  CalendarEventType,
  CalendarFarmOption,
  CalendarFreshnessSource,
  CalendarMonthResponse,
  CalendarProjectionEvent,
  CalendarStreamNotification,
  CalendarUpcomingResponse,
  CreateCanonicalTaskRequest,
  CreateCanonicalTaskResponse,
  DomainOutboxEvent,
  FarmWeatherSummary,
  TaskAuditRecord,
  TaskCommandRequest,
} from '../src/types/calendar';
import {
  buildUnifiedPortfolioPayload,
  getDataStoreMtimes,
  PortfolioStore,
  readMapsStore,
  readPortfolioStore,
  recordDomainOutboxEvent,
  subscribeCalendarDomainEvents,
  writePortfolioStore,
} from './myFarmsRouter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', '.data');
const QUESTIONNAIRES_STORE_PATH = path.join(DATA_DIR, 'questionnaires-store.json');

/* -------------------------------------------------------------------------- */
/* Date & Timezone Utilities (IANA-Safe, Never Parsed As UTC Midnights)       */
/* -------------------------------------------------------------------------- */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function isValidDateStr(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isValidTimezone(tz?: string | null): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function getTodayDateStrInTz(timezone?: string | null, referenceDate = new Date()): string {
  const tz = isValidTimezone(timezone) ? String(timezone) : 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(referenceDate);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fallback
  }
  return referenceDate.toISOString().slice(0, 10);
}

export function isoToDateStrInTz(isoOrDate: string | null | undefined, timezone?: string | null): string | null {
  if (!isoOrDate) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate.trim())) {
    return isoOrDate.trim();
  }
  const dt = new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(isoOrDate);
    return m ? m[1] : null;
  }
  return getTodayDateStrInTz(timezone, dt);
}

export function addDaysToDateStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function daysBetweenDateStrs(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  const ta = Date.UTC(ya, ma - 1, da, 12, 0, 0);
  const tb = Date.UTC(yb, mb - 1, db, 12, 0, 0);
  return Math.round((tb - ta) / 86400000);
}

function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function makeShortFieldLabel(fieldName?: string | null): string {
  if (!fieldName || fieldName === 'Whole Farm') return 'Whole Farm';
  const match = /\b(\d+)\b/.exec(fieldName);
  if (match) return `Field ${match[1].padStart(2, '0')}`;
  return fieldName.length > 18 ? `${fieldName.slice(0, 16).trim()}…` : fieldName;
}

function resolveCropEntry(cropIdOrName?: string | null): CropKnowledgeEntry | null {
  if (!cropIdOrName) return null;
  const q = cropIdOrName.toLowerCase().trim();
  if (!q) return null;
  if (CROP_KNOWLEDGE_LIBRARY[q]) return CROP_KNOWLEDGE_LIBRARY[q];
  for (const entry of Object.values(CROP_KNOWLEDGE_LIBRARY)) {
    if (
      entry.commonName.toLowerCase() === q ||
      q.includes(entry.id) ||
      q.includes(entry.commonName.toLowerCase())
    ) {
      return entry;
    }
  }
  if (/(corn|maize)/.test(q)) return CROP_KNOWLEDGE_LIBRARY.maize;
  if (/(soy)/.test(q)) return CROP_KNOWLEDGE_LIBRARY.soybean;
  if (/(barley|oat|rye|millet|sorghum|cover)/.test(q)) return CROP_KNOWLEDGE_LIBRARY.barley;
  if (/(pea|bean|lentil|chickpea|legume|alfalfa|clover|pulse)/.test(q)) return CROP_KNOWLEDGE_LIBRARY.peas;
  if (/(sunflower|canola|rapeseed|oilseed)/.test(q)) return CROP_KNOWLEDGE_LIBRARY.sunflower;
  if (/(tomato|lettuce|onion|pepper|veg|potato|hort)/.test(q)) return CROP_KNOWLEDGE_LIBRARY.vegetables;
  return CROP_KNOWLEDGE_LIBRARY.wheat;
}

function deterministicHashInt(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

/* -------------------------------------------------------------------------- */
/* Server-Side Open-Meteo Weather Ingestion (Farm Centroid ONLY, Never IP)    */
/* -------------------------------------------------------------------------- */

const weatherCache = new Map<string, { value: FarmWeatherSummary; expiresAt: number }>();

function decodeWeatherCodeLabel(code: number | null): string {
  if (code === null) return 'Unavailable';
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly Cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95) return 'Storm';
  return 'Clear';
}

export async function fetchServerFarmWeather(
  farmId: string,
  farmName: string,
  centroid: { lat: number; lon: number } | null,
  timezone: string,
  forceSimulateFailure = false
): Promise<FarmWeatherSummary> {
  const nowIso = new Date().toISOString();
  if (!centroid || !Number.isFinite(centroid.lat) || !Number.isFinite(centroid.lon)) {
    return {
      farm_id: farmId,
      farm_name: farmName,
      available: false,
      temp_c: null,
      temp_min_c: null,
      temp_max_c: null,
      wind_kmh: null,
      precip_mm_24h: null,
      forecast_precip_48h_mm: null,
      et0_mm_day: null,
      humidity_pct: null,
      weather_code: null,
      condition_label: 'No farm coordinates',
      retrieved_at: nowIso,
      error: 'Farm coordinates are not configured.',
    };
  }

  if (forceSimulateFailure || process.env.CALENDAR_SIMULATE_WEATHER_FAILURE === '1') {
    return {
      farm_id: farmId,
      farm_name: farmName,
      available: false,
      temp_c: null,
      temp_min_c: null,
      temp_max_c: null,
      wind_kmh: null,
      precip_mm_24h: null,
      forecast_precip_48h_mm: null,
      et0_mm_day: null,
      humidity_pct: null,
      weather_code: null,
      condition_label: 'Weather unavailable',
      retrieved_at: nowIso,
      error: 'Weather provider unreachable.',
    };
  }

  const key = `${farmId}:${centroid.lat.toFixed(3)},${centroid.lon.toFixed(3)}:${timezone}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() < hit.expiresAt) {
    return hit.value;
  }

  try {
    const tzParam = encodeURIComponent(isValidTimezone(timezone) ? timezone : 'auto');
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${centroid.lat.toFixed(4)}&longitude=${centroid.lon.toFixed(4)}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,weather_code` +
      `&forecast_days=3&timezone=${tzParam}`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!resp.ok) {
      throw new Error(`Open-Meteo HTTP ${resp.status}`);
    }
    const json = (await resp.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        precipitation?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
      daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
        et0_fao_evapotranspiration?: number[];
        weather_code?: number[];
      };
    };

    const precip0 = json.daily?.precipitation_sum?.[0] ?? 0;
    const precip1 = json.daily?.precipitation_sum?.[1] ?? 0;
    const wCode =
      typeof json.current?.weather_code === 'number'
        ? json.current.weather_code
        : json.daily?.weather_code?.[0] ?? null;

    const summary: FarmWeatherSummary = {
      farm_id: farmId,
      farm_name: farmName,
      available: true,
      temp_c:
        typeof json.current?.temperature_2m === 'number'
          ? Math.round(json.current.temperature_2m)
          : null,
      temp_min_c:
        typeof json.daily?.temperature_2m_min?.[0] === 'number'
          ? Number(json.daily.temperature_2m_min[0].toFixed(1))
          : null,
      temp_max_c:
        typeof json.daily?.temperature_2m_max?.[0] === 'number'
          ? Number(json.daily.temperature_2m_max[0].toFixed(1))
          : null,
      wind_kmh:
        typeof json.current?.wind_speed_10m === 'number'
          ? Math.round(json.current.wind_speed_10m)
          : null,
      precip_mm_24h: Number(precip0.toFixed(1)),
      forecast_precip_48h_mm: Number((precip0 + precip1).toFixed(1)),
      et0_mm_day:
        typeof json.daily?.et0_fao_evapotranspiration?.[0] === 'number'
          ? Number(json.daily.et0_fao_evapotranspiration[0].toFixed(1))
          : null,
      humidity_pct:
        typeof json.current?.relative_humidity_2m === 'number'
          ? Math.round(json.current.relative_humidity_2m)
          : null,
      weather_code: wCode,
      condition_label: decodeWeatherCodeLabel(wCode),
      retrieved_at: nowIso,
      error: null,
    };

    weatherCache.set(key, { value: summary, expiresAt: Date.now() + 15 * 60 * 1000 });
    return summary;
  } catch (err) {
    return {
      farm_id: farmId,
      farm_name: farmName,
      available: false,
      temp_c: null,
      temp_min_c: null,
      temp_max_c: null,
      wind_kmh: null,
      precip_mm_24h: null,
      forecast_precip_48h_mm: null,
      et0_mm_day: null,
      humidity_pct: null,
      weather_code: null,
      condition_label: 'Weather unavailable',
      retrieved_at: nowIso,
      error: err instanceof Error ? err.message : 'Weather provider unavailable.',
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Questionnaires / Deep Analysis Canonical Reader                            */
/* -------------------------------------------------------------------------- */

interface QuestionnaireStoreMinimal {
  jobs?: Record<
    string,
    {
      jobId: string;
      status: string;
      createdAt: string;
      updatedAt: string;
      snapshotId?: string;
    }
  >;
  results?: Record<
    string,
    {
      resultId: string;
      jobId: string;
      farmId?: string;
      farmName?: string;
      generatedAt: string;
      summary?: { overallScore?: number; topCrop?: string };
    }
  >;
}

function readQuestionnaireStoreMinimal(): QuestionnaireStoreMinimal {
  try {
    if (!fs.existsSync(QUESTIONNAIRES_STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(QUESTIONNAIRES_STORE_PATH, 'utf8')) as QuestionnaireStoreMinimal;
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/* Natural-Language Task Classification & Field Matching                      */
/* -------------------------------------------------------------------------- */

export function classifyTaskText(
  text: string,
  farmFields: Array<{ id: string; name: string; cropName?: string }>
): {
  inferred_category: FarmTaskItem['category'];
  inferred_field_id: string | null;
  inferred_field_name: string | null;
  inferred_crop: string | null;
  needs_field_confirmation: boolean;
} {
  const lower = text.toLowerCase();

  let inferred_category: FarmTaskItem['category'] = 'general';
  if (/(irrigat|water|drip|sprinkler|pump|valve|moisture|soak)/.test(lower)) {
    inferred_category = 'irrigation';
  } else if (/(soil|ph|core|sample|lab|nitrate|ec |salinity|compost)/.test(lower)) {
    inferred_category = 'soil';
  } else if (/(scout|pest|aphid|disease|rust|weed|inspect|walk field|check )/.test(lower)) {
    inferred_category = 'scouting';
  } else if (/(harvest|cut|combine|reap|pick|thresh)/.test(lower)) {
    inferred_category = 'harvest';
  } else if (/(rotat|cover|transition|prep|harrow|residue|till|seedbed)/.test(lower)) {
    inferred_category = 'rotation';
  } else if (/(fertiliz|nitrogen|urea|npk|foliar|spray|topdress)/.test(lower)) {
    inferred_category = 'fertilizer';
  } else if (/(plant|seed|sow|drill|emergence)/.test(lower)) {
    inferred_category = 'planting';
  }

  // Exact or unambiguous field mention match
  const matchedFields: Array<{ id: string; name: string }> = [];
  for (const field of farmFields) {
    const fname = field.name.toLowerCase();
    const numMatch = /\b(\d+)\b/.exec(fname);
    const shortPattern = numMatch ? new RegExp(`\\bfield\\s*0*${Number(numMatch[1])}\\b`, 'i') : null;
    if (lower.includes(fname) || (shortPattern && shortPattern.test(text))) {
      matchedFields.push({ id: field.id, name: field.name });
    }
  }

  let inferred_crop: string | null = null;
  for (const entry of Object.values(CROP_KNOWLEDGE_LIBRARY)) {
    if (lower.includes(entry.id) || lower.includes(entry.commonName.toLowerCase())) {
      inferred_crop = entry.commonName;
      break;
    }
  }

  if (matchedFields.length === 1) {
    return {
      inferred_category,
      inferred_field_id: matchedFields[0].id,
      inferred_field_name: matchedFields[0].name,
      inferred_crop,
      needs_field_confirmation: false,
    };
  }

  return {
    inferred_category,
    inferred_field_id: null,
    inferred_field_name: null,
    inferred_crop,
    needs_field_confirmation: farmFields.length > 1 && matchedFields.length !== 1,
  };
}

function mapTaskCategoryToEventType(cat: string): CalendarEventType {
  switch (cat) {
    case 'irrigation':
      return 'irrigation';
    case 'soil':
      return 'soil_test';
    case 'scouting':
      return 'scouting';
    case 'rotation':
      return 'rotation_prep';
    case 'harvest':
      return 'harvest';
    case 'fertilizer':
      return 'fertilizer';
    case 'planting':
      return 'planting';
    default:
      return 'general';
  }
}

/* -------------------------------------------------------------------------- */
/* Projection Cache & SSE Notification Bridge                                 */
/* -------------------------------------------------------------------------- */

const projectionCache = new Map<string, CalendarMonthResponse>();
let lastObservedMtimeSig = '';

function computeMtimeSignature(): string {
  const m = getDataStoreMtimes();
  return `${m.mapsMtime}:${m.portfolioMtime}:${m.questionnairesMtime}`;
}

export function invalidateCalendarCache(): void {
  projectionCache.clear();
}

const sseClients = new Set<(notification: CalendarStreamNotification) => void>();

export function registerCalendarSseClient(
  fn: (notification: CalendarStreamNotification) => void
): () => void {
  sseClients.add(fn);
  return () => {
    sseClients.delete(fn);
  };
}

// Automatically bridge domain outbox events -> cache invalidation + SSE push
subscribeCalendarDomainEvents((evt: DomainOutboxEvent) => {
  invalidateCalendarCache();
  const payload: CalendarStreamNotification = {
    event: 'CalendarProjectionUpdated',
    farm_id: evt.farm_id,
    affected_fields: evt.field_ids,
    affected_range: evt.affected_range,
    version: evt.version,
    source_event: evt.event_name,
  };
  for (const client of sseClients) {
    try {
      client(payload);
    } catch {
      // ignore disconnected listeners
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Core Canonical Event Collector                                             */
/* -------------------------------------------------------------------------- */

interface CollectedFarmBundle {
  events: CalendarProjectionEvent[];
  weather: FarmWeatherSummary;
  sources: CalendarFreshnessSource[];
  partial_sources: CalendarFreshnessSource[];
  farmOption: CalendarFarmOption;
}

async function collectEventsForSingleFarm(params: {
  rawFarm: ReturnType<typeof buildUnifiedPortfolioPayload>['farms'][number];
  allFields: ReturnType<typeof buildUnifiedPortfolioPayload>['fields'];
  port: PortfolioStore;
  qStore: QuestionnaireStoreMinimal;
  rangeStart: string;
  rangeEnd: string;
  simulateWeatherFailure?: boolean;
}): Promise<CollectedFarmBundle> {
  const { rawFarm, allFields, port, qStore, rangeStart, rangeEnd, simulateWeatherFailure } = params;
  const nowIso = new Date().toISOString();
  const tz = isValidTimezone(rawFarm.timezone) ? rawFarm.timezone : 'UTC';
  const todayStr = getTodayDateStrInTz(tz);
  const farmFields = allFields.filter((f) => f.farmId === rawFarm.id);
  const farmFieldsById = new Map(farmFields.map((f) => [f.id, f]));

  const weather = await fetchServerFarmWeather(
    rawFarm.id,
    rawFarm.name,
    rawFarm.centroid ?? null,
    tz,
    simulateWeatherFailure
  );

  const sources: CalendarFreshnessSource[] = [
    {
      source: 'farm_data',
      status: 'fresh',
      last_updated_at: rawFarm.updatedAt || nowIso,
      retrieved_at: nowIso,
    },
    {
      source: 'tasks',
      status: 'fresh',
      last_updated_at: nowIso,
      retrieved_at: nowIso,
    },
    {
      source: `weather:${rawFarm.id}`,
      status: weather.available ? 'fresh' : 'unavailable',
      last_updated_at: weather.retrieved_at,
      retrieved_at: nowIso,
      error: weather.error ?? null,
    },
  ];

  const partial_sources: CalendarFreshnessSource[] = [];
  if (!weather.available) {
    partial_sources.push(sources[sources.length - 1]);
  }

  const events: CalendarProjectionEvent[] = [];
  const emittedDedup = new Set<string>();

  const pushEvent = (evt: CalendarProjectionEvent) => {
    // Intersects requested range [rangeStart, rangeEnd]
    if (evt.end_date < rangeStart || evt.start_date > rangeEnd) return;
    if (emittedDedup.has(evt.event_id)) return;
    emittedDedup.add(evt.event_id);
    events.push(evt);
  };

  /* ---------------------------------------------------------------------- */
  /* 1. Canonical Tasks (`port.tasks`)                                      */
  /* ---------------------------------------------------------------------- */
  const farmTasks = (port.tasks as unknown as FarmTaskItem[]).filter((t) => t.farmId === rawFarm.id);
  const activeTaskKeys = new Set<string>();
  for (const t of farmTasks) {
    const status = t.status || (t.completed ? 'completed' : 'scheduled');
    const dueStr = isoToDateStrInTz(t.dueDate || t.createdAt, tz) || todayStr;
    const startDate = isoToDateStrInTz(t.scheduledStart, tz) || dueStr;
    const endDate = isoToDateStrInTz(t.scheduledEnd, tz) || dueStr;
    const field = t.fieldId ? farmFieldsById.get(t.fieldId) : undefined;
    const fieldName = field?.name || t.fieldName || 'Whole Farm';
    const shortField = makeShortFieldLabel(fieldName);
    const eventType = mapTaskCategoryToEventType(t.category);
    const cropName = field?.cropName || rawFarm.primaryCrop || null;

    if (status !== 'cancelled') {
      activeTaskKeys.add(`${eventType}:${t.fieldId || 'farm'}:${dueStr}`);
    }

    const isActionableIrrigation =
      eventType === 'irrigation' &&
      !t.completed &&
      status !== 'cancelled' &&
      status !== 'deferred' &&
      startDate <= addDaysToDateStr(todayStr, 1);

    const isSprayUnsuitable =
      eventType === 'fertilizer' &&
      !t.completed &&
      weather.available &&
      ((weather.wind_kmh !== null && weather.wind_kmh >= 22) ||
        (weather.forecast_precip_48h_mm !== null && weather.forecast_precip_48h_mm >= 6));

    const evidence: string[] = [
      `Task record ${t.id} (v${t.version ?? 1})`,
      `Farm timezone: ${tz}`,
      `Field scope: ${fieldName}`,
    ];
    if (t.linkedRotationPlanId) evidence.push(`Linked Rotation Plan: ${t.linkedRotationPlanId}`);
    if (t.linkedReportId) evidence.push(`Linked Report: ${t.linkedReportId}`);
    if (t.deferredUntil) evidence.push(`Deferred until ${t.deferredUntil}`);
    if (isSprayUnsuitable) {
      evidence.push(
        `Weather check: high wind (${weather.wind_kmh} km/h) or forecast rain (${weather.forecast_precip_48h_mm} mm) may delay foliar spraying.`
      );
    }

    const subtitle = t.completed
      ? 'Completed'
      : status === 'cancelled'
        ? 'Cancelled'
        : status === 'deferred'
          ? `Deferred to ${formatShortDate(dueStr)}`
          : isSprayUnsuitable
            ? 'Check spray weather window'
            : isActionableIrrigation
              ? 'Recommended Now'
              : t.priority === 'high'
                ? 'High Priority'
                : dueStr === todayStr
                  ? 'Due Today'
                  : fieldName;

    pushEvent({
      event_id: `task:${t.id}`,
      source_type: 'task',
      source_id: t.id,
      farm_id: rawFarm.id,
      farm_name: rawFarm.name,
      field_id: t.fieldId ?? null,
      field_name: fieldName,
      crop_occurrence_id: field ? `crop:${field.id}` : null,
      crop_name: cropName,
      title: `${t.title}${shortField !== 'Whole Farm' && !t.title.toLowerCase().includes(shortField.toLowerCase()) ? ` - ${shortField}` : ''}`,
      subtitle,
      description:
        t.notes ||
        `${t.title} scheduled for ${fieldName} (${rawFarm.name}).`,
      event_type: eventType,
      start_date: startDate,
      end_date: endDate < startDate ? startDate : endDate,
      start_at: `${startDate}T00:00:00`,
      end_at: `${endDate < startDate ? startDate : endDate}T23:59:59`,
      timezone: tz,
      date_basis: t.completed ? 'Completed' : 'Scheduled',
      status,
      priority: t.priority || 'normal',
      action_button_type: isActionableIrrigation ? 'start' : null,
      completed: Boolean(t.completed || status === 'completed'),
      planned_date: dueStr,
      actual_date: t.completedAt ? isoToDateStrInTz(t.completedAt, tz) : null,
      evidence,
      links: {
        rotation_plan_id: t.linkedRotationPlanId ?? null,
        analysis_id: t.linkedAnalysisId ?? null,
        report_id: t.linkedReportId ?? null,
        recommendation_id: t.linkedRecommendationId ?? null,
        observation_id: t.linkedObservationId ?? null,
        farm_route: `/my-farms/${rawFarm.id}`,
        rotation_route: '/rotation',
        report_route: t.linkedReportId ? '/questions' : null,
      },
      source_version: t.version ?? 1,
      generated_at: nowIso,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 2. Observed Irrigation Logs (`port.irrigationLogs`)                    */
  /* ---------------------------------------------------------------------- */
  const farmIrrLogs = port.irrigationLogs.filter((l) => l.farmId === rawFarm.id);
  const irrigatedTodayKeys = new Set<string>();
  let latestIrrDate: string | null = null;
  for (const log of farmIrrLogs) {
    const logDate = isoToDateStrInTz(String(log.date || log.createdAt), tz) || todayStr;
    if (!latestIrrDate || logDate > latestIrrDate) latestIrrDate = logDate;
    const fId = log.fieldId ? String(log.fieldId) : null;
    if (logDate === todayStr) {
      irrigatedTodayKeys.add(fId || 'farm');
      irrigatedTodayKeys.add('farm');
    }
    const field = fId ? farmFieldsById.get(fId) : undefined;
    const fieldName = field?.name || String(log.fieldName || 'Whole Farm');
    const shortField = makeShortFieldLabel(fieldName);
    const vol = Number(log.volumeM3 ?? 0);
    const method = String(log.method || rawFarm.water.irrigationMethod || 'Irrigation');

    pushEvent({
      event_id: `irr:${String(log.id)}`,
      source_type: 'irrigation_log',
      source_id: String(log.id),
      farm_id: rawFarm.id,
      farm_name: rawFarm.name,
      field_id: fId,
      field_name: fieldName,
      crop_occurrence_id: field ? `crop:${field.id}` : null,
      crop_name: field?.cropName || rawFarm.primaryCrop || null,
      title: `Irrigation Applied - ${shortField}`,
      subtitle: `${method} · ${vol} m³ logged`,
      description: String(log.notes || `Recorded ${vol} m³ via ${method}.`),
      event_type: 'irrigation',
      start_date: logDate,
      end_date: logDate,
      start_at: `${logDate}T00:00:00`,
      end_at: `${logDate}T23:59:59`,
      timezone: tz,
      date_basis: 'Observed',
      status: 'completed',
      priority: 'normal',
      action_button_type: null,
      completed: true,
      planned_date: null,
      actual_date: logDate,
      evidence: [
        `Irrigation execution record ${String(log.id)}`,
        `Delivered volume: ${vol} m³`,
        `Method: ${method}`,
      ],
      links: {
        farm_route: `/my-farms/${rawFarm.id}`,
      },
      source_version: 1,
      generated_at: nowIso,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 3. Farmer Observations & Soil Lab Records (`port.observations`)        */
  /* ---------------------------------------------------------------------- */
  const farmObservations = port.observations.filter((o) => o.farmId === rawFarm.id);
  let latestSoilObsDate: string | null = null;
  let actualPlantedObs: { date: string; fieldId: string | null; title: string; id: string } | null = null;
  let actualHarvestedObs: { date: string; fieldId: string | null; title: string; id: string } | null = null;

  for (const obs of farmObservations) {
    const obsDate = isoToDateStrInTz(String(obs.observedAt || obs.createdAt), tz) || todayStr;
    const catRaw = String(obs.category || 'scouting');
    const eventType: CalendarEventType = catRaw === 'soil_lab' ? 'soil_test' : 'scouting';
    if (catRaw === 'soil_lab' && (!latestSoilObsDate || obsDate > latestSoilObsDate)) {
      latestSoilObsDate = obsDate;
    }

    const obsTitle = String(obs.title || 'Field observation');
    const lowerTitle = obsTitle.toLowerCase();
    const fId = obs.fieldId ? String(obs.fieldId) : null;
    if (
      catRaw === 'planting' ||
      lowerTitle.includes('planted') ||
      lowerTitle.includes('actual planting') ||
      lowerTitle.includes('sowed') ||
      lowerTitle.includes('seeded')
    ) {
      actualPlantedObs = { date: obsDate, fieldId: fId, title: obsTitle, id: String(obs.id) };
    }
    if (catRaw === 'harvest' || lowerTitle.includes('harvested') || lowerTitle.includes('actual harvest')) {
      actualHarvestedObs = { date: obsDate, fieldId: fId, title: obsTitle, id: String(obs.id) };
    }

    const field = fId ? farmFieldsById.get(fId) : undefined;
    const fieldName = field?.name || String(obs.fieldName || 'Whole Farm');
    const shortField = makeShortFieldLabel(fieldName);

    pushEvent({
      event_id: `obs:${String(obs.id)}`,
      source_type: 'observation',
      source_id: String(obs.id),
      farm_id: rawFarm.id,
      farm_name: rawFarm.name,
      field_id: fId,
      field_name: fieldName,
      crop_occurrence_id: field ? `crop:${field.id}` : null,
      crop_name: field?.cropName || rawFarm.primaryCrop || null,
      title: `${catRaw === 'soil_lab' ? 'Soil Lab Check' : 'Observation'} - ${shortField}`,
      subtitle: obsTitle,
      description: String(obs.detail || obsTitle),
      event_type: eventType,
      start_date: obsDate,
      end_date: obsDate,
      start_at: `${obsDate}T00:00:00`,
      end_at: `${obsDate}T23:59:59`,
      timezone: tz,
      date_basis: 'Observed',
      status: 'observed',
      priority: 'normal',
      action_button_type: null,
      completed: true,
      planned_date: null,
      actual_date: obsDate,
      evidence: [
        `Farmer observation ${String(obs.id)}`,
        `Provenance: ${String(obs.provenance || 'Reported')}`,
      ],
      links: {
        observation_id: String(obs.id),
        farm_route: `/my-farms/${rawFarm.id}`,
      },
      source_version: 1,
      generated_at: nowIso,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 4. Continuous Per-Field Daily Growing Crops & Rotation Milestones      */
  /* ---------------------------------------------------------------------- */
  const matchingQResults = Object.values(qStore.results || {}).filter(
    (res) =>
      res.farmId === rawFarm.id ||
      (res.farmName && res.farmName.toLowerCase() === rawFarm.name.toLowerCase())
  );
  const qTopCrop = matchingQResults[0]?.summary?.topCrop || null;
  const activePlan = rawFarm.activePlan;
  const planVersion = activePlan?.version ?? 1;
  const planAnchorRaw = activePlan?.selectedAt || rawFarm.createdAt || nowIso;
  const plannedAnchorDate = isoToDateStrInTz(planAnchorRaw, tz) || todayStr;

  // Include ALL non-archived fields for this farm (Active, Needs Review, Planned, Fallow)
  // or synthesize a whole-farm slot when a farm does not have field polygons yet.
  const allFarmFieldsOrFallback =
    farmFields.length > 0
      ? farmFields
      : [
          {
            id: null as unknown as string,
            name: 'Whole Farm',
            cropName:
              activePlan?.cropSequence?.[0]?.cropName ||
              rawFarm.primaryCrop ||
              qTopCrop ||
              'Wheat',
            status: 'Active' as const,
            rotationReviewDue: false,
            activeAlertsCount: 0,
            criticalAlert: null,
            staleCalculations: [] as string[],
            notes: '',
            updatedAt: rawFarm.createdAt,
          },
        ];

  let standingBaselineAnchor = plannedAnchorDate;
  if (!activePlan) {
    const createdDate = isoToDateStrInTz(rawFarm.createdAt || nowIso, tz) || todayStr;
    standingBaselineAnchor = addDaysToDateStr(createdDate, -24);
  } else if (allFarmFieldsOrFallback[0]?.updatedAt) {
    const fieldUpd = isoToDateStrInTz(allFarmFieldsOrFallback[0].updatedAt, tz);
    if (fieldUpd && fieldUpd < plannedAnchorDate) {
      standingBaselineAnchor = fieldUpd;
    }
  }
  const effectivePlantAnchor = actualPlantedObs ? actualPlantedObs.date : standingBaselineAnchor;

  interface RotationCycleStep {
    displayCropName: string;
    entry: CropKnowledgeEntry;
  }

  const buildFieldRotationCycle = (baseCropName: string): RotationCycleStep[] => {
    const steps: RotationCycleStep[] = [];
    const seenIds = new Set<string>();
    const addStep = (name?: string | null) => {
      if (!name || !name.trim()) return;
      const entry = resolveCropEntry(name) || CROP_KNOWLEDGE_LIBRARY.wheat;
      const cleanName =
        name.trim().toLowerCase() === entry.id
          ? entry.commonName
          : name.trim();
      const dedupKey = `${entry.id}:${cleanName.toLowerCase()}`;
      if (seenIds.has(dedupKey)) return;
      seenIds.add(dedupKey);
      steps.push({ displayCropName: cleanName, entry });
    };

    addStep(baseCropName);
    if (activePlan?.cropSequence?.length) {
      const startIdx = activePlan.cropSequence.findIndex(
        (s) => s.cropName.toLowerCase() === baseCropName.toLowerCase()
      );
      if (startIdx >= 0) {
        for (let i = 1; i < activePlan.cropSequence.length; i++) {
          const idx = (startIdx + i) % activePlan.cropSequence.length;
          addStep(activePlan.cropSequence[idx].cropName);
        }
      } else {
        for (const s of activePlan.cropSequence) {
          addStep(s.cropName);
        }
      }
    }

    // Ensure at least a 3-crop balanced rotation loop so multi-month scrolling never stalls
    let guard = 0;
    while (steps.length < 3 && guard < 5) {
      guard++;
      const last = steps[steps.length - 1];
      const nextName = last?.entry.defaultNextCrop || 'Field Peas';
      const beforeCount = steps.length;
      addStep(nextName);
      if (steps.length === beforeCount) {
        addStep(
          last?.entry.id === 'wheat'
            ? 'Soybean'
            : last?.entry.id === 'soybean'
              ? 'Barley'
              : 'Wheat'
        );
      }
    }

    return steps;
  };

  allFarmFieldsOrFallback.forEach((fieldObj, fieldIdx) => {
    const seqFallbackCrop =
      activePlan?.cropSequence?.[fieldIdx % Math.max(1, activePlan.cropSequence.length)]?.cropName ||
      activePlan?.cropSequence?.[0]?.cropName;
    const rawCropName =
      fieldObj.cropName || seqFallbackCrop || rawFarm.primaryCrop || qTopCrop || 'Wheat';
    const primaryEntry = resolveCropEntry(rawCropName) || CROP_KNOWLEDGE_LIBRARY.wheat;
    const cycleList = buildFieldRotationCycle(rawCropName);

    const fId = fieldObj.id || null;
    const fName = fieldObj.name || 'Whole Farm';
    const shortField = makeShortFieldLabel(fName);
    const isPlannedField = fieldObj.status === 'Planned';

    const staggerDays =
      fieldIdx === 0
        ? 0
        : (deterministicHashInt(`${rawFarm.id}:${fId || fieldIdx}`) % 21) - 10;

    let cycle0Start =
      fieldIdx === 0
        ? effectivePlantAnchor
        : fieldObj.updatedAt
          ? addDaysToDateStr(
              isoToDateStrInTz(fieldObj.updatedAt, tz) || effectivePlantAnchor,
              staggerDays
            )
          : addDaysToDateStr(effectivePlantAnchor, staggerDays);

    // Ensure cycle0Start does not leave today or recent past orphaned far in the future
    if (cycle0Start > todayStr) {
      cycle0Start = addDaysToDateStr(todayStr, -((14 + fieldIdx * 7) % 35));
    }

    const emitCycleSpan = (params: {
      cycleNum: number;
      step: RotationCycleStep;
      startDate: string;
      endDate: string;
      isHistoricalAnchor: boolean;
    }) => {
      const { cycleNum, step, startDate, endDate, isHistoricalAnchor } = params;
      if (endDate < rangeStart || startDate > rangeEnd) return;

      const { ini, dev, mid, late } = step.entry.stageDays;
      const totalCycleDays = ini + dev + mid + late;
      const elapsed = Math.max(0, daysBetweenDateStrs(startDate, todayStr));
      const dayNum = Math.min(totalCycleDays, elapsed + 1);

      let stageName = 'Emergence / Establishment';
      if (elapsed >= ini + dev + mid) {
        stageName = 'Ripening & Harvest Readiness';
      } else if (elapsed >= ini + dev) {
        stageName = 'Mid-Season Canopy Peak';
      } else if (elapsed >= ini) {
        const cl = step.displayCropName.toLowerCase();
        stageName =
          cl.includes('wheat') || cl.includes('barley') || cl.includes('oat')
            ? 'Vegetative / Tillering'
            : 'Vegetative Canopy Growth';
      }

      const basis: CalendarProjectionEvent['date_basis'] =
        cycleNum === 0 && fieldIdx === 0 && actualPlantedObs
          ? 'Observed'
          : isPlannedField || cycleNum > 0
            ? 'Planned'
            : 'Modelled';

      const cycleTag =
        cycleNum === 0
          ? isPlannedField
            ? `Planned Active Block · Day ${dayNum} of ${totalCycleDays} (${stageName})`
            : `Growing · Day ${dayNum} of ${totalCycleDays} (${stageName})`
          : cycleNum < 0
            ? `Prior Season Cycle (${formatShortDate(startDate)}–${formatShortDate(endDate)})`
            : `Succession Cycle +${cycleNum} (${formatShortDate(startDate)}–${formatShortDate(endDate)})`;

      pushEvent({
        event_id: `crop-growing:${rawFarm.id}:${fId || 'farm'}:c${cycleNum}`,
        source_type: 'crop_stage',
        source_id: activePlan?.planId ?? null,
        farm_id: rawFarm.id,
        farm_name: rawFarm.name,
        field_id: fId,
        field_name: fName,
        crop_occurrence_id: fId
          ? `crop:${fId}:c${cycleNum}`
          : `crop:${rawFarm.id}:c${cycleNum}`,
        crop_name: step.displayCropName,
        title: `${step.displayCropName} - ${shortField}`,
        subtitle: cycleTag,
        description: `${step.displayCropName} (${step.entry.scientificName}) projected to grow across ${rawFarm.name} (${fName}) from ${formatShortDate(startDate)} through ${formatShortDate(endDate)}. Moisture: ${rawFarm.soil.moisturePct !== null ? `${rawFarm.soil.moisturePct}% VWC` : 'not measured'}.`,
        event_type: 'crop_stage',
        start_date: startDate,
        end_date: endDate,
        start_at: `${startDate}T00:00:00`,
        end_at: `${endDate}T23:59:59`,
        timezone: tz,
        date_basis: basis,
        status: endDate < todayStr ? 'completed' : cycleNum > 0 ? 'scheduled' : 'active',
        priority: 'normal',
        action_button_type: null,
        completed: endDate < todayStr,
        planned_date: isHistoricalAnchor ? plannedAnchorDate : startDate,
        actual_date:
          cycleNum === 0 && fieldIdx === 0 ? actualPlantedObs?.date ?? null : null,
        stage_breakdown: { ini, dev, mid, late },
        evidence: [
          `Crop baseline: ${step.displayCropName} (${step.entry.sourceRef})`,
          `Field status: ${fieldObj.status} · Window: ${formatShortDate(startDate)} – ${formatShortDate(endDate)} (${totalCycleDays} days)`,
          `Stage durations (days): Ini ${ini} / Dev ${dev} / Mid ${mid} / Late ${late}`,
          cycleNum === 0 && fieldIdx === 0 && actualPlantedObs
            ? `Anchored to recorded farmer planting (${actualPlantedObs.date})`
            : activePlan
              ? `Rotation plan: "${activePlan.title}" v${planVersion}`
              : `Agronomic succession cycle (${step.entry.defaultPrevCrop} → ${step.displayCropName} → ${step.entry.defaultNextCrop})`,
        ],
        links: {
          rotation_plan_id: activePlan?.planId ?? null,
          farm_route: `/my-farms/${rawFarm.id}`,
          rotation_route: '/rotation',
        },
        source_version: planVersion,
        generated_at: nowIso,
      });
    };

    // Cycle 0
    const ini0 = cycleList[0].entry.stageDays.ini;
    const dev0 = cycleList[0].entry.stageDays.dev;
    const mid0 = cycleList[0].entry.stageDays.mid;
    const late0 = cycleList[0].entry.stageDays.late;
    const total0 = ini0 + dev0 + mid0 + late0;
    const cycle0End =
      fieldIdx === 0 && actualHarvestedObs && actualHarvestedObs.date > cycle0Start
        ? actualHarvestedObs.date
        : addDaysToDateStr(cycle0Start, total0 - 1);

    emitCycleSpan({
      cycleNum: 0,
      step: cycleList[0],
      startDate: cycle0Start,
      endDate: cycle0End,
      isHistoricalAnchor: true,
    });

    // Backward cycles so earlier months in rangeStart never appear blank
    let backCursorEnd = addDaysToDateStr(cycle0Start, -1);
    let backNum = -1;
    while (backCursorEnd >= rangeStart && backNum >= -6) {
      const prevIdx =
        ((backNum % cycleList.length) + cycleList.length) % cycleList.length;
      const prevStep = cycleList[prevIdx];
      const d = prevStep.entry.stageDays;
      const len = d.ini + d.dev + d.mid + d.late;
      const prevStart = addDaysToDateStr(backCursorEnd, -(len - 1));
      emitCycleSpan({
        cycleNum: backNum,
        step: prevStep,
        startDate: prevStart,
        endDate: backCursorEnd,
        isHistoricalAnchor: false,
      });
      backCursorEnd = addDaysToDateStr(prevStart, -1);
      backNum--;
    }

    // Forward succession cycles so future months up to rangeEnd ALWAYS show per-field crops
    let fwdCursorStart = addDaysToDateStr(cycle0End, 1);
    let fwdNum = 1;
    while (fwdCursorStart <= rangeEnd && fwdNum <= 10) {
      const step = cycleList[fwdNum % cycleList.length];
      const d = step.entry.stageDays;
      const len = d.ini + d.dev + d.mid + d.late;
      const fwdEnd = addDaysToDateStr(fwdCursorStart, len - 1);
      emitCycleSpan({
        cycleNum: fwdNum,
        step,
        startDate: fwdCursorStart,
        endDate: fwdEnd,
        isHistoricalAnchor: false,
      });

      // Emit transition prep + planting + harvest milestone windows for upcoming cycle transitions
      const prepStart = fwdCursorStart;
      const prepEnd = addDaysToDateStr(prepStart, 3);
      if (prepEnd >= rangeStart && prepStart <= rangeEnd && fieldIdx === 0) {
        pushEvent({
          event_id: `rotation-prep:${rawFarm.id}:${fId || 'farm'}:c${fwdNum}:${planVersion}`,
          source_type: 'rotation_stage',
          source_id: activePlan?.planId ?? null,
          farm_id: rawFarm.id,
          farm_name: rawFarm.name,
          field_id: fId,
          field_name: fName,
          crop_occurrence_id: fId ? `crop:${fId}:c${fwdNum}` : null,
          crop_name: step.displayCropName,
          title: `Rotation Prep - ${shortField}`,
          subtitle: `${step.displayCropName} transition (${formatShortDate(prepStart)}–${formatShortDate(prepEnd)})`,
          description: `Seedbed residue management and transition prep for ${step.displayCropName} on ${fName}.`,
          event_type: 'rotation_prep',
          start_date: prepStart,
          end_date: prepEnd,
          start_at: `${prepStart}T00:00:00`,
          end_at: `${prepEnd}T23:59:59`,
          timezone: tz,
          date_basis: 'Planned',
          status: prepEnd < todayStr ? 'completed' : 'scheduled',
          priority: 'normal',
          action_button_type: null,
          completed: prepEnd < todayStr,
          planned_date: prepStart,
          actual_date: null,
          evidence: [
            `Succession crop: ${step.displayCropName}`,
            activePlan
              ? `Rotation Plan "${activePlan.title}" v${planVersion}`
              : `Agronomic succession sequence`,
          ],
          links: {
            rotation_plan_id: activePlan?.planId ?? null,
            farm_route: `/my-farms/${rawFarm.id}`,
            rotation_route: '/rotation',
          },
          source_version: planVersion,
          generated_at: nowIso,
        });
      }

      fwdCursorStart = addDaysToDateStr(fwdEnd, 1);
      fwdNum++;
    }

    // Cycle 0 stage transition + harvest milestones on Field 01
    if (fieldIdx === 0) {
      const devDate = addDaysToDateStr(cycle0Start, ini0);
      const midDate = addDaysToDateStr(cycle0Start, ini0 + dev0);
      const harvestStart = addDaysToDateStr(cycle0Start, ini0 + dev0 + mid0);
      const effectiveHarvestStart = actualHarvestedObs ? actualHarvestedObs.date : harvestStart;
      const effectiveHarvestEnd = actualHarvestedObs
        ? actualHarvestedObs.date
        : addDaysToDateStr(harvestStart, 6);

      pushEvent({
        event_id: `crop-milestone:${rawFarm.id}:${fId || 'farm'}:dev:${devDate}`,
        source_type: 'rotation_stage',
        source_id: activePlan?.planId ?? null,
        farm_id: rawFarm.id,
        farm_name: rawFarm.name,
        field_id: fId,
        field_name: fName,
        crop_occurrence_id: fId ? `crop:${fId}` : null,
        crop_name: cycleList[0].displayCropName,
        title: `${cycleList[0].displayCropName} Vegetative Phase - ${shortField}`,
        subtitle: 'Vegetative Development Milestone',
        description: `Expected transition into rapid vegetative canopy cover (~${ini0} days from start).`,
        event_type: 'crop_stage',
        start_date: devDate,
        end_date: devDate,
        start_at: `${devDate}T00:00:00`,
        end_at: `${devDate}T23:59:59`,
        timezone: tz,
        date_basis: 'Modelled',
        status: devDate < todayStr ? 'completed' : 'active',
        priority: 'normal',
        action_button_type: null,
        completed: devDate < todayStr,
        planned_date: addDaysToDateStr(plannedAnchorDate, ini0),
        actual_date: actualPlantedObs ? devDate : null,
        evidence: [
          `FAO-56 stage table (${primaryEntry.commonName}): Initial phase ${ini0} days`,
        ],
        links: {
          rotation_plan_id: activePlan?.planId ?? null,
          farm_route: `/my-farms/${rawFarm.id}`,
          rotation_route: '/rotation',
        },
        source_version: planVersion,
        generated_at: nowIso,
      });

      pushEvent({
        event_id: `crop-milestone:${rawFarm.id}:${fId || 'farm'}:mid:${midDate}`,
        source_type: 'rotation_stage',
        source_id: activePlan?.planId ?? null,
        farm_id: rawFarm.id,
        farm_name: rawFarm.name,
        field_id: fId,
        field_name: fName,
        crop_occurrence_id: fId ? `crop:${fId}` : null,
        crop_name: cycleList[0].displayCropName,
        title: `${cycleList[0].displayCropName} Peak Canopy - ${shortField}`,
        subtitle: `Sensitive Stage: ${primaryEntry.sensitiveStages}`,
        description: `Peak canopy Kc=${primaryEntry.kcMid}; sensitive to moisture or heat stress above ${primaryEntry.heatThresholdC}°C.`,
        event_type: 'crop_stage',
        start_date: midDate,
        end_date: midDate,
        start_at: `${midDate}T00:00:00`,
        end_at: `${midDate}T23:59:59`,
        timezone: tz,
        date_basis: 'Modelled',
        status: midDate < todayStr ? 'completed' : 'active',
        priority: 'normal',
        action_button_type: null,
        completed: midDate < todayStr,
        planned_date: addDaysToDateStr(plannedAnchorDate, ini0 + dev0),
        actual_date: null,
        evidence: [
          `Sensitive stage (${primaryEntry.sensitiveStages})`,
          `Heat threshold: ${primaryEntry.heatThresholdC}°C`,
        ],
        links: {
          rotation_plan_id: activePlan?.planId ?? null,
          farm_route: `/my-farms/${rawFarm.id}`,
          rotation_route: '/rotation',
        },
        source_version: planVersion,
        generated_at: nowIso,
      });

      pushEvent({
        event_id: `rotation-harvest:${rawFarm.id}:${fId || 'farm'}:${planVersion}`,
        source_type: 'rotation_stage',
        source_id: activePlan?.planId ?? null,
        farm_id: rawFarm.id,
        farm_name: rawFarm.name,
        field_id: fId,
        field_name: fName,
        crop_occurrence_id: fId ? `crop:${fId}` : null,
        crop_name: cycleList[0].displayCropName,
        title: `Harvest Window - ${shortField}`,
        subtitle: actualHarvestedObs
          ? `Actual harvest recorded (${formatShortDate(actualHarvestedObs.date)})`
          : `Modelled window: ${formatShortDate(effectiveHarvestStart)}–${formatShortDate(effectiveHarvestEnd)}`,
        description: `Target harvest window for ${cycleList[0].displayCropName} under ${activePlan?.title || 'current crop profile'}. Planned maturity window: ${formatShortDate(harvestStart)}–${formatShortDate(cycle0End)}.`,
        event_type: 'harvest',
        start_date: effectiveHarvestStart,
        end_date: effectiveHarvestEnd,
        start_at: `${effectiveHarvestStart}T00:00:00`,
        end_at: `${effectiveHarvestEnd}T23:59:59`,
        timezone: tz,
        date_basis: actualHarvestedObs ? 'Observed' : activePlan ? 'Planned' : 'Modelled',
        status: actualHarvestedObs || effectiveHarvestEnd < todayStr ? 'completed' : 'scheduled',
        priority: 'normal',
        action_button_type: null,
        completed: Boolean(actualHarvestedObs) || effectiveHarvestEnd < todayStr,
        planned_date: harvestStart,
        actual_date: actualHarvestedObs?.date ?? null,
        evidence: [
          `Active Rotation Plan: ${activePlan?.title || cycleList[0].displayCropName} (v${planVersion})`,
          `Projected cycle length: ${total0} days`,
        ],
        links: {
          rotation_plan_id: activePlan?.planId ?? null,
          farm_route: `/my-farms/${rawFarm.id}`,
          rotation_route: '/rotation',
        },
        source_version: planVersion,
        generated_at: nowIso,
      });
    }
  });

  // Specific fields with rotationReviewDue flag
  for (const field of farmFields) {
    if (!field.rotationReviewDue) continue;
    const reviewDate = addDaysToDateStr(todayStr, 3);
    const shortField = makeShortFieldLabel(field.name);
    pushEvent({
      event_id: `rotation-review:${rawFarm.id}:${field.id}`,
      source_type: 'rotation_stage',
      source_id: field.activePlanId || activePlan?.planId || field.id,
      farm_id: rawFarm.id,
      farm_name: rawFarm.name,
      field_id: field.id,
      field_name: field.name,
      crop_occurrence_id: `crop:${field.id}`,
      crop_name: field.cropName || rawFarm.primaryCrop || null,
      title: `Rotation Prep - ${shortField}`,
      subtitle: `${field.cropName || 'Next cycle'} review due`,
      description:
        field.notes ||
        `Field "${field.name}" is flagged for rotation transition review before the next planting cycle.`,
      event_type: 'rotation_prep',
      start_date: reviewDate,
      end_date: reviewDate,
      start_at: `${reviewDate}T00:00:00`,
      end_at: `${reviewDate}T23:59:59`,
      timezone: tz,
      date_basis: 'Planned',
      status: 'scheduled',
      priority: 'high',
      action_button_type: null,
      completed: false,
      evidence: [`Field rotationReviewDue flag set on ${field.name}`],
      links: {
        rotation_plan_id: field.activePlanId || activePlan?.planId || null,
        farm_route: `/my-farms/${rawFarm.id}`,
        rotation_route: '/rotation',
      },
      source_version: planVersion,
      generated_at: nowIso,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 5–7. Logic-Driven Recurring Safety & Agronomic Scheduler               */
  /*      (Weekly / Bi-Weekly / Monthly — Priority & Cadence By Condition)  */
  /* ---------------------------------------------------------------------- */
  const hasUserTaskNearby = (
    eventType: CalendarEventType,
    fieldId: string | null,
    targetDate: string
  ): boolean => {
    for (const t of farmTasks) {
      const status = t.status || (t.completed ? 'completed' : 'scheduled');
      if (status === 'cancelled') continue;
      if (mapTaskCategoryToEventType(t.category) !== eventType) continue;
      const taskField = t.fieldId || null;
      if (fieldId && taskField && taskField !== fieldId) continue;
      const dueStr = isoToDateStrInTz(t.dueDate || t.createdAt, tz) || todayStr;
      if (Math.abs(daysBetweenDateStrs(dueStr, targetDate)) <= 2) return true;
    }
    return false;
  };

  const safetyFields =
    allFarmFieldsOrFallback.length > 0
      ? allFarmFieldsOrFallback
      : [
          {
            id: null as unknown as string,
            name: 'Whole Farm',
            cropName: rawFarm.primaryCrop || qTopCrop || 'Wheat',
            status: 'Active' as const,
            rotationReviewDue: false,
            activeAlertsCount: 0,
            criticalAlert: null,
            staleCalculations: [] as string[],
            notes: '',
            updatedAt: rawFarm.createdAt,
          },
        ];

  const farmSeed = deterministicHashInt(rawFarm.id);
  const effectiveSafetyStart =
    rangeStart > todayStr ? rangeStart : todayStr;

  const moisturePct = rawFarm.soil.moisturePct;
  const isMoistureCritical = moisturePct !== null && moisturePct < 22;
  const isMoistureLow = moisturePct !== null && moisturePct < 28;
  const isMoistureUnknown =
    rawFarm.soil.moistureStatus === 'unknown' || moisturePct === null;

  const phUntested =
    rawFarm.soil.phStatus === 'not_tested' || rawFarm.soil.phValue === null;
  const phOutOfRange =
    rawFarm.soil.phValue !== null &&
    (rawFarm.soil.phValue < 5.6 || rawFarm.soil.phValue > 7.8);
  const lowOrganicMatter =
    rawFarm.soil.organicMatterPct !== null && rawFarm.soil.organicMatterPct < 2.5;
  const drainageExtreme =
    rawFarm.soil.drainage === 'Quickly' ||
    rawFarm.soil.drainage === 'Very slowly' ||
    rawFarm.soil.drainage === 'Slowly';
  const waterQualityUntestedOrSaline =
    rawFarm.water.qualityTested === 'No' ||
    (rawFarm.water.ecDsM !== null && rawFarm.water.ecDsM >= 1.5);
  const soilRefDate = latestSoilObsDate || rawFarm.soil.phTestDate || null;
  const soilAgeDays = soilRefDate ? daysBetweenDateStrs(soilRefDate, todayStr) : 999;
  const soilStale = soilAgeDays > 180;

  const isIrrigatedFarm =
    Boolean(rawFarm.water.wateringMethod?.toLowerCase().includes('irrigation')) ||
    (rawFarm.water.irrigationMethod !== 'Unknown' &&
      rawFarm.water.irrigationMethod !== 'None / Rain-fed');
  const irrFreq = String(rawFarm.water.irrigationFrequency || '');
  const demandExceedsSupply =
    rawFarm.water.estimatedDailyDemandM3 !== null &&
    rawFarm.water.dailyCapacityM3 !== null &&
    rawFarm.water.estimatedDailyDemandM3 > rawFarm.water.dailyCapacityM3;
  const limitedWater =
    rawFarm.water.reliability === 'Frequently limited' ||
    rawFarm.water.reliability === 'Sometimes limited';
  const heavyRainAhead =
    weather.available &&
    weather.forecast_precip_48h_mm !== null &&
    weather.forecast_precip_48h_mm >= 10;

  const alertedFields = farmFields.filter(
    (f) => f.activeAlertsCount > 0 || f.status === 'Needs Review' || Boolean(f.criticalAlert)
  );
  const heatOrStormWeather =
    weather.available &&
    ((weather.temp_max_c !== null && weather.temp_max_c >= 30) ||
      (weather.wind_kmh !== null && weather.wind_kmh >= 24) ||
      (weather.forecast_precip_48h_mm !== null && weather.forecast_precip_48h_mm >= 12) ||
      (weather.weather_code !== null && weather.weather_code >= 80));
  const challengeText = (rawFarm.challenges || []).join(' ').toLowerCase();
  const hasPestOrDroughtChallenge = /(pest|disease|drought|heat|flood|erosion|salin)/.test(
    challengeText
  );
  const rotationReviewNeeded = farmFields.some((f) => f.rotationReviewDue);

  // Helper to iterate phase-locked dates from anchorDate with intervalDays covering [effectiveSafetyStart .. rangeEnd]
  const collectRecurringDates = (
    anchorDate: string,
    intervalDays: number
  ): Array<{ dateStr: string; cycleIdx: number }> => {
    if (effectiveSafetyStart > rangeEnd) return [];
    const results: Array<{ dateStr: string; cycleIdx: number }> = [];
    const diff = daysBetweenDateStrs(anchorDate, effectiveSafetyStart);
    let n = diff <= 0 ? 0 : Math.ceil(diff / intervalDays);
    let guard = 0;
    while (guard < 45) {
      guard++;
      const d = addDaysToDateStr(anchorDate, n * intervalDays);
      if (d > rangeEnd) break;
      if (d >= effectiveSafetyStart) {
        results.push({ dateStr: d, cycleIdx: n });
      }
      n++;
    }
    return results;
  };

  /* 5A. Recurring Plant & Canopy Safety Inspection (`scouting`) */
  const scoutingElevated =
    alertedFields.length > 0 ||
    isMoistureCritical ||
    heatOrStormWeather ||
    hasPestOrDroughtChallenge;
  const scoutingInterval = scoutingElevated ? 5 : 7;
  const scoutingAnchor = scoutingElevated
    ? todayStr
    : addDaysToDateStr(todayStr, farmSeed % 4);
  const scoutingPriority: 'high' | 'normal' = scoutingElevated ? 'high' : 'normal';

  const scoutingReasons: string[] = [];
  if (alertedFields.length > 0) {
    scoutingReasons.push(
      `${alertedFields.length} field(s) flagged Needs Review / active alerts (${alertedFields.map((f) => f.name).join(', ')})`
    );
  }
  if (isMoistureCritical) {
    scoutingReasons.push(`Critical low soil moisture (${moisturePct}% VWC) stresses crop resistance`);
  }
  if (heatOrStormWeather && weather.available) {
    scoutingReasons.push(
      `Weather watch: ${weather.temp_max_c ?? '--'}°C max, ${weather.wind_kmh ?? '--'} km/h wind, ${weather.forecast_precip_48h_mm ?? 0} mm 48h rain`
    );
  }
  if (hasPestOrDroughtChallenge) {
    scoutingReasons.push(`Reported farm challenges: ${(rawFarm.challenges || []).join(', ')}`);
  }
  if (scoutingReasons.length === 0) {
    scoutingReasons.push('Standard preventive weekly canopy, pest trap & stand-uniformity inspection');
  }

  for (const { dateStr, cycleIdx } of collectRecurringDates(scoutingAnchor, scoutingInterval)) {
    const targetField =
      cycleIdx === 0 && alertedFields.length > 0
        ? alertedFields[0]
        : safetyFields[(cycleIdx + farmSeed) % safetyFields.length];
    const fId = targetField.id || null;
    const fName = targetField.name || 'Whole Farm';
    const shortField = makeShortFieldLabel(fName);
    if (hasUserTaskNearby('scouting', fId, dateStr)) continue;

    const isFieldAlert =
      targetField.activeAlertsCount > 0 ||
      targetField.status === 'Needs Review' ||
      Boolean(targetField.criticalAlert);

    pushEvent({
      event_id: `auto-safety:${rawFarm.id}:${fId || 'farm'}:scouting:${dateStr}`,
      source_type: 'scouting_recommendation',
      source_id: `auto-safety:${rawFarm.id}:scouting`,
      farm_id: rawFarm.id,
      farm_name: rawFarm.name,
      field_id: fId,
      field_name: fName,
      crop_occurrence_id: fId ? `crop:${fId}` : null,
      crop_name: targetField.cropName || rawFarm.primaryCrop || qTopCrop || null,
      title: `Plant Inspection - ${shortField}`,
      subtitle:
        isFieldAlert && targetField.criticalAlert
          ? targetField.criticalAlert
          : scoutingElevated
            ? `Every ${scoutingInterval}d High-Risk Safety Check`
            : 'Weekly Canopy & Pest Walk',
      description: `Automated ${scoutingInterval}-day plant safety inspection for ${fName} (${rawFarm.name}). Check emergence/leaf health, pest traps, disease lesions, and moisture stress.`,
      event_type: 'scouting',
      start_date: dateStr,
      end_date: dateStr,
      start_at: `${dateStr}T00:00:00`,
      end_at: `${dateStr}T23:59:59`,
      timezone: tz,
      date_basis: 'Planned',
      status: 'recommended',
      priority: isFieldAlert || scoutingPriority === 'high' ? 'high' : 'normal',
      action_button_type: null,
      completed: false,
      planned_date: dateStr,
      evidence: [
        `Auto-planned cadence: Every ${scoutingInterval} days (${scoutingElevated ? 'High Priority' : 'Weekly Safety Baseline'})`,
        ...scoutingReasons,
      ],
      links: {
        recommendation_id: `auto-safety:${rawFarm.id}:scouting:${dateStr}`,
        farm_route: `/my-farms/${rawFarm.id}`,
      },
      source_version: 1,
      generated_at: nowIso,
    });
  }

  /* 5B. Recurring Soil Health, Moisture & Salinity Safety Test (`soil_test`) */
  const soilHighRisk =
    phUntested || isMoistureUnknown || phOutOfRange || soilStale || waterQualityUntestedOrSaline;
  const soilModerateRisk = !soilHighRisk && (drainageExtreme || lowOrganicMatter);
  const soilInterval = soilHighRisk ? 14 : soilModerateRisk ? 21 : 28;
  const soilPriority: 'high' | 'normal' = soilHighRisk ? 'high' : 'normal';
  const soilOffset = soilHighRisk ? (farmSeed % 2) : ((farmSeed + 2) % 6);
  const soilAnchor = addDaysToDateStr(todayStr, soilOffset);

  const soilReasons: string[] = [];
  if (phUntested) soilReasons.push('Soil pH has not been tested yet');
  if (isMoistureUnknown) soilReasons.push('Soil moisture is unmeasured');
  if (phOutOfRange) soilReasons.push(`Measured pH (${rawFarm.soil.phValue}) sits outside optimal 5.6–7.8 band`);
  if (waterQualityUntestedOrSaline) {
    soilReasons.push(
      rawFarm.water.qualityTested === 'No'
        ? 'Irrigation water salinity/EC untested — check root-zone salt buildup'
        : `Elevated water EC (${rawFarm.water.ecDsM} dS/m)`
    );
  }
  if (soilStale && soilRefDate) {
    soilReasons.push(`Last recorded soil check was ${soilAgeDays} days ago (${soilRefDate})`);
  }
  if (drainageExtreme) {
    soilReasons.push(`Drainage class "${rawFarm.soil.drainage}" benefits from bi/tri-weekly topsoil moisture verification`);
  }
  if (lowOrganicMatter) {
    soilReasons.push(`Low organic matter (${rawFarm.soil.organicMatterPct}%) — monitor structure & nutrient retention`);
  }
  if (soilReasons.length === 0) {
    soilReasons.push('Preventive monthly 0–20 cm composite soil pH, EC & moisture safety audit');
  }

  for (const { dateStr, cycleIdx } of collectRecurringDates(soilAnchor, soilInterval)) {
    const targetField =
      safetyFields[(cycleIdx + safetyFields.length - 1 + farmSeed) % safetyFields.length];
    const fId = targetField.id || null;
    const fName = targetField.name || 'Whole Farm';
    const shortField = makeShortFieldLabel(fName);
    if (hasUserTaskNearby('soil_test', fId, dateStr)) continue;

    pushEvent({
      event_id: `auto-safety:${rawFarm.id}:${fId || 'farm'}:soil:${dateStr}`,
      source_type: 'soil_recommendation',
      source_id: `auto-safety:${rawFarm.id}:soil`,
      farm_id: rawFarm.id,
      farm_name: rawFarm.name,
      field_id: fId,
      field_name: fName,
      crop_occurrence_id: fId ? `crop:${fId}` : null,
      crop_name: targetField.cropName || rawFarm.primaryCrop || qTopCrop || null,
      title: `Soil Test - ${shortField}`,
      subtitle: soilHighRisk
        ? phUntested
          ? 'pH & EC Safety Check (Bi-weekly)'
          : `Bi-weekly Soil Safety Re-test (${soilInterval}d)`
        : soilModerateRisk
          ? '3-Week Topsoil Moisture & Structure Test'
          : 'Monthly Soil Health & pH Test',
      description: `Automated ${soilInterval}-day soil safety check on ${fName} (${rawFarm.name}). Sample 0–20 cm profile for moisture, pH (${rawFarm.soil.phValue ?? 'untested'}), and salinity.`,
      event_type: 'soil_test',
      start_date: dateStr,
      end_date: dateStr,
      start_at: `${dateStr}T00:00:00`,
      end_at: `${dateStr}T23:59:59`,
      timezone: tz,
      date_basis: 'Planned',
      status: 'recommended',
      priority: soilPriority,
      action_button_type: null,
      completed: false,
      planned_date: dateStr,
      evidence: [
        `Auto-planned cadence: Every ${soilInterval} days (${soilHighRisk ? 'High Priority' : 'Preventive Monthly'})`,
        ...soilReasons,
      ],
      links: {
        recommendation_id: `auto-safety:${rawFarm.id}:soil:${dateStr}`,
        farm_route: `/my-farms/${rawFarm.id}`,
      },
      source_version: 1,
      generated_at: nowIso,
    });
  }

  /* 5C. Recurring Water, Irrigation & Drainage Safety Check (`irrigation`) */
  const irrUrgent = isIrrigatedFarm && (isMoistureCritical || isMoistureLow || demandExceedsSupply || limitedWater);
  const irrInterval = !isIrrigatedFarm
    ? 28
    : irrUrgent
      ? irrFreq.toLowerCase().includes('2–3') || irrFreq.toLowerCase().includes('2-3')
        ? 4
        : 5
      : irrFreq.toLowerCase().includes('weekly') || irrFreq.toLowerCase().includes('2–3')
        ? 7
        : 14;
  const irrPriority: 'high' | 'normal' = irrUrgent ? 'high' : 'normal';
  const daysSinceLastIrr = latestIrrDate ? daysBetweenDateStrs(latestIrrDate, todayStr) : 99;
  const irrImmediateNeeded =
    isIrrigatedFarm && (irrUrgent || daysSinceLastIrr >= irrInterval);
  const irrAnchor = irrImmediateNeeded
    ? heavyRainAhead
      ? addDaysToDateStr(todayStr, 2)
      : todayStr
    : addDaysToDateStr(todayStr, ((farmSeed + 3) % 5) + 1);

  const irrReasons: string[] = [
    `Watering method: ${rawFarm.water.wateringMethod || rawFarm.water.irrigationMethod || 'Not specified'}`,
    `Last logged irrigation: ${latestIrrDate ? `${daysSinceLastIrr} days ago (${latestIrrDate})` : 'No prior run recorded'}`,
  ];
  if (moisturePct !== null) {
    irrReasons.push(`Current soil moisture: ${moisturePct}% VWC (${rawFarm.soil.moistureStatus})`);
  }
  if (demandExceedsSupply) {
    irrReasons.push(
      `Estimated demand (${rawFarm.water.estimatedDailyDemandM3} m³/d) exceeds reliable supply (${rawFarm.water.dailyCapacityM3} m³/d)`
    );
  }
  if (limitedWater) {
    irrReasons.push(`Water reliability flagged: ${rawFarm.water.reliability}`);
  }
  if (weather.available) {
    irrReasons.push(
      `Open-Meteo 48h rain: ${weather.forecast_precip_48h_mm ?? 0} mm · ET0: ${weather.et0_mm_day ?? '—'} mm/d`
    );
  }

  for (const { dateStr, cycleIdx } of collectRecurringDates(irrAnchor, irrInterval)) {
    const targetField =
      safetyFields[(cycleIdx + 1 + farmSeed) % safetyFields.length];
    const fId = targetField.id || null;
    const fName = targetField.name || 'Whole Farm';
    const shortField = makeShortFieldLabel(fName);

    if (dateStr === todayStr && irrigatedTodayKeys.has(fId || 'farm')) continue;
    if (hasUserTaskNearby('irrigation', fId, dateStr)) continue;

    const isImmediateStart =
      isIrrigatedFarm &&
      !heavyRainAhead &&
      dateStr <= addDaysToDateStr(todayStr, 1);

    pushEvent({
      event_id: `auto-safety:${rawFarm.id}:${fId || 'farm'}:irr:${dateStr}`,
      source_type: 'irrigation_recommendation',
      source_id: `auto-safety:${rawFarm.id}:irrigation`,
      farm_id: rawFarm.id,
      farm_name: rawFarm.name,
      field_id: fId,
      field_name: fName,
      crop_occurrence_id: fId ? `crop:${fId}` : null,
      crop_name: targetField.cropName || rawFarm.primaryCrop || qTopCrop || null,
      title: isIrrigatedFarm
        ? `Irrigation Check - ${shortField}`
        : `Drainage & Moisture Check - ${shortField}`,
      subtitle: isImmediateStart
        ? 'Recommended Now'
        : heavyRainAhead && dateStr <= addDaysToDateStr(todayStr, 3)
          ? `Adjusted after ${weather.forecast_precip_48h_mm} mm forecast rain`
          : isIrrigatedFarm
            ? irrUrgent
              ? `Every ${irrInterval}d Moisture Safety Run`
              : `Weekly Water & Line Check`
            : 'Monthly Drainage & Runoff Audit',
      description: isIrrigatedFarm
        ? `Automated ${irrInterval}-day irrigation and moisture safety check on ${fName}. Verify pump/drip pressure and deliver required m³ if moisture remains low.`
        : `Monthly rain-fed drainage, ponding and subsoil moisture safety check on ${fName}.`,
      event_type: 'irrigation',
      start_date: dateStr,
      end_date: dateStr,
      start_at: `${dateStr}T00:00:00`,
      end_at: `${dateStr}T23:59:59`,
      timezone: tz,
      date_basis: 'Planned',
      status: 'recommended',
      priority: irrPriority,
      action_button_type: isImmediateStart ? 'start' : null,
      completed: false,
      planned_date: dateStr,
      evidence: [
        `Auto-planned cadence: Every ${irrInterval} days (${irrPriority === 'high' ? 'High Priority Moisture/Supply' : 'Routine Safety Check'})`,
        ...irrReasons,
      ],
      links: {
        recommendation_id: `auto-safety:${rawFarm.id}:irrigation:${dateStr}`,
        farm_route: `/my-farms/${rawFarm.id}`,
      },
      source_version: 1,
      generated_at: nowIso,
    });
  }

  /* 5D. Monthly Crop Nutrition & Rotation Safety Audit (`fertilizer`) */
  const nutrientElevated = rotationReviewNeeded || lowOrganicMatter || phOutOfRange;
  const nutrientInterval = nutrientElevated ? 14 : 28;
  const nutrientPriority: 'high' | 'normal' = nutrientElevated ? 'high' : 'normal';
  const nutrientAnchor = addDaysToDateStr(todayStr, ((farmSeed + 5) % 6) + 2);

  for (const { dateStr, cycleIdx } of collectRecurringDates(nutrientAnchor, nutrientInterval)) {
    const targetField =
      safetyFields[(cycleIdx + farmSeed) % safetyFields.length];
    const fId = targetField.id || null;
    const fName = targetField.name || 'Whole Farm';
    const shortField = makeShortFieldLabel(fName);
    if (hasUserTaskNearby('fertilizer', fId, dateStr)) continue;

    pushEvent({
      event_id: `auto-safety:${rawFarm.id}:${fId || 'farm'}:nutr:${dateStr}`,
      source_type: 'rotation_stage',
      source_id: activePlan?.planId ?? `auto-safety:${rawFarm.id}:nutrition`,
      farm_id: rawFarm.id,
      farm_name: rawFarm.name,
      field_id: fId,
      field_name: fName,
      crop_occurrence_id: fId ? `crop:${fId}` : null,
      crop_name: targetField.cropName || rawFarm.primaryCrop || qTopCrop || null,
      title: `Crop Safety & Nutrition - ${shortField}`,
      subtitle: nutrientElevated
        ? `Bi-weekly Nutrient & Rotation Audit`
        : 'Monthly Crop Nutrition Safety Check',
      description: `Automated ${nutrientInterval}-day safety audit of crop vigor, foliar nutrition balance, and upcoming rotation prep on ${fName}.`,
      event_type: 'fertilizer',
      start_date: dateStr,
      end_date: dateStr,
      start_at: `${dateStr}T00:00:00`,
      end_at: `${dateStr}T23:59:59`,
      timezone: tz,
      date_basis: 'Planned',
      status: 'scheduled',
      priority: nutrientPriority,
      action_button_type: null,
      completed: false,
      planned_date: dateStr,
      evidence: [
        `Auto-planned cadence: Every ${nutrientInterval} days (${nutrientElevated ? 'Elevated Risk' : 'Monthly Safety Baseline'})`,
        lowOrganicMatter
          ? `Organic matter ${rawFarm.soil.organicMatterPct}% < 2.5% target`
          : 'Routine macronutrient & micronutrient deficiency check',
        rotationReviewNeeded
          ? 'Field rotation review flag active — verify residue & nutrient carryover'
          : `Active plan: ${activePlan?.title || 'Standard Crop Management'}`,
      ],
      links: {
        rotation_plan_id: activePlan?.planId ?? null,
        farm_route: `/my-farms/${rawFarm.id}`,
        rotation_route: '/rotation',
      },
      source_version: 1,
      generated_at: nowIso,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 8. Deep Analysis Snapshots, Questionnaire Results & Stale Reports      */
  /* ---------------------------------------------------------------------- */
  const farmSnapshots = port.snapshots.filter((s) => s.farmId === rawFarm.id);
  for (const snap of farmSnapshots) {
    const snapDate = isoToDateStrInTz(String(snap.generatedAt), tz);
    if (!snapDate) continue;
    const isStale =
      rawFarm.lastAssessedAt && daysBetweenDateStrs(snapDate, todayStr) > 14 &&
      snap === farmSnapshots[0];
    pushEvent({
      event_id: `snap:${String(snap.id)}`,
      source_type: 'analysis_report',
      source_id: String(snap.id),
      farm_id: rawFarm.id,
      farm_name: rawFarm.name,
      field_id: snap.fieldId ? String(snap.fieldId) : null,
      field_name: String(snap.fieldName || 'Whole Farm'),
      crop_occurrence_id: null,
      crop_name: rawFarm.primaryCrop || null,
      title: `Analysis Report · ${rawFarm.name}`,
      subtitle: `${snap.suitabilityScore !== null && snap.suitabilityScore !== undefined ? `Score ${snap.suitabilityScore}/100` : 'Snapshot saved'}${isStale ? ' (Stale)' : ''}`,
      description: String(snap.triggerReason || snap.weatherWindowSummary || 'Deep farm analysis snapshot.'),
      event_type: 'analysis',
      start_date: snapDate,
      end_date: snapDate,
      start_at: `${snapDate}T00:00:00`,
      end_at: `${snapDate}T23:59:59`,
      timezone: tz,
      date_basis: 'Completed',
      status: isStale ? 'stale' : 'completed',
      priority: 'normal',
      action_button_type: null,
      completed: true,
      actual_date: snapDate,
      evidence: [
        `Model version: ${String(snap.modelVersion || 'power-eonet')}`,
        `Report ID: ${String(snap.id)}`,
      ],
      links: {
        analysis_id: String(snap.id),
        report_id: String(snap.id),
        farm_route: `/my-farms/${rawFarm.id}`,
        report_route: `/my-farms/${rawFarm.id}`,
      },
      source_version: 1,
      generated_at: nowIso,
    });
  }

  // Also check stale assessment or staleCalculations on fields
  const lastAssessedDate = isoToDateStrInTz(rawFarm.lastAssessedAt, tz);
  const assessmentAgeDays = lastAssessedDate ? daysBetweenDateStrs(lastAssessedDate, todayStr) : null;
  const staleFieldItems = farmFields.flatMap((f) => f.staleCalculations || []);
  if ((assessmentAgeDays !== null && assessmentAgeDays > 14) || staleFieldItems.length > 0) {
    const staleReasons: string[] = [];
    if (assessmentAgeDays !== null && assessmentAgeDays > 14) {
      staleReasons.push(`Last farm assessment was ${assessmentAgeDays} days ago (${lastAssessedDate})`);
    }
    if (staleFieldItems.length > 0) {
      staleReasons.push(...staleFieldItems);
    }
    pushEvent({
      event_id: `analysis-stale:${rawFarm.id}:${todayStr}`,
      source_type: 'analysis_job',
      source_id: `stale:${rawFarm.id}`,
      farm_id: rawFarm.id,
      farm_name: rawFarm.name,
      field_id: null,
      field_name: 'Whole Farm',
      crop_occurrence_id: null,
      crop_name: rawFarm.primaryCrop || null,
      title: `Deep Analysis Reassessment - ${rawFarm.name}`,
      subtitle: 'Stale assessment — refresh recommended',
      description: staleReasons.join(' · '),
      event_type: 'analysis',
      start_date: todayStr,
      end_date: todayStr,
      start_at: `${todayStr}T00:00:00`,
      end_at: `${todayStr}T23:59:59`,
      timezone: tz,
      date_basis: 'Modelled',
      status: 'stale',
      priority: 'normal',
      action_button_type: null,
      completed: false,
      evidence: staleReasons,
      links: {
        farm_route: `/my-farms/${rawFarm.id}`,
        report_route: '/questions',
      },
      source_version: 1,
      generated_at: nowIso,
    });
  }

  // Questionnaire store completed results matching this farm
  for (const res of Object.values(qStore.results || {})) {
    const matchesFarm =
      res.farmId === rawFarm.id ||
      (res.farmName && res.farmName.toLowerCase() === rawFarm.name.toLowerCase());
    if (!matchesFarm) continue;
    const resDate = isoToDateStrInTz(res.generatedAt, tz);
    if (!resDate) continue;
    pushEvent({
      event_id: `qres:${res.resultId}`,
      source_type: 'analysis_report',
      source_id: res.resultId,
      farm_id: rawFarm.id,
      farm_name: rawFarm.name,
      field_id: null,
      field_name: 'Whole Farm',
      crop_occurrence_id: null,
      crop_name: res.summary?.topCrop || rawFarm.primaryCrop || null,
      title: `Deep Analysis Report (${res.summary?.topCrop || rawFarm.name})`,
      subtitle:
        typeof res.summary?.overallScore === 'number'
          ? `Deep Analysis Score: ${res.summary.overallScore}/100`
          : 'Completed Deep Analysis',
      description: `Questionnaire assessment completed for ${rawFarm.name}.`,
      event_type: 'analysis',
      start_date: resDate,
      end_date: resDate,
      start_at: `${resDate}T00:00:00`,
      end_at: `${resDate}T23:59:59`,
      timezone: tz,
      date_basis: 'Completed',
      status: 'completed',
      priority: 'normal',
      action_button_type: null,
      completed: true,
      actual_date: resDate,
      evidence: [`Deep Analysis Result ${res.resultId}`],
      links: {
        analysis_id: res.jobId,
        report_id: res.resultId,
        report_route: '/questions',
        farm_route: `/my-farms/${rawFarm.id}`,
      },
      source_version: 1,
      generated_at: nowIso,
    });
  }

  const farmOption: CalendarFarmOption = {
    id: rawFarm.id,
    name: rawFarm.name,
    timezone: tz,
    primary_crop: rawFarm.primaryCrop ?? null,
    region_label: rawFarm.regionLabel || rawFarm.locationLabel || '',
    centroid: rawFarm.centroid ?? null,
    fields: farmFields.map((f) => ({
      id: f.id,
      name: f.name,
      cropName: f.cropName,
      status: f.status,
    })),
    weather,
  };

  return { events, weather, sources, partial_sources, farmOption };
}

/* -------------------------------------------------------------------------- */
/* Conflict Detection (Factual Only — Never Invents Labor/Machine Capacity)   */
/* -------------------------------------------------------------------------- */

function detectConflicts(events: CalendarProjectionEvent[]): CalendarConflictWarning[] {
  const warnings: CalendarConflictWarning[] = [];
  const active = events.filter((e) => !e.completed && e.status !== 'cancelled');

  // Group by field + ISO week bucket
  const byFieldWeek = new Map<string, CalendarProjectionEvent[]>();
  for (const evt of active) {
    if (!evt.field_id) continue;
    const [y, m, d] = evt.start_date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const weekStart = addDaysToDateStr(evt.start_date, -dt.getUTCDay());
    const key = `${evt.farm_id}:${evt.field_id}:${weekStart}`;
    const list = byFieldWeek.get(key);
    if (list) list.push(evt);
    else byFieldWeek.set(key, [evt]);
  }

  for (const [, group] of byFieldWeek.entries()) {
    const actionableOps = group.filter(
      (e) =>
        e.source_type === 'task' ||
        e.event_type === 'harvest' ||
        e.event_type === 'planting' ||
        (e.event_type === 'irrigation' && e.action_button_type === 'start')
    );
    if (actionableOps.length >= 2) {
      const sample = actionableOps[0];
      const dates = actionableOps.map((e) => e.start_date).sort();
      warnings.push({
        id: `conflict:field-week:${sample.field_id}:${dates[0]}`,
        type: 'same_field_multiple_ops',
        farm_id: sample.farm_id,
        field_id: sample.field_id,
        date_range: { start: dates[0], end: dates[dates.length - 1] },
        message: `Multiple operations fall in the same week for ${sample.field_name} (${sample.farm_name}).`,
        event_ids: actionableOps.map((e) => e.event_id),
      });
    }
  }

  // Detect overlapping planting or harvest windows across fields
  const plantings = active.filter((e) => e.event_type === 'planting' && e.source_type === 'rotation_stage');
  for (let i = 0; i < plantings.length; i++) {
    for (let j = i + 1; j < plantings.length; j++) {
      const a = plantings[i];
      const b = plantings[j];
      if (a.start_date <= b.end_date && b.start_date <= a.end_date) {
        warnings.push({
          id: `conflict:plant-overlap:${a.event_id}:${b.event_id}`,
          type: 'overlapping_planting',
          farm_id: a.farm_id,
          field_id: a.field_id,
          date_range: {
            start: a.start_date > b.start_date ? a.start_date : b.start_date,
            end: a.end_date < b.end_date ? a.end_date : b.end_date,
          },
          message: `Planting windows overlap between ${a.field_name} and ${b.field_name}.`,
          event_ids: [a.event_id, b.event_id],
        });
      }
    }
  }

  return warnings;
}

function sortProjectionEvents(events: CalendarProjectionEvent[]): CalendarProjectionEvent[] {
  const typeOrder: Record<CalendarEventType, number> = {
    crop_stage: 1,
    planting: 2,
    irrigation: 3,
    scouting: 4,
    soil_test: 5,
    fertilizer: 6,
    harvest: 7,
    rotation_prep: 8,
    analysis: 9,
    general: 10,
  };
  const prioOrder: Record<string, number> = { high: 1, normal: 2, low: 3 };
  return [...events].sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date.localeCompare(b.start_date);
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const pa = prioOrder[a.priority || 'normal'] ?? 2;
    const pb = prioOrder[b.priority || 'normal'] ?? 2;
    if (pa !== pb) return pa - pb;
    const ta = typeOrder[a.event_type] ?? 20;
    const tb = typeOrder[b.event_type] ?? 20;
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });
}

/* -------------------------------------------------------------------------- */
/* Public Unified Projection Queries                                          */
/* -------------------------------------------------------------------------- */

export async function getCalendarProjection(params: {
  farmId?: string | null;
  fieldId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  eventTypes?: string[] | null;
  statuses?: string[] | null;
  simulateWeatherFailure?: boolean;
}): Promise<CalendarMonthResponse> {
  const mtimeSig = computeMtimeSignature();
  if (lastObservedMtimeSig && lastObservedMtimeSig !== mtimeSig) {
    invalidateCalendarCache();
  }
  lastObservedMtimeSig = mtimeSig;

  const port = readPortfolioStore();
  const payload = buildUnifiedPortfolioPayload();
  const qStore = readQuestionnaireStoreMinimal();

  const activeFarms = payload.farms.filter((f) => !f.archivedAt);
  const requestedFarmId =
    params.farmId && params.farmId.trim() !== '' ? params.farmId.trim() : activeFarms[0]?.id || 'all';
  const isAllFarms = requestedFarmId === 'all';
  const selectedFarmObj = isAllFarms
    ? null
    : activeFarms.find((f) => f.id === requestedFarmId) ?? activeFarms[0] ?? null;

  const effectiveFarmScope = isAllFarms ? 'all' : selectedFarmObj?.id || 'none';
  const resolvedTz =
    (params.timezone && isValidTimezone(params.timezone) ? params.timezone : null) ||
    selectedFarmObj?.timezone ||
    'UTC';

  const todayStr = getTodayDateStrInTz(resolvedTz);
  const startDate =
    params.startDate && isValidDateStr(params.startDate)
      ? params.startDate
      : `${todayStr.slice(0, 7)}-01`;
  const endDate =
    params.endDate && isValidDateStr(params.endDate)
      ? params.endDate
      : addDaysToDateStr(startDate, 34);

  const requestedFieldId =
    params.fieldId && params.fieldId.trim() !== '' && params.fieldId !== 'all'
      ? params.fieldId.trim()
      : null;

  const typeKey = params.eventTypes?.join(',') || '';
  const statusKey = params.statuses?.join(',') || '';
  const cacheKey = `${effectiveFarmScope}|${requestedFieldId || 'all'}|${startDate}|${endDate}|${resolvedTz}|${typeKey}|${statusKey}|${port.calendarVersion}|${mtimeSig}|${params.simulateWeatherFailure ? 'wf' : 'ok'}`;
  const cached = projectionCache.get(cacheKey);
  if (cached) return cached;

  // Always build farm options for header selector; only fetch live weather for active scope farms
  const scopeFarms = isAllFarms ? activeFarms : selectedFarmObj ? [selectedFarmObj] : [];
  const bundles = await Promise.all(
    scopeFarms.map((rf) =>
      collectEventsForSingleFarm({
        rawFarm: rf,
        allFields: payload.fields,
        port,
        qStore,
        rangeStart: startDate,
        rangeEnd: endDate,
        simulateWeatherFailure: params.simulateWeatherFailure,
      })
    )
  );

  // Build dropdown options for non-scope farms without blocking extra weather fetches
  const bundleByFarmId = new Map(bundles.map((b) => [b.farmOption.id, b]));
  const allFarmOptions: CalendarFarmOption[] = activeFarms.map((rf) => {
    const existing = bundleByFarmId.get(rf.id);
    if (existing) return existing.farmOption;
    const farmFields = payload.fields.filter((f) => f.farmId === rf.id);
    return {
      id: rf.id,
      name: rf.name,
      timezone: isValidTimezone(rf.timezone) ? rf.timezone : 'UTC',
      primary_crop: rf.primaryCrop ?? null,
      region_label: rf.regionLabel || rf.locationLabel || '',
      centroid: rf.centroid ?? null,
      fields: farmFields.map((f) => ({
        id: f.id,
        name: f.name,
        cropName: f.cropName,
        status: f.status,
      })),
      weather: {
        farm_id: rf.id,
        farm_name: rf.name,
        available: false,
        temp_c: null,
        temp_min_c: null,
        temp_max_c: null,
        wind_kmh: null,
        precip_mm_24h: null,
        forecast_precip_48h_mm: null,
        et0_mm_day: null,
        humidity_pct: null,
        weather_code: null,
        condition_label: 'Select farm for live weather',
        retrieved_at: new Date().toISOString(),
      },
    };
  });

  let events = bundles.flatMap((b) => b.events);
  const sources = bundles.flatMap((b) => b.sources);
  const partial_sources = bundles.flatMap((b) => b.partial_sources);

  if (requestedFieldId) {
    events = events.filter((e) => e.field_id === requestedFieldId);
  }
  if (params.eventTypes && params.eventTypes.length > 0) {
    const allowedTypes = new Set(params.eventTypes);
    events = events.filter((e) => allowedTypes.has(e.event_type));
  }
  if (params.statuses && params.statuses.length > 0) {
    const allowedStatuses = new Set(params.statuses);
    events = events.filter((e) => allowedStatuses.has(e.status));
  } else {
    events = events.filter((e) => e.status !== 'cancelled');
  }

  events = sortProjectionEvents(events);
  const conflicts = detectConflicts(events);

  const response: CalendarMonthResponse = {
    farm_id: effectiveFarmScope,
    field_id: requestedFieldId,
    timezone: resolvedTz,
    today: todayStr,
    range: { start: startDate, end: endDate },
    events,
    conflicts,
    workload_summary: {
      total_events: events.length,
      open_tasks: events.filter((e) => e.source_type === 'task' && !e.completed).length,
      actionable_recommendations: events.filter((e) => e.action_button_type === 'start').length,
      completed_events: events.filter((e) => e.completed).length,
    },
    farms: allFarmOptions,
    weather: selectedFarmObj ? bundleByFarmId.get(selectedFarmObj.id)?.weather ?? null : bundles[0]?.weather ?? null,
    generated_at: new Date().toISOString(),
    data_version: port.calendarVersion,
    partial_sources,
    sources,
  };

  projectionCache.set(cacheKey, response);
  return response;
}

export async function getCalendarDayProjection(params: {
  date: string;
  farmId?: string | null;
  fieldId?: string | null;
  timezone?: string | null;
  simulateWeatherFailure?: boolean;
}): Promise<CalendarDayResponse> {
  const proj = await getCalendarProjection({
    farmId: params.farmId,
    fieldId: params.fieldId,
    startDate: params.date,
    endDate: params.date,
    timezone: params.timezone,
    simulateWeatherFailure: params.simulateWeatherFailure,
  });

  const groups: CalendarDayGroups = {
    crops_and_stages: [],
    planned_work: [],
    tasks_due: [],
    observations: [],
    completed_history: [],
  };

    for (const evt of proj.events) {
      if (evt.completed || evt.status === 'completed') {
        if (evt.source_type === 'observation' || evt.source_type === 'irrigation_log') {
          groups.observations.push(evt);
        } else {
          groups.completed_history.push(evt);
        }
        continue;
      }
      if (evt.source_type === 'crop_stage') {
        // Tailor subtitle dynamically to reflect exact growth day for the queried date
        let tailoredEvt = evt;
        if (evt.stage_breakdown) {
          const dayNum = Math.max(1, daysBetweenDateStrs(evt.start_date, params.date) + 1);
          const { ini, dev, mid, late } = evt.stage_breakdown;
          const total = ini + dev + mid + late;
          const clamped = Math.min(dayNum, total);
          let phase = 'Emergence / Establishment';
          if (dayNum > ini + dev + mid) phase = 'Ripening & Harvest Readiness';
          else if (dayNum > ini + dev) phase = 'Mid-Season Canopy Peak';
          else if (dayNum > ini) {
            const c = (evt.crop_name || '').toLowerCase();
            phase = c.includes('wheat') || c.includes('barley') || c.includes('oat')
              ? 'Vegetative / Tillering'
              : 'Vegetative Canopy Growth';
          }
          tailoredEvt = {
            ...evt,
            subtitle: `Day ${clamped} of ${total} · ${phase}`,
          };
        }
        groups.crops_and_stages.push(tailoredEvt);
      } else if (evt.source_type === 'task') {
        groups.tasks_due.push(evt);
      } else if (evt.source_type === 'observation' || evt.source_type === 'irrigation_log') {
        groups.observations.push(evt);
      } else {
        groups.planned_work.push(evt);
      }
    }

    const tailoredEvents = proj.events.map((evt) => {
      if (evt.source_type !== 'crop_stage') return evt;
      return groups.crops_and_stages.find((g) => g.event_id === evt.event_id) ?? evt;
    });

    return {
      date: params.date,
      farm_id: proj.farm_id,
      field_id: proj.field_id,
      timezone: proj.timezone,
      groups,
      events: tailoredEvents,
      conflicts: proj.conflicts,
      generated_at: proj.generated_at,
      data_version: proj.data_version,
      partial_sources: proj.partial_sources,
    };
  }

  export async function getCalendarUpcomingProjection(params: {
    farmId?: string | null;
    fieldId?: string | null;
    startDate?: string | null;
    days?: number;
    timezone?: string | null;
  }): Promise<CalendarUpcomingResponse> {
    const days = Math.max(1, Math.min(30, params.days || 7));
    const payload = buildUnifiedPortfolioPayload();
    const farmObj =
      params.farmId && params.farmId !== 'all'
        ? payload.farms.find((f) => f.id === params.farmId)
        : payload.farms[0];
    const tz = params.timezone || farmObj?.timezone || 'UTC';
    const anchor = params.startDate && isValidDateStr(params.startDate) ? params.startDate : getTodayDateStrInTz(tz);
    const startDate = addDaysToDateStr(anchor, 1);
    const endDate = addDaysToDateStr(anchor, days);

    const proj = await getCalendarProjection({
      farmId: params.farmId,
      fieldId: params.fieldId,
      startDate,
      endDate,
      timezone: tz,
    });

    // Deduplicate linked recommendation vs user task & omit ongoing multi-day crop_stage spans from Next 7 Days action queue
    const seen = new Set<string>();
    const upcomingEvents: CalendarProjectionEvent[] = [];
    for (const evt of proj.events) {
      if (evt.completed) continue;
      if (evt.source_type === 'crop_stage' && evt.start_date < startDate) continue;
      const dedupKey = evt.links.recommendation_id
        ? `rec:${evt.links.recommendation_id}`
        : evt.event_id;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      upcomingEvents.push(evt);
    }

  return {
    farm_id: proj.farm_id,
    field_id: proj.field_id,
    timezone: proj.timezone,
    start_date: startDate,
    end_date: endDate,
    days,
    events: upcomingEvents,
    generated_at: proj.generated_at,
    data_version: proj.data_version,
    partial_sources: proj.partial_sources,
  };
}

export async function getCalendarEventDetail(eventId: string): Promise<CalendarEventDetailResponse | null> {
  const port = readPortfolioStore();
  const payload = buildUnifiedPortfolioPayload();
  const qStore = readQuestionnaireStoreMinimal();

  // Direct lookup for task events (even if cancelled)
  if (eventId.startsWith('task:')) {
    const taskId = eventId.slice('task:'.length);
    const task = (port.tasks as unknown as FarmTaskItem[]).find((t) => t.id === taskId);
    if (!task) return null;
    const farm = payload.farms.find((f) => f.id === task.farmId);
    const tz = farm?.timezone || task.timezone || 'UTC';
    const dStr = isoToDateStrInTz(task.dueDate || task.createdAt, tz) || getTodayDateStrInTz(tz);

    const proj = await getCalendarProjection({
      farmId: task.farmId,
      startDate: dStr,
      endDate: dStr,
      statuses: ['open', 'scheduled', 'in_progress', 'completed', 'deferred', 'cancelled'],
    });
    const evt = proj.events.find((e) => e.event_id === eventId);
    if (!evt) return null;

    const audits = port.taskAudits.filter((a) => a.task_id === taskId);
    const status = task.status || (task.completed ? 'completed' : 'scheduled');
    const available_commands: CalendarEventDetailResponse['available_commands'] =
      status === 'completed' || status === 'cancelled'
        ? ['reopen', 'reschedule']
        : ['complete', 'defer', 'reschedule', 'cancel'];

    return {
      event: evt,
      canonical_record: task as unknown as Record<string, unknown>,
      audit_history: audits,
      available_commands,
      weather: proj.weather,
      data_version: port.calendarVersion,
    };
  }

  // Resolve wide range around today to find projected event across active farms
  for (const farm of payload.farms.filter((f) => !f.archivedAt)) {
    const tz = farm.timezone || 'UTC';
    const today = getTodayDateStrInTz(tz);
    const bundle = await collectEventsForSingleFarm({
      rawFarm: farm,
      allFields: payload.fields,
      port,
      qStore,
      rangeStart: addDaysToDateStr(today, -180),
      rangeEnd: addDaysToDateStr(today, 550),
    });
    const match = bundle.events.find((e) => e.event_id === eventId);
    if (match) {
      let canonical: Record<string, unknown> | null = null;
      if (match.source_type === 'observation' && match.source_id) {
        canonical = (port.observations.find((o) => o.id === match.source_id) as Record<string, unknown>) ?? null;
      } else if (match.source_type === 'irrigation_log' && match.source_id) {
        canonical = (port.irrigationLogs.find((l) => l.id === match.source_id) as Record<string, unknown>) ?? null;
      } else if (match.source_type === 'analysis_report' && match.source_id) {
        canonical = (port.snapshots.find((s) => s.id === match.source_id) as Record<string, unknown>) ?? null;
      } else if (match.source_type === 'rotation_stage') {
        canonical = (farm.activePlan as unknown as Record<string, unknown>) ?? null;
      }
      return {
        event: match,
        canonical_record: canonical,
        audit_history: [],
        available_commands: [],
        weather: bundle.weather,
        data_version: port.calendarVersion,
      };
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Canonical Task Creation, Editing, Commands & Irrigation Execution          */
/* -------------------------------------------------------------------------- */

export async function createCanonicalTask(
  req: CreateCanonicalTaskRequest
): Promise<{ ok: true; data: CreateCanonicalTaskResponse } | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> }> {
  if (!req.title || !req.title.trim()) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_TASK_TITLE',
      message: 'Please describe what you need to do.',
    };
  }
  if (!isValidDateStr(req.due_date)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_TASK_DATE',
      message: 'The selected task date is invalid.',
      details: { due_date: req.due_date },
    };
  }

  const payload = buildUnifiedPortfolioPayload();
  const farm = payload.farms.find((f) => f.id === req.farm_id && !f.archivedAt);
  if (!farm) {
    return {
      ok: false,
      status: 404,
      code: 'FARM_NOT_FOUND',
      message: 'Selected farm was not found or is archived.',
    };
  }

  const port = readPortfolioStore();
  // Idempotency guarantee
  if (req.idempotency_key && port.taskIdempotency[req.idempotency_key]) {
    const existingTaskId = port.taskIdempotency[req.idempotency_key];
    const existingTask = (port.tasks as unknown as FarmTaskItem[]).find((t) => t.id === existingTaskId);
    if (existingTask) {
      const farmFields = payload.fields.filter((f) => f.farmId === farm.id);
      const classification = classifyTaskText(existingTask.title, farmFields);
      const dayProj = await getCalendarProjection({
        farmId: farm.id,
        startDate: existingTask.dueDate || req.due_date,
        endDate: existingTask.dueDate || req.due_date,
      });
      const existingEvt = dayProj.events.find((e) => e.event_id === `task:${existingTask.id}`)!;
      return {
        ok: true,
        data: {
          task: existingTask,
          classification,
          conflicts: dayProj.conflicts,
          event: existingEvt,
          data_version: port.calendarVersion,
        },
      };
    }
  }

  const farmFields = payload.fields.filter((f) => f.farmId === farm.id);
  let resolvedField = req.field_id ? farmFields.find((f) => f.id === req.field_id) ?? null : null;
  if (req.field_id && !resolvedField) {
    return {
      ok: false,
      status: 404,
      code: 'FIELD_NOT_FOUND',
      message: 'The selected field does not belong to this farm.',
    };
  }

  const classification = classifyTaskText(req.title, farmFields);
  if (!resolvedField && classification.inferred_field_id) {
    resolvedField = farmFields.find((f) => f.id === classification.inferred_field_id) ?? null;
  }

  const normalizeTaskType = (raw?: string): FarmTaskItem['category'] => {
    switch (raw) {
      case 'irrigation':
      case 'soil':
      case 'planting':
      case 'scouting':
      case 'rotation':
      case 'harvest':
      case 'fertilizer':
      case 'general':
        return raw;
      case 'soil_test':
        return 'soil';
      case 'rotation_prep':
        return 'rotation';
      case 'crop_stage':
        return 'planting';
      default:
        return classification.inferred_category;
    }
  };

  const now = new Date().toISOString();
  const tz = isValidTimezone(farm.timezone) ? farm.timezone : 'UTC';
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const taskRecord: FarmTaskItem = {
    id: taskId,
    farmId: farm.id,
    fieldId: resolvedField ? resolvedField.id : null,
    fieldName: resolvedField ? resolvedField.name : 'Whole Farm',
    title: req.title.trim(), // Preserve farmer's exact input text verbatim
    category: normalizeTaskType(req.task_type),
    dueDate: req.due_date,
    scheduledStart: req.due_date,
    scheduledEnd: req.due_date,
    priority: req.priority || 'normal',
    status: 'scheduled',
    timezone: tz,
    sourceType: 'user_created',
    ...(req.notes?.trim() ? { notes: req.notes.trim() } : {}),
    completed: false,
    completedAt: null,
    completedBy: null,
    createdBy: 'Farm Manager',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const audit: TaskAuditRecord = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    task_id: taskId,
    actor_id: 'Farm Manager',
    command: 'created',
    previous_values: null,
    new_values: taskRecord as unknown as Record<string, unknown>,
    reason: 'Created via Calendar & Actions',
    occurred_at: now,
    timezone: tz,
    request_id: req.idempotency_key || null,
  };

  port.tasks = [taskRecord as unknown as Record<string, unknown>, ...port.tasks];
  port.taskAudits = [audit, ...port.taskAudits];
  if (req.idempotency_key) {
    port.taskIdempotency[req.idempotency_key] = taskId;
  }
  recordDomainOutboxEvent(port, {
    eventName: 'TaskCreated',
    farmId: farm.id,
    fieldIds: taskRecord.fieldId ? [taskRecord.fieldId] : [],
    startDate: req.due_date,
    endDate: req.due_date,
  });
  writePortfolioStore(port);

  const dayProj = await getCalendarProjection({
    farmId: farm.id,
    startDate: req.due_date,
    endDate: req.due_date,
  });
  const createdEvt =
    dayProj.events.find((e) => e.event_id === `task:${taskId}`) ?? dayProj.events[0];

  return {
    ok: true,
    data: {
      task: taskRecord,
      classification,
      conflicts: dayProj.conflicts,
      event: createdEvt,
      data_version: port.calendarVersion,
    },
  };
}

export function executeTaskCommand(
  taskId: string,
  cmd: TaskCommandRequest
):
  | { ok: true; task: FarmTaskItem; audit: TaskAuditRecord; data_version: number }
  | { ok: false; status: number; code: string; message: string } {
  const port = readPortfolioStore();
  const idx = port.tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) {
    return { ok: false, status: 404, code: 'TASK_NOT_FOUND', message: 'Task not found.' };
  }

  const current = { ...(port.tasks[idx] as unknown as FarmTaskItem) };
  const tz = isValidTimezone(current.timezone)
    ? current.timezone!
    : port.farmMeta[current.farmId]?.timezone || 'UTC';
  const now = new Date().toISOString();
  const actor = cmd.actor_id || 'Farm Manager';
  const currentStatus = current.status || (current.completed ? 'completed' : 'scheduled');
  const nextVersion = (current.version || 1) + 1;

  const updated: FarmTaskItem = {
    ...current,
    updatedAt: now,
    version: nextVersion,
  };

  let eventName = 'TaskUpdated';

  switch (cmd.command) {
    case 'complete': {
      if (currentStatus === 'cancelled') {
        return {
          ok: false,
          status: 409,
          code: 'INVALID_TRANSITION',
          message: 'Cancelled tasks must be reopened before marking completed.',
        };
      }
      updated.status = 'completed';
      updated.completed = true;
      updated.completedAt = cmd.actual_at || now;
      updated.completedBy = actor;
      eventName = 'TaskCompleted';
      break;
    }
    case 'defer': {
      const targetDate = cmd.new_date || addDaysToDateStr(current.dueDate || getTodayDateStrInTz(tz), 2);
      if (!isValidDateStr(targetDate)) {
        return {
          ok: false,
          status: 400,
          code: 'INVALID_TASK_DATE',
          message: 'Deferral target date must be a valid YYYY-MM-DD date.',
        };
      }
      updated.status = 'deferred';
      updated.completed = false;
      updated.dueDate = targetDate;
      updated.scheduledStart = targetDate;
      updated.scheduledEnd = targetDate;
      updated.deferredUntil = targetDate;
      eventName = 'TaskDeferred';
      break;
    }
    case 'reschedule': {
      if (!cmd.new_date || !isValidDateStr(cmd.new_date)) {
        return {
          ok: false,
          status: 400,
          code: 'INVALID_TASK_DATE',
          message: 'A valid new_date (YYYY-MM-DD) is required to reschedule.',
        };
      }
      updated.status = 'scheduled';
      updated.completed = false;
      updated.completedAt = null;
      updated.dueDate = cmd.new_date;
      updated.scheduledStart = cmd.new_date;
      updated.scheduledEnd = cmd.new_date;
      eventName = 'TaskRescheduled';
      break;
    }
    case 'cancel': {
      updated.status = 'cancelled';
      updated.completed = false;
      updated.cancelledAt = now;
      eventName = 'TaskCancelled';
      break;
    }
    case 'reopen': {
      updated.status = 'open';
      updated.completed = false;
      updated.completedAt = null;
      updated.cancelledAt = null;
      eventName = 'TaskReopened';
      break;
    }
  }

  const audit: TaskAuditRecord = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    task_id: taskId,
    actor_id: actor,
    command: cmd.command,
    previous_values: current as unknown as Record<string, unknown>,
    new_values: updated as unknown as Record<string, unknown>,
    reason: cmd.reason || `Executed ${cmd.command}`,
    occurred_at: now,
    timezone: tz,
    request_id: null,
  };

  port.tasks[idx] = updated as unknown as Record<string, unknown>;
  port.taskAudits = [audit, ...port.taskAudits];
  recordDomainOutboxEvent(port, {
    eventName,
    farmId: updated.farmId,
    fieldIds: updated.fieldId ? [updated.fieldId] : [],
    startDate: updated.dueDate || undefined,
    endDate: updated.dueDate || undefined,
  });
  writePortfolioStore(port);

  return { ok: true, task: updated, audit, data_version: port.calendarVersion };
}

/* -------------------------------------------------------------------------- */
/* Server-Side RFC-5545 ICS Generator                                         */
/* -------------------------------------------------------------------------- */

function escapeIcsText(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export async function generateCalendarIcs(params: {
  farmId?: string | null;
  fieldId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  eventTypes?: string[] | null;
}): Promise<{ filename: string; content: string }> {
  const proj = await getCalendarProjection({
    farmId: params.farmId,
    fieldId: params.fieldId,
    startDate: params.startDate,
    endDate: params.endDate,
    eventTypes: params.eventTypes,
    statuses: ['open', 'scheduled', 'in_progress', 'completed', 'deferred', 'cancelled', 'recommended', 'active', 'observed', 'stale'],
  });

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const scopeName =
    proj.farm_id === 'all'
      ? 'All Farms'
      : proj.farms.find((f) => f.id === proj.farm_id)?.name || 'Farm';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FIELD SHIFT//Calendar & Actions//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcsText(`${scopeName} Schedule`)}`,
    `X-WR-TIMEZONE:${escapeIcsText(proj.timezone)}`,
  ];

  for (const evt of proj.events) {
    const startCompact = evt.start_date.replace(/-/g, '');
    const endCompact = addDaysToDateStr(evt.end_date, 1).replace(/-/g, '');
    const status =
      evt.status === 'cancelled'
        ? 'CANCELLED'
        : evt.completed
          ? 'COMPLETED'
          : 'CONFIRMED';

    lines.push(
      'BEGIN:VEVENT',
      `UID:fieldshift-${evt.event_id.replace(/[^a-zA-Z0-9._-]/g, '_')}@fieldshift.ag`,
      `SEQUENCE:${evt.source_version}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${startCompact}`,
      `DTEND;VALUE=DATE:${endCompact}`,
      `SUMMARY:${escapeIcsText(evt.title)}`,
      `DESCRIPTION:${escapeIcsText(`${evt.subtitle}\nProvenance: ${evt.date_basis}\nTimezone: ${evt.timezone}\n${evt.description}`)}`,
      `LOCATION:${escapeIcsText(`${evt.farm_name} - ${evt.field_name}`)}`,
      `STATUS:${status}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  const slug = scopeName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    filename: `${slug}-calendar.ics`,
    content: lines.join('\r\n'),
  };
}
