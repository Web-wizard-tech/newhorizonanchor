import React, { useState } from 'react';
import {
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Pause,
  Play,
  Plus,
  Radio,
  ShieldOff,
  Trash2,
  X,
} from 'lucide-react';
import {
  AnalysisJob,
  AnalysisScope,
  AutomationSchedule,
  FarmPracticeRoutine,
  NotificationRecord,
  ProviderHealth,
} from '../../../../types/advanced';
import { MyFarmRecord, PortfolioFieldRecord } from '../../../../types/myFarms';
import {
  confirmRoutine,
  createRoutine,
  createSchedule,
  deleteRoutine,
  deleteSchedule,
  markNotificationsRead,
  patchSchedule,
  pauseSchedule,
  resumeSchedule,
  revokeScheduleConsent,
  runScheduleNow,
  testProviderLive,
} from '../../../../services/advancedApi';
import { useToast } from '../../../Toast';

interface ManageAutomationModalProps {
  farm: MyFarmRecord;
  fields: PortfolioFieldRecord[];
  schedules: AutomationSchedule[];
  routines: FarmPracticeRoutine[];
  jobs: AnalysisJob[];
  notifications: NotificationRecord[];
  providers: ProviderHealth[];
  onRefreshSummary: () => Promise<void>;
  onRunStarted: (runId: string) => void;
  onClose: () => void;
}

