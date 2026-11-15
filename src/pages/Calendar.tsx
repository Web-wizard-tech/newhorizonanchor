import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import rotationHeroSunsetImg from '../assets/images/rotation_hero_sunset_1794746173892.jpg';
import { CalendarHeader } from '../components/calendar/CalendarHeader';
import { CalendarToolbar } from '../components/calendar/CalendarToolbar';
import { DailyActivitiesPanel } from '../components/calendar/DailyActivitiesPanel';
import { MonthlyCalendarGrid } from '../components/calendar/MonthlyCalendarGrid';
import {
  ActivityDetailDrawer,
  AddTaskModal,
  DayOverflowModal,
  FullScheduleModal,
} from '../components/calendar/CalendarModals';
import { useToast } from '../components/Toast';
import {
  CALENDAR_CATEGORIES,
  CalendarActivity,
  getMonthGridCells,
  getTodayDateStrInTimezone,
  parseDateStr,
  projectionToCalendarActivity,
} from '../lib/calendarEngine';
import { getActiveFarmId, setActiveFarmId } from '../lib/farmStorage';
import {
  createCanonicalTaskApi,
  executeIrrigationRunApi,
  executeTaskCommandApi,
  fetchCalendarChanges,
  fetchCalendarDay,
  fetchCalendarMonth,
  fetchCalendarUpcoming,
  subscribeToCalendarStream,
} from '../services/calendarApi';
import type {
  CalendarConflictWarning,
  CalendarFarmOption,
  CalendarFreshnessSource,
  CalendarProjectionEvent,
  FarmWeatherSummary,
  TaskCommandRequest,
} from '../types/calendar';
import type { FarmTaskItem } from '../types/myFarms';

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `task-idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const Calendar: React.FC = () => {
  const { showToast } = useToast();

  const [farms, setFarms] = useState<CalendarFarmOption[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState<string>(() => getActiveFarmId() || '');
  const [selectedFieldId, setSelectedFieldId] = useState<string>('all');

  const initialToday = getTodayDateStrInTimezone();
  const initialParsed = parseDateStr(initialToday);
  const [displayYear, setDisplayYear] = useState(initialParsed.year);
  const [displayMonth0, setDisplayMonth0] = useState(initialParsed.month - 1);
  const [selectedDateStr, setSelectedDateStr] = useState(initialToday);
  const [serverTodayStr, setServerTodayStr] = useState(initialToday);
  const [activeTimezone, setActiveTimezone] = useState('UTC');

  const [monthEvents, setMonthEvents] = useState<CalendarProjectionEvent[]>([]);
  const [dayEvents, setDayEvents] = useState<CalendarProjectionEvent[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarProjectionEvent[]>([]);
  const [conflicts, setConflicts] = useState<CalendarConflictWarning[]>([]);
  const [partialSources, setPartialSources] = useState<CalendarFreshnessSource[]>([]);
  const [weather, setWeather] = useState<FarmWeatherSummary | null>(null);
  const [dataVersion, setDataVersion] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalDate, setAddModalDate] = useState(initialToday);
  const [addIdempotencyKey, setAddIdempotencyKey] = useState<string>(() => createIdempotencyKey());
  const [fullScheduleOpen, setFullScheduleOpen] = useState(false);
  const [overflowDateStr, setOverflowDateStr] = useState<string | null>(null);
  const [activeDrawer, setActiveDrawer] = useState<{
    activity: CalendarActivity;
    irrigationMode: boolean;
  } | null>(null);

  const monthCells = useMemo(
    () => getMonthGridCells(displayYear, displayMonth0),
    [displayYear, displayMonth0]
  );

  const gridRange = useMemo(() => {
    const start = monthCells[0]?.dateStr || `${displayYear}-01-01`;
    const end = monthCells[monthCells.length - 1]?.dateStr || `${displayYear}-12-31`;
    return { start, end };
  }, [monthCells, displayYear]);

  const dataVersionRef = useRef<number>(dataVersion);
  useEffect(() => {
    dataVersionRef.current = dataVersion;
  }, [dataVersion]);

  const scopeFarmParam = selectedFarmId || undefined;
  const scopeFieldParam = selectedFieldId !== 'all' ? selectedFieldId : undefined;
  const includeFarmInLabel = selectedFarmId === 'all' || farms.length > 1 && selectedFarmId === 'all';

  const loadMonthAndUpcoming = useCallback(async () => {
    setLoadError(null);
    const [monthRes, upcomingRes] = await Promise.all([
      fetchCalendarMonth({
        farmId: scopeFarmParam,
        fieldId: scopeFieldParam,
        startDate: gridRange.start,
        endDate: gridRange.end,
      }),
      fetchCalendarUpcoming({
        farmId: scopeFarmParam,
        fieldId: scopeFieldParam,
        days: 7,
      }),
    ]);

    setFarms(monthRes.farms);
    setSelectedFarmId((prev) => {
      if (prev === 'all') return 'all';
      if (prev && monthRes.farms.some((f) => f.id === prev)) return prev;
      return monthRes.farm_id || monthRes.farms[0]?.id || '';
    });
    setActiveTimezone(monthRes.timezone);
    setServerTodayStr(monthRes.today);
    setMonthEvents(monthRes.events);
    setConflicts(monthRes.conflicts);
    setPartialSources(monthRes.partial_sources);
    setWeather(monthRes.weather);
    setUpcomingEvents(upcomingRes.events);
    setDataVersion(monthRes.data_version);

    return monthRes;
  }, [scopeFarmParam, scopeFieldParam, gridRange.start, gridRange.end]);

  const loadSelectedDay = useCallback(
    async (dateStr: string) => {
      const dayRes = await fetchCalendarDay({
        date: dateStr,
        farmId: scopeFarmParam,
        fieldId: scopeFieldParam,
      });
      setDayEvents(dayRes.events);
      return dayRes;
    },
    [scopeFarmParam, scopeFieldParam]
  );

  const refreshAll = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      try {
        await Promise.all([loadMonthAndUpcoming(), loadSelectedDay(selectedDateStr)]);
      } catch (err) {
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Unable to load farm calendar schedule. Please retry.'
        );
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [loadMonthAndUpcoming, loadSelectedDay, selectedDateStr]
  );

  // Initial & scope/month fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadMonthAndUpcoming(), loadSelectedDay(selectedDateStr)])
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : 'Unable to load farm calendar schedule. Please retry.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadMonthAndUpcoming, loadSelectedDay, selectedDateStr]);

  // Real-time domain outbox SSE subscription
  useEffect(() => {
    const unsubscribe = subscribeToCalendarStream((notif) => {
      if (
        selectedFarmId === 'all' ||
        notif.farm_id === 'all' ||
        notif.farm_id === selectedFarmId
      ) {
        void refreshAll(false);
      }
    });
    return unsubscribe;
  }, [selectedFarmId, refreshAll]);

  // Tab focus change check for cross-workspace freshness
  useEffect(() => {
    const onFocus = () => {
      void fetchCalendarChanges(dataVersionRef.current)
        .then((res) => {
          if (res.has_changes) {
            void refreshAll(false);
          }
        })
        .catch(() => {
          // ignore transient background check failure
        });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshAll]);

  const mappedMonthActivities = useMemo(
    () =>
      monthEvents.map((evt) =>
        projectionToCalendarActivity(evt, serverTodayStr, selectedFarmId === 'all')
      ),
    [monthEvents, serverTodayStr, selectedFarmId]
  );

  // Populate multi-day spans across every grid cell within [startDate, endDate]
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, CalendarActivity[]>();
    for (const cell of monthCells) {
      map.set(cell.dateStr, []);
    }
    for (const act of mappedMonthActivities) {
      for (const cell of monthCells) {
        if (cell.dateStr >= act.startDate && cell.dateStr <= act.endDate) {
          map.get(cell.dateStr)!.push(act);
        }
      }
    }
    return map;
  }, [mappedMonthActivities, monthCells]);

  const selectedDayActivities = useMemo(() => {
    if (dayEvents.length > 0) {
      return dayEvents.map((evt) =>
        projectionToCalendarActivity(evt, serverTodayStr, includeFarmInLabel)
      );
    }
    return activitiesByDate.get(selectedDateStr) ?? [];
  }, [dayEvents, activitiesByDate, selectedDateStr, serverTodayStr, includeFarmInLabel]);

  const upcomingActivities = useMemo(
    () =>
      upcomingEvents
        .slice(0, 4)
        .map((evt) =>
          projectionToCalendarActivity(evt, serverTodayStr, selectedFarmId === 'all')
        ),
    [upcomingEvents, serverTodayStr, selectedFarmId]
  );

  const overflowActivities = useMemo(
    () => (overflowDateStr ? activitiesByDate.get(overflowDateStr) ?? [] : []),
    [activitiesByDate, overflowDateStr]
  );

  const openAddTaskModalForDate = (dateStr: string) => {
    setAddModalDate(dateStr);
    setAddIdempotencyKey(createIdempotencyKey());
    setAddModalOpen(true);
  };

  const handleSelectFarm = (farmId: string) => {
    setSelectedFarmId(farmId);
    setSelectedFieldId('all');
    if (farmId !== 'all') {
      setActiveFarmId(farmId);
    }
    const targetFarm = farms.find((f) => f.id === farmId);
    const nextToday = getTodayDateStrInTimezone(targetFarm?.timezone || activeTimezone);
    setSelectedDateStr(nextToday);
  };

  const handlePrevMonth = () => {
    if (displayMonth0 === 0) {
      setDisplayYear((y) => y - 1);
      setDisplayMonth0(11);
    } else {
      setDisplayMonth0((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (displayMonth0 === 11) {
      setDisplayYear((y) => y + 1);
      setDisplayMonth0(0);
    } else {
      setDisplayMonth0((m) => m + 1);
    }
  };

  const handleSelectMonthYear = (year: number, month0: number) => {
    setDisplayYear(year);
    setDisplayMonth0(month0);
  };

  const handleJumpToday = () => {
    const parsed = parseDateStr(serverTodayStr);
    setDisplayYear(parsed.year);
    setDisplayMonth0(parsed.month - 1);
    setSelectedDateStr(serverTodayStr);
  };

  const handleJumpToActivityDate = (act: CalendarActivity) => {
    const parsed = parseDateStr(act.dateStr);
    setDisplayYear(parsed.year);
    setDisplayMonth0(parsed.month - 1);
    setSelectedDateStr(act.dateStr);
    setActiveDrawer({ activity: act, irrigationMode: false });
  };

  /* ------------------------------------------------------------------------ */
  /* Canonical Server Actions                                                 */
  /* ------------------------------------------------------------------------ */

  const handleCreateTask = async (payload: {
    farmId: string;
    fieldId: string | null;
    title: string;
    dueDate: string;
    taskType?: FarmTaskItem['category'];
  }) => {
    setMutating(true);
    try {
      const res = await createCanonicalTaskApi({
        farm_id: payload.farmId,
        field_id: payload.fieldId,
        title: payload.title,
        due_date: payload.dueDate,
        task_type: payload.taskType,
        idempotency_key: addIdempotencyKey,
      });

      const parsed = parseDateStr(payload.dueDate);
      setDisplayYear(parsed.year);
      setDisplayMonth0(parsed.month - 1);
      setSelectedDateStr(payload.dueDate);
      setAddModalOpen(false);
      await refreshAll(false);

      const fieldNote = res.classification.inferred_field_name
        ? ` (${res.classification.inferred_field_name})`
        : '';
      showToast(`Added "${res.task.title}"${fieldNote}.`, 'success');
    } finally {
      setMutating(false);
    }
  };

  const handleExecuteTaskCommand = async (taskId: string, cmd: TaskCommandRequest) => {
    setMutating(true);
    try {
      await executeTaskCommandApi(taskId, cmd);
      if (cmd.new_date) {
        const parsed = parseDateStr(cmd.new_date);
        setDisplayYear(parsed.year);
        setDisplayMonth0(parsed.month - 1);
        setSelectedDateStr(cmd.new_date);
      }
      await refreshAll(false);
      setActiveDrawer(null);
      const labelMap: Record<TaskCommandRequest['command'], string> = {
        complete: 'Task marked completed.',
        defer: `Task deferred to ${cmd.new_date || 'later'}.`,
        reschedule: `Task rescheduled to ${cmd.new_date}.`,
        cancel: 'Task cancelled (preserved in history).',
        reopen: 'Task reopened.',
      };
      showToast(labelMap[cmd.command], 'success');
    } finally {
      setMutating(false);
    }
  };

  const handlePromoteToTask = async (act: CalendarActivity) => {
    setMutating(true);
    try {
      await createCanonicalTaskApi({
        farm_id: act.farmId,
        field_id: act.fieldId,
        title: act.title,
        due_date: act.dateStr,
        task_type: CALENDAR_CATEGORIES[act.category].backendCategory,
        priority: act.priority,
        notes: act.notes,
        idempotency_key: createIdempotencyKey(),
      });
      await refreshAll(false);
      setActiveDrawer(null);
      showToast(`Tracked "${act.title}" as a farm task.`, 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not promote item to task.',
        'error'
      );
    } finally {
      setMutating(false);
    }
  };

  const handleLogIrrigation = async (payload: {
    farmId: string;
    fieldId: string | null;
    fieldName: string;
    date: string;
    volumeM3: number;
    method: string;
    notes: string;
    linkedTaskId: string | null;
    recommendationId?: string | null;
  }) => {
    setMutating(true);
    try {
      await executeIrrigationRunApi({
        farm_id: payload.farmId,
        field_id: payload.fieldId,
        field_name: payload.fieldName,
        date: payload.date,
        volume_m3: payload.volumeM3,
        method: payload.method,
        notes: payload.notes,
        linked_task_id: payload.linkedTaskId,
        recommendation_id: payload.recommendationId ?? null,
      });
      await refreshAll(false);
      setActiveDrawer(null);
      showToast(
        `Logged ${payload.volumeM3} m³ irrigation run for ${payload.fieldName}.`,
        'success'
      );
    } finally {
      setMutating(false);
    }
  };

  const scopeLabel =
    selectedFarmId === 'all'
      ? 'All Farms'
      : farms.find((f) => f.id === selectedFarmId)?.name || 'Farm';

  return (
    <div className="relative min-h-screen w-full text-[#EEF4F6] overflow-x-hidden">
      {/* Full-bleed Agricultural Sunset Backdrop */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          src={rotationHeroSunsetImg}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover object-center scale-[1.02]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(4, 15, 22, 0.74) 0%, rgba(4, 17, 23, 0.48) 46%, rgba(3, 14, 18, 0.70) 100%)',
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 22% 14%, rgba(16, 185, 129, 0.14), transparent 46%), radial-gradient(circle at 86% 26%, rgba(251, 191, 36, 0.10), transparent 40%)',
          }}
        />
      </div>

      {/* Main Content Shell (Clears floating global Header.tsx) */}
      <div className="relative z-10 max-w-[1400px] mx-auto px-4 sm:px-7 lg:px-8 pt-[96px] sm:pt-[104px] pb-10 space-y-5">
        <CalendarHeader
          farms={farms}
          selectedFarmId={selectedFarmId || (farms[0]?.id ?? '')}
          selectedFieldId={selectedFieldId}
          onSelectFarm={handleSelectFarm}
          onSelectField={setSelectedFieldId}
          weather={weather}
          loading={loading && farms.length === 0}
        />

        <CalendarToolbar
          displayYear={displayYear}
          displayMonth0={displayMonth0}
          conflicts={conflicts}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
          onSelectMonthYear={handleSelectMonthYear}
          onJumpToday={handleJumpToday}
          onOpenAddTask={() => openAddTaskModalForDate(selectedDateStr)}
        />

        {/* Partial Source Notice (e.g., if external weather feed fails honestly) */}
        {partialSources.length > 0 && !loadError && (
          <div className="fs-cal-panel !rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-amber-200 border-amber-400/35">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
              <span>
                Some live telemetry sources are unavailable (
                {Array.from(
                  new Set(
                    partialSources.map((s) =>
                      s.source.startsWith('weather') ? 'live weather' : s.source
                    )
                  )
                ).join(', ')}
                ). Showing persisted farm records.
              </span>
            </div>
            <button
              type="button"
              onClick={() => void refreshAll(false)}
              className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/18 text-[11.5px] font-bold text-white inline-flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </button>
          </div>
        )}

        {/* Network / Server Failure Banner with Explicit Retry (Never fabricates mock events) */}
        {loadError && (
          <div className="fs-cal-panel !rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-rose-400/45">
            <div className="flex items-center gap-2.5 text-[13.5px] text-rose-200">
              <AlertTriangle className="w-5 h-5 text-rose-300 shrink-0" />
              <span>{loadError}</span>
            </div>
            <button
              type="button"
              onClick={() => void refreshAll(true)}
              className="h-9 px-4 rounded-xl bg-rose-500/20 border border-rose-400/45 text-[12.5px] font-bold text-white inline-flex items-center gap-1.5 hover:bg-rose-500/30 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {loading && farms.length === 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_365px] xl:grid-cols-[minmax(0,2.38fr)_385px] gap-[22px]">
            <div className="fs-cal-panel !rounded-[24px] h-[640px] p-6 animate-pulse flex flex-col justify-between">
              <div className="h-8 w-48 rounded-lg bg-white/10" />
              <div className="grid grid-cols-7 gap-3 flex-1 mt-6">
                {Array.from({ length: 28 }).map((_, idx) => (
                  <div key={idx} className="rounded-xl bg-white/[0.04]" />
                ))}
              </div>
            </div>
            <div className="fs-cal-panel !rounded-[24px] h-[640px] p-6 animate-pulse space-y-4">
              <div className="h-10 w-3/4 rounded-lg bg-white/10" />
              <div className="h-20 rounded-xl bg-white/[0.05]" />
              <div className="h-20 rounded-xl bg-white/[0.05]" />
              <div className="h-20 rounded-xl bg-white/[0.05]" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_365px] xl:grid-cols-[minmax(0,2.38fr)_385px] gap-[22px] items-stretch">
            <MonthlyCalendarGrid
              cells={monthCells}
              activitiesByDate={activitiesByDate}
              todayStr={serverTodayStr}
              selectedDateStr={selectedDateStr}
              onSelectDate={setSelectedDateStr}
              onSelectActivity={(act) =>
                setActiveDrawer({ activity: act, irrigationMode: false })
              }
              onOpenDayOverflow={setOverflowDateStr}
            />

            <DailyActivitiesPanel
              selectedDateStr={selectedDateStr}
              todayStr={serverTodayStr}
              dayActivities={selectedDayActivities}
              upcomingActivities={upcomingActivities}
              onSelectActivity={(act) =>
                setActiveDrawer({ activity: act, irrigationMode: false })
              }
              onStartActivity={(act) =>
                setActiveDrawer({ activity: act, irrigationMode: true })
              }
              onJumpToActivityDate={handleJumpToActivityDate}
              onOpenAddTaskForDate={openAddTaskModalForDate}
              onOpenFullSchedule={() => setFullScheduleOpen(true)}
            />
          </div>
        )}
      </div>

      {/* Modals & Slide-Over Drawer */}
      <AddTaskModal
        open={addModalOpen}
        farms={farms}
        selectedFarmId={selectedFarmId || (farms[0]?.id ?? '')}
        selectedFieldId={selectedFieldId}
        todayStr={serverTodayStr}
        defaultDateStr={addModalDate}
        submitting={mutating}
        onClose={() => setAddModalOpen(false)}
        onSubmit={handleCreateTask}
      />

      <ActivityDetailDrawer
        activity={activeDrawer?.activity ?? null}
        initialIrrigationMode={activeDrawer?.irrigationMode ?? false}
        mutating={mutating}
        onClose={() => setActiveDrawer(null)}
        onExecuteTaskCommand={handleExecuteTaskCommand}
        onPromoteToTask={handlePromoteToTask}
        onLogIrrigation={handleLogIrrigation}
      />

      <DayOverflowModal
        dateStr={overflowDateStr}
        activities={overflowActivities}
        onClose={() => setOverflowDateStr(null)}
        onSelectActivity={(act) =>
          setActiveDrawer({ activity: act, irrigationMode: false })
        }
        onAddTaskForDate={openAddTaskModalForDate}
      />

      <FullScheduleModal
        open={fullScheduleOpen}
        scopeLabel={scopeLabel}
        timezoneLabel={activeTimezone}
        selectedFarmId={selectedFarmId || (farms[0]?.id ?? 'all')}
        selectedFieldId={selectedFieldId}
        rangeStart={gridRange.start}
        rangeEnd={gridRange.end}
        activities={mappedMonthActivities}
        onClose={() => setFullScheduleOpen(false)}
        onSelectActivity={(act) =>
          setActiveDrawer({ activity: act, irrigationMode: false })
        }
      />
    </div>
  );
};
