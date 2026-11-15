import {
  ActionRecommendation,
  ActionStatus,
  AnalysisJob,
  AnalysisScope,
  AutomationSchedule,
  DeepAnalysisReport,
  FarmPracticeRoutine,
  NotificationRecord,
  ParsedPracticeDraft,
  ProviderHealth,
  ReportComparisonResult,
} from '../types/advanced';

export interface RecentReportMeta {
  id: string;
  farmId: string;
  farmName: string;
  scope: AnalysisScope;
  runType: 'manual' | 'scheduled';
  triggerReason: string;
  createdAt: string;
  completedAt: string;
  status: 'complete' | 'partial' | 'failed' | 'cancelled';
  overallSummary: DeepAnalysisReport['overallSummary'];
  findingsCount: number;
  watchPointsCount: number;
}

export interface AdvancedSummaryResponse {
  farmId: string;
  latestReport: DeepAnalysisReport | null;
  recentReports: RecentReportMeta[];
  jobs: AnalysisJob[];
  schedules: AutomationSchedule[];
  routines: FarmPracticeRoutine[];
  notifications: NotificationRecord[];
  unreadNotificationCount: number;
  providers: ProviderHealth[];
  lastConfirmedIrrigation: Record<string, unknown> | null;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      // ignore non-json error body
    }
    throw new Error(msg);
  }
  return (await resp.json()) as T;
}

export async function fetchAdvancedSummary(farmId: string): Promise<AdvancedSummaryResponse> {
  return apiJson<AdvancedSummaryResponse>(`/api/farms/${encodeURIComponent(farmId)}/advanced/summary`);
}

export async function fetchProvidersStatus(): Promise<ProviderHealth[]> {
  const res = await apiJson<{ providers: ProviderHealth[] }>('/api/providers/status');
  return res.providers;
}

export async function testProviderLive(
  providerId: string,
  lat: number,
  lon: number
): Promise<ProviderHealth> {
  const res = await apiJson<{ provider: ProviderHealth }>(
    `/api/providers/${encodeURIComponent(providerId)}/test`,
    {
      method: 'POST',
      body: JSON.stringify({ lat, lon }),
    }
  );
  return res.provider;
}