export const ManageAutomationModal: React.FC<ManageAutomationModalProps> = ({
  farm,
  fields,
  schedules,
  routines,
  jobs,
  notifications,
  providers,
  onRefreshSummary,
  onRunStarted,
  onClose,
}) => {
  const { showToast } = useToast();
  const [tab, setTab] = useState<'schedules' | 'routines' | 'history' | 'notifications' | 'providers'>(
    'schedules'
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create new schedule form
  const [newFreq, setNewFreq] = useState<AutomationSchedule['frequency']>('weekly');
  const [newTime, setNewTime] = useState('09:00');
  const [newTimezone, setNewTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  const [newScopeFieldId, setNewScopeFieldId] = useState('all');
  const [quietStart, setQuietStart] = useState('21:00');
  const [quietEnd, setQuietEnd] = useState('06:00');

  // Create routine form
  const [rtnFieldId, setRtnFieldId] = useState(fields[0]?.id ?? '');
  const [rtnDesc, setRtnDesc] = useState('');
  const [rtnCadence, setRtnCadence] = useState('Weekly');

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId('create-sched');
    try {
      const targetField = fields.find((f) => f.id === newScopeFieldId);
      const scope: AnalysisScope =
        newScopeFieldId === 'all' || !targetField
          ? {
              type: fields.length > 0 ? 'all_fields' : 'whole_farm',
              farmId: farm.id,
              fieldIds: fields.map((f) => f.id),
              label: fields.length > 0 ? `All Fields (${fields.length})` : 'Whole Farm',
            }
          : {
              type: 'single_field',
              farmId: farm.id,
              fieldIds: [targetField.id],
              label: targetField.name,
            };
      await createSchedule(farm.id, {
        name: `${newFreq.replace('_', ' ')} ${scope.label}`,
        scope,
        frequency: newFreq,
        preferredTime: newTime,
        timezone: newTimezone,
        quietHours: { start: quietStart, end: quietEnd },
        allowRemoteProcessingConsent: true,
      });
      await onRefreshSummary();
      showToast('Created automation schedule.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed creating schedule', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleScheduleAction = async (
    id: string,
    action: 'pause' | 'resume' | 'revoke' | 'delete' | 'run' | 'regrant'
  ) => {
    setBusyId(id);
    try {
      if (action === 'pause') await pauseSchedule(id);
      else if (action === 'resume') await resumeSchedule(id);
      else if (action === 'revoke') await revokeScheduleConsent(id);
      else if (action === 'regrant')
        await patchSchedule(id, { allowRemoteProcessingConsent: true, enabled: true });
      else if (action === 'delete') await deleteSchedule(id);
      else if (action === 'run') {
        const res = await runScheduleNow(id);
        onRunStarted(res.runId);
        onClose();
        return;
      }
      await onRefreshSummary();
      showToast('Schedule updated.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Schedule action failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rtnDesc.trim()) return;
    setBusyId('create-rtn');
    try {
      const f = fields.find((x) => x.id === rtnFieldId);
      await createRoutine(farm.id, {
        fieldId: f?.id ?? null,
        fieldName: f?.name ?? farm.name,
        category: 'irrigation_routine',
        description: rtnDesc.trim(),
        cadenceLabel: rtnCadence,
      });
      setRtnDesc('');
      await onRefreshSummary();
      showToast('Saved practice routine.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed saving routine', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkAllRead = async () => {
    setBusyId('read-notifs');
    try {
      await markNotificationsRead(farm.id);
      await onRefreshSummary();
      showToast('Marked all notifications read.', 'success');
    } finally {
      setBusyId(null);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div
      className="fixed inset-0 z-[88] bg-[#030D18]/85 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Automation, Routines & Notifications Console"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-[22px] border border-[#00E99A]/35 bg-[#081A2E] text-[#F2F7FF] shadow-[0_24px_64px_rgba(0,0,0,0.72)] p-5 sm:p-6 space-y-5"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#00E99A]">
              <Clock className="w-3.5 h-3.5" />
              <span>Automation &amp; Monitoring Control Center</span>
            </div>
            <h2 className="text-xl font-bold text-[#F2F7FF]">{farm.name} — Schedules &amp; Alerts</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#AAB9CA] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Console Tabs */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'schedules', label: `Schedules (${schedules.length})` },
              { id: 'routines', label: `Saved Routines (${routines.length})` },
              { id: 'history', label: `Job Runs (${jobs.length})` },
              { id: 'notifications', label: `Notifications (${unreadCount} unread)` },
              { id: 'providers', label: `Data Providers (${providers.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === t.id
                  ? 'bg-[#00E99A] text-[#042419]'
                  : 'bg-[#10263A] text-[#C7D6E6] hover:bg-[#173550]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB 1: DURABLE SCHEDULES */}
        {tab === 'schedules' && (
          <div className="space-y-4 text-xs">
            <div className="space-y-2.5">
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-white/12 bg-[#0D2137] p-4 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#F2F7FF]">{s.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${
                          s.status === 'active'
                            ? 'border-[#00E99A]/40 bg-[#00E99A]/12 text-[#00E99A]'
                            : s.status === 'consent_revoked'
                              ? 'border-rose-400/40 bg-rose-500/15 text-rose-300'
                              : 'border-amber-400/40 bg-amber-400/12 text-amber-300'
                        }`}
                      >
                        {s.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-[#AAB9CA]">
                      {s.frequency} at {s.preferredTime} ({s.timezone}) · Scope: {s.scope.label} ·
                      Quiet hours: {s.quietHours ? `${s.quietHours.start}–${s.quietHours.end}` : 'Off'}
                    </div>
                    <div className="text-[11px] text-[#8DA4BC] tabular-nums">
                      Next run: {new Date(s.nextRunAt).toLocaleString()} · Last run:{' '}
                      {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : 'Never'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busyId === s.id || !s.consent.allowRemoteJobProcessing}
                      onClick={() => handleScheduleAction(s.id, 'run')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#00E99A]/45 bg-[#00E99A]/15 text-[#00E99A] font-semibold cursor-pointer disabled:opacity-40"
                    >
                      <Play className="w-3 h-3" /> Run Now
                    </button>

                    {s.status === 'active' ? (
                      <button
                        type="button"
                        disabled={busyId === s.id}
                        onClick={() => handleScheduleAction(s.id, 'pause')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 text-amber-200 font-semibold cursor-pointer"
                      >
                        <Pause className="w-3 h-3" /> Pause
                      </button>
                    ) : s.status === 'paused' ? (
                      <button
                        type="button"
                        disabled={busyId === s.id}
                        onClick={() => handleScheduleAction(s.id, 'resume')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#00CFFF]/40 bg-[#00CFFF]/10 text-[#8CEBFF] font-semibold cursor-pointer"
                      >
                        <Check className="w-3 h-3" /> Resume
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === s.id}
                        onClick={() => handleScheduleAction(s.id, 'regrant')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#00E99A]/40 bg-[#00E99A]/10 text-[#00E99A] font-semibold cursor-pointer"
                      >
                        Re-grant Consent
                      </button>
                    )}

                    {s.consent.allowRemoteJobProcessing && (
                      <button
                        type="button"
                        disabled={busyId === s.id}
                        onClick={() => handleScheduleAction(s.id, 'revoke')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-400/35 bg-rose-500/10 text-rose-200 font-semibold cursor-pointer"
                      >
                        <ShieldOff className="w-3 h-3" /> Revoke Consent
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={busyId === s.id}
                      onClick={() => handleScheduleAction(s.id, 'delete')}
                      className="p-1.5 rounded-lg border border-white/10 bg-white/5 text-[#AAB9CA] hover:text-rose-300 cursor-pointer"
                      aria-label="Delete schedule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <form
              onSubmit={handleCreateSchedule}
              className="rounded-xl border border-[#00CFFF]/30 bg-[#0A1E33] p-4 space-y-3"
            >
              <div className="font-bold text-[#8CEBFF] flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Add Recurring Schedule (With Remote Processing Consent)
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                <div>
                  <label className="block text-[11px] text-[#AAB9CA] mb-1">Frequency</label>
                  <select
                    value={newFreq}
                    onChange={(e) => setNewFreq(e.target.value as AutomationSchedule['frequency'])}
                    className="w-full rounded-lg border border-white/15 bg-[#081726] px-2.5 py-2 text-xs text-[#F2F7FF]"
                  >
                    <option value="daily">Daily</option>
                    <option value="every_3_days">Every 3 Days</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-[#AAB9CA] mb-1">Time</label>
                  <input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-[#081726] px-2.5 py-2 text-xs text-[#F2F7FF]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#AAB9CA] mb-1">Timezone</label>
                  <input
                    type="text"
                    value={newTimezone}
                    onChange={(e) => setNewTimezone(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-[#081726] px-2.5 py-2 text-xs text-[#F2F7FF]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#AAB9CA] mb-1">Scope</label>
                  <select
                    value={newScopeFieldId}
                    onChange={(e) => setNewScopeFieldId(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-[#081726] px-2.5 py-2 text-xs text-[#F2F7FF]"
                  >
                    <option value="all">All Fields</option>
                    {fields.map((fl) => (
                      <option key={fl.id} value={fl.id}>
                        {fl.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-[#AAB9CA] mb-1">Quiet Hours</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="time"
                      value={quietStart}
                      onChange={(e) => setQuietStart(e.target.value)}
                      className="w-full rounded-lg border border-white/15 bg-[#081726] px-1.5 py-2 text-[11px] text-[#F2F7FF]"
                    />
                    <input
                      type="time"
                      value={quietEnd}
                      onChange={(e) => setQuietEnd(e.target.value)}
                      className="w-full rounded-lg border border-white/15 bg-[#081726] px-1.5 py-2 text-[11px] text-[#F2F7FF]"
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busyId === 'create-sched'}
                  className="px-4 py-2 rounded-full bg-[#00E99A] text-[#042419] font-bold hover:brightness-105 cursor-pointer"
                >
                  {busyId === 'create-sched' ? 'Saving…' : 'Create Schedule'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 2: SAVED ROUTINES */}
        {tab === 'routines' && (
          <div className="space-y-4 text-xs">
            <p className="text-[#AAB9CA]">
              Saved routines store planned cadence context and trigger periodic reconfirmation
              prompts. They never automatically create confirmed irrigation volume entries.
            </p>
            <div className="space-y-2">
              {routines.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-white/12 bg-[#0D2137] p-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-bold text-[#F2F7FF]">
                      {r.fieldName} — {r.cadenceLabel}
                    </div>
                    <div className="text-[#C7D6E6] mt-0.5">{r.description}</div>
                    <div className="text-[11px] text-[#8DA4BC] mt-0.5">
                      Last confirmed: {new Date(r.lastConfirmedAt).toLocaleDateString()}
                      {r.needsReconfirmation && (
                        <span className="ml-2 text-amber-300 font-semibold">
                          · Reconfirmation needed (&gt;14 days)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await confirmRoutine(farm.id, r.id);
                        await onRefreshSummary();
                        showToast('Routine confirmed active.', 'success');
                      }}
                      className="px-3 py-1.5 rounded-lg border border-[#00E99A]/45 bg-[#00E99A]/15 text-[#00E99A] font-semibold cursor-pointer"
                    >
                      Confirm Still Active
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteRoutine(farm.id, r.id);
                        await onRefreshSummary();
                      }}
                      className="p-1.5 rounded-lg border border-white/10 bg-white/5 text-[#AAB9CA] hover:text-rose-300 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <form
              onSubmit={handleAddRoutine}
              className="rounded-xl border border-white/12 bg-[#0A1E33] p-4 grid grid-cols-1 md:grid-cols-4 gap-2.5 items-end"
            >
              <div>
                <label className="block text-[11px] text-[#AAB9CA] mb-1">Field</label>
                <select
                  value={rtnFieldId}
                  onChange={(e) => setRtnFieldId(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-[#081726] px-2.5 py-2 text-xs text-[#F2F7FF]"
                >
                  <option value="">Whole Farm</option>
                  {fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#AAB9CA] mb-1">Cadence</label>
                <input
                  type="text"
                  value={rtnCadence}
                  onChange={(e) => setRtnCadence(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-[#081726] px-2.5 py-2 text-xs text-[#F2F7FF]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#AAB9CA] mb-1">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Tuesday drip line flush"
                  value={rtnDesc}
                  onChange={(e) => setRtnDesc(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-[#081726] px-2.5 py-2 text-xs text-[#F2F7FF]"
                />
              </div>
              <button
                type="submit"
                disabled={busyId === 'create-rtn' || !rtnDesc.trim()}
                className="px-4 py-2 rounded-lg bg-[#00E99A] text-[#042419] font-bold cursor-pointer disabled:opacity-50"
              >
                Save Routine
              </button>
            </form>
          </div>
        )}

        {/* TAB 3: JOB HISTORY */}
        {tab === 'history' && (
          <div className="space-y-2 text-xs">
            {jobs.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#0D2137] p-4 text-[#AAB9CA]">
                No analysis runs recorded yet.
              </div>
            ) : (
              jobs.map((j) => (
                <div
                  key={j.id}
                  className="rounded-xl border border-white/10 bg-[#0D2137] p-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-bold text-[#F2F7FF]">
                      {j.triggerReason} ({j.scope.label})
                    </div>
                    <div className="text-[11px] text-[#8DA4BC] tabular-nums">
                      Requested: {new Date(j.requestedAt).toLocaleString()} · Run ID: {j.id}
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded border text-[10.5px] font-bold uppercase ${
                      j.status === 'complete'
                        ? 'border-[#00E99A]/40 bg-[#00E99A]/12 text-[#00E99A]'
                        : j.status === 'partial'
                          ? 'border-amber-400/40 bg-amber-400/12 text-amber-300'
                          : 'border-white/20 bg-white/10 text-[#D6E4F2]'
                    }`}
                  >
                    {j.status}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 4: DEDUPLICATED NOTIFICATIONS */}
        {tab === 'notifications' && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#AAB9CA]">
                Deduplicated change alerts ({unreadCount} unread)
              </span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="px-3 py-1 rounded-lg border border-[#00E99A]/45 bg-[#00E99A]/15 text-[#00E99A] font-semibold cursor-pointer"
                >
                  Mark All Read
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#0D2137] p-4 text-[#AAB9CA]">
                No automation or change notifications yet.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-xl border p-3.5 flex items-start justify-between gap-3 ${
                    n.read
                      ? 'border-white/10 bg-[#0D2137]/60 text-[#AAB9CA]'
                      : 'border-[#00CFFF]/45 bg-[#0E2842] text-[#F2F7FF]'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="font-bold flex items-center gap-2">
                      <Bell className="w-3.5 h-3.5 text-[#00CFFF]" />
                      <span>{n.title}</span>
                    </div>
                    <div>{n.message}</div>
                    <div className="text-[10.5px] text-[#8DA4BC] tabular-nums">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {!n.read && (
                    <span className="px-2 py-0.5 rounded bg-[#00CFFF]/20 text-[#8CEBFF] text-[10px] font-bold">
                      NEW
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 5: DATA PROVIDERS */}
        {tab === 'providers' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
            {providers.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-white/10 bg-[#0D2137] p-3 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-bold text-[#F2F7FF] flex items-center gap-2">
                    <Radio className="w-3.5 h-3.5 text-[#00CFFF] shrink-0" />
                    <span className="truncate">{p.name}</span>
                  </div>
                  <div className="text-[11px] text-[#8DA4BC] mt-0.5">
                    {p.state} · {p.resolutionLabel}
                    {p.lastError ? ` · ${p.lastError}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={p.state === 'planned'}
                  onClick={async () => {
                    const lat = farm.centroid?.lat ?? 44.8602;
                    const lon = farm.centroid?.lon ?? -123.1462;
                    const updated = await testProviderLive(p.id, lat, lon);
                    await onRefreshSummary();
                    showToast(`${updated.name}: ${updated.state}`, 'info');
                  }}
                  className="px-2.5 py-1 rounded border border-white/15 bg-white/5 hover:bg-white/10 text-[11px] font-semibold cursor-pointer disabled:opacity-40"
                >
                  Test
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
