import React from 'react';
import {
  CALENDAR_CATEGORIES,
  CalendarActivity,
  MonthGridCell,
} from '../../lib/calendarEngine';
import { CalendarCategoryGlyph } from './CalendarCategoryGlyph';

interface MonthlyCalendarGridProps {
  cells: MonthGridCell[];
  activitiesByDate: Map<string, CalendarActivity[]>;
  todayStr: string;
  selectedDateStr: string;
  onSelectDate: (dateStr: string) => void;
  onSelectActivity: (activity: CalendarActivity) => void;
  onOpenDayOverflow: (dateStr: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MonthlyCalendarGrid: React.FC<MonthlyCalendarGridProps> = ({
  cells,
  activitiesByDate,
  todayStr,
  selectedDateStr,
  onSelectDate,
  onSelectActivity,
  onOpenDayOverflow,
}) => {
  return (
    <div className="fs-cal-panel !rounded-[24px] overflow-hidden flex flex-col">
      {/* Horizontal scroll wrapper for narrow viewports so 7 columns stay legible */}
      <div className="overflow-x-auto fs-thin-scroll flex-1 flex flex-col">
        <div className="min-w-[660px] flex-1 flex flex-col">
          {/* Weekday Column Headers */}
          <div className="grid grid-cols-7 border-b border-[#38BDCE]/25 bg-white/[0.025]">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="h-[48px] sm:h-[52px] flex items-center justify-center text-[14px] sm:text-[15.5px] font-semibold text-[#EDF4F7] tracking-wide"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Month Day Cells */}
          <div className="grid grid-cols-7 flex-1 auto-rows-[minmax(144px,1fr)] xl:auto-rows-[minmax(158px,1fr)]">
            {cells.map((cell, idx) => {
              const dayItems = activitiesByDate.get(cell.dateStr) ?? [];
              const growingCrops = dayItems.filter((a) => a.sourceType === 'crop_stage');
              const actionItems = dayItems.filter((a) => a.sourceType !== 'crop_stage');

              // Show every field's crop clearly on every day cell (up to 3 distinct field-crops individually)
              const visibleCropChips =
                growingCrops.length <= 3 ? growingCrops : growingCrops.slice(0, 2);
              const hiddenCropCount = Math.max(0, growingCrops.length - visibleCropChips.length);

              const maxActionSlots = visibleCropChips.length <= 1 ? 3 : 2;
              const visibleActions = actionItems.slice(0, maxActionSlots);
              const overflowCount = Math.max(0, actionItems.length - visibleActions.length);

              const cropMeta = CALENDAR_CATEGORIES.planting;
              const multiCropTooltip = growingCrops
                .map((c) => `${c.farmName}: ${c.cropName || c.title} (${c.fieldName})`)
                .join(' • ');

              const isToday = cell.dateStr === todayStr;
              const isSelected = cell.dateStr === selectedDateStr;
              const isLastCol = (idx + 1) % 7 === 0;
              const isLastRow = idx >= cells.length - 7;

              return (
                <div
                  key={cell.dateStr}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectDate(cell.dateStr)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectDate(cell.dateStr);
                    }
                  }}
                  aria-label={`${cell.dateStr}${isToday ? ', Today' : ''}, ${growingCrops.length} growing crops, ${actionItems.length} scheduled actions`}
                  aria-pressed={isSelected}
                  className={`relative p-2 sm:p-2.5 flex flex-col justify-start gap-1.5 text-left transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#20F69A] ${
                    !isLastCol ? 'border-r border-[#38BDCE]/22' : ''
                  } ${!isLastRow ? 'border-b border-[#38BDCE]/22' : ''} ${
                    isToday
                      ? 'z-10 rounded-[10px]'
                      : isSelected
                        ? 'bg-[#0E4350]/55 ring-2 ring-inset ring-[#38BDF8]/80 z-[5]'
                        : cell.inCurrentMonth
                          ? 'hover:bg-white/[0.04]'
                          : 'bg-black/15 hover:bg-white/[0.03]'
                  }`}
                  style={
                    isToday
                      ? {
                          border: '2px solid #20F69A',
                          background:
                            'linear-gradient(155deg, rgba(16, 99, 69, 0.54) 0%, rgba(11, 61, 47, 0.68) 100%)',
                          boxShadow:
                            '0 0 24px rgba(32, 246, 154, 0.24), inset 0 0 18px rgba(32, 246, 154, 0.14)',
                        }
                      : undefined
                  }
                >
                  {/* Top Row: Day Number + Today Pill */}
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span
                      className={`text-[16px] sm:text-[18px] font-bold tabular-nums leading-none ${
                        isToday
                          ? 'text-[#FFFFFF]'
                          : cell.inCurrentMonth
                            ? 'text-[#EEF4F7]'
                            : 'text-[#6A868E]'
                      }`}
                    >
                      {cell.dayNumber}
                    </span>

                    {isToday && (
                      <span className="px-2 py-0.5 rounded-full bg-[#22EE8E] text-[#053521] text-[10.5px] font-extrabold leading-tight shadow-[0_0_10px_rgba(34,238,142,0.5)]">
                        Today
                      </span>
                    )}
                  </div>

                  {/* Daily Growing Crops Strip (Every field per farm shown cleanly) */}
                  <div className="flex flex-col gap-1 w-full min-w-0">
                    {visibleCropChips.map((cropAct) => (
                      <button
                        key={`${cell.dateStr}:${cropAct.id}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectDate(cell.dateStr);
                          onSelectActivity(cropAct);
                        }}
                        title={`${cropAct.farmName}: ${cropAct.rowTitle}`}
                        className="w-full rounded-[7px] px-1.5 py-0.5 min-h-[22px] flex items-center gap-1 text-left transition-all hover:brightness-115 cursor-pointer border"
                        style={{
                          background: cropMeta.chipBg,
                          borderColor: cropMeta.chipBorder,
                          color: cropMeta.chipText,
                        }}
                      >
                        <CalendarCategoryGlyph
                          category="planting"
                          className="w-3 h-3 shrink-0"
                        />
                        <span className="text-[10.5px] font-semibold leading-[1.15] truncate min-w-0">
                          {cropAct.chipLabel}
                        </span>
                      </button>
                    ))}

                    {hiddenCropCount > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectDate(cell.dateStr);
                          onOpenDayOverflow(cell.dateStr);
                        }}
                        title={multiCropTooltip}
                        className="w-full rounded-[7px] px-1.5 py-0.5 min-h-[20px] flex items-center justify-between gap-1 text-left transition-all hover:brightness-115 cursor-pointer border"
                        style={{
                          background: 'rgba(14, 62, 36, 0.72)',
                          borderColor: cropMeta.chipBorder,
                          color: '#A7F3D0',
                        }}
                      >
                        <span className="text-[10px] font-semibold truncate">
                          +{hiddenCropCount} more growing field{hiddenCropCount > 1 ? 's' : ''}
                        </span>
                        <span className="text-[9.5px] font-bold shrink-0 tabular-nums">
                          {growingCrops.length}
                        </span>
                      </button>
                    )}

                    {/* Scheduled Action / Auto-Planned Safety Task Chips */}
                    {visibleActions.map((act) => {
                      const meta = CALENDAR_CATEGORIES[act.category];
                      return (
                        <button
                          key={`${cell.dateStr}:${act.id}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectDate(cell.dateStr);
                            onSelectActivity(act);
                          }}
                          title={`${act.rowTitle} — ${act.subtitle}`}
                          className={`w-full rounded-[8px] px-2 py-1 min-h-[28px] flex items-center gap-1.5 text-left transition-all hover:brightness-115 cursor-pointer border ${
                            act.completed && !isToday ? 'opacity-80' : ''
                          }`}
                          style={{
                            background: meta.chipBg,
                            borderColor:
                              act.priority === 'high' && !act.completed
                                ? '#F59E0B'
                                : meta.chipBorder,
                            color: meta.chipText,
                          }}
                        >
                          <CalendarCategoryGlyph
                            category={act.category}
                            className="w-3.5 h-3.5 shrink-0"
                          />
                          <span
                            className={`text-[10.5px] font-semibold leading-[1.2] line-clamp-1 min-w-0 ${
                              act.completed && act.sourceType === 'task' ? 'line-through opacity-75' : ''
                            }`}
                          >
                            {act.chipLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* +N more overflow link */}
                  {overflowCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDate(cell.dateStr);
                        onOpenDayOverflow(cell.dateStr);
                      }}
                      className="mt-auto pt-0.5 text-left text-[10.5px] font-bold text-[#DCECEF] hover:text-[#22EE8E] transition-colors cursor-pointer"
                    >
                      +{overflowCount} more task{overflowCount > 1 ? 's' : ''}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