export async function startAnalysisRun(
  farmId: string,
  payload: {
    scope: AnalysisScope;
    triggerReason: string;
    dateFrom?: string;
    dateTo?: string;
    consentConfirmed: boolean;
    idempotencyKey?: string;
  }
): Promise<{ runId: string; job: AnalysisJob; deduplicated?: boolean }> {
  return apiJson(`/api/farms/${encodeURIComponent(farmId)}/analysis-runs`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchAnalysisRun(
  runId: string
): Promise<{ job: AnalysisJob; report: DeepAnalysisReport | null }> {
  return apiJson(`/api/analysis-runs/${encodeURIComponent(runId)}`);
}

export function subscribeAnalysisRunStream(
  runId: string,
  onProgress: (job: AnalysisJob) => void,
  onDone: (job: AnalysisJob, report: DeepAnalysisReport | null) => void,
  onError?: (message: string) => void
): () => void {
  let closed = false;
  let es: EventSource | null = null;
  let pollTimer: number | null = null;

  const stop = () => {
    closed = true;
    if (es) {
      es.close();
      es = null;
    }
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const pollOnce = async () => {
    if (closed) return;
    try {
      const { job, report } = await fetchAnalysisRun(runId);
      if (closed) return;
      onProgress(job);
      if (
        job.status === 'complete' ||
        job.status === 'partial' ||
        job.status === 'failed' ||
        job.status === 'cancelled'
      ) {
        stop();
        onDone(job, report);
      }
    } catch (err) {
      if (!closed) {
        onError?.(err instanceof Error ? err.message : 'Unable to poll job status.');
      }
    }
  };

  if (typeof EventSource !== 'undefined') {
    es = new EventSource(`/api/analysis-runs/${encodeURIComponent(runId)}/stream`);
    es.addEventListener('progress', (ev) => {
      if (closed) return;
      try {
        const job = JSON.parse((ev as MessageEvent).data) as AnalysisJob;
        onProgress(job);
      } catch {
        // ignore parse glitch
      }
    });
    es.addEventListener('done', async (ev) => {
      if (closed) return;
      try {
        const job = JSON.parse((ev as MessageEvent).data) as AnalysisJob;
        const full = await fetchAnalysisRun(runId).catch(() => ({ job, report: null }));
        stop();
        onDone(full.job, full.report);
      } catch {
        pollOnce();
      }
    });
    es.onerror = () => {
      if (es) {
        es.close();
        es = null;
      }
      if (!closed && pollTimer === null) {
        pollTimer = window.setInterval(pollOnce, 1200);
        pollOnce();
      }
    };
  } else {
    pollTimer = window.setInterval(pollOnce, 1200);
    pollOnce();
  }

  return stop;
}

export async function cancelAnalysisRun(runId: string): Promise<AnalysisJob> {
  const res = await apiJson<{ job: AnalysisJob }>(
    `/api/analysis-runs/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST' }
  );
  return res.job;
}

export async function fetchFullReport(reportId: string): Promise<DeepAnalysisReport> {
  const res = await apiJson<{ report: DeepAnalysisReport }>(
    `/api/reports/${encodeURIComponent(reportId)}`
  );
  return res.report;
}

export async function compareReports(
  baselineReportId: string,
  currentReportId: string
): Promise<{
  comparison: ReportComparisonResult;
  baseline: DeepAnalysisReport;
  current: DeepAnalysisReport;
}> {
  return apiJson('/api/reports/compare', {
    method: 'POST',
    body: JSON.stringify({ baselineReportId, currentReportId }),
  });
}

export async function exportReportFile(
  reportId: string,
  format: 'csv' | 'json',
  includePrivateGeometry = false
): Promise<string> {
  if (format === 'csv') {
    const resp = await fetch(`/api/reports/${encodeURIComponent(reportId)}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'csv', includePrivateGeometry }),
    });
    if (!resp.ok) throw new Error(`Failed CSV export (HTTP ${resp.status})`);
    const text = await resp.text();
    const filename = `deep-analysis-${reportId}.csv`;
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return filename;
  }

  const res = await apiJson<{ exportFormat: string; report: Record<string, unknown> }>(
    `/api/reports/${encodeURIComponent(reportId)}/export`,
    {
      method: 'POST',
      body: JSON.stringify({ format: 'json', includePrivateGeometry }),
    }
  );
  const filename = `deep-analysis-${reportId}.json`;
  const blob = new Blob([JSON.stringify(res.report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return filename;
}

export async function updateReportActionStatus(
  reportId: string,
  actionId: string,
  payload: {
    status: ActionStatus;
    note?: string;
    createTask?: boolean;
    dueDate?: string;
  }
): Promise<{ action: ActionRecommendation; createdTaskId: string | null }> {
  return apiJson(
    `/api/reports/${encodeURIComponent(reportId)}/actions/${encodeURIComponent(actionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );
}

export async function regenerateAiExplanation(
  reportId: string
): Promise<DeepAnalysisReport['aiExplanation']> {
  const res = await apiJson<{ aiExplanation: DeepAnalysisReport['aiExplanation'] }>(
    `/api/reports/${encodeURIComponent(reportId)}/explain`,
    { method: 'POST' }
  );
  return res.aiExplanation;
}

export async function createSchedule(
  farmId: string,
  payload: {
    name: string;
    scope: AnalysisScope;
    frequency: AutomationSchedule['frequency'];
    preferredTime: string;
    timezone: string;
    refreshProviders?: string[];
    useSavedRoutines?: boolean;
    routineReconfirmDays?: number;
    notifyOnImportantChanges?: boolean;
    quietHours?: { start: string; end: string } | null;
    allowRemoteProcessingConsent: boolean;
  }
): Promise<AutomationSchedule> {
  const res = await apiJson<{ schedule: AutomationSchedule }>(
    `/api/farms/${encodeURIComponent(farmId)}/schedules`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
  return res.schedule;
}

export async function patchSchedule(
  scheduleId: string,
  payload: {
    name?: string;
    enabled?: boolean;
    scope?: AnalysisScope;
    frequency?: AutomationSchedule['frequency'];
    preferredTime?: string;
    timezone?: string;
    useSavedRoutines?: boolean;
    notifyOnImportantChanges?: boolean;
    quietHours?: { start: string; end: string } | null;
    allowRemoteProcessingConsent?: boolean;
  }
): Promise<AutomationSchedule> {
  const res = await apiJson<{ schedule: AutomationSchedule }>(
    `/api/schedules/${encodeURIComponent(scheduleId)}`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  );
  return res.schedule;
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  await apiJson(`/api/schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' });
}

export async function pauseSchedule(scheduleId: string): Promise<AutomationSchedule> {
  const res = await apiJson<{ schedule: AutomationSchedule }>(
    `/api/schedules/${encodeURIComponent(scheduleId)}/pause`,
    { method: 'POST' }
  );
  return res.schedule;
}

export async function resumeSchedule(scheduleId: string): Promise<AutomationSchedule> {
  const res = await apiJson<{ schedule: AutomationSchedule }>(
    `/api/schedules/${encodeURIComponent(scheduleId)}/resume`,
    { method: 'POST' }
  );
  return res.schedule;
}

export async function revokeScheduleConsent(scheduleId: string): Promise<AutomationSchedule> {
  const res = await apiJson<{ schedule: AutomationSchedule }>(
    `/api/schedules/${encodeURIComponent(scheduleId)}/revoke-consent`,
    { method: 'POST' }
  );
  return res.schedule;
}

export async function runScheduleNow(
  scheduleId: string
): Promise<{ runId: string; job: AnalysisJob }> {
  return apiJson(`/api/schedules/${encodeURIComponent(scheduleId)}/run-now`, { method: 'POST' });
}

export async function createRoutine(
  farmId: string,
  payload: {
    fieldId: string | null;
    fieldName: string;
    category: FarmPracticeRoutine['category'];
    description: string;
    cadenceLabel: string;
    assumedMethod?: string;
    assumedVolumePerEventM3?: number | null;
  }
): Promise<FarmPracticeRoutine> {
  const res = await apiJson<{ routine: FarmPracticeRoutine }>(
    `/api/farms/${encodeURIComponent(farmId)}/routines`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
  return res.routine;
}

export async function confirmRoutine(
  farmId: string,
  routineId: string
): Promise<FarmPracticeRoutine> {
  const res = await apiJson<{ routine: FarmPracticeRoutine }>(
    `/api/farms/${encodeURIComponent(farmId)}/routines/${encodeURIComponent(routineId)}/confirm`,
    { method: 'POST' }
  );
  return res.routine;
}

export async function deleteRoutine(farmId: string, routineId: string): Promise<void> {
  await apiJson(
    `/api/farms/${encodeURIComponent(farmId)}/routines/${encodeURIComponent(routineId)}`,
    { method: 'DELETE' }
  );
}

export async function parsePracticeText(
  farmId: string,
  text: string
): Promise<ParsedPracticeDraft> {
  const res = await apiJson<{ draft: ParsedPracticeDraft }>(
    `/api/farms/${encodeURIComponent(farmId)}/parse-practice`,
    { method: 'POST', body: JSON.stringify({ text }) }
  );
  return res.draft;
}

export async function confirmPracticeDraft(
  farmId: string,
  payload: {
    kind: 'irrigation_event' | 'routine' | 'observation' | 'soil_test';
    fieldId: string | null;
    fieldName: string;
    date?: string;
    volumeM3?: number | null;
    method?: string;
    title: string;
    notes?: string;
    cadenceLabel?: string;
    userConfirmed: true;
  }
): Promise<{ savedAs: string; record: Record<string, unknown> }> {
  return apiJson(`/api/farms/${encodeURIComponent(farmId)}/confirm-practice`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function markNotificationsRead(farmId: string, ids?: string[]): Promise<void> {
  await apiJson(`/api/farms/${encodeURIComponent(farmId)}/notifications/read`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}
