import type {
  CalendarEventLinks,
  CalendarEventType,
  CalendarProjectionEvent,
  CalendarProvenanceBasis,
  CalendarSourceType,
} from '../types/calendar';
import type { FarmTaskItem } from '../types/myFarms';

export type CalendarCategory =
  | 'planting'
  | 'irrigation'
  | 'soil_test'
  | 'scouting'
  | 'harvest'
  | 'rotation_prep'
  | 'fertilizer'
  | 'analysis'
  | 'general';

export type CalendarStatusBadge =
  | 'In Progress'
  | 'High Priority'
  | 'Due Today'
  | 'Completed'
  | 'Scheduled'
  | 'Observed'
  | 'Deferred'
  | 'Stale';

export interface CalendarActivity {
  id: string;
  farmId: string;
  farmName: string;
  fieldId: string | null;
  fieldName: string;
  shortFieldLabel: string;
  cropName: string | null;
  title: string;
  chipLabel: string;
  rowTitle: string;
  subtitle: string;
  upcomingTitle: string;
  category: CalendarCategory;
  dateStr: string;
  startDate: string;
  endDate: string;
  timezone: string;
  priority: 'high' | 'normal' | 'low';
  statusBadge: CalendarStatusBadge | null;
  actionButtonType: 'start' | null;
  completed: boolean;
  sourceType: CalendarSourceType;
  sourceId: string | null;
  provenanceBasis: CalendarProvenanceBasis;
  plannedDate: string | null;
  actualDate: string | null;
  stageBreakdown: { ini: number; dev: number; mid: number; late: number } | null;
  notes: string;
  detailBullets: string[];
  links: CalendarEventLinks;
  cropImageKey?: string | null;
}

export interface CalendarCategoryMeta {
  id: CalendarCategory;
  label: string;
  backendCategory: FarmTaskItem['category'];
  accentHex: string;
  chipBg: string;
  chipBorder: string;
  chipText: string;
  tileBg: string;
  tileBorder: string;
}

export const CALENDAR_CATEGORIES: Record<CalendarCategory, CalendarCategoryMeta> = {
  planting: {
    id: 'planting',
    label: 'Planting / Crop Growth',
    backendCategory: 'planting',
    accentHex: '#35D96D',
    chipBg: 'rgba(18, 78, 43, 0.88)',
    chipBorder: 'rgba(53, 217, 109, 0.40)',
    chipText: '#ECFBF0',
    tileBg: 'linear-gradient(145deg, rgba(22, 86, 48, 0.92), rgba(11, 46, 26, 0.96))',
    tileBorder: 'rgba(53, 217, 109, 0.42)',
  },
  irrigation: {
    id: 'irrigation',
    label: 'Irrigation',
    backendCategory: 'irrigation',
    accentHex: '#26B9F4',
    chipBg: 'rgba(13, 59, 92, 0.88)',
    chipBorder: 'rgba(38, 185, 244, 0.44)',
    chipText: '#E8F7FF',
    tileBg: 'linear-gradient(145deg, rgba(16, 70, 110, 0.92), rgba(9, 39, 64, 0.96))',
    tileBorder: 'rgba(38, 185, 244, 0.44)',
  },
  soil_test: {
    id: 'soil_test',
    label: 'Soil Test',
    backendCategory: 'soil',
    accentHex: '#F49A31',
    chipBg: 'rgba(79, 53, 22, 0.90)',
    chipBorder: 'rgba(244, 154, 49, 0.45)',
    chipText: '#FFF5E8',
    tileBg: 'linear-gradient(145deg, rgba(92, 57, 20, 0.92), rgba(50, 31, 12, 0.96))',
    tileBorder: 'rgba(244, 154, 49, 0.45)',
  },
  scouting: {
    id: 'scouting',
    label: 'Scouting',
    backendCategory: 'scouting',
    accentHex: '#B46BFA',
    chipBg: 'rgba(49, 36, 80, 0.90)',
    chipBorder: 'rgba(180, 107, 250, 0.45)',
    chipText: '#F4ECFF',
    tileBg: 'linear-gradient(145deg, rgba(64, 42, 106, 0.92), rgba(34, 22, 58, 0.96))',
    tileBorder: 'rgba(180, 107, 250, 0.44)',
  },
  harvest: {
    id: 'harvest',
    label: 'Harvest Window',
    backendCategory: 'harvest',
    accentHex: '#F4AE24',
    chipBg: 'rgba(74, 56, 20, 0.90)',
    chipBorder: 'rgba(244, 174, 36, 0.45)',
    chipText: '#FFF7E4',
    tileBg: 'linear-gradient(145deg, rgba(84, 62, 18, 0.92), rgba(46, 34, 10, 0.96))',
    tileBorder: 'rgba(244, 174, 36, 0.44)',
  },
  rotation_prep: {
    id: 'rotation_prep',
    label: 'Rotation Prep',
    backendCategory: 'rotation',
    accentHex: '#43D95A',
    chipBg: 'rgba(19, 74, 41, 0.88)',
    chipBorder: 'rgba(67, 217, 90, 0.42)',
    chipText: '#ECFBEE',
    tileBg: 'linear-gradient(145deg, rgba(20, 78, 42, 0.92), rgba(10, 44, 24, 0.96))',
    tileBorder: 'rgba(67, 217, 90, 0.42)',
  },
  fertilizer: {
    id: 'fertilizer',
    label: 'Fertilizer / Nutrition',
    backendCategory: 'fertilizer',
    accentHex: '#2DD4BF',
    chipBg: 'rgba(14, 72, 74, 0.90)',
    chipBorder: 'rgba(45, 212, 191, 0.45)',
    chipText: '#E9FFFC',
    tileBg: 'linear-gradient(145deg, rgba(16, 84, 82, 0.92), rgba(8, 46, 48, 0.96))',
    tileBorder: 'rgba(45, 212, 191, 0.45)',
  },
  analysis: {
    id: 'analysis',
    label: 'Deep Analysis',
    backendCategory: 'general',
    accentHex: '#38BDF8',
    chipBg: 'rgba(17, 54, 84, 0.90)',
    chipBorder: 'rgba(56, 189, 248, 0.44)',
    chipText: '#E8F6FF',
    tileBg: 'linear-gradient(145deg, rgba(20, 62, 98, 0.92), rgba(10, 34, 58, 0.96))',
    tileBorder: 'rgba(56, 189, 248, 0.44)',
  },
  general: {
    id: 'general',
    label: 'Farm Operation',
    backendCategory: 'general',
    accentHex: '#22F08E',
    chipBg: 'rgba(16, 66, 52, 0.90)',
    chipBorder: 'rgba(34, 240, 142, 0.42)',
    chipText: '#EAFFF5',
    tileBg: 'linear-gradient(145deg, rgba(18, 78, 58, 0.92), rgba(9, 44, 34, 0.96))',
    tileBorder: 'rgba(34, 240, 142, 0.42)',
  },
};

