import express from 'express';
import { z } from 'zod';
import {
  appendAuditEvent,
  computeNextRunIso,
  hydrateFarmContext,
  readAdvancedStore,
  updateActionStatusAndMaybeCreateTask,
  writeAdvancedStore,
} from './store';
import { enqueueAnalysisJob, subscribeJobEvents } from './pipeline';
import { getProvidersStatus, testProviderLive } from './providers/providerRegistry';
import { compareImmutableReports } from './engine/comparisonEngine';
import {
  generateBoundedReportExplanation,
  parseNaturalLanguagePractice,
} from './aiLayer';
import { readPortfolioStore, recordDomainOutboxEvent, writePortfolioStore } from '../myFarmsRouter';
import { DeepAnalysisReport } from '../../src/types/advanced';

const ScopeSchema = z.object({
  type: z.enum(['whole_farm', 'all_fields', 'selected_fields', 'single_field']),
  farmId: z.string().min(1),
  fieldIds: z.array(z.string()).default([]),
  label: z.string().min(1),
});

function serializeReportCsv(report: DeepAnalysisReport): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: string[] = [];
  rows.push(
    [
      'Report ID',
      'Farm',
      'Completed At',
      'Field',
      'Area (ha)',
      'Crop',
      'Condition',
      'Calibrated Score (%)',
      'Coverage (%)',
      'Confidence (%)',
      'ET0 Mean (mm/d)',
      'ET0 Method',
      'Period ETc (mm)',
      'Effective Rain (mm)',
      'Confirmed Irrigation (mm)',
      'Net Balance (mm)',
      'TAW (mm)',
      'RAW (mm)',
      'Depletion Dr (mm)',
      'Texture',
      'Elevation (m)',
      'Slope (%)',
      'Sentinel-2 NDVI Mean',
      'Sentinel-2 Valid Pixels (%)',
      'Leading Finding',
    ]
      .map(esc)
      .join(',')
  );

  for (const fa of report.fieldAssessments) {
    rows.push(
      [
        report.id,
        report.farmName,
        report.completedAt,
        fa.fieldName,
        fa.areaHa,
        fa.cropName ?? 'Unknown',
        fa.conditionLabel,
        fa.healthScore ?? 'Unscored',
        fa.coveragePct,
        fa.confidencePct,
        fa.waterSummary.et0MeanMmDay ?? 'Unavailable',
        fa.waterSummary.et0Method,
        fa.waterSummary.etcPeriodMm ?? 'Unavailable',
        fa.waterSummary.effectiveRainMm ?? 'Unavailable',
        fa.waterSummary.confirmedIrrigationMm,
        fa.waterSummary.netBalanceMm ?? 'Unavailable',
        fa.waterSummary.tawMm ?? 'Unavailable',
        fa.waterSummary.rawMm ?? 'Unavailable',
        fa.waterSummary.latestDepletionMm ?? 'Unavailable',
        fa.soilSummary.textureClass,
        fa.soilSummary.elevationM ?? 'Unavailable',
        fa.soilSummary.slopePct ?? 'Unavailable',
        fa.vegetationSummary.ndviMean ?? 'Unavailable',
        fa.vegetationSummary.validCoveragePct,
        fa.leadingFinding,
      ]
        .map(esc)
        .join(',')
    );
  }
  return rows.join('\n');
}

