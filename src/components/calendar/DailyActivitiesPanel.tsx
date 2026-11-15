import React from 'react';
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Plus,
  Sprout,
  TrendingUp,
} from 'lucide-react';
import {
  CalendarActivity,
  CalendarStatusBadge,
  computeCropStageForDate,
  formatDateSubtitle,
  formatDateWindowLabel,
  formatShortWeekdayDate,
} from '../../lib/calendarEngine';
import {
  CalendarActivityThumbnail,
  CalendarCategoryGlyph,
} from './CalendarCategoryGlyph';

interface DailyActivitiesPanelProps {
  selectedDateStr: string;
  todayStr: string;
  dayActivities: CalendarActivity[];
  upcomingActivities: CalendarActivity[];
  onSelectActivity: (activity: CalendarActivity) => void;
  onStartActivity: (activity: CalendarActivity) => void;
  onJumpToActivityDate: (activity: CalendarActivity) => void;
  onOpenAddTaskForDate: (dateStr: string) => void;
  onOpenFullSchedule: () => void;
}

function StatusBadgePill({ status }: { status: CalendarStatusBadge | null }) {
  if (!status) return null;

  let classes = 'bg-white/12 text-[#E2EEF1]';
  if (status === 'In Progress') {
    classes = 'bg-[#1D8F41] text-white';
  } else if (status === 'High Priority') {
    classes = 'bg-[#6F43DF] text-white';
  } else if (status === 'Due Today') {
    classes = 'bg-[#C48212] text-white';
  } else if (status === 'Completed') {
    classes = 'bg-[#145334] text-[#8CF5B9] border border-[#22F08E]/30';
  } else if (status === 'Observed') {
    classes = 'bg-[#124B66] text-[#9EE2FF] border border-[#38BDF8]/30';
  } else if (status === 'Deferred') {
    classes = 'bg-[#4E3B16] text-[#FDE68A] border border-amber-400/35';
  } else if (status === 'Stale') {
    classes = 'bg-[#5A2D18] text-[#FED7AA] border border-orange-400/35';
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold leading-tight mt-1.5 ${classes}`}
    >
      {status}
    </span>
  );
}

export const DailyActivitiesPanel: React.FC<DailyActivitiesPanelProps> = ({
  selectedDateStr,
  todayStr,
  dayActivities,
  upcomingActivities,
  onSelectActivity,
  onStartActivity,
  onJumpToActivityDate,
  onOpenAddTaskForDate,
  onOpenFullSchedule,
}) => {
  const isTodaySelected = selectedDateStr === todayStr;
  const growingCrops = dayActivities.filter((a) => a.sourceType === 'crop_stage');
  const scheduledActions = dayActivities.filter((a) => a.sourceType !== 'crop_stage');

  return (
    <aside
      aria-label="Selected day activities and upcoming schedule"
      className="fs-cal-panel !rounded-[24px] p-5 flex flex-col justify-between gap-4"
    >
      {/* Top Section: Header + Growing Crops + Daily Scheduled Activities */}
      <div className="flex flex-col min-w-0">
        {/* Panel Title */}
        <div className="flex items-start gap-3 pb-3.5 border-b border-[#38BDCE]/25">
          <CalendarDays
            className="w-7 h-7 text-[#22F08E] shrink-0 mt-0.5"
            style={{ filter: 'drop-shadow(0 0 8px rgba(34, 240, 142, 0.45))' }}
            strokeWidth={2}
          />
          <div className="min-w-0">
            <h2 className="text-[19px] sm:text-[21px] font-extrabold text-[#F3F7F9] leading-tight">
              {isTodaySelected ? "Today's Activities" : 'Selected Day'}
            </h2>
            <p className="text-[13.5px] text-[#C5D5D9] mt-0.5">
              {formatDateSubtitle(selectedDateStr)}
            </p>
          </div>
        </div>

        {/* Scrollable Daily Content */}
        <div className="max-h-[455px] overflow-y-auto fs-thin-scroll pr-0.5 space-y-3 pt-3">
          {/* Growing Crops on Selected Day */}
          {growingCrops.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-[#8CEFB9]">
                  <Sprout className="w-3.5 h-3.5 text-[#22F08E]" />
                  <span>Growing Crops ({growingCrops.length})</span>
                </div>
              </div>

              <div className="space-y-2">
                {growingCrops.map((cropAct) => {
                  const stageLabel = computeCropStageForDate(cropAct, selectedDateStr);
                  return (
                    <div
                      key={cropAct.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectActivity(cropAct)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectActivity(cropAct);
                        }
                      }}
                      className="fs-cal-subcard fs-cal-subcard-interactive p-2.5 !rounded-xl flex items-center gap-3 cursor-pointer"
                    >
                      <CalendarActivityThumbnail
                        category="planting"
                        cropName={cropAct.cropName}
                        size="sm"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-bold text-[#F3F7F9] leading-snug truncate">
                          {cropAct.rowTitle}
                        </div>
                        <div className="text-[11.5px] text-[#BCE6D0] truncate mt-0.5">
                          {stageLabel}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#A7D3BE] shrink-0" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Scheduled Actions / Tasks */}
          {scheduledActions.length === 0 ? (
            <div className="py-6 px-3 text-center space-y-2.5 rounded-xl bg-white/[0.025] border border-white/[0.06]">
              <p className="text-[13px] text-[#B8CCD1]">
                {growingCrops.length > 0
                  ? 'No extra tasks scheduled for this date.'
                  : 'No activities scheduled for this date.'}
              </p>
              <button
                type="button"
                onClick={() => onOpenAddTaskForDate(selectedDateStr)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#20F69A]/16 border border-[#20F69A]/40 text-[#5FFFC0] text-[12.5px] font-bold hover:bg-[#20F69A]/25 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add a task</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[#38BDCE]/20">
              {scheduledActions.map((act) => (
                <div
                  key={act.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectActivity(act)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectActivity(act);
                    }
                  }}
                  className="py-3 flex items-center gap-3.5 group cursor-pointer hover:bg-white/[0.045] -mx-2 px-2 rounded-xl transition-colors"
                >
                  <CalendarActivityThumbnail
                    category={act.category}
                    cropName={act.cropName}
                  />

                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-[15px] font-bold text-[#F3F7F9] leading-snug truncate ${
                        act.completed && act.sourceType === 'task' ? 'line-through opacity-75' : ''
                      }`}
                    >
                      {act.rowTitle}
                    </div>
                    <div className="text-[12.5px] text-[#BDD0D4] truncate mt-0.5">
                      {act.subtitle}
                    </div>
                    {act.actionButtonType !== 'start' && (
                      <StatusBadgePill status={act.statusBadge} />
                    )}
                  </div>

                  {act.actionButtonType === 'start' ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartActivity(act);
                      }}
                      className="h-[34px] px-3 rounded-[10px] bg-gradient-to-b from-[#1EA7FF] to-[#0B7EE8] text-white text-[13px] font-bold inline-flex items-center gap-1 shrink-0 hover:brightness-110 transition-all cursor-pointer"
                      style={{
                        boxShadow: '0 4px 14px rgba(24, 144, 255, 0.35)',
                      }}
                    >
                      <span>Start</span>
                      <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
                    </button>
                  ) : (
                    <ChevronRight className="w-4 h-4 text-[#C2D4D9] group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Section: Next 7 Days + Full Schedule Button */}
      <div className="pt-3.5 border-t border-[#38BDCE]/25 space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[#22F08E] shrink-0" strokeWidth={2.2} />
          <h3 className="text-[17px] font-extrabold text-[#F3F7F9]">Next 7 Days</h3>
        </div>

        {upcomingActivities.length === 0 ? (
          <p className="text-[12.5px] text-[#9FB8BF] py-1">
            No upcoming actions queued in the next 7 days.
          </p>
        ) : (
          <div className="space-y-2">
            {upcomingActivities.map((act) => (
              <button
                key={act.id}
                type="button"
                onClick={() => onJumpToActivityDate(act)}
                className="w-full flex items-center justify-between gap-3 py-1.5 px-2 -mx-2 rounded-xl hover:bg-white/[0.06] text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <CalendarCategoryGlyph
                    category={act.category}
                    className="w-5 h-5 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold text-[#EEF4F6] truncate">
                      {act.upcomingTitle}
                    </div>
                    <div className="text-[12px] text-[#A8C0C6] truncate">
                      {act.shortFieldLabel}
                    </div>
                  </div>
                </div>
                <span className="text-[12px] font-semibold text-[#CBDCE0] whitespace-nowrap tabular-nums shrink-0">
                  {act.endDate && act.endDate > act.startDate
                    ? formatDateWindowLabel(act.startDate, act.endDate)
                    : formatShortWeekdayDate(act.dateStr)}
                </span>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onOpenFullSchedule}
          className="fs-cal-subcard fs-cal-subcard-interactive w-full h-[46px] !rounded-[13px] flex items-center justify-center gap-2 text-[14.5px] font-bold text-[#EFF6F8] cursor-pointer"
        >
          <span>View Full Schedule</span>
          <ArrowRight className="w-4 h-4" strokeWidth={2.3} />
        </button>
      </div>
    </aside>
  );
};
