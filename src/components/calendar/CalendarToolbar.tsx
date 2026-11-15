import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Plus,
} from 'lucide-react';
import { formatMonthYearTitle } from '../../lib/calendarEngine';
import type { CalendarConflictWarning } from '../../types/calendar';

interface CalendarToolbarProps {
  displayYear: number;
  displayMonth0: number;
  conflicts?: CalendarConflictWarning[];
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectMonthYear: (year: number, month0: number) => void;
  onJumpToday: () => void;
  onOpenAddTask: () => void;
}

const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const CalendarToolbar: React.FC<CalendarToolbarProps> = ({
  displayYear,
  displayMonth0,
  conflicts = [],
  onPrevMonth,
  onNextMonth,
  onSelectMonthYear,
  onJumpToday,
  onOpenAddTask,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(displayYear);
  const pickerRef = useRef<HTMLDivElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPickerYear(displayYear);
  }, [displayYear]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
      if (conflictRef.current && !conflictRef.current.contains(e.target as Node)) {
        setConflictOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  return (
    <section
      aria-label="Calendar navigation and task creation"
      className="fs-cal-panel relative z-30 !rounded-[22px] px-3.5 sm:px-5 py-3 lg:h-[82px] flex flex-wrap lg:flex-nowrap items-center justify-between gap-3"
    >
      {/* Left Cluster: Prev/Next Arrows + Month/Year Selector */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 min-w-0">
        {/* Prev / Next Month Buttons */}
        <div className="fs-cal-subcard h-[48px] sm:h-[52px] !rounded-[13px] flex items-center overflow-hidden shrink-0">
          <button
            type="button"
            onClick={onPrevMonth}
            aria-label="Previous month"
            className="w-[52px] sm:w-[64px] h-full flex items-center justify-center text-[#EDF4F7] hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={2.4} />
          </button>
          <span
            aria-hidden="true"
            className="w-px h-7 bg-[#38BDCE]/30 shrink-0"
          />
          <button
            type="button"
            onClick={onNextMonth}
            aria-label="Next month"
            className="w-[52px] sm:w-[64px] h-full flex items-center justify-center text-[#EDF4F7] hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" strokeWidth={2.4} />
          </button>
        </div>

        {/* Month & Year Picker */}
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            className="fs-cal-subcard fs-cal-subcard-interactive h-[48px] sm:h-[52px] px-4 sm:px-5 !rounded-[13px] flex items-center gap-3 cursor-pointer"
          >
            <CalendarDays
              className="w-5 h-5 sm:w-6 sm:h-6 text-[#22F08E] shrink-0"
              style={{ filter: 'drop-shadow(0 0 8px rgba(34, 240, 142, 0.45))' }}
              strokeWidth={2}
            />
            <span className="text-[17px] sm:text-[20px] font-bold text-[#F3F7F9] whitespace-nowrap">
              {formatMonthYearTitle(displayYear, displayMonth0)}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-[#C6D8DE] transition-transform duration-200 ${
                pickerOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {pickerOpen && (
            <div
              className="fs-cal-panel absolute left-0 top-[58px] z-50 w-[280px] !rounded-[18px] p-4 shadow-2xl space-y-3"
              style={{ backgroundColor: 'rgba(6, 26, 36, 0.96)' }}
            >
              {/* Year Stepper */}
              <div className="flex items-center justify-between px-1">
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y - 1)}
                  aria-label="Previous year"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#D6E6EA] hover:bg-white/10 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[15px] font-bold text-[#F5F8FA] tabular-nums">
                  {pickerYear}
                </span>
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y + 1)}
                  aria-label="Next year"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#D6E6EA] hover:bg-white/10 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* 3x4 Month Grid */}
              <div className="grid grid-cols-3 gap-1.5">
                {MONTH_SHORT_NAMES.map((mLabel, idx) => {
                  const active = idx === displayMonth0 && pickerYear === displayYear;
                  return (
                    <button
                      key={mLabel}
                      type="button"
                      onClick={() => {
                        onSelectMonthYear(pickerYear, idx);
                        setPickerOpen(false);
                      }}
                      className={`h-9 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#20F69A] text-[#032719] font-bold'
                          : 'bg-white/[0.05] text-[#D7E6E9] hover:bg-white/[0.12]'
                      }`}
                    >
                      {mLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Factual Conflict Indicator Pill (only when overlaps/gaps exist) */}
        {conflicts.length > 0 && (
          <div className="relative" ref={conflictRef}>
            <button
              type="button"
              onClick={() => setConflictOpen((v) => !v)}
              className="h-[40px] px-3 rounded-xl bg-amber-500/15 border border-amber-400/45 text-amber-200 text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-amber-500/25 transition-colors cursor-pointer"
            >
              <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
              <span>
                {conflicts.length} {conflicts.length === 1 ? 'Conflict' : 'Conflicts'}
              </span>
            </button>

            {conflictOpen && (
              <div
                className="fs-cal-panel absolute left-0 top-[48px] z-50 w-[330px] !rounded-[18px] p-3.5 shadow-2xl space-y-2"
                style={{ backgroundColor: 'rgba(6, 26, 36, 0.96)' }}
              >
                <div className="text-[12px] font-bold uppercase tracking-wider text-amber-300">
                  Schedule Conflict Warnings
                </div>
                <div className="space-y-2 max-h-[220px] overflow-y-auto fs-thin-scroll">
                  {conflicts.map((c) => (
                    <div
                      key={c.id}
                      className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-400/25 text-[12px] text-amber-100 leading-snug"
                    >
                      {c.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Cluster: Today Button + Primary + Add Task CTA */}
      <div className="flex items-center gap-3 sm:gap-4 ml-auto">
        <button
          type="button"
          onClick={onJumpToday}
          className="fs-cal-subcard fs-cal-subcard-interactive h-[48px] sm:h-[52px] px-4 sm:px-5 !rounded-[13px] flex items-center gap-2.5 text-[15px] sm:text-[16px] font-bold text-[#EEF4F6] cursor-pointer"
        >
          <Crosshair className="w-4 h-4 sm:w-5 sm:h-5 text-[#E8F2F4]" strokeWidth={2.2} />
          <span>Today</span>
        </button>

        <button
          type="button"
          onClick={onOpenAddTask}
          className="h-[48px] sm:h-[52px] px-5 sm:px-6 rounded-[13px] flex items-center gap-2 text-[15.5px] sm:text-[17px] font-extrabold text-[#032719] bg-gradient-to-b from-[#39F5A0] to-[#12D77A] hover:-translate-y-0.5 hover:brightness-105 transition-all cursor-pointer shrink-0"
          style={{
            boxShadow: '0 6px 24px rgba(32, 246, 154, 0.34)',
          }}
        >
          <Plus className="w-5 h-5 text-[#032719]" strokeWidth={2.8} />
          <span>Add Task</span>
        </button>
      </div>
    </section>
  );
};