export function createAdvancedRouter() {
  const router = express.Router();

  // 1. Summary bundle for My Farms -> [Selected Farm] -> Advanced
  router.get('/farms/:farmId/advanced/summary', (req, res) => {
    const farmId = req.params.farmId;
    const farmCtx = hydrateFarmContext(farmId);
    if (!farmCtx) {
      res.status(404).json({ error: 'Farm not found.' });
      return;
    }

    const store = readAdvancedStore();
    const reports = store.reports
      .filter((r) => r.farmId === farmId)
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
    const jobs = store.jobs
      .filter((j) => j.farmId === farmId)
      .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
      .slice(0, 15);
    const schedules = store.schedules.filter((s) => s.farmId === farmId);
    const routines = store.routines
      .filter((r) => r.farmId === farmId)
      .map((r) => ({
        ...r,
        needsReconfirmation:
          Date.now() - Date.parse(r.lastConfirmedAt) > 14 * 86400000,
      }));
    const notifications = store.notifications
      .filter((n) => n.farmId === farmId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 30);

    res.json({
      farmId,
      latestReport: reports[0] ?? null,
      recentReports: reports.slice(0, 12).map((r) => ({
        id: r.id,
        farmId: r.farmId,
        farmName: r.farmName,
        scope: r.scope,
        runType: r.runType,
        triggerReason: r.triggerReason,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        status: r.status,
        overallSummary: r.overallSummary,
        findingsCount: r.findings.length,
        watchPointsCount: r.watchPoints.length,
      })),
      jobs,
      schedules,
      routines,
      notifications,
      unreadNotificationCount: notifications.filter((n) => !n.read).length,
      providers: getProvidersStatus(),
      lastConfirmedIrrigation: farmCtx.irrigationLogs[0] ?? null,
    });
  });

  // 2. Provider Registry & Live Connection Check
  router.get('/providers/status', (_req, res) => {
    res.json({ providers: getProvidersStatus() });
  });

  router.post('/providers/:providerId/test', async (req, res) => {
    const lat = Number(req.body?.lat ?? 44.8602);
    const lon = Number(req.body?.lon ?? -123.1462);
    const updated = await testProviderLive(
      req.params.providerId,
      Number.isFinite(lat) ? lat : 44.8602,
      Number.isFinite(lon) ? lon : -123.1462
    );
    if (!updated) {
      res.status(404).json({ error: 'Unknown provider ID.' });
      return;
    }
    res.json({ provider: updated });
  });

  // 3. On-demand Analysis Runs (Async 202 + SSE Stream + Polling + Cancellation)
  router.post('/farms/:farmId/analysis-runs', (req, res) => {
    const schema = z.object({
      scope: ScopeSchema,
      triggerReason: z.string().min(1).max(200).default('On-demand Deep Analysis'),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      consentConfirmed: z.boolean(),
      idempotencyKey: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid run request.' });
      return;
    }
    if (!parsed.data.consentConfirmed) {
      res.status(400).json({
        error: 'Explicit pre-run confirmation of external meteorological/satellite telemetry lookup is required.',
      });
      return;
    }

    const farmCtx = hydrateFarmContext(req.params.farmId);
    if (!farmCtx) {
      res.status(404).json({ error: 'Farm not found.' });
      return;
    }

    const headerKey = req.header('Idempotency-Key');
    const { job, deduplicated } = enqueueAnalysisJob({
      farmId: req.params.farmId,
      scope: parsed.data.scope,
      runType: 'manual',
      triggerReason: parsed.data.triggerReason,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      idempotencyKey: parsed.data.idempotencyKey || headerKey,
    });

    res.status(202).json({
      runId: job.id,
      status: job.status,
      farmId: job.farmId,
      scope: job.scope,
      createdAt: job.requestedAt,
      deduplicated,
      job,
    });
  });

  router.get('/analysis-runs/:runId', (req, res) => {
    const store = readAdvancedStore();
    const job = store.jobs.find((j) => j.id === req.params.runId);
    if (!job) {
      res.status(404).json({ error: 'Analysis run not found.' });
      return;
    }
    const report = job.reportId
      ? store.reports.find((r) => r.id === job.reportId) ?? null
      : null;
    res.json({ job, report });
  });

  router.get('/analysis-runs/:runId/stream', (req, res) => {
    const store = readAdvancedStore();
    const job = store.jobs.find((j) => j.id === req.params.runId);
    if (!job) {
      res.status(404).json({ error: 'Analysis run not found.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (j: typeof job) => {
      res.write(`event: progress\ndata: ${JSON.stringify(j)}\n\n`);
      if (j.status === 'complete' || j.status === 'partial' || j.status === 'failed' || j.status === 'cancelled') {
        res.write(`event: done\ndata: ${JSON.stringify(j)}\n\n`);
        res.end();
      }
    };

    send(job);
    if (
      job.status === 'complete' ||
      job.status === 'partial' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      return;
    }

    const unsub = subscribeJobEvents(req.params.runId, send);
    req.on('close', () => {
      unsub();
    });
  });

  router.post('/analysis-runs/:runId/cancel', (req, res) => {
    const store = readAdvancedStore();
    const idx = store.jobs.findIndex((j) => j.id === req.params.runId);
    if (idx < 0) {
      res.status(404).json({ error: 'Analysis run not found.' });
      return;
    }
    store.jobs[idx] = {
      ...store.jobs[idx],
      cancellationRequested: true,
      ...(store.jobs[idx].status === 'queued'
        ? { status: 'cancelled', currentStage: 'CANCELLED', finishedAt: new Date().toISOString() }
        : {}),
    };
    writeAdvancedStore(store);
    res.json({ job: store.jobs[idx] });
  });

  // 4. Reports, Compare, Export & Action Workflow
  router.get('/farms/:farmId/reports', (req, res) => {
    const store = readAdvancedStore();
    const reports = store.reports
      .filter((r) => r.farmId === req.params.farmId)
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
    res.json({ reports });
  });

  router.get('/reports/:reportId', (req, res) => {
    const store = readAdvancedStore();
    const report = store.reports.find((r) => r.id === req.params.reportId);
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    res.json({ report });
  });

  router.post('/reports/compare', (req, res) => {
    const schema = z.object({
      baselineReportId: z.string().min(1),
      currentReportId: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Both baselineReportId and currentReportId are required.' });
      return;
    }
    const store = readAdvancedStore();
    const baseline = store.reports.find((r) => r.id === parsed.data.baselineReportId);
    const current = store.reports.find((r) => r.id === parsed.data.currentReportId);
    if (!baseline || !current) {
      res.status(404).json({ error: 'One or both reports not found.' });
      return;
    }
    const actionsBetween = baseline.recommendations
      .filter((a) => a.status === 'Completed' || a.status === 'Scheduled')
      .map((a) => ({ title: a.title, status: a.status }));
    const comparison = compareImmutableReports(baseline, current, actionsBetween);
    res.json({ comparison, baseline, current });
  });

  router.post('/reports/:reportId/export', (req, res) => {
    const store = readAdvancedStore();
    const report = store.reports.find((r) => r.id === req.params.reportId);
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    const format = String(req.body?.format || 'json').toLowerCase();
    const includePrivateGeometry = Boolean(req.body?.includePrivateGeometry);

    if (format === 'csv') {
      const csv = serializeReportCsv(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="deep-analysis-${report.id}.csv"`
      );
      res.send(csv);
      return;
    }

    // By default strip raw polygon coordinates/exact centroids if farm is private unless user explicitly opts in
    const exportPayload = includePrivateGeometry
      ? report
      : {
          ...report,
          fieldAssessments: report.fieldAssessments.map((f) => ({
            ...f,
            centroid: undefined,
          })),
          privacyRedactionApplied: 'Coordinates omitted (includePrivateGeometry=false).',
        };
    res.json({ exportFormat: 'json', report: exportPayload });
  });

  router.patch('/reports/:reportId/actions/:actionId', (req, res) => {
    const schema = z.object({
      status: z.enum([
        'Suggested',
        'Accepted',
        'Scheduled',
        'In progress',
        'Completed',
        'Deferred',
        'Dismissed',
      ]),
      note: z.string().max(400).optional(),
      createTask: z.boolean().optional(),
      dueDate: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid action status update.' });
      return;
    }
    const { action, createdTaskId } = updateActionStatusAndMaybeCreateTask({
      reportId: req.params.reportId,
      actionId: req.params.actionId,
      status: parsed.data.status,
      note: parsed.data.note,
      createTask: parsed.data.createTask,
      dueDate: parsed.data.dueDate,
    });
    if (!action) {
      res.status(404).json({ error: 'Report or action not found.' });
      return;
    }
    res.json({ action, createdTaskId });
  });

  router.post('/reports/:reportId/explain', async (req, res) => {
    const store = readAdvancedStore();
    const idx = store.reports.findIndex((r) => r.id === req.params.reportId);
    if (idx < 0) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    const aiExplanation = await generateBoundedReportExplanation(store.reports[idx]);
    store.reports[idx] = { ...store.reports[idx], aiExplanation };
    writeAdvancedStore(store);
    res.json({ aiExplanation });
  });

  // 5. Automation Schedules (CRUD + pause/resume/run-now/revoke-consent)
  router.get('/farms/:farmId/schedules', (req, res) => {
    const store = readAdvancedStore();
    res.json({
      schedules: store.schedules.filter((s) => s.farmId === req.params.farmId),
    });
  });

  router.post('/farms/:farmId/schedules', (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(120).default('Recurring Deep Analysis'),
      scope: ScopeSchema,
      frequency: z.enum(['daily', 'every_3_days', 'weekly', 'biweekly', 'monthly']),
      preferredTime: z.string().regex(/^\d{2}:\d{2}$/),
      timezone: z.string().min(1).default('UTC'),
      refreshProviders: z.array(z.string()).default(['all']),
      useSavedRoutines: z.boolean().default(true),
      routineReconfirmDays: z.number().int().min(3).max(90).default(14),
      notifyOnImportantChanges: z.boolean().default(true),
      quietHours: z
        .object({ start: z.string(), end: z.string() })
        .nullable()
        .default({ start: '21:00', end: '06:00' }),
      allowRemoteProcessingConsent: z.boolean(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid schedule.' });
      return;
    }
    if (!parsed.data.allowRemoteProcessingConsent) {
      res.status(400).json({
        error: 'Explicit consent for recurring remote analysis & telemetry requests is required.',
      });
      return;
    }

    const d = parsed.data;
    const nowIso = new Date().toISOString();
    const store = readAdvancedStore();
    const sched = {
      id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      farmId: req.params.farmId,
      name: d.name,
      enabled: true,
      status: 'active' as const,
      scope: d.scope,
      frequency: d.frequency,
      preferredTime: d.preferredTime,
      timezone: d.timezone,
      refreshProviders: d.refreshProviders,
      useSavedRoutines: d.useSavedRoutines,
      routineReconfirmDays: d.routineReconfirmDays,
      notifyOnImportantChanges: d.notifyOnImportantChanges,
      quietHours: d.quietHours,
      consent: {
        allowRemoteProviderRequests: true,
        allowRemoteJobProcessing: true,
        consentedAt: nowIso,
      },
      nextRunAt: computeNextRunIso(d.frequency, d.preferredTime, d.timezone),
      lastRunAt: null,
      lastJobId: null,
      lastJobStatus: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    store.schedules = [sched, ...store.schedules];
    appendAuditEvent(store, req.params.farmId, 'SCHEDULE_CREATED', `Created "${d.name}" (${d.frequency})`);
    writeAdvancedStore(store);
    res.status(201).json({ schedule: sched });
  });

  router.patch('/schedules/:scheduleId', (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(120).optional(),
      enabled: z.boolean().optional(),
      scope: ScopeSchema.optional(),
      frequency: z.enum(['daily', 'every_3_days', 'weekly', 'biweekly', 'monthly']).optional(),
      preferredTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      timezone: z.string().min(1).optional(),
      useSavedRoutines: z.boolean().optional(),
      notifyOnImportantChanges: z.boolean().optional(),
      quietHours: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
      allowRemoteProcessingConsent: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid schedule patch.' });
      return;
    }

    const store = readAdvancedStore();
    const idx = store.schedules.findIndex((s) => s.id === req.params.scheduleId);
    if (idx < 0) {
      res.status(404).json({ error: 'Schedule not found.' });
      return;
    }
    const prev = store.schedules[idx];
    const d = parsed.data;
    const freq = d.frequency ?? prev.frequency;
    const prefTime = d.preferredTime ?? prev.preferredTime;
    const tz = d.timezone ?? prev.timezone;

    const consentGranted =
      d.allowRemoteProcessingConsent !== undefined
        ? d.allowRemoteProcessingConsent
        : prev.consent.allowRemoteJobProcessing;
    const nextEnabled = consentGranted ? (d.enabled ?? prev.enabled) : false;

    const updated = {
      ...prev,
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.scope !== undefined ? { scope: d.scope } : {}),
      ...(d.useSavedRoutines !== undefined ? { useSavedRoutines: d.useSavedRoutines } : {}),
      ...(d.notifyOnImportantChanges !== undefined
        ? { notifyOnImportantChanges: d.notifyOnImportantChanges }
        : {}),
      ...(d.quietHours !== undefined ? { quietHours: d.quietHours } : {}),
      frequency: freq,
      preferredTime: prefTime,
      timezone: tz,
      enabled: nextEnabled,
      status: !consentGranted
        ? ('consent_revoked' as const)
        : nextEnabled
          ? ('active' as const)
          : ('paused' as const),
      consent: {
        ...prev.consent,
        allowRemoteJobProcessing: consentGranted,
        allowRemoteProviderRequests: consentGranted,
        consentedAt: consentGranted ? (prev.consent.consentedAt ?? new Date().toISOString()) : undefined,
      },
      nextRunAt: computeNextRunIso(freq, prefTime, tz),
      updatedAt: new Date().toISOString(),
    };

    store.schedules[idx] = updated;
    appendAuditEvent(store, updated.farmId, 'SCHEDULE_UPDATED', `Updated schedule ${updated.name}`);
    writeAdvancedStore(store);
    res.json({ schedule: updated });
  });

  router.delete('/schedules/:scheduleId', (req, res) => {
    const store = readAdvancedStore();
    const existing = store.schedules.find((s) => s.id === req.params.scheduleId);
    if (!existing) {
      res.status(404).json({ error: 'Schedule not found.' });
      return;
    }
    store.schedules = store.schedules.filter((s) => s.id !== req.params.scheduleId);
    appendAuditEvent(store, existing.farmId, 'SCHEDULE_DELETED', `Deleted schedule "${existing.name}"`);
    writeAdvancedStore(store);
    res.json({ deletedId: req.params.scheduleId });
  });

  router.post('/schedules/:scheduleId/pause', (req, res) => {
    const store = readAdvancedStore();
    const idx = store.schedules.findIndex((s) => s.id === req.params.scheduleId);
    if (idx < 0) return void res.status(404).json({ error: 'Schedule not found.' });
    store.schedules[idx] = {
      ...store.schedules[idx],
      enabled: false,
      status: 'paused',
      updatedAt: new Date().toISOString(),
    };
    appendAuditEvent(store, store.schedules[idx].farmId, 'SCHEDULE_PAUSED', store.schedules[idx].name);
    writeAdvancedStore(store);
    res.json({ schedule: store.schedules[idx] });
  });

  router.post('/schedules/:scheduleId/resume', (req, res) => {
    const store = readAdvancedStore();
    const idx = store.schedules.findIndex((s) => s.id === req.params.scheduleId);
    if (idx < 0) return void res.status(404).json({ error: 'Schedule not found.' });
    const prev = store.schedules[idx];
    if (!prev.consent.allowRemoteJobProcessing) {
      res.status(400).json({ error: 'Consent was revoked; re-grant consent to resume schedule.' });
      return;
    }
    store.schedules[idx] = {
      ...prev,
      enabled: true,
      status: 'active',
      nextRunAt: computeNextRunIso(prev.frequency, prev.preferredTime, prev.timezone),
      updatedAt: new Date().toISOString(),
    };
    appendAuditEvent(store, prev.farmId, 'SCHEDULE_RESUMED', prev.name);
    writeAdvancedStore(store);
    res.json({ schedule: store.schedules[idx] });
  });

  router.post('/schedules/:scheduleId/revoke-consent', (req, res) => {
    const store = readAdvancedStore();
    const idx = store.schedules.findIndex((s) => s.id === req.params.scheduleId);
    if (idx < 0) return void res.status(404).json({ error: 'Schedule not found.' });
    store.schedules[idx] = {
      ...store.schedules[idx],
      enabled: false,
      status: 'consent_revoked',
      consent: {
        allowRemoteJobProcessing: false,
        allowRemoteProviderRequests: false,
      },
      updatedAt: new Date().toISOString(),
    };
    appendAuditEvent(store, store.schedules[idx].farmId, 'CONSENT_REVOKED', store.schedules[idx].name);
    writeAdvancedStore(store);
    res.json({ schedule: store.schedules[idx] });
  });

  router.post('/schedules/:scheduleId/run-now', (req, res) => {
    const store = readAdvancedStore();
    const sched = store.schedules.find((s) => s.id === req.params.scheduleId);
    if (!sched) return void res.status(404).json({ error: 'Schedule not found.' });
    if (!sched.consent.allowRemoteJobProcessing) {
      res.status(400).json({ error: 'Cannot run without remote processing consent.' });
      return;
    }
    const { job } = enqueueAnalysisJob({
      farmId: sched.farmId,
      scope: sched.scope,
      runType: 'scheduled',
      triggerReason: `Manual trigger of schedule "${sched.name}"`,
      scheduleId: sched.id,
    });
    res.status(202).json({ runId: job.id, job });
  });

  // 6. Routines + Natural-Language Practice Parser & Confirmed Creation
  router.post('/farms/:farmId/routines', (req, res) => {
    const schema = z.object({
      fieldId: z.string().nullable().default(null),
      fieldName: z.string().default('Whole Farm'),
      category: z.enum(['irrigation_routine', 'fertilizer_routine', 'scouting_routine']),
      description: z.string().min(2).max(400),
      cadenceLabel: z.string().min(1).max(120),
      assumedMethod: z.string().default('Drip irrigation'),
      assumedVolumePerEventM3: z.number().positive().nullable().default(null),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid routine data.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const store = readAdvancedStore();
    const routine = {
      id: `rtn-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      farmId: req.params.farmId,
      ...parsed.data,
      lastConfirmedAt: nowIso,
      needsReconfirmation: false,
      userConfirmed: true,
      createdAt: nowIso,
    };
    store.routines = [routine, ...store.routines];
    writeAdvancedStore(store);
    res.status(201).json({ routine });
  });

  router.post('/farms/:farmId/routines/:routineId/confirm', (req, res) => {
    const store = readAdvancedStore();
    const idx = store.routines.findIndex(
      (r) => r.id === req.params.routineId && r.farmId === req.params.farmId
    );
    if (idx < 0) return void res.status(404).json({ error: 'Routine not found.' });
    store.routines[idx] = {
      ...store.routines[idx],
      lastConfirmedAt: new Date().toISOString(),
      needsReconfirmation: false,
      userConfirmed: true,
    };
    writeAdvancedStore(store);
    res.json({ routine: store.routines[idx] });
  });

  router.delete('/farms/:farmId/routines/:routineId', (req, res) => {
    const store = readAdvancedStore();
    store.routines = store.routines.filter(
      (r) => !(r.id === req.params.routineId && r.farmId === req.params.farmId)
    );
    writeAdvancedStore(store);
    res.json({ deletedId: req.params.routineId });
  });

  router.post('/farms/:farmId/parse-practice', async (req, res) => {
    const schema = z.object({ text: z.string().trim().min(3).max(500) });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter a farm practice description (3–500 characters).' });
      return;
    }
    const farmCtx = hydrateFarmContext(req.params.farmId);
    if (!farmCtx) return void res.status(404).json({ error: 'Farm not found.' });

    const draft = await parseNaturalLanguagePractice(parsed.data.text, farmCtx.fields);
    res.json({ draft });
  });

  router.post('/farms/:farmId/confirm-practice', (req, res) => {
    const schema = z.object({
      kind: z.enum(['irrigation_event', 'routine', 'observation', 'soil_test']),
      fieldId: z.string().nullable().default(null),
      fieldName: z.string().default('Whole Farm'),
      date: z.string().optional(),
      volumeM3: z.number().positive().nullable().optional(),
      method: z.string().optional(),
      title: z.string().min(1).max(160),
      notes: z.string().max(500).default(''),
      cadenceLabel: z.string().optional(),
      userConfirmed: z.literal(true),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Explicit user confirmation is required before saving.',
      });
      return;
    }

    const d = parsed.data;
    const port = readPortfolioStore();
    const nowIso = new Date().toISOString();

    if (d.kind === 'irrigation_event') {
      if (!d.volumeM3 || !d.date) {
        res.status(400).json({
          error: 'Confirmed irrigation log requires exact date and positive water volume (m³).',
        });
        return;
      }
      const irr = {
        id: `irr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        farmId: req.params.farmId,
        fieldId: d.fieldId,
        fieldName: d.fieldName,
        date: d.date,
        volumeM3: d.volumeM3,
        method: d.method || 'Drip irrigation',
        notes: d.notes,
        createdAt: nowIso,
      };
      port.irrigationLogs = [irr, ...port.irrigationLogs];
      recordDomainOutboxEvent(port, {
        eventName: 'IrrigationCompleted',
        farmId: req.params.farmId,
        fieldIds: d.fieldId ? [d.fieldId] : [],
        startDate: d.date,
        endDate: d.date,
      });
      writePortfolioStore(port);
      res.status(201).json({ savedAs: 'irrigation_event', record: irr });
      return;
    }

    if (d.kind === 'routine') {
      const store = readAdvancedStore();
      const routine = {
        id: `rtn-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        farmId: req.params.farmId,
        fieldId: d.fieldId,
        fieldName: d.fieldName,
        category: 'irrigation_routine' as const,
        description: d.title,
        cadenceLabel: d.cadenceLabel || 'Recurring practice',
        assumedMethod: d.method || 'Drip irrigation',
        assumedVolumePerEventM3: d.volumeM3 ?? null,
        lastConfirmedAt: nowIso,
        needsReconfirmation: false,
        userConfirmed: true,
        createdAt: nowIso,
      };
      store.routines = [routine, ...store.routines];
      writeAdvancedStore(store);
      res.status(201).json({ savedAs: 'routine', record: routine });
      return;
    }

    const obs = {
      id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      farmId: req.params.farmId,
      fieldId: d.fieldId,
      fieldName: d.fieldName,
      category: d.kind === 'soil_test' ? 'soil_lab' : 'scouting',
      title: d.title,
      detail: d.notes || d.title,
      observedAt: d.date || nowIso.slice(0, 10),
      provenance: d.kind === 'soil_test' ? 'Measured' : 'Reported',
      createdAt: nowIso,
    };
    port.observations = [obs, ...port.observations];
    recordDomainOutboxEvent(port, {
      eventName: 'ObservationRecorded',
      farmId: req.params.farmId,
      fieldIds: d.fieldId ? [d.fieldId] : [],
    });
    writePortfolioStore(port);
    res.status(201).json({ savedAs: 'observation', record: obs });
  });

  // 7. Notification Center
  router.get('/farms/:farmId/notifications', (req, res) => {
    const store = readAdvancedStore();
    const notifications = store.notifications.filter((n) => n.farmId === req.params.farmId);
    res.json({ notifications });
  });

  router.post('/farms/:farmId/notifications/read', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : null;
    const store = readAdvancedStore();
    store.notifications = store.notifications.map((n) =>
      n.farmId === req.params.farmId && (!ids || ids.includes(n.id))
        ? { ...n, read: true }
        : n
    );
    writeAdvancedStore(store);
    res.json({ ok: true });
  });

  return router;
}