export function mapProjectionTypeToCategory(t: CalendarEventType): CalendarCategory {
  switch (t) {
    case 'crop_stage':
    case 'planting':
      return 'planting';
    case 'irrigation':
      return 'irrigation';
    case 'soil_test':
      return 'soil_test';
    case 'scouting':
      return 'scouting';
    case 'harvest':
      return 'harvest';
    case 'rotation_prep':
      return 'rotation_prep';
    case 'fertilizer':
      return 'fertilizer';
    case 'analysis':
      return 'analysis';
    default:
      return 'general';
  }
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseDateStr(dateStr: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

export function toDateStr(year: number, month1: number, day: number): string {
  const dt = new Date(Date.UTC(year, month1 - 1, day, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function addDaysToDateStr(dateStr: string, deltaDays: number): string {
  const { year, month, day } = parseDateStr(dateStr);
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function getTodayDateStrInTimezone(timezone?: string | null): string {
  const now = new Date();
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const y = parts.find((p) => p.type === 'year')?.value;
      const m = parts.find((p) => p.type === 'month')?.value;
      const d = parts.find((p) => p.type === 'day')?.value;
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      // Fallback to local time if timezone identifier is invalid
    }
  }
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export interface MonthGridCell {
  dateStr: string;
  dayNumber: number;
  inCurrentMonth: boolean;
}

export function getMonthGridCells(year: number, monthIndex0: number): MonthGridCell[] {
  const firstDayDow = new Date(Date.UTC(year, monthIndex0, 1, 12, 0, 0)).getUTCDay(); // 0 = Sun
  const daysInMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0, 12, 0, 0)).getUTCDate();
  const totalSlots = firstDayDow + daysInMonth <= 35 ? 35 : 42;
  const cells: MonthGridCell[] = [];

  for (let idx = 0; idx < totalSlots; idx++) {
    const dayOffset = idx - firstDayDow + 1;
    const dt = new Date(Date.UTC(year, monthIndex0, dayOffset, 12, 0, 0));
    const cellYear = dt.getUTCFullYear();
    const cellMonth0 = dt.getUTCMonth();
    const cellDay = dt.getUTCDate();
    cells.push({
      dateStr: `${cellYear}-${pad2(cellMonth0 + 1)}-${pad2(cellDay)}`,
      dayNumber: cellDay,
      inCurrentMonth: cellYear === year && cellMonth0 === monthIndex0,
    });
  }
  return cells;
}

export function formatMonthYearTitle(year: number, monthIndex0: number): string {
  const dt = new Date(Date.UTC(year, monthIndex0, 15, 12, 0, 0));
  return dt.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateSubtitle(dateStr: string): string {
  const { year, month, day } = parseDateStr(dateStr);
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatShortWeekdayDate(dateStr: string): string {
  const { year, month, day } = parseDateStr(dateStr);
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateWindowLabel(startDate: string, endDate: string): string {
  if (!endDate || endDate <= startDate) {
    return formatShortWeekdayDate(startDate);
  }
  const s = parseDateStr(startDate);
  const e = parseDateStr(endDate);
  const sDt = new Date(Date.UTC(s.year, s.month - 1, s.day, 12, 0, 0));
  const eDt = new Date(Date.UTC(e.year, e.month - 1, e.day, 12, 0, 0));
  const sMonth = sDt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const eMonth = eDt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  if (sMonth === eMonth && s.year === e.year) {
    return `${sMonth} ${s.day}–${e.day}`;
  }
  return `${sMonth} ${s.day} – ${eMonth} ${e.day}`;
}

function makeShortFieldLabel(fieldName?: string | null): string {
  if (!fieldName || fieldName === 'Whole Farm') return 'Whole Farm';
  const match = /\b(\d+)\b/.exec(fieldName);
  if (match) return `Field ${match[1].padStart(2, '0')}`;
  return fieldName.length > 16 ? `${fieldName.slice(0, 14).trim()}…` : fieldName;
}

export function projectionToCalendarActivity(
  evt: CalendarProjectionEvent,
  todayStr: string,
  includeFarmInLabel = false
): CalendarActivity {
  const category = mapProjectionTypeToCategory(evt.event_type);
  const shortField = makeShortFieldLabel(evt.field_name);
  const farmTag = includeFarmInLabel ? ` · ${evt.farm_name}` : '';

  let statusBadge: CalendarStatusBadge | null = null;
  if (evt.status === 'stale') {
    statusBadge = 'Stale';
  } else if (evt.status === 'deferred') {
    statusBadge = 'Deferred';
  } else if (evt.date_basis === 'Observed') {
    statusBadge = 'Observed';
  } else if (evt.completed || evt.status === 'completed') {
    statusBadge = 'Completed';
  } else if (evt.action_button_type === 'start') {
    statusBadge = null;
  } else if (evt.source_type === 'crop_stage') {
    statusBadge = 'In Progress';
  } else if (evt.priority === 'high') {
    statusBadge = 'High Priority';
  } else if (evt.start_date === todayStr) {
    statusBadge = 'Due Today';
  } else {
    statusBadge = 'Scheduled';
  }

  return {
    id: evt.event_id,
    farmId: evt.farm_id,
    farmName: evt.farm_name,
    fieldId: evt.field_id,
    fieldName: evt.field_name,
    shortFieldLabel: includeFarmInLabel ? `${shortField} (${evt.farm_name})` : shortField,
    cropName: evt.crop_name,
    title: evt.title,
    chipLabel: `${evt.title}${farmTag}`,
    rowTitle: `${evt.title}${farmTag}`,
    subtitle: evt.subtitle,
    upcomingTitle: evt.title.split(' - ')[0],
    category,
    dateStr: evt.start_date,
    startDate: evt.start_date,
    endDate: evt.end_date,
    timezone: evt.timezone,
    priority: evt.priority || 'normal',
    statusBadge,
    actionButtonType: evt.action_button_type,
    completed: evt.completed,
    sourceType: evt.source_type,
    sourceId: evt.source_id,
    provenanceBasis: evt.date_basis,
    plannedDate: evt.planned_date ?? null,
    actualDate: evt.actual_date ?? null,
    stageBreakdown: evt.stage_breakdown ?? null,
    notes: evt.description,
    detailBullets: evt.evidence,
    links: evt.links,
    cropImageKey: evt.crop_name,
  };
}

export function computeCropStageForDate(
  act: CalendarActivity,
  targetDateStr: string
): string {
  if (!act.stageBreakdown) return act.subtitle;
  const s = parseDateStr(act.startDate);
  const t = parseDateStr(targetDateStr);
  const startMs = Date.UTC(s.year, s.month - 1, s.day, 12, 0, 0);
  const targetMs = Date.UTC(t.year, t.month - 1, t.day, 12, 0, 0);
  const dayNum = Math.max(1, Math.floor((targetMs - startMs) / 86400000) + 1);
  const { ini, dev, mid, late } = act.stageBreakdown;
  const total = ini + dev + mid + late;
  const clampedDay = Math.min(dayNum, total);

  let phase = 'Emergence / Establishment';
  if (dayNum > ini + dev + mid) {
    phase = 'Ripening & Harvest Readiness';
  } else if (dayNum > ini + dev) {
    phase = 'Mid-Season Canopy Peak';
  } else if (dayNum > ini) {
    const cropLower = (act.cropName || '').toLowerCase();
    phase =
      cropLower.includes('wheat') || cropLower.includes('barley') || cropLower.includes('oat')
        ? 'Vegetative / Tillering'
        : 'Vegetative Canopy Growth';
  }

  return `Day ${clampedDay} of ${total} · ${phase}`;
}
