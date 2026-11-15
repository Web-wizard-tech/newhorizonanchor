import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Crosshair,
  Download,
  Droplets,
  ExternalLink,
  History,
  PauseCircle,
  Plus,
  RotateCcw,
  Search,
  Tractor,
  X,
  XCircle,
} from 'lucide-react';
import seedlingBannerImg from '../../assets/images/rotation_soil_seedling_1794746175973.jpg';
import {
  addDaysToDateStr,
  CALENDAR_CATEGORIES,
  CalendarActivity,
  CalendarCategory,
  formatDateSubtitle,
  formatDateWindowLabel,
  formatShortWeekdayDate,
} from '../../lib/calendarEngine';
import {
  buildCalendarIcsExportUrl,
  fetchCalendarEventDetail,
} from '../../services/calendarApi';
import type {
  CalendarEventDetailResponse,
  CalendarFarmOption,
  TaskCommandRequest,
} from '../../types/calendar';
import type { FarmTaskItem } from '../../types/myFarms';
import {
  CalendarActivityThumbnail,
  CalendarCategoryGlyph,
} from './CalendarCategoryGlyph';

/* -------------------------------------------------------------------------- */
/* 1. Add New Task Modal (Matches Reference Visual + No Additional Details)   */
/* -------------------------------------------------------------------------- */

interface AddTaskModalProps {
  open: boolean;
  farms: CalendarFarmOption[];
  selectedFarmId: string; // farm ID or 'all'
  selectedFieldId: string; // field ID or 'all'
  todayStr: string;
  defaultDateStr: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    farmId: string;
    fieldId: string | null;
    title: string;
    dueDate: string;
    taskType?: FarmTaskItem['category'];
  }) => Promise<void>;
}

const PICKER_CATEGORIES: Array<{
  id: 'auto' | CalendarCategory;
  label: string;
  backendCategory?: FarmTaskItem['category'];
}> = [
  { id: 'auto', label: 'Auto-detect from note' },
  { id: 'general', label: 'General Farm Work', backendCategory: 'general' },
  { id: 'irrigation', label: 'Irrigation', backendCategory: 'irrigation' },
  { id: 'scouting', label: 'Scouting / Pests', backendCategory: 'scouting' },
  { id: 'soil_test', label: 'Soil Test', backendCategory: 'soil' },
  { id: 'fertilizer', label: 'Fertilizer', backendCategory: 'fertilizer' },
  { id: 'planting', label: 'Planting', backendCategory: 'planting' },
  { id: 'harvest', label: 'Harvest', backendCategory: 'harvest' },
  { id: 'rotation_prep', label: 'Rotation Prep', backendCategory: 'rotation' },
];

function inferPreviewCategory(text: string): CalendarCategory | null {
  const lower = text.toLowerCase();
  if (/(irrigat|water|drip|sprinkler|moisture|pump|valve)/.test(lower)) return 'irrigation';
  if (/(pest|aphid|fungus|mildew|blight|disease|scout|weed|trap)/.test(lower)) return 'scouting';
  if (/(soil|ph|sample|lab|salinity|ec|probe)/.test(lower)) return 'soil_test';
  if (/(fertiliz|nitrogen|urea|compost|npk|manure|spray)/.test(lower)) return 'fertilizer';
  if (/(plant|seed|sow|drill|transplant)/.test(lower)) return 'planting';
  if (/(harvest|combine|reap|thresh|pick)/.test(lower)) return 'harvest';
  if (/(rotat|cover crop|tillage|plow|seedbed|residue)/.test(lower)) return 'rotation_prep';
  return null;
}

