import type {
  CalendarDayResponse,
  CalendarEventDetailResponse,
  CalendarMonthResponse,
  CalendarStreamNotification,
  CalendarUpcomingResponse,
  CreateCanonicalTaskRequest,
  CreateCanonicalTaskResponse,
  TaskAuditRecord,
  TaskCommandRequest,
} from '../types/calendar';
import type { FarmTaskItem } from '../types/myFarms';

export class CalendarApiError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(
    message: string,
    code = 'API_ERROR',
    status = 500,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'CalendarApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function parseJsonOrThrow<T>(resp: Response): Promise<T> {
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    const errObj =
      json.error && typeof json.error === 'object'
        ? (json.error as { code?: string; message?: string; details?: Record<string, unknown> })
        : null;
    const message =
      errObj?.message ||
      (typeof json.error === 'string' ? json.error : `Request failed (${resp.status})`);
    throw new CalendarApiError(
      message,
      errObj?.code || 'API_ERROR',
      resp.status,
      errObj?.details || {}
    );
  }
  return json as T;
}

export async function fetchCalendarMonth(params: {
  farmId?: string | null;
  fieldId?: string | null;
  startDate: string;
  endDate: string;
  timezone?: string | null;
  eventTypes?: string[];
}): Promise<CalendarMonthResponse> {
  const qs = new URLSearchParams();
  if (params.farmId) qs.set('farm_id', params.farmId);
  if (params.fieldId && params.fieldId !== 'all') qs.set('field_id', params.fieldId);
  qs.set('start_date', params.startDate);
  qs.set('end_date', params.endDate);
  if (params.timezone) qs.set('timezone', params.timezone);
  if (params.eventTypes && params.eventTypes.length > 0) {
    qs.set('event_types', params.eventTypes.join(','));
  }

  const resp = await fetch(`/api/calendar?${qs.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  return parseJsonOrThrow<CalendarMonthResponse>(resp);
}

export async function fetchCalendarDay(params: {
  date: string;
  farmId?: string | null;
  fieldId?: string | null;
  timezone?: string | null;
}): Promise<CalendarDayResponse> {
  const qs = new URLSearchParams();
  qs.set('date', params.date);
  if (params.farmId) qs.set('farm_id', params.farmId);
  if (params.fieldId && params.fieldId !== 'all') qs.set('field_id', params.fieldId);
  if (params.timezone) qs.set('timezone', params.timezone);

  const resp = await fetch(`/api/calendar/day?${qs.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  return parseJsonOrThrow<CalendarDayResponse>(resp);
}

export async function fetchCalendarUpcoming(params: {
  farmId?: string | null;
  fieldId?: string | null;
  startDate?: string;
  days?: number;
  timezone?: string | null;
}): Promise<CalendarUpcomingResponse> {
  const qs = new URLSearchParams();
  if (params.farmId) qs.set('farm_id', params.farmId);
  if (params.fieldId && params.fieldId !== 'all') qs.set('field_id', params.fieldId);
  if (params.startDate) qs.set('start_date', params.startDate);
  qs.set('days', String(params.days ?? 7));
  if (params.timezone) qs.set('timezone', params.timezone);

  const resp = await fetch(`/api/calendar/upcoming?${qs.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  return parseJsonOrThrow<CalendarUpcomingResponse>(resp);
}

export async function fetchCalendarEventDetail(
  eventId: string
): Promise<CalendarEventDetailResponse> {
  const resp = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
    headers: { Accept: 'application/json' },
  });
  return parseJsonOrThrow<CalendarEventDetailResponse>(resp);
}

export async function createCanonicalTaskApi(
  payload: CreateCanonicalTaskRequest
): Promise<CreateCanonicalTaskResponse> {
  const resp = await fetch('/api/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': payload.idempotency_key,
    },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<CreateCanonicalTaskResponse>(resp);
}

export async function executeTaskCommandApi(
  taskId: string,
  payload: TaskCommandRequest
): Promise<{ task: FarmTaskItem; audit: TaskAuditRecord; data_version: number }> {
  const resp = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(resp);
}

export async function executeIrrigationRunApi(payload: {
  farm_id: string;
  field_id: string | null;
  field_name: string;
  date: string;
  volume_m3: number;
  method: string;
  notes?: string;
  linked_task_id?: string | null;
  recommendation_id?: string | null;
}): Promise<{ irrigation_log: Record<string, unknown>; data_version: number }> {
  const resp = await fetch('/api/calendar/irrigation/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(resp);
}

export async function fetchCalendarChanges(sinceVersion: number): Promise<{
  current_version: number;
  has_changes: boolean;
}> {
  const resp = await fetch(`/api/calendar/changes?since_version=${sinceVersion}`, {
    headers: { Accept: 'application/json' },
  });
  return parseJsonOrThrow(resp);
}

export function buildCalendarIcsExportUrl(params: {
  farmId?: string | null;
  fieldId?: string | null;
  startDate?: string;
  endDate?: string;
}): string {
  const qs = new URLSearchParams();
  if (params.farmId) qs.set('farm_id', params.farmId);
  if (params.fieldId && params.fieldId !== 'all') qs.set('field_id', params.fieldId);
  if (params.startDate) qs.set('start_date', params.startDate);
  if (params.endDate) qs.set('end_date', params.endDate);
  return `/api/calendar/export.ics?${qs.toString()}`;
}

export function subscribeToCalendarStream(
  onUpdate: (notification: CalendarStreamNotification) => void
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {};
  }
  const source = new EventSource('/api/calendar/stream');
  const handler = (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data) as CalendarStreamNotification;
      if (data && data.event === 'CalendarProjectionUpdated') {
        onUpdate(data);
      }
    } catch {
      // ignore malformed event frames
    }
  };
  source.addEventListener('CalendarProjectionUpdated', handler as EventListener);
  return () => {
    source.removeEventListener('CalendarProjectionUpdated', handler as EventListener);
    source.close();
  };
}
