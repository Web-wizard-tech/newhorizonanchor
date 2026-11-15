import express from 'express';
import { z } from 'zod';
import {
  buildUnifiedPortfolioPayload,
  readPortfolioStore,
  recordDomainOutboxEvent,
  writePortfolioStore,
} from './myFarmsRouter';
import {
  createCanonicalTask,
  executeTaskCommand,
  generateCalendarIcs,
  getCalendarDayProjection,
  getCalendarEventDetail,
  getCalendarProjection,
  getCalendarUpcomingProjection,
  getTodayDateStrInTz,
  isValidDateStr,
  registerCalendarSseClient,
} from './calendarService';
import type { FarmTaskItem } from '../src/types/myFarms';
import type { TaskAuditRecord } from '../src/types/calendar';

function sendApiError(
  res: express.Response,
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {}
) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

function parseCsvParam(val: unknown): string[] | null {
  if (typeof val !== 'string' || !val.trim()) return null;
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createCalendarRouter(): express.Router {
  const router = express.Router();

  // 1. Unified Month / Range Calendar Projection
  router.get('/calendar', async (req, res) => {
    try {
      const farmId = typeof req.query.farm_id === 'string' ? req.query.farm_id : undefined;
      const fieldId = typeof req.query.field_id === 'string' ? req.query.field_id : undefined;
      const startDate = typeof req.query.start_date === 'string' ? req.query.start_date : undefined;
      const endDate = typeof req.query.end_date === 'string' ? req.query.end_date : undefined;
      const timezone = typeof req.query.timezone === 'string' ? req.query.timezone : undefined;
      const eventTypes = parseCsvParam(req.query.event_types);
      const statuses = parseCsvParam(req.query.statuses);
      const simulateWeatherFailure = req.query.simulate_weather_failure === '1';

      if (startDate && !isValidDateStr(startDate)) {
        sendApiError(res, 400, 'INVALID_DATE_RANGE', 'start_date must be YYYY-MM-DD.', { start_date: startDate });
        return;
      }
      if (endDate && !isValidDateStr(endDate)) {
        sendApiError(res, 400, 'INVALID_DATE_RANGE', 'end_date must be YYYY-MM-DD.', { end_date: endDate });
        return;
      }
      if (startDate && endDate && endDate < startDate) {
        sendApiError(res, 400, 'INVALID_DATE_RANGE', 'end_date cannot precede start_date.', {
          start_date: startDate,
          end_date: endDate,
        });
        return;
      }

      const data = await getCalendarProjection({
        farmId,
        fieldId,
        startDate,
        endDate,
        timezone,
        eventTypes,
        statuses,
        simulateWeatherFailure,
      });
      res.json(data);
    } catch (err) {
      sendApiError(
        res,
        500,
        'CALENDAR_PROJECTION_ERROR',
        err instanceof Error ? err.message : 'Failed to build calendar projection.'
      );
    }
  });

  // 2. Selected-Date Grouped Projection
  router.get('/calendar/day', async (req, res) => {
    try {
      const dateParam = typeof req.query.date === 'string' ? req.query.date : '';
      const farmId = typeof req.query.farm_id === 'string' ? req.query.farm_id : undefined;
      const fieldId = typeof req.query.field_id === 'string' ? req.query.field_id : undefined;
      const timezone = typeof req.query.timezone === 'string' ? req.query.timezone : undefined;
      const simulateWeatherFailure = req.query.simulate_weather_failure === '1';

      const targetDate = dateParam || getTodayDateStrInTz(timezone);
      if (!isValidDateStr(targetDate)) {
        sendApiError(res, 400, 'INVALID_DATE', 'date query parameter must be YYYY-MM-DD.', { date: dateParam });
        return;
      }

      const data = await getCalendarDayProjection({
        date: targetDate,
        farmId,
        fieldId,
        timezone,
        simulateWeatherFailure,
      });
      res.json(data);
    } catch (err) {
      sendApiError(
        res,
        500,
        'CALENDAR_DAY_ERROR',
        err instanceof Error ? err.message : 'Failed to load daily activities.'
      );
    }
  });

  // 3. Upcoming 7-Day (or N-Day) Activities Projection
  router.get('/calendar/upcoming', async (req, res) => {
    try {
      const farmId = typeof req.query.farm_id === 'string' ? req.query.farm_id : undefined;
      const fieldId = typeof req.query.field_id === 'string' ? req.query.field_id : undefined;
      const startDate = typeof req.query.start_date === 'string' ? req.query.start_date : undefined;
      const timezone = typeof req.query.timezone === 'string' ? req.query.timezone : undefined;
      const days = req.query.days ? Number(req.query.days) : 7;

      const data = await getCalendarUpcomingProjection({
        farmId,
        fieldId,
        startDate,
        days: Number.isFinite(days) ? days : 7,
        timezone,
      });
      res.json(data);
    } catch (err) {
      sendApiError(
        res,
        500,
        'CALENDAR_UPCOMING_ERROR',
        err instanceof Error ? err.message : 'Failed to load upcoming schedule.'
      );
    }
  });

  // 4. Incremental Synchronization Check
  router.get('/calendar/changes', (req, res) => {
    const sinceVersion = Number(req.query.since_version || 0);
    const port = readPortfolioStore();
    const currentVersion = port.calendarVersion || 1;
    const changes = (port.domainOutbox || []).filter((e) => e.version > sinceVersion);
    res.json({
      current_version: currentVersion,
      has_changes: currentVersion > sinceVersion,
      changes,
    });
  });

  // 5. Real-Time SSE Synchronization Stream
  router.get('/calendar/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const port = readPortfolioStore();
    res.write(
      `event: connected\ndata: ${JSON.stringify({ version: port.calendarVersion || 1 })}\n\n`
    );

    const unsubscribe = registerCalendarSseClient((notification) => {
      res.write(`event: CalendarProjectionUpdated\ndata: ${JSON.stringify(notification)}\n\n`);
    });

    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });

  // 6. RFC-5545 ICS Export
  router.get('/calendar/export.ics', async (req, res) => {
    try {
      const farmId = typeof req.query.farm_id === 'string' ? req.query.farm_id : undefined;
      const fieldId = typeof req.query.field_id === 'string' ? req.query.field_id : undefined;
      const startDate = typeof req.query.start_date === 'string' ? req.query.start_date : undefined;
      const endDate = typeof req.query.end_date === 'string' ? req.query.end_date : undefined;
      const eventTypes = parseCsvParam(req.query.event_types);

      const { filename, content } = await generateCalendarIcs({
        farmId,
        fieldId,
        startDate,
        endDate,
        eventTypes,
      });

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (err) {
      sendApiError(
        res,
        500,
        'ICS_EXPORT_ERROR',
        err instanceof Error ? err.message : 'Failed to export calendar.'
      );
    }
  });

  // 7. Canonical Event Detail Resolver (with Audit History & Source Record)
  router.get('/calendar/events/:eventId', async (req, res) => {
    try {
      const eventId = decodeURIComponent(req.params.eventId);
      const detail = await getCalendarEventDetail(eventId);
      if (!detail) {
        sendApiError(res, 404, 'EVENT_NOT_FOUND', 'Calendar event was not found.', {
          event_id: eventId,
        });
        return;
      }
      res.json(detail);
    } catch (err) {
      sendApiError(
        res,
        500,
        'EVENT_DETAIL_ERROR',
        err instanceof Error ? err.message : 'Failed to resolve event detail.'
      );
    }
  });

  // 8. Execute Irrigation Workflow from Recommendation or Irrigation Task ("Start >")
  router.post('/calendar/irrigation/execute', (req, res) => {
    const schema = z.object({
      farm_id: z.string().min(1),
      field_id: z.string().nullable().optional(),
      field_name: z.string().nullable().optional(),
      date: z.string().min(4),
      volume_m3: z.number().positive(),
      method: z.string().min(1),
      notes: z.string().max(400).optional(),
      linked_task_id: z.string().nullable().optional(),
      recommendation_id: z.string().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendApiError(
        res,
        400,
        'INVALID_IRRIGATION_PAYLOAD',
        parsed.error.issues[0]?.message || 'Valid farm, date, volume, and method required.'
      );
      return;
    }
    const d = parsed.data;
    if (!isValidDateStr(d.date)) {
      sendApiError(res, 400, 'INVALID_IRRIGATION_DATE', 'Execution date must be YYYY-MM-DD.');
      return;
    }

    const payload = buildUnifiedPortfolioPayload();
    const farm = payload.farms.find((f) => f.id === d.farm_id && !f.archivedAt);
    if (!farm) {
      sendApiError(res, 404, 'FARM_NOT_FOUND', 'Target farm not found.');
      return;
    }

    const port = readPortfolioStore();
    const now = new Date().toISOString();
    const irrRec = {
      id: `irr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      farmId: d.farm_id,
      fieldId: d.field_id ?? null,
      fieldName: d.field_name || 'Whole Farm',
      date: d.date,
      volumeM3: d.volume_m3,
      method: d.method,
      notes: d.notes || `Executed via Calendar Start action (${d.recommendation_id || 'scheduled run'}).`,
      recommendationId: d.recommendation_id ?? null,
      createdAt: now,
    };
    port.irrigationLogs = [irrRec, ...port.irrigationLogs];

    if (d.linked_task_id) {
      const tIdx = port.tasks.findIndex((t) => t.id === d.linked_task_id);
      if (tIdx >= 0) {
        const prevTask = { ...(port.tasks[tIdx] as unknown as FarmTaskItem) };
        const updatedTask: FarmTaskItem = {
          ...prevTask,
          status: 'completed',
          completed: true,
          completedAt: now,
          completedBy: 'Farm Manager',
          updatedAt: now,
          version: (prevTask.version || 1) + 1,
        };
        port.tasks[tIdx] = updatedTask as unknown as Record<string, unknown>;
        const audit: TaskAuditRecord = {
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          task_id: d.linked_task_id,
          actor_id: 'Farm Manager',
          command: 'complete',
          previous_values: prevTask as unknown as Record<string, unknown>,
          new_values: updatedTask as unknown as Record<string, unknown>,
          reason: `Logged ${d.volume_m3} m³ irrigation run (${d.method})`,
          occurred_at: now,
          timezone: farm.timezone || 'UTC',
          request_id: null,
        };
        port.taskAudits = [audit, ...port.taskAudits];
      }
    }

    recordDomainOutboxEvent(port, {
      eventName: 'IrrigationCompleted',
      farmId: d.farm_id,
      fieldIds: d.field_id ? [d.field_id] : [],
      startDate: d.date,
      endDate: d.date,
    });
    writePortfolioStore(port);

    res.status(201).json({
      irrigation_log: irrRec,
      data_version: port.calendarVersion,
    });
  });

  // 9. Canonical Task Creation (`POST /api/tasks`)
  router.post('/tasks', async (req, res) => {
    const schema = z.object({
      farm_id: z.string().min(1),
      field_id: z.string().nullable().optional(),
      title: z.string().trim().min(1, 'Please describe what needs to be done.').max(180),
      due_date: z.string().min(8),
      task_type: z.string().optional(),
      priority: z.enum(['high', 'normal', 'low']).optional(),
      notes: z.string().max(600).optional(),
      idempotency_key: z.string().min(1).optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendApiError(
        res,
        400,
        'INVALID_TASK_INPUT',
        parsed.error.issues[0]?.message || 'Invalid task input.'
      );
      return;
    }

    const headerIdem = req.header('Idempotency-Key');
    const result = await createCanonicalTask({
      farm_id: parsed.data.farm_id,
      field_id: parsed.data.field_id ?? null,
      title: parsed.data.title,
      due_date: parsed.data.due_date,
      task_type: parsed.data.task_type as FarmTaskItem['category'] | undefined,
      priority: parsed.data.priority,
      notes: parsed.data.notes,
      idempotency_key:
        parsed.data.idempotency_key ||
        headerIdem ||
        `auto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });

    if (!result.ok) {
      sendApiError(res, result.status, result.code, result.message, result.details || {});
      return;
    }
    res.status(201).json(result.data);
  });

  // 10. Canonical Task Editing (`PATCH /api/tasks/:taskId`)
  router.patch('/tasks/:taskId', (req, res) => {
    const schema = z.object({
      title: z.string().trim().min(1).max(180).optional(),
      due_date: z.string().optional(),
      priority: z.enum(['high', 'normal', 'low']).optional(),
      field_id: z.string().nullable().optional(),
      notes: z.string().max(600).optional(),
      task_type: z
        .enum([
          'irrigation',
          'soil',
          'planting',
          'scouting',
          'rotation',
          'harvest',
          'fertilizer',
          'general',
        ])
        .optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendApiError(
        res,
        400,
        'INVALID_TASK_UPDATE',
        parsed.error.issues[0]?.message || 'Invalid task update.'
      );
      return;
    }
    if (parsed.data.due_date && !isValidDateStr(parsed.data.due_date)) {
      sendApiError(res, 400, 'INVALID_TASK_DATE', 'The selected task date is invalid.');
      return;
    }

    const port = readPortfolioStore();
    const idx = port.tasks.findIndex((t) => t.id === req.params.taskId);
    if (idx < 0) {
      sendApiError(res, 404, 'TASK_NOT_FOUND', 'Task not found.');
      return;
    }

    const current = { ...(port.tasks[idx] as unknown as FarmTaskItem) };
    const now = new Date().toISOString();
    const tz = current.timezone || port.farmMeta[current.farmId]?.timezone || 'UTC';
    const updated: FarmTaskItem = {
      ...current,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.due_date !== undefined
        ? {
            dueDate: parsed.data.due_date,
            scheduledStart: parsed.data.due_date,
            scheduledEnd: parsed.data.due_date,
          }
        : {}),
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      ...(parsed.data.task_type !== undefined ? { category: parsed.data.task_type } : {}),
      ...(parsed.data.field_id !== undefined ? { fieldId: parsed.data.field_id } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      updatedAt: now,
      version: (current.version || 1) + 1,
    };

    const audit: TaskAuditRecord = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      task_id: current.id,
      actor_id: 'Farm Manager',
      command: 'edited',
      previous_values: current as unknown as Record<string, unknown>,
      new_values: updated as unknown as Record<string, unknown>,
      reason: 'Edited task',
      occurred_at: now,
      timezone: tz,
      request_id: null,
    };

    port.tasks[idx] = updated as unknown as Record<string, unknown>;
    port.taskAudits = [audit, ...port.taskAudits];
    recordDomainOutboxEvent(port, {
      eventName: 'TaskUpdated',
      farmId: updated.farmId,
      fieldIds: updated.fieldId ? [updated.fieldId] : [],
      startDate: updated.dueDate || undefined,
      endDate: updated.dueDate || undefined,
    });
    writePortfolioStore(port);

    res.json({ task: updated, audit, data_version: port.calendarVersion });
  });

  // 11. Canonical Task Commands (`POST /api/tasks/:taskId/commands`)
  router.post('/tasks/:taskId/commands', (req, res) => {
    const schema = z.object({
      command: z.enum(['complete', 'defer', 'reschedule', 'cancel', 'reopen']),
      reason: z.string().max(400).optional(),
      new_date: z.string().optional(),
      actual_at: z.string().optional(),
      actor_id: z.string().max(100).optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendApiError(
        res,
        400,
        'INVALID_TASK_COMMAND',
        parsed.error.issues[0]?.message || 'Invalid command payload.'
      );
      return;
    }

    const result = executeTaskCommand(req.params.taskId, parsed.data);
    if (!result.ok) {
      sendApiError(res, result.status, result.code, result.message);
      return;
    }
    res.json({
      task: result.task,
      audit: result.audit,
      data_version: result.data_version,
    });
  });

  return router;
}