export const AddTaskModal: React.FC<AddTaskModalProps> = ({
  open,
  farms,
  selectedFarmId,
  selectedFieldId,
  todayStr,
  defaultDateStr,
  submitting,
  onClose,
  onSubmit,
}) => {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(defaultDateStr);
  const [chosenCategory, setChosenCategory] = useState<'auto' | CalendarCategory>('auto');
  const [targetFarmId, setTargetFarmId] = useState<string>('');
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const dateInputRef = useRef<HTMLInputElement>(null);
  const catMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDueDate(defaultDateStr || todayStr);
      setChosenCategory('auto');
      setCatMenuOpen(false);
      setFormError(null);
      const resolvedFarmId =
        selectedFarmId && selectedFarmId !== 'all'
          ? selectedFarmId
          : farms[0]?.id || '';
      setTargetFarmId(resolvedFarmId);
    }
  }, [open, defaultDateStr, todayStr, selectedFarmId, farms]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (catMenuRef.current && !catMenuRef.current.contains(e.target as Node)) {
        setCatMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  if (!open) return null;

  const tomorrowStr = addDaysToDateStr(todayStr, 1);
  const nextWeekStr = addDaysToDateStr(todayStr, 7);

  const activeCategoryForIcon: CalendarCategory | 'tractor_default' =
    chosenCategory !== 'auto'
      ? chosenCategory
      : inferPreviewCategory(title) ?? 'tractor_default';

  const openDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch {
        // Fallback to focus/click below
      }
    }
    input.focus();
    input.click();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setFormError('Please describe what you need to do.');
      return;
    }
    const effectiveFarmId = targetFarmId || farms[0]?.id;
    if (!effectiveFarmId) {
      setFormError('Please create a farm first before scheduling tasks.');
      return;
    }

    setFormError(null);
    const chosenMeta = PICKER_CATEGORIES.find((c) => c.id === chosenCategory);
    try {
      await onSubmit({
        farmId: effectiveFarmId,
        fieldId:
          selectedFarmId !== 'all' && selectedFieldId !== 'all'
            ? selectedFieldId
            : null,
        title: title.trim(),
        dueDate,
        taskType: chosenMeta?.backendCategory,
      });
    } catch (err) {
      setFormError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save task. Please verify your inputs and try again.'
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#02120F]/78 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-task-modal-title"
        className="fs-cal-panel w-full max-w-[590px] !rounded-[28px] overflow-hidden shadow-[0_28px_80px_rgba(0,0,0,0.72)]"
        style={{
          backgroundImage:
            'linear-gradient(155deg, rgba(6, 36, 32, 0.94) 0%, rgba(5, 29, 38, 0.96) 55%, rgba(7, 25, 48, 0.98) 100%)',
          border: '1px solid rgba(56, 189, 206, 0.48)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Hero Banner with Seedling Image & Luminous Emerald Divider */}
        <div className="relative h-[126px] sm:h-[134px] overflow-hidden border-b border-[#20F69A]/50 shadow-[0_1px_18px_rgba(32,246,154,0.28)]">
          {/* Right-side sunrise seedling photo */}
          <img
            src={seedlingBannerImg}
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-0 h-full w-[72%] object-cover object-center opacity-85"
          />
          {/* Smooth left-to-right gradient mask blending photo into dark frosted glass */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(5, 31, 28, 0.99) 0%, rgba(5, 31, 28, 0.94) 36%, rgba(5, 31, 28, 0.35) 72%, rgba(5, 31, 28, 0.14) 100%)',
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-8"
            style={{
              background:
                'linear-gradient(180deg, transparent 0%, rgba(6, 34, 34, 0.72) 100%)',
            }}
          />

          <div className="relative z-10 h-full px-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {/* Glowing Circle + Icon */}
              <div
                className="w-12 h-12 sm:w-[54px] sm:h-[54px] rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: 'rgba(14, 78, 52, 0.72)',
                  border: '2px solid #20F69A',
                  boxShadow:
                    '0 0 24px rgba(32, 246, 154, 0.48), inset 0 0 12px rgba(32, 246, 154, 0.25)',
                }}
              >
                <Plus className="w-7 h-7 text-white" strokeWidth={2.7} />
              </div>

              <div className="min-w-0">
                <h2
                  id="add-task-modal-title"
                  className="text-[22px] sm:text-[26px] font-extrabold text-[#F5FAF8] tracking-tight leading-tight"
                >
                  Add New Task
                </h2>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  <p className="text-[13.5px] sm:text-[14.5px] text-[#C8DCD9]">
                    Schedule a new task for your farm
                  </p>
                  {selectedFarmId === 'all' && farms.length > 1 && (
                    <select
                      aria-label="Target farm for new task"
                      value={targetFarmId}
                      onChange={(e) => setTargetFarmId(e.target.value)}
                      className="h-6 px-2 rounded-full bg-black/45 border border-[#20F69A]/45 text-[11.5px] font-semibold text-[#A7F3D0] focus:outline-none cursor-pointer"
                    >
                      {farms.map((f) => (
                        <option key={f.id} value={f.id} className="bg-[#072024] text-white">
                          {f.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Add New Task modal"
              className="self-start mt-4 w-9 h-9 rounded-full flex items-center justify-center text-[#DCECEF] hover:text-white hover:bg-white/12 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" strokeWidth={2.2} />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* 1. Select Date */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-[#22F08E]" strokeWidth={2.1} />
              <span className="text-[16px] font-bold text-[#F3F8F6]">Select Date</span>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
              {/* Formatted Date Trigger + Hidden Native Date Input */}
              <div className="relative flex-1 min-w-[205px]">
                <input
                  ref={dateInputRef}
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    if (e.target.value) setDueDate(e.target.value);
                  }}
                  aria-label="Select task date"
                  className="sr-only"
                  required
                />
                <button
                  type="button"
                  onClick={openDatePicker}
                  className="fs-cal-subcard fs-cal-subcard-interactive w-full h-[46px] px-3.5 !rounded-[13px] flex items-center justify-between gap-2.5 cursor-pointer"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <CalendarDays className="w-4 h-4 text-[#C6DCE0] shrink-0" strokeWidth={2} />
                    <span className="text-[14.5px] font-semibold text-[#F2F7F8] truncate tabular-nums">
                      {formatDateSubtitle(dueDate)}
                    </span>
                  </span>
                  <ChevronDown className="w-4 h-4 text-[#B6CED4] shrink-0" />
                </button>
              </div>

              {/* 3 Quick Date Shortcuts: Today, Tomorrow, +1 Week */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setDueDate(todayStr)}
                  className={`h-[46px] px-3.5 rounded-[13px] text-[13px] font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                    dueDate === todayStr
                      ? 'bg-[#12513B]/80 border border-[#20F69A]/70 text-white shadow-[0_0_14px_rgba(32,246,154,0.22)]'
                      : 'fs-cal-subcard fs-cal-subcard-interactive text-[#DCECEF]'
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5 text-[#D2E6EA]" />
                  <span>Today</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDueDate(tomorrowStr)}
                  className={`h-[46px] px-3.5 rounded-[13px] text-[13px] font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                    dueDate === tomorrowStr
                      ? 'bg-[#12513B]/80 border border-[#20F69A]/70 text-white shadow-[0_0_14px_rgba(32,246,154,0.22)]'
                      : 'fs-cal-subcard fs-cal-subcard-interactive text-[#DCECEF]'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5 text-[#D2E6EA]" />
                  <span>Tomorrow</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDueDate(nextWeekStr)}
                  className={`h-[46px] px-3.5 rounded-[13px] text-[13px] font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                    dueDate === nextWeekStr
                      ? 'bg-[#12513B]/80 border border-[#20F69A]/70 text-white shadow-[0_0_14px_rgba(32,246,154,0.22)]'
                      : 'fs-cal-subcard fs-cal-subcard-interactive text-[#DCECEF]'
                  }`}
                >
                  <CalendarPlus className="w-3.5 h-3.5 text-[#D2E6EA]" />
                  <span>+1 Week</span>
                </button>
              </div>
            </div>
          </div>

          {/* 2. Task Details (Left Emerald Category Icon Tile + Right Task Textarea) */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-[#22F08E]" strokeWidth={2.1} />
              <span className="text-[16px] font-bold text-[#F3F8F6]">Task Details</span>
            </div>

            <div className="flex items-stretch gap-3.5">
              {/* Left Category Selector Tile */}
              <div className="relative shrink-0" ref={catMenuRef}>
                <button
                  type="button"
                  onClick={() => setCatMenuOpen((v) => !v)}
                  aria-label="Choose task category"
                  aria-expanded={catMenuOpen}
                  className="w-[86px] h-[118px] rounded-[16px] flex flex-col overflow-hidden cursor-pointer transition-all hover:brightness-110"
                  style={{
                    background:
                      'linear-gradient(175deg, rgba(22, 134, 72, 0.92) 0%, rgba(12, 74, 44, 0.96) 100%)',
                    border: '1px solid rgba(57, 245, 160, 0.45)',
                    boxShadow: '0 8px 24px rgba(16, 185, 129, 0.22)',
                  }}
                >
                  <div className="flex-1 flex items-center justify-center">
                    {activeCategoryForIcon === 'tractor_default' ? (
                      <Tractor className="w-9 h-9 text-white" strokeWidth={2.1} />
                    ) : (
                      <CalendarCategoryGlyph
                        category={activeCategoryForIcon}
                        className="w-9 h-9"
                        colorOverride="#FFFFFF"
                      />
                    )}
                  </div>
                  <div className="h-[32px] border-t border-white/20 bg-black/15 flex items-center justify-center">
                    <ChevronDown className="w-4 h-4 text-white" strokeWidth={2.3} />
                  </div>
                </button>

                {catMenuOpen && (
                  <div
                    className="fs-cal-panel absolute left-0 bottom-[126px] z-50 w-[225px] !rounded-[16px] p-1.5 space-y-1 shadow-2xl"
                    style={{ backgroundColor: 'rgba(6, 26, 36, 0.98)' }}
                  >
                    {PICKER_CATEGORIES.map((opt) => {
                      const active = chosenCategory === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setChosenCategory(opt.id);
                            setCatMenuOpen(false);
                          }}
                          className={`w-full px-2.5 py-2 rounded-xl flex items-center gap-2.5 text-left text-[12.5px] font-semibold transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#20F69A]/18 text-white border border-[#20F69A]/45'
                              : 'text-[#D6E6EA] hover:bg-white/[0.08] border border-transparent'
                          }`}
                        >
                          {opt.id === 'auto' ? (
                            <Tractor className="w-4 h-4 text-[#22F08E] shrink-0" />
                          ) : (
                            <CalendarCategoryGlyph
                              category={opt.id}
                              className="w-4 h-4 shrink-0"
                            />
                          )}
                          <span className="truncate">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right What Do You Need To Do Textarea */}
              <div className="fs-cal-subcard flex-1 !rounded-[16px] px-4 py-3.5 flex flex-col justify-between min-h-[118px] focus-within:border-[#20F69A]/65 transition-colors">
                <label
                  htmlFor="add-task-description-input"
                  className="text-[14.5px] font-medium text-[#CFE0DF] mb-1.5 select-none"
                >
                  What do you need to do?
                </label>
                <textarea
                  id="add-task-description-input"
                  rows={3}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="e.g. Irrigate Field 02, Check for pests, Apply fertilizer..."
                  className="w-full flex-1 bg-transparent border-0 p-0 text-[14.5px] text-white placeholder-[#8AA4AB] focus:outline-none focus:ring-0 resize-none leading-relaxed"
                  autoFocus
                />
              </div>
            </div>
          </div>

          {/* Inline Error Feedback (Preserves user text on failure) */}
          {formError && (
            <div
              role="alert"
              className="px-3.5 py-2.5 rounded-xl bg-rose-500/15 border border-rose-400/45 text-[13px] text-rose-200 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Footer Buttons: Cancel (left) + Add Task (right) */}
          <div className="pt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="fs-cal-subcard fs-cal-subcard-interactive h-[46px] px-5 !rounded-full inline-flex items-center gap-2 text-[14.5px] font-semibold text-[#EAF4F6] cursor-pointer"
            >
              <X className="w-4 h-4 text-[#DCECEF]" strokeWidth={2.4} />
              <span>Cancel</span>
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="h-[46px] px-7 rounded-full inline-flex items-center gap-2 text-[15.5px] font-extrabold text-[#032719] bg-gradient-to-b from-[#39F5A0] to-[#12D77A] hover:brightness-105 disabled:opacity-60 transition-all cursor-pointer"
              style={{
                boxShadow: '0 0 26px rgba(32, 246, 154, 0.45)',
              }}
            >
              <Check className="w-4.5 h-4.5 text-[#032719]" strokeWidth={2.8} />
              <span>{submitting ? 'Adding…' : 'Add Task'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 2. Activity Detail & Execution Slide-Over Drawer                           */
/* -------------------------------------------------------------------------- */

interface ActivityDetailDrawerProps {
  activity: CalendarActivity | null;
  initialIrrigationMode?: boolean;
  mutating: boolean;
  onClose: () => void;
  onExecuteTaskCommand: (taskId: string, cmd: TaskCommandRequest) => Promise<void>;
  onPromoteToTask: (activity: CalendarActivity) => Promise<void>;
  onLogIrrigation: (payload: {
    farmId: string;
    fieldId: string | null;
    fieldName: string;
    date: string;
    volumeM3: number;
    method: string;
    notes: string;
    linkedTaskId: string | null;
    recommendationId?: string | null;
  }) => Promise<void>;
}

export const ActivityDetailDrawer: React.FC<ActivityDetailDrawerProps> = ({
  activity,
  initialIrrigationMode = false,
  mutating,
  onClose,
  onExecuteTaskCommand,
  onPromoteToTask,
  onLogIrrigation,
}) => {
  const [detail, setDetail] = useState<CalendarEventDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [deferReason, setDeferReason] = useState('');
  const [showIrrigationLog, setShowIrrigationLog] = useState(false);
  const [volumeM3, setVolumeM3] = useState('110');
  const [method, setMethod] = useState('Drip irrigation');
  const [irrNotes, setIrrNotes] = useState('');
  const [drawerError, setDrawerError] = useState<string | null>(null);

  useEffect(() => {
    if (!activity) {
      setDetail(null);
      return;
    }
    setRescheduleDate(activity.dateStr);
    setDeferReason('');
    setShowIrrigationLog(initialIrrigationMode && activity.category === 'irrigation');
    setVolumeM3('110');
    setMethod('Drip irrigation');
    setIrrNotes('');
    setDrawerError(null);

    let cancelled = false;
    setDetailLoading(true);
    fetchCalendarEventDetail(activity.id)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activity, initialIrrigationMode]);

  if (!activity) return null;

  const isUserTask = activity.sourceType === 'task' && Boolean(activity.sourceId);
  const canLogIrrigation =
    activity.category === 'irrigation' && activity.sourceType !== 'irrigation_log';
  const liveEvent = detail?.event;
  const availableCommands = detail?.available_commands ?? (isUserTask ? ['complete', 'defer', 'reschedule', 'cancel'] : []);
  const auditHistory = detail?.audit_history ?? [];
  const evidenceBullets = liveEvent?.evidence?.length ? liveEvent.evidence : activity.detailBullets;
  const displayWeather = detail?.weather;

  const handleCmd = async (cmd: TaskCommandRequest) => {
    if (!activity.sourceId) return;
    setDrawerError(null);
    try {
      await onExecuteTaskCommand(activity.sourceId, cmd);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#02120F]/72 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fs-drawer-shell w-full max-w-md h-full overflow-y-auto fs-thin-scroll p-6 flex flex-col justify-between gap-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-5">
          {/* Top Bar */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0">
              <CalendarActivityThumbnail
                category={activity.category}
                cropName={activity.cropName}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-[#9FE8D0] border border-[#22F08E]/25">
                    {activity.provenanceBasis}
                  </span>
                  <span className="text-[11px] text-[#8EB3BC] font-medium truncate">
                    {activity.farmName}
                  </span>
                </div>
                <h2 className="text-[20px] font-extrabold text-[#F5F8FA] mt-1 leading-snug">
                  {activity.title}
                </h2>
                <p className="text-[13px] text-[#A8C1C7]">
                  {activity.endDate > activity.startDate
                    ? `${formatDateWindowLabel(activity.startDate, activity.endDate)} (${activity.timezone})`
                    : `${formatDateSubtitle(activity.dateStr)} (${activity.timezone})`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close activity detail"
              className="p-1.5 rounded-full text-[#9DB8BF] hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Planned vs Actual Dates (when available) */}
          {(activity.plannedDate || activity.actualDate) && (
            <div className="fs-cal-subcard !rounded-2xl px-4 py-3 grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <div className="text-[#8EB3BC]">Planned Date</div>
                <div className="font-bold text-[#EEF4F6] mt-0.5 tabular-nums">
                  {activity.plannedDate ? formatShortWeekdayDate(activity.plannedDate) : '—'}
                </div>
              </div>
              <div>
                <div className="text-[#8EB3BC]">Actual Recorded</div>
                <div className="font-bold text-[#9EE2FF] mt-0.5 tabular-nums">
                  {activity.actualDate ? formatShortWeekdayDate(activity.actualDate) : 'Pending'}
                </div>
              </div>
            </div>
          )}

          {/* Summary & Evidence */}
          <div className="fs-cal-subcard !rounded-2xl p-4 space-y-2.5">
            <div className="text-[13.5px] font-semibold text-[#EAF4F6]">
              {liveEvent?.subtitle || activity.subtitle}
            </div>
            <p className="text-[13px] text-[#BDD1D6] leading-relaxed">
              {liveEvent?.description || activity.notes}
            </p>
            {evidenceBullets.length > 0 && (
              <ul className="pt-1 space-y-1.5">
                {evidenceBullets.map((b, i) => (
                  <li key={i} className="text-[12px] text-[#9BB7BE] flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#22F08E] mt-1.5 shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
            {displayWeather && displayWeather.available && (
              <div className="pt-2 mt-2 border-t border-white/10 text-[11.5px] text-[#9EE2FF] flex flex-wrap gap-3">
                <span>Temp: {displayWeather.temp_c ?? '--'}°C</span>
                <span>48h Rain: {displayWeather.forecast_precip_48h_mm ?? 0} mm</span>
                {displayWeather.et0_mm_day !== null && (
                  <span>ET₀: {displayWeather.et0_mm_day} mm/d</span>
                )}
              </div>
            )}
          </div>

          {drawerError && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-400/40 text-[12.5px] text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{drawerError}</span>
            </div>
          )}

          {/* Irrigation Run Logger */}
          {canLogIrrigation && (
            <div className="rounded-2xl p-4 bg-[#0D3956]/60 border border-[#26B9F4]/40 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[14px] font-bold text-[#E6F6FF]">
                  <Droplets className="w-4 h-4 text-[#26B9F4]" />
                  <span>Execute &amp; Log Irrigation Run</span>
                </div>
                {!showIrrigationLog && (
                  <button
                    type="button"
                    onClick={() => setShowIrrigationLog(true)}
                    className="px-3 py-1 rounded-lg bg-[#1890FF] text-white text-[12px] font-bold hover:brightness-110 cursor-pointer"
                  >
                    Start Run
                  </button>
                )}
              </div>

              {showIrrigationLog && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const parsedVol = Number(volumeM3);
                    if (!Number.isFinite(parsedVol) || parsedVol <= 0) return;
                    setDrawerError(null);
                    try {
                      await onLogIrrigation({
                        farmId: activity.farmId,
                        fieldId: activity.fieldId,
                        fieldName: activity.fieldName,
                        date: activity.dateStr,
                        volumeM3: parsedVol,
                        method,
                        notes:
                          irrNotes.trim() ||
                          `Executed scheduled irrigation for ${activity.fieldName}.`,
                        linkedTaskId: isUserTask ? activity.sourceId : null,
                        recommendationId: activity.links.recommendation_id ?? null,
                      });
                    } catch (err) {
                      setDrawerError(err instanceof Error ? err.message : 'Failed to log run.');
                    }
                  }}
                  className="space-y-3 pt-1"
                >
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11.5px] text-[#BFE4F7] mb-1">
                        Volume (m³)
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={volumeM3}
                        onChange={(e) => setVolumeM3(e.target.value)}
                        required
                        className="w-full h-9 px-3 rounded-lg bg-black/35 border border-[#26B9F4]/35 text-[13px] text-white focus:outline-none focus:border-[#26B9F4]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11.5px] text-[#BFE4F7] mb-1">
                        Method
                      </label>
                      <input
                        type="text"
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                        required
                        className="w-full h-9 px-3 rounded-lg bg-black/35 border border-[#26B9F4]/35 text-[13px] text-white focus:outline-none focus:border-[#26B9F4]"
                      />
                    </div>
                  </div>
                  <input
                    type="text"
                    value={irrNotes}
                    onChange={(e) => setIrrNotes(e.target.value)}
                    placeholder="Optional flow pressure or duration note…"
                    className="w-full h-9 px-3 rounded-lg bg-black/35 border border-[#26B9F4]/35 text-[12.5px] text-white placeholder-[#7FA6BC] focus:outline-none focus:border-[#26B9F4]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowIrrigationLog(false)}
                      className="px-3 py-1.5 rounded-lg text-[12px] text-[#BFE4F7] hover:bg-white/10 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={mutating}
                      className="px-4 py-1.5 rounded-lg bg-gradient-to-b from-[#1EA7FF] to-[#0B7EE8] text-white text-[12.5px] font-bold hover:brightness-110 disabled:opacity-60 cursor-pointer"
                    >
                      {mutating ? 'Logging…' : 'Confirm & Log Run'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Canonical Task Commands: Complete, Reopen, Reschedule, Defer, Cancel */}
          {isUserTask && activity.sourceId ? (
            <div className="fs-cal-subcard !rounded-2xl p-4 space-y-3">
              <div className="text-[12.5px] font-bold text-[#DCECEF]">Task Actions</div>

              <div className="flex flex-wrap gap-2">
                {availableCommands.includes('complete') && (
                  <button
                    type="button"
                    disabled={mutating}
                    onClick={() => handleCmd({ command: 'complete', reason: 'Marked complete in calendar' })}
                    className="flex-1 h-10 px-3.5 rounded-xl bg-[#20F69A] text-[#032719] font-bold text-[13px] inline-flex items-center justify-center gap-2 hover:brightness-105 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Complete</span>
                  </button>
                )}

                {availableCommands.includes('reopen') && (
                  <button
                    type="button"
                    disabled={mutating}
                    onClick={() => handleCmd({ command: 'reopen', reason: 'Reopened from calendar' })}
                    className="flex-1 h-10 px-3.5 rounded-xl bg-white/12 text-[#EEF4F6] font-bold text-[13px] inline-flex items-center justify-center gap-2 hover:bg-white/18 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Reopen</span>
                  </button>
                )}

                {availableCommands.includes('cancel') && (
                  <button
                    type="button"
                    disabled={mutating}
                    onClick={() => handleCmd({ command: 'cancel', reason: 'Cancelled from schedule' })}
                    className="h-10 px-3.5 rounded-xl bg-rose-500/15 border border-rose-400/35 text-rose-200 text-[13px] font-semibold inline-flex items-center gap-1.5 hover:bg-rose-500/25 cursor-pointer"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Cancel</span>
                  </button>
                )}
              </div>

              {/* Reschedule / Defer with target date + reason */}
              <div className="pt-2.5 border-t border-white/10 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className="flex-1 h-9 px-3 rounded-lg bg-black/30 border border-[#74A3AD]/30 text-[12.5px] text-white"
                  />
                  <button
                    type="button"
                    disabled={mutating || !rescheduleDate || rescheduleDate === activity.dateStr}
                    onClick={() =>
                      handleCmd({
                        command: 'reschedule',
                        new_date: rescheduleDate,
                        reason: deferReason.trim() || `Rescheduled to ${rescheduleDate}`,
                      })
                    }
                    className="h-9 px-3 rounded-lg bg-white/12 hover:bg-white/20 disabled:opacity-40 text-[12px] font-bold text-white cursor-pointer"
                  >
                    Reschedule
                  </button>
                  {availableCommands.includes('defer') && (
                    <button
                      type="button"
                      disabled={mutating || !rescheduleDate}
                      onClick={() =>
                        handleCmd({
                          command: 'defer',
                          new_date:
                            rescheduleDate !== activity.dateStr
                              ? rescheduleDate
                              : addDaysToDateStr(activity.dateStr, 2),
                          reason: deferReason.trim() || 'Deferred from daily queue',
                        })
                      }
                      className="h-9 px-3 rounded-lg bg-amber-500/18 border border-amber-400/40 hover:bg-amber-500/28 disabled:opacity-40 text-[12px] font-bold text-amber-200 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <PauseCircle className="w-3.5 h-3.5" />
                      <span>Defer</span>
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={deferReason}
                  onChange={(e) => setDeferReason(e.target.value)}
                  placeholder="Optional reason for audit log…"
                  className="w-full h-8 px-3 rounded-lg bg-black/25 border border-white/10 text-[12px] text-white placeholder-[#7C9BA3] focus:outline-none focus:border-[#20F69A]"
                />
              </div>
            </div>
          ) : activity.sourceType === 'crop_stage' ||
            activity.sourceType === 'rotation_stage' ||
            activity.sourceType === 'scouting_recommendation' ||
            activity.sourceType === 'soil_recommendation' ||
            activity.sourceType === 'irrigation_recommendation' ? (
            <div className="fs-cal-subcard !rounded-2xl p-4 space-y-3">
              <p className="text-[12.5px] text-[#BDD1D6]">
                {activity.sourceType === 'crop_stage' || activity.sourceType === 'rotation_stage'
                  ? "Auto-projected from your farm's crop baseline, safety schedule, and rotation plan. Track it as a canonical task to assign dates, defer, or mark complete."
                  : 'Auto-scheduled by farm safety logic based on current field, soil, water, and weather conditions. Track it as a canonical task to mark complete, defer, or reschedule.'}
              </p>
              <button
                type="button"
                disabled={mutating}
                onClick={() => onPromoteToTask(activity)}
                className="w-full h-10 rounded-xl bg-[#20F69A]/18 border border-[#20F69A]/45 text-[#5FFFC0] text-[13px] font-bold inline-flex items-center justify-center gap-2 hover:bg-[#20F69A]/28 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Track as Farm Task</span>
              </button>
            </div>
          ) : null}

          {/* Audit History Timeline */}
          {(detailLoading || auditHistory.length > 0) && (
            <div className="fs-cal-subcard !rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-[12.5px] font-bold text-[#DCECEF]">
                <History className="w-4 h-4 text-[#22F08E]" />
                <span>Task Audit History</span>
              </div>
              {detailLoading ? (
                <div className="text-[12px] text-[#8FB3BC]">Loading audit log…</div>
              ) : (
                <div className="space-y-2">
                  {auditHistory.map((aud) => (
                    <div
                      key={aud.id}
                      className="p-2.5 rounded-xl bg-black/25 border border-white/10 text-[11.5px] space-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-2 font-bold text-[#EAF4F6]">
                        <span className="capitalize">{aud.command}</span>
                        <span className="text-[10.5px] text-[#8EB3BC] tabular-nums inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(aud.occurred_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-[#AFC6CC]">{aud.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Workspace Links */}
        <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
          <Link
            to={activity.links.farm_route || `/my-farms/${activity.farmId}`}
            className="inline-flex items-center gap-1.5 text-[#5EEAD4] hover:underline font-semibold"
          >
            <span>Open Farm Detail</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
          {activity.links.report_route && (
            <Link
              to={activity.links.report_route}
              className="inline-flex items-center gap-1.5 text-[#38BDF8] hover:underline font-semibold"
            >
              <span>Intelligence Report</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          )}
          <Link
            to={activity.links.rotation_route || '/rotation'}
            className="inline-flex items-center gap-1.5 text-[#9FE8D0] hover:underline font-semibold"
          >
            <span>Rotation Planner</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 3. Day Overflow Modal (+N more)                                            */
/* -------------------------------------------------------------------------- */

interface DayOverflowModalProps {
  dateStr: string | null;
  activities: CalendarActivity[];
  onClose: () => void;
  onSelectActivity: (activity: CalendarActivity) => void;
  onAddTaskForDate: (dateStr: string) => void;
}

export const DayOverflowModal: React.FC<DayOverflowModalProps> = ({
  dateStr,
  activities,
  onClose,
  onSelectActivity,
  onAddTaskForDate,
}) => {
  if (!dateStr) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#02120F]/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fs-modal-shell w-full max-w-md rounded-[24px] p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[18px] font-extrabold text-[#F5F8FA]">
              {formatDateSubtitle(dateStr)}
            </h3>
            <p className="text-[12.5px] text-[#A8C1C7]">
              {activities.length} scheduled {activities.length === 1 ? 'activity' : 'activities'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close day agenda"
            className="p-1.5 rounded-full text-[#9DB8BF] hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-[340px] overflow-y-auto fs-thin-scroll space-y-2 pr-1">
          {activities.map((act) => (
            <button
              key={act.id}
              type="button"
              onClick={() => {
                onClose();
                onSelectActivity(act);
              }}
              className="fs-cal-subcard fs-cal-subcard-interactive w-full p-3 !rounded-xl flex items-center gap-3 text-left cursor-pointer"
            >
              <CalendarActivityThumbnail
                category={act.category}
                cropName={act.cropName}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold text-[#F3F7F9] truncate">{act.rowTitle}</div>
                <div className="text-[12px] text-[#BDD0D4] truncate">{act.subtitle}</div>
              </div>
              {act.completed && <Check className="w-4 h-4 text-[#22F08E] shrink-0" />}
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              onClose();
              onAddTaskForDate(dateStr);
            }}
            className="h-9 px-4 rounded-xl bg-[#20F69A] text-[#032719] text-[13px] font-extrabold inline-flex items-center gap-1.5 hover:brightness-105 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Task</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 4. Full Schedule & Timeline Modal (View Full Schedule ->)                  */
/* -------------------------------------------------------------------------- */

const SCHEDULE_FILTER_CATEGORIES: CalendarCategory[] = [
  'planting',
  'irrigation',
  'soil_test',
  'scouting',
  'harvest',
  'rotation_prep',
  'fertilizer',
  'analysis',
  'general',
];

interface FullScheduleModalProps {
  open: boolean;
  scopeLabel: string;
  timezoneLabel: string;
  selectedFarmId: string;
  selectedFieldId: string;
  rangeStart: string;
  rangeEnd: string;
  activities: CalendarActivity[];
  onClose: () => void;
  onSelectActivity: (activity: CalendarActivity) => void;
}

export const FullScheduleModal: React.FC<FullScheduleModalProps> = ({
  open,
  scopeLabel,
  timezoneLabel,
  selectedFarmId,
  selectedFieldId,
  rangeStart,
  rangeEnd,
  activities,
  onClose,
  onSelectActivity,
}) => {
  const [filterCat, setFilterCat] = useState<'all' | CalendarCategory>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activities.filter((act) => {
      if (filterCat !== 'all' && act.category !== filterCat) return false;
      if (
        q &&
        !act.rowTitle.toLowerCase().includes(q) &&
        !act.fieldName.toLowerCase().includes(q) &&
        !act.farmName.toLowerCase().includes(q) &&
        !act.subtitle.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [activities, filterCat, search]);

  if (!open) return null;

  const icsHref = buildCalendarIcsExportUrl({
    farmId: selectedFarmId,
    fieldId: selectedFieldId,
    startDate: rangeStart,
    endDate: rangeEnd,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#02120F]/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fs-modal-shell w-full max-w-3xl max-h-[86vh] rounded-[24px] p-6 flex flex-col gap-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CalendarDays className="w-6 h-6 text-[#22F08E]" />
            <div>
              <h2 className="text-[20px] font-extrabold text-[#F5F8FA]">
                Full Farm Schedule · {scopeLabel}
              </h2>
              <p className="text-[12.5px] text-[#A8C1C7]">
                {filtered.length} activities · Timezone: {timezoneLabel}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={icsHref}
              download
              className="fs-cal-subcard fs-cal-subcard-interactive h-9 px-3.5 !rounded-xl text-[12.5px] font-bold text-[#EAF4F6] inline-flex items-center gap-1.5"
            >
              <Download className="w-4 h-4 text-[#22F08E]" />
              <span>Export .ics</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Full Schedule"
              className="p-1.5 rounded-full text-[#9DB8BF] hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search + Category Filter inside modal */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#8BB0B8] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by farm, field, crop, or action…"
              className="w-full h-9 pl-9 pr-3 rounded-xl bg-black/30 border border-[#74A3AD]/30 text-[13px] text-white placeholder-[#7C9BA3] focus:outline-none focus:border-[#20F69A]"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setFilterCat('all')}
              className={`h-9 px-3 rounded-xl text-[12px] font-semibold cursor-pointer ${
                filterCat === 'all'
                  ? 'bg-[#20F69A] text-[#032719] font-bold'
                  : 'bg-white/[0.06] text-[#C8DCE0] hover:bg-white/[0.12]'
              }`}
            >
              All
            </button>
            {SCHEDULE_FILTER_CATEGORIES.map((catId) => (
              <button
                key={catId}
                type="button"
                onClick={() => setFilterCat(catId)}
                className={`h-9 px-2.5 rounded-xl text-[12px] font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                  filterCat === catId
                    ? 'bg-[#20F69A] text-[#032719] font-bold'
                    : 'bg-white/[0.06] text-[#C8DCE0] hover:bg-white/[0.12]'
                }`}
              >
                <CalendarCategoryGlyph category={catId} className="w-3.5 h-3.5" />
                <span>{CALENDAR_CATEGORIES[catId].label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Chronological Schedule Rows */}
        <div className="flex-1 overflow-y-auto fs-thin-scroll divide-y divide-white/10 pr-1">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-[14px] text-[#9FB8BF]">
              No activities match the current filter.
            </div>
          ) : (
            filtered.map((act) => (
              <button
                key={act.id}
                type="button"
                onClick={() => {
                  onClose();
                  onSelectActivity(act);
                }}
                className="w-full py-3 px-2 rounded-xl hover:bg-white/[0.05] flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <CalendarActivityThumbnail
                    category={act.category}
                    cropName={act.cropName}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold text-[#F3F7F9] truncate">
                      {act.rowTitle}
                    </div>
                    <div className="text-[12px] text-[#AFC6CC] truncate">
                      {act.subtitle} · {act.provenanceBasis}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[12.5px] font-bold text-[#EAF4F6] tabular-nums">
                    {act.endDate > act.startDate
                      ? formatDateWindowLabel(act.startDate, act.endDate)
                      : formatShortWeekdayDate(act.dateStr)}
                  </div>
                  <div className="text-[11px] text-[#8FB3BC]">
                    {act.statusBadge || (act.actionButtonType === 'start' ? 'Actionable' : 'Scheduled')}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
