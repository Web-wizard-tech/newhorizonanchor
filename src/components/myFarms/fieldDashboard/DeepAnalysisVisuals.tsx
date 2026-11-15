import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart2,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  CloudRain,
  Download,
  Droplets,
  FileText,
  GitCompare,
  Layers,
  Leaf,
  RefreshCw,
  Satellite,
  ShieldAlert,
  Sparkles,
  Sprout,
  Thermometer,
  X,
} from 'lucide-react';
import seedlingImg from '../../../assets/images/deep_analysis_seedling_1794768907112.jpg';
import aerialMarjanImg from '../../../assets/images/farm_aerial_marjan_1790789310167.jpg';
import aerialCinematicImg from '../../../assets/images/farm_aerial_cinematic_1793374539769.jpg';
import heroFarmlandImg from '../../../assets/images/hero_farmland_1790691713410.jpg';
import aerialRakImg from '../../../assets/images/farm_aerial_rak_1790789322524.jpg';
import {
  AnalysisFrequency,
  FarmAnalysisSchedule,
  MyFarmRecord,
  PortfolioFieldRecord,
  SavedFarmSnapshot,
} from '../../../types/myFarms';
import { computeNextScheduledRunIso } from '../../../lib/myFarmsEngine';
import { DeepAnalysisReport } from '../../../types/advanced';

const REPORT_THUMBS = [
  aerialMarjanImg,
  aerialCinematicImg,
  heroFarmlandImg,
  aerialRakImg,
];

export function formatScheduleDateTime(iso: string | null | undefined): {
  dateText: string;
  timeText: string;
  combined: string;
} {
  if (!iso || !Number.isFinite(Date.parse(iso))) {
    return { dateText: 'Not scheduled', timeText: '—', combined: 'Not scheduled' };
  }
  const d = new Date(iso);
  const dateText = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeText = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return { dateText, timeText, combined: `${dateText} · ${timeText}` };
}

/* -------------------------------------------------------------------------- */
/* 1. Hero Circular Agricultural Visualization                                */
/* -------------------------------------------------------------------------- */

interface HeroAgriculturalOrbProps {
  moisturePct: number | null;
  meanTempLabel: string;
  healthScore: number | null;
  cropName: string;
  isRunning: boolean;
}

export const HeroAgriculturalOrb: React.FC<HeroAgriculturalOrbProps> = ({
  moisturePct,
  meanTempLabel,
  healthScore,
  cropName,
  isRunning,
}) => {
  const [hoveredNode, setHoveredNode] = useState<'water' | 'temp' | 'chart' | 'leaf' | null>(null);

  const nodes = [
    {
      id: 'water' as const,
      label: 'Water Analysis',
      metric: moisturePct !== null ? `${moisturePct}% VWC` : 'Soil moisture',
      Icon: Droplets,
      ring: 'border-[#00CFFF]/70 text-[#00CFFF] shadow-[0_0_16px_rgba(0,207,255,0.45)]',
      pos: 'top-[4%] right-[12%]',
    },
    {
      id: 'temp' as const,
      label: 'Temperature',
      metric: meanTempLabel,
      Icon: Thermometer,
      ring: 'border-[#FB7185]/70 text-[#FB7185] shadow-[0_0_16px_rgba(251,113,133,0.42)]',
      pos: 'top-[28%] -right-[2%]',
    },
    {
      id: 'chart' as const,
      label: 'Health Analytics',
      metric: healthScore !== null ? `${healthScore}% Score` : 'Ready',
      Icon: BarChart2,
      ring: 'border-[#38BDF8]/70 text-[#38BDF8] shadow-[0_0_16px_rgba(56,189,248,0.42)]',
      pos: 'bottom-[26%] -right-[2%]',
    },
    {
      id: 'leaf' as const,
      label: 'Crop Health',
      metric: cropName,
      Icon: Leaf,
      ring: 'border-[#00E99A]/75 text-[#00E99A] shadow-[0_0_16px_rgba(0,233,154,0.48)]',
      pos: 'bottom-[3%] right-[14%]',
    },
  ];

  return (
    <div className="relative w-[228px] h-[228px] sm:w-[258px] sm:h-[258px] mx-auto lg:mx-0 shrink-0 select-none flex items-center justify-center">
      {/* Ambient radial emerald/cyan halo */}
      <div
        aria-hidden="true"
        className="absolute inset-2 rounded-full blur-2xl opacity-55 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 42% 45%, rgba(0, 207, 255, 0.24), rgba(0, 233, 154, 0.22) 52%, transparent 74%)',
        }}
      />

      {/* Multi-layered Concentric Glowing SVG Rings */}
      <svg
        viewBox="0 0 260 260"
        className={`absolute inset-0 w-full h-full pointer-events-none ${
          isRunning ? 'animate-[spin_12s_linear_infinite]' : ''
        }`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="daOrbCyanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00CFFF" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#00E99A" stopOpacity="0.88" />
            <stop offset="100%" stopColor="#00CFFF" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="daOrbGreenGrad" x1="15%" y1="100%" x2="85%" y2="0%">
            <stop offset="0%" stopColor="#00E99A" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#00CFFF" stopOpacity="0.35" />
          </linearGradient>
          <filter id="daGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer thin boundary ring */}
        <circle
          cx="130"
          cy="130"
          r="116"
          fill="none"
          stroke="rgba(0, 207, 255, 0.22)"
          strokeWidth="1"
        />
        {/* Dashed orbital ring */}
        <circle
          cx="130"
          cy="130"
          r="102"
          fill="none"
          stroke="rgba(0, 233, 154, 0.26)"
          strokeWidth="1"
          strokeDasharray="4 6"
        />
        {/* Primary thick illuminated cyan-to-green arc (upper-left to mid-left) */}
        <path
          d="M 142 36 A 94 94 0 0 0 46 172"
          fill="none"
          stroke="url(#daOrbCyanGrad)"
          strokeWidth="8"
          strokeLinecap="round"
          filter="url(#daGlow)"
        />
        {/* Secondary emerald arc (bottom-left to bottom) */}
        <path
          d="M 52 178 A 94 94 0 0 0 154 221"
          fill="none"
          stroke="url(#daOrbGreenGrad)"
          strokeWidth="6.5"
          strokeLinecap="round"
          filter="url(#daGlow)"
        />
        {/* Inner fine ring */}
        <circle
          cx="130"
          cy="130"
          r="76"
          fill="none"
          stroke="rgba(165, 243, 252, 0.28)"
          strokeWidth="1"
        />

        {/* Circumferential illuminated telemetry dots */}
        {[
          { cx: 130, cy: 14, r: 2.5, c: '#00CFFF' },
          { cx: 34, cy: 86, r: 2.2, c: '#00E99A' },
          { cx: 28, cy: 160, r: 2.5, c: '#00CFFF' },
          { cx: 92, cy: 238, r: 2.2, c: '#00E99A' },
          { cx: 214, cy: 196, r: 2, c: '#00CFFF' },
        ].map((dot, idx) => (
          <circle
            key={idx}
            cx={dot.cx}
            cy={dot.cy}
            r={dot.r}
            fill={dot.c}
            filter="url(#daGlow)"
          />
        ))}
      </svg>

      {/* Center Young Green Plant in Fertile Soil */}
      <div className="relative w-[152px] h-[152px] sm:w-[172px] sm:h-[172px] rounded-full overflow-hidden border border-[#00CFFF]/35 shadow-[inset_0_0_26px_rgba(0,233,154,0.22),0_0_24px_rgba(0,20,38,0.8)] bg-[#07182B]">
        <img
          src={seedlingImg}
          alt="Young green crop sprout growing from fertile dark soil"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover object-center scale-105"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 45%, transparent 48%, rgba(7, 24, 43, 0.72) 100%)',
          }}
        />
      </div>

      {/* 4 Floating Circular Glass Icon Nodes */}
      {nodes.map(({ id, label, metric, Icon, ring, pos }) => (
        <div
          key={id}
          className={`absolute ${pos} z-10`}
          onMouseEnter={() => setHoveredNode(id)}
          onMouseLeave={() => setHoveredNode(null)}
        >
          <button
            type="button"
            onFocus={() => setHoveredNode(id)}
            onBlur={() => setHoveredNode(null)}
            aria-label={`${label}: ${metric}`}
            className={`w-10 h-10 rounded-full bg-[#091F36]/90 backdrop-blur-md border flex items-center justify-center transition-transform duration-200 hover:scale-110 cursor-pointer ${ring}`}
          >
            <Icon className="w-4 h-4" />
          </button>
          {hoveredNode === id && (
            <div className="absolute left-1/2 -translate-x-1/2 -top-11 px-2.5 py-1 rounded-lg bg-[#07182B]/95 border border-[#00CFFF]/40 text-[11px] font-semibold text-[#F2F7FF] whitespace-nowrap shadow-lg pointer-events-none z-20">
              <span className="text-[#AAB9CA]">{label}:</span>{' '}
              <span className="text-[#00E99A] tabular-nums">{metric}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 2. Interactive 3D Glass Calendar & Analog Clock Illustration               */
/* -------------------------------------------------------------------------- */

interface ScheduleCalendar3DProps {
  frequency: AnalysisFrequency;
  nextRunAt: string;
  timeOfDay: string;
  enabled: boolean;
}

export const ScheduleCalendar3D: React.FC<ScheduleCalendar3DProps> = ({
  frequency,
  nextRunAt,
  timeOfDay,
  enabled,
}) => {
  const calendarModel = useMemo(() => {
    const parsed = Date.parse(nextRunAt);
    const refDate = Number.isFinite(parsed) ? new Date(parsed) : new Date();
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const monthTitle = refDate
      .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      .toUpperCase();
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const anchorDay = refDate.getDate();

    const highlightedDays = new Set<number>();
    if (enabled) {
      if (frequency === 'Daily') {
        for (let d = anchorDay; d <= Math.min(daysInMonth, anchorDay + 10); d += 2) {
          highlightedDays.add(d);
        }
      } else if (frequency === 'Weekly') {
        for (let d = anchorDay; d <= daysInMonth; d += 7) highlightedDays.add(d);
        for (let d = anchorDay - 7; d >= 1; d -= 7) highlightedDays.add(d);
      } else if (frequency === 'Biweekly') {
        highlightedDays.add(anchorDay);
        if (anchorDay - 14 >= 1) highlightedDays.add(anchorDay - 14);
        if (anchorDay + 14 <= daysInMonth) highlightedDays.add(anchorDay + 14);
      } else {
        highlightedDays.add(anchorDay);
      }
    }

    const cells: Array<{ day: number | null; active: boolean }> = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: null, active: false });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, active: highlightedDays.has(d) });
    }
    while (cells.length < 35) cells.push({ day: null, active: false });

    return { monthTitle, cells: cells.slice(0, 35) };
  }, [frequency, nextRunAt, enabled]);

  const clockAngles = useMemo(() => {
    const [hhRaw, mmRaw] = timeOfDay.split(':').map(Number);
    const hh = Number.isFinite(hhRaw) ? hhRaw % 12 : 9;
    const mm = Number.isFinite(mmRaw) ? mmRaw : 0;
    const minuteDeg = mm * 6;
    const hourDeg = hh * 30 + mm * 0.5;
    return { hourDeg, minuteDeg };
  }, [timeOfDay]);

  return (
    <div className="relative w-full max-w-[260px] h-[228px] mx-auto select-none flex items-center justify-center">
      {/* Grounded Soil & Sprouts Base */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 inset-x-2 h-[54px] rounded-b-2xl overflow-hidden opacity-85 pointer-events-none"
      >
        <img
          src={seedlingImg}
          alt=""
          referrerPolicy="no-referrer"
          className="w-full h-[140px] -mt-[86px] object-cover object-bottom brightness-90"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(11, 29, 48, 0.96) 0%, rgba(11, 29, 48, 0.25) 45%, rgba(7, 24, 43, 0.85) 100%)',
          }}
        />
      </div>

      {/* Tilted 3D Translucent Glass Calendar */}
      <div
        className="relative w-[198px] rounded-[18px] p-3 border border-[#00CFFF]/45 bg-gradient-to-br from-[#133452]/85 via-[#0C253E]/85 to-[#081A2E]/90 backdrop-blur-md shadow-[0_14px_34px_rgba(0,0,0,0.55),0_0_24px_rgba(0,207,255,0.20),inset_0_1px_1px_rgba(186,240,255,0.35)]"
        style={{
          transform: 'perspective(640px) rotateY(14deg) rotateX(6deg) rotateZ(-4deg)',
        }}
      >
        {/* Metallic Binding Rings */}
        <div className="absolute -top-2.5 left-8 w-3 h-5 rounded-full border-2 border-[#7DD3FC] bg-[#0B2238] shadow-[0_0_8px_rgba(0,207,255,0.45)]" />
        <div className="absolute -top-2.5 right-8 w-3 h-5 rounded-full border-2 border-[#7DD3FC] bg-[#0B2238] shadow-[0_0_8px_rgba(0,207,255,0.45)]" />

        <div className="flex items-center justify-between px-1 pb-2 border-b border-white/10">
          <span className="text-[10px] font-bold tracking-wider text-[#8CEBFF] tabular-nums">
            {calendarModel.monthTitle}
          </span>
          <span className="text-[9px] font-semibold text-[#00E99A]">
            {enabled ? frequency : 'Paused'}
          </span>
        </div>

        <div className="grid grid-cols-7 gap-1 mt-2 text-center">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, idx) => (
            <span key={idx} className="text-[8px] font-semibold text-[#7A9BB8]">
              {d}
            </span>
          ))}
          {calendarModel.cells.map((cell, idx) => (
            <div
              key={idx}
              className={`h-[18px] rounded-[4px] flex items-center justify-center text-[8.5px] font-bold tabular-nums transition-all ${
                cell.day === null
                  ? 'opacity-0'
                  : cell.active
                    ? 'bg-[#00E99A] text-[#042419] shadow-[0_0_10px_rgba(0,233,154,0.75)]'
                    : 'border border-[#00CFFF]/20 bg-[#0A2036]/60 text-[#9CB7D0]'
              }`}
            >
              {cell.day ?? ''}
            </div>
          ))}
        </div>
      </div>

      {/* Overlapping Glowing Cyan Analog Clock */}
      <div
        className="absolute right-2 sm:right-4 bottom-4 w-[86px] h-[86px] rounded-full bg-gradient-to-br from-[#0F2F4C]/95 to-[#07182B]/95 border-2 border-[#00CFFF] shadow-[0_0_24px_rgba(0,207,255,0.45),inset_0_0_14px_rgba(0,207,255,0.28)] flex items-center justify-center"
        aria-hidden="true"
      >
        <svg viewBox="0 0 80 80" className="w-full h-full">
          {/* Hour markers */}
          {Array.from({ length: 12 }).map((_, i) => {
            const angle = (i * 30 * Math.PI) / 180;
            const x1 = 40 + Math.sin(angle) * 30;
            const y1 = 40 - Math.cos(angle) * 30;
            const x2 = 40 + Math.sin(angle) * 33.5;
            const y2 = 40 - Math.cos(angle) * 33.5;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={i % 3 === 0 ? '#00E99A' : '#38BDF8'}
                strokeWidth={i % 3 === 0 ? '2' : '1.2'}
                strokeLinecap="round"
              />
            );
          })}
          {/* Hour Hand */}
          <line
            x1="40"
            y1="40"
            x2="40"
            y2="22"
            stroke="#F2F7FF"
            strokeWidth="2.8"
            strokeLinecap="round"
            transform={`rotate(${clockAngles.hourDeg} 40 40)`}
          />
          {/* Minute Hand */}
          <line
            x1="40"
            y1="40"
            x2="40"
            y2="14"
            stroke="#00CFFF"
            strokeWidth="2"
            strokeLinecap="round"
            transform={`rotate(${clockAngles.minuteDeg} 40 40)`}
          />
          {/* Glowing Center Pivot */}
          <circle cx="40" cy="40" r="3.5" fill="#00E99A" />
        </svg>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 3. Aerial Satellite Parcel Thumbnail for Historical Report Cards           */
/* -------------------------------------------------------------------------- */

export const AerialParcelThumbnail: React.FC<{
  index: number;
  highlighted?: boolean;
  alt: string;
}> = ({ index, highlighted = false, alt }) => {
  const src = REPORT_THUMBS[index % REPORT_THUMBS.length];
  const strokeColor = highlighted ? '#00E99A' : index === 3 ? '#F5B83D' : '#38BDF8';

  return (
    <div className="relative w-full h-[92px] rounded-t-[14px] overflow-hidden bg-[#07182B]">
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        className="w-full h-full object-cover object-center brightness-90 saturate-110 transition-transform duration-300 group-hover:scale-105"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(7, 24, 43, 0.14) 0%, rgba(7, 24, 43, 0.45) 100%)',
        }}
      />
      {/* Crisp Field Parcel Boundary Overlay */}
      <svg
        viewBox="0 0 200 92"
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      >
        <polygon
          points="32,18 118,12 168,36 144,78 52,72"
          fill="rgba(0, 233, 154, 0.08)"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeOpacity="0.88"
        />
        <line
          x1="82"
          y1="15"
          x2="98"
          y2="75"
          stroke={strokeColor}
          strokeWidth="1"
          strokeOpacity="0.6"
        />
        <line
          x1="42"
          y1="46"
          x2="156"
          y2="46"
          stroke={strokeColor}
          strokeWidth="1"
          strokeOpacity="0.55"
        />
        {[
          [32, 18],
          [118, 12],
          [168, 36],
          [144, 78],
          [52, 72],
          [90, 46],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="2.3" fill="#F2F7FF" stroke={strokeColor} strokeWidth="1" />
        ))}
      </svg>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 4. Interactive Modals (Full Report, Compare, Summary, Manage Schedule)     */
/* -------------------------------------------------------------------------- */

interface FullReportModalProps {
  farm: MyFarmRecord;
  snapshot: SavedFarmSnapshot;
  previousSnapshot: SavedFarmSnapshot | null;
  tempUnit: 'C' | 'F';
  onClose: () => void;
  onExportPdf: (snap: SavedFarmSnapshot) => void;
  onOpenCompare: (snapId: string) => void;
  onOpenAnalyzeStudio: () => void;
}

export const FullReportModal: React.FC<FullReportModalProps> = ({
  farm,
  snapshot,
  previousSnapshot,
  tempUnit,
  onClose,
  onExportPdf,
  onOpenCompare,
  onOpenAnalyzeStudio,
}) => {
  const { combined } = formatScheduleDateTime(snapshot.generatedAt);
  const score = snapshot.suitabilityScore;
  const prevScore = previousSnapshot?.suitabilityScore ?? null;
  const delta = score !== null && prevScore !== null ? score - prevScore : null;

  const fmtTemp = (c: number | null | undefined) => {
    if (c === null || c === undefined || !Number.isFinite(c)) return '—';
    return tempUnit === 'F' ? `${Math.round((c * 9) / 5 + 32)} °F` : `${c.toFixed(1)} °C`;
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-[#030D18]/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Full Deep Analysis Report"
        className="w-full max-w-3xl max-h-[88vh] overflow-y-auto fs-thin-scroll rounded-[24px] border border-[#00CFFF]/35 bg-[#0A1E33]/95 text-[#F2F7FF] shadow-[0_24px_60px_rgba(0,0,0,0.75)] p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-[#00CFFF]/40 bg-[#00CFFF]/10 text-[11px] font-semibold text-[#7CE8FF]">
              <Sparkles className="w-3 h-3" />
              Deep Analysis Report · {snapshot.modelVersion}
            </div>
            <h3 className="text-xl font-bold text-[#F2F7FF]">
              {farm.name} — {snapshot.fieldScopeLabel || snapshot.fieldName || 'Whole Farm'}
            </h3>
            <p className="text-xs text-[#AAB9CA] tabular-nums">
              {combined} · {snapshot.triggerReason}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report"
            className="w-9 h-9 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#AAB9CA] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Score + Key Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-[#00E99A]/35 bg-[#0D2B3E]/70 p-4 flex flex-col justify-between">
            <span className="text-xs text-[#AAB9CA]">Overall Farm Health</span>
            <div className="text-3xl font-bold text-[#00E99A] tabular-nums mt-1">
              {score !== null ? `${score}%` : '—'}
            </div>
            <div className="text-[11px] text-[#8CEBFF] mt-1 tabular-nums">
              {delta !== null
                ? `${delta >= 0 ? '↑ +' : '↓ '}${delta}% vs previous`
                : `${snapshot.confidencePct}% confidence`}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#10263A]/80 p-4">
            <span className="text-xs text-[#AAB9CA]">Soil Moisture &amp; pH</span>
            <div className="text-lg font-bold text-[#F2F7FF] tabular-nums mt-1">
              {snapshot.keyMetrics.soilMoisturePct !== null
                ? `${snapshot.keyMetrics.soilMoisturePct}% VWC`
                : '—'}
            </div>
            <div className="text-[11px] text-[#AAB9CA] mt-1 tabular-nums">
              pH {snapshot.keyMetrics.phValue !== null ? snapshot.keyMetrics.phValue.toFixed(1) : 'Untested'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#10263A]/80 p-4">
            <span className="text-xs text-[#AAB9CA]">Climate Mean</span>
            <div className="text-lg font-bold text-[#F2F7FF] tabular-nums mt-1">
              {fmtTemp(snapshot.keyMetrics.meanTempC)}
            </div>
            <div className="text-[11px] text-[#AAB9CA] mt-1 tabular-nums">
              {snapshot.keyMetrics.precipMmDay !== null
                ? `${snapshot.keyMetrics.precipMmDay.toFixed(2)} mm/day precip`
                : 'Precip N/A'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#10263A]/80 p-4">
            <span className="text-xs text-[#AAB9CA]">Data Completeness</span>
            <div className="text-lg font-bold text-[#F2F7FF] tabular-nums mt-1">
              {snapshot.completenessPct}%
            </div>
            <div className="text-[11px] text-[#AAB9CA] mt-1 tabular-nums">
              {snapshot.keyMetrics.mappedAreaHa.toFixed(1)} ha mapped
            </div>
          </div>
        </div>

        {/* Summary & Climate Window */}
        <div className="rounded-2xl border border-white/10 bg-[#10263A]/70 p-4 space-y-2.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#00CFFF]">
            Executive &amp; Climate Assessment
          </div>
          <p className="text-sm text-[#E2EEFA] leading-relaxed">
            {snapshot.aiSummary || farm.assessment.summary}
          </p>
          <p className="text-xs text-[#AAB9CA]">{snapshot.weatherWindowSummary}</p>
        </div>

        {/* Drivers & Risks */}
        {((snapshot.keyDrivers && snapshot.keyDrivers.length > 0) ||
          (snapshot.risksDetected && snapshot.risksDetected.length > 0)) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {snapshot.keyDrivers && snapshot.keyDrivers.length > 0 && (
              <div className="rounded-2xl border border-[#00E99A]/25 bg-[#0D2938]/70 p-4 space-y-2">
                <div className="text-xs font-bold text-[#00E99A] flex items-center gap-1.5">
                  <Sprout className="w-4 h-4" />
                  Key Agronomic Drivers
                </div>
                <ul className="space-y-1.5 text-xs text-[#DCE9F7]">
                  {snapshot.keyDrivers.map((d, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#00E99A] shrink-0 mt-0.5" />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {snapshot.risksDetected && snapshot.risksDetected.length > 0 && (
              <div className="rounded-2xl border border-amber-400/30 bg-[#212636]/70 p-4 space-y-2">
                <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4" />
                  Risk Signals
                </div>
                <ul className="space-y-1.5 text-xs text-[#FDE68A]">
                  {snapshot.risksDetected.map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Smart Recommendations */}
        <div className="rounded-2xl border border-white/10 bg-[#10263A]/70 p-4 space-y-2.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#00E99A]">
            Smart Recommendations
          </div>
          <ul className="space-y-2 text-xs text-[#E2EEFA]">
            {(snapshot.recommendations.length > 0
              ? snapshot.recommendations
              : ['Continue routine moisture and scouting logs; no urgent interventions detected.']
            ).map((rec, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-[#00E99A]/20 text-[#00E99A] flex items-center justify-center shrink-0 mt-0.5">
                  <Check className="w-2.5 h-2.5" />
                </span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#AAB9CA]">
            <Satellite className="w-3.5 h-3.5 text-[#00CFFF]" />
            <span>
              NASA POWER: {snapshot.dataAvailability.nasaPower} · Open-Meteo:{' '}
              {snapshot.dataAvailability.openMeteo} · EONET: {snapshot.dataAvailability.nasaEonet}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenCompare(snapshot.id)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-semibold text-[#F2F7FF] cursor-pointer whitespace-nowrap"
            >
              <GitCompare className="w-3.5 h-3.5 text-[#00CFFF]" />
              Compare
            </button>
            <button
              type="button"
              onClick={() => onExportPdf(snapshot)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#00CFFF]/40 bg-[#0F2C47] hover:bg-[#14395A] text-xs font-semibold text-[#F2F7FF] cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-[#00CFFF]" />
              Export as PDF
            </button>
            <button
              type="button"
              onClick={onOpenAnalyzeStudio}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#49FFA8] to-[#00C47D] text-[#042419] text-xs font-bold hover:brightness-105 cursor-pointer whitespace-nowrap"
            >
              <span>Full Studio View</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Compare Two Reports Modal                                                  */
/* -------------------------------------------------------------------------- */

interface CompareReportsModalProps {
  snapshots: SavedFarmSnapshot[];
  initialLeftId: string;
  initialRightId: string;
  tempUnit: 'C' | 'F';
  onClose: () => void;
  onRunNewAnalysis: () => void;
}

export const CompareReportsModal: React.FC<CompareReportsModalProps> = ({
  snapshots,
  initialLeftId,
  initialRightId,
  tempUnit,
  onClose,
  onRunNewAnalysis,
}) => {
  const [leftId, setLeftId] = useState(initialLeftId);
  const [rightId, setRightId] = useState(initialRightId);

  const left = snapshots.find((s) => s.id === leftId) ?? snapshots[1] ?? snapshots[0] ?? null;
  const right = snapshots.find((s) => s.id === rightId) ?? snapshots[0] ?? null;

  const fmtTemp = (c: number | null | undefined) => {
    if (c === null || c === undefined || !Number.isFinite(c)) return '—';
    return tempUnit === 'F' ? `${Math.round((c * 9) / 5 + 32)} °F` : `${c.toFixed(1)} °C`;
  };

  const renderDelta = (a: number | null | undefined, b: number | null | undefined, unit = '') => {
    if (a === null || a === undefined || b === null || b === undefined) return '—';
    const diff = Number((b - a).toFixed(1));
    const positive = diff >= 0;
    return (
      <span
        className={`inline-flex items-center gap-0.5 font-bold tabular-nums ${
          positive ? 'text-[#00E99A]' : 'text-amber-300'
        }`}
      >
        {positive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
        {positive ? `+${diff}${unit}` : `${diff}${unit}`}
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-[#030D18]/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compare Analysis Reports"
        className="w-full max-w-3xl max-h-[88vh] overflow-y-auto fs-thin-scroll rounded-[24px] border border-[#00CFFF]/35 bg-[#0A1E33]/95 text-[#F2F7FF] shadow-[0_24px_60px_rgba(0,0,0,0.75)] p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#00CFFF]/15 border border-[#00CFFF]/35 flex items-center justify-center text-[#00CFFF]">
              <GitCompare className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#F2F7FF]">Compare Two Reports</h3>
              <p className="text-xs text-[#AAB9CA]">
                Side-by-side health score, soil moisture, and climate deltas
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comparison"
            className="w-9 h-9 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#AAB9CA] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {snapshots.length < 2 || !left || !right ? (
          <div className="rounded-2xl border border-white/10 bg-[#10263A]/70 p-6 text-center space-y-3">
            <p className="text-sm text-[#E2EEFA]">
              At least two saved Deep Analysis reports are needed to compare trends.
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                onRunNewAnalysis();
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#49FFA8] to-[#00C47D] text-[#042419] text-xs font-bold cursor-pointer"
            >
              Run New Analysis
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 text-xs">
                <span className="text-[#AAB9CA] font-medium">Baseline Report</span>
                <select
                  value={left.id}
                  onChange={(e) => setLeftId(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-[#10263A] px-3 py-2.5 text-xs text-[#F2F7FF]"
                >
                  {snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatScheduleDateTime(s.generatedAt).combined} —{' '}
                      {s.suitabilityScore !== null ? `${s.suitabilityScore}%` : 'Unscored'}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs">
                <span className="text-[#AAB9CA] font-medium">Comparison Report</span>
                <select
                  value={right.id}
                  onChange={(e) => setRightId(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-[#10263A] px-3 py-2.5 text-xs text-[#F2F7FF]"
                >
                  {snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatScheduleDateTime(s.generatedAt).combined} —{' '}
                      {s.suitabilityScore !== null ? `${s.suitabilityScore}%` : 'Unscored'}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#10263A]/75 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[#AAB9CA]">
                    <th className="py-3 px-4 font-semibold">Metric</th>
                    <th className="py-3 px-4 font-semibold">Baseline</th>
                    <th className="py-3 px-4 font-semibold">Comparison</th>
                    <th className="py-3 px-4 font-semibold text-right">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8 tabular-nums">
                  <tr>
                    <td className="py-3 px-4 font-medium text-[#E2EEFA]">Overall Farm Health</td>
                    <td className="py-3 px-4 text-[#F2F7FF] font-bold">
                      {left.suitabilityScore !== null ? `${left.suitabilityScore}%` : '—'}
                    </td>
                    <td className="py-3 px-4 text-[#F2F7FF] font-bold">
                      {right.suitabilityScore !== null ? `${right.suitabilityScore}%` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {renderDelta(left.suitabilityScore, right.suitabilityScore, '%')}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium text-[#E2EEFA]">Soil Moisture (VWC)</td>
                    <td className="py-3 px-4 text-[#DCE9F7]">
                      {left.keyMetrics.soilMoisturePct !== null
                        ? `${left.keyMetrics.soilMoisturePct}%`
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-[#DCE9F7]">
                      {right.keyMetrics.soilMoisturePct !== null
                        ? `${right.keyMetrics.soilMoisturePct}%`
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {renderDelta(
                        left.keyMetrics.soilMoisturePct,
                        right.keyMetrics.soilMoisturePct,
                        '%'
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium text-[#E2EEFA]">Mean Temperature</td>
                    <td className="py-3 px-4 text-[#DCE9F7]">{fmtTemp(left.keyMetrics.meanTempC)}</td>
                    <td className="py-3 px-4 text-[#DCE9F7]">{fmtTemp(right.keyMetrics.meanTempC)}</td>
                    <td className="py-3 px-4 text-right">
                      {renderDelta(left.keyMetrics.meanTempC, right.keyMetrics.meanTempC, '°C')}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium text-[#E2EEFA]">Precipitation Rate</td>
                    <td className="py-3 px-4 text-[#DCE9F7]">
                      {left.keyMetrics.precipMmDay !== null
                        ? `${left.keyMetrics.precipMmDay.toFixed(2)} mm/d`
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-[#DCE9F7]">
                      {right.keyMetrics.precipMmDay !== null
                        ? `${right.keyMetrics.precipMmDay.toFixed(2)} mm/d`
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {renderDelta(left.keyMetrics.precipMmDay, right.keyMetrics.precipMmDay, ' mm/d')}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium text-[#E2EEFA]">Data Confidence</td>
                    <td className="py-3 px-4 text-[#DCE9F7]">{left.confidencePct}%</td>
                    <td className="py-3 px-4 text-[#DCE9F7]">{right.confidencePct}%</td>
                    <td className="py-3 px-4 text-right">
                      {renderDelta(left.confidencePct, right.confidencePct, '%')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Condensed Analysis Summary Modal                                           */
/* -------------------------------------------------------------------------- */

interface AnalysisSummaryModalProps {
  farm: MyFarmRecord;
  latestBackendReport?: DeepAnalysisReport | null;
  latestSnapshot: SavedFarmSnapshot | null;
  previousSnapshot: SavedFarmSnapshot | null;
  onClose: () => void;
  onExportPdf: (snap?: SavedFarmSnapshot) => void;
  onOpenFullReport: () => void;
}

export const AnalysisSummaryModal: React.FC<AnalysisSummaryModalProps> = ({
  farm,
  latestBackendReport,
  latestSnapshot,
  previousSnapshot,
  onClose,
  onExportPdf,
  onOpenFullReport,
}) => {
  const score =
    latestBackendReport?.overallSummary.healthScore ??
    latestSnapshot?.suitabilityScore ??
    farm.assessment.score;
  const delta =
    latestBackendReport?.comparisonWithPrevious?.scoreDelta ??
    (latestSnapshot?.suitabilityScore !== null &&
    latestSnapshot?.suitabilityScore !== undefined &&
    previousSnapshot?.suitabilityScore !== null &&
    previousSnapshot?.suitabilityScore !== undefined
      ? latestSnapshot.suitabilityScore - previousSnapshot.suitabilityScore
      : null);

  const primaryFieldWater = latestBackendReport?.fieldAssessments[0]?.waterSummary;
  const primaryFieldSoil = latestBackendReport?.fieldAssessments[0]?.soilSummary;

  const pillars = latestBackendReport
    ? [
        {
          title: 'Soil & Water Analysis',
          status: `${primaryFieldSoil?.textureClass || farm.soil.texture} · ${
            primaryFieldWater?.surfaceMoisturePct !== null &&
            primaryFieldWater?.surfaceMoisturePct !== undefined
              ? `${primaryFieldWater.surfaceMoisturePct}% VWC`
              : 'Moisture via water balance'
          } · ET₀ ${primaryFieldWater?.et0MeanMmDay ?? '—'} mm/d`,
        },
        {
          title: 'Field Insights',
          status: `${latestBackendReport.overallSummary.fieldsAssessedCount} field(s) · ${latestBackendReport.scope.label} · ${latestBackendReport.overallSummary.coveragePct}% coverage`,
        },
        {
          title: 'Crop Health Assessment',
          status: `${latestBackendReport.overallSummary.conditionLabel} · ${
            score !== null ? `${score}% calibrated score` : 'Unscored'
          } · ${latestBackendReport.overallSummary.confidencePct}% confidence`,
        },
        {
          title: 'Smart Recommendations',
          status:
            latestBackendReport.recommendations[0]?.title ||
            latestBackendReport.overallSummary.priorityNextAction ||
            'Continue routine monitoring.',
        },
        {
          title: 'Risk Detection',
          status:
            latestBackendReport.findings.length + latestBackendReport.watchPoints.length > 0
              ? `${latestBackendReport.findings.length} finding(s), ${latestBackendReport.watchPoints.length} watch point(s)`
              : 'Zero elevated risk findings flagged',
        },
        {
          title: 'Historical Comparison',
          status:
            latestBackendReport.comparisonWithPrevious?.summaryHeadline ||
            (delta !== null
              ? `${delta >= 0 ? '+' : ''}${delta}% vs previous report`
              : 'Baseline report recorded'),
        },
      ]
    : [
        {
          title: 'Soil & Water Analysis',
          status: `${farm.soil.texture} · ${
            farm.soil.moisturePct !== null ? `${farm.soil.moisturePct}% VWC` : 'Moisture unmeasured'
          } · ${farm.water.reliability || 'Supply check'}`,
        },
        {
          title: 'Field Insights',
          status: `${farm.mappedAreaHa > 0 ? `${farm.mappedAreaHa.toFixed(1)} ha` : 'Unmapped'} · ${
            farm.regionLabel || farm.locationLabel
          }`,
        },
        {
          title: 'Crop Health Assessment',
          status: `${farm.primaryCrop || 'Primary crop'} · ${
            score !== null ? `${score}% overall health` : 'Pending run'
          }`,
        },
        {
          title: 'Smart Recommendations',
          status:
            latestSnapshot?.recommendations?.[0] ||
            'Run a Deep Analysis to generate updated action guidance.',
        },
        {
          title: 'Risk Detection',
          status:
            farm.assessment.activeAlertsCount > 0
              ? `${farm.assessment.activeAlertsCount} active alert(s) flagged`
              : 'Zero active spatial or EONET hazard alerts',
        },
        {
          title: 'Historical Comparison',
          status:
            delta !== null
              ? `${delta >= 0 ? '+' : ''}${delta}% change vs previous report`
              : 'Baseline established',
        },
      ];

  return (
    <div
      className="fixed inset-0 z-[80] bg-[#030D18]/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Analysis Summary"
        className="w-full max-w-2xl rounded-[24px] border border-[#00CFFF]/35 bg-[#0A1E33]/95 text-[#F2F7FF] shadow-[0_24px_60px_rgba(0,0,0,0.75)] p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#00E99A]/15 border border-[#00E99A]/35 flex items-center justify-center text-[#00E99A]">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#F2F7FF]">
                {farm.name} — Analysis Summary
              </h3>
              <p className="text-xs text-[#AAB9CA] tabular-nums">
                {latestBackendReport
                  ? `Latest Run: ${formatScheduleDateTime(latestBackendReport.completedAt).combined}`
                  : latestSnapshot
                    ? `Latest Run: ${formatScheduleDateTime(latestSnapshot.generatedAt).combined}`
                    : 'No completed analysis report yet'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close summary"
            className="w-9 h-9 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#AAB9CA] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {pillars.map((p) => (
            <div
              key={p.title}
              className="rounded-xl border border-white/10 bg-[#10263A]/75 p-3.5 space-y-1"
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#00E99A]">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{p.title}</span>
              </div>
              <p className="text-xs text-[#DCE9F7] leading-relaxed">{p.status}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-white/10">
          {(latestBackendReport || latestSnapshot) && (
            <>
              <button
                type="button"
                onClick={() => onExportPdf(latestSnapshot ?? undefined)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#00CFFF]/40 bg-[#0F2C47] hover:bg-[#14395A] text-xs font-semibold text-[#F2F7FF] cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#00CFFF]" />
                Export PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFullReport();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#49FFA8] to-[#00C47D] text-[#042419] text-xs font-bold cursor-pointer"
              >
                Open Full Report
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Manage Schedule Modal                                                      */
/* -------------------------------------------------------------------------- */

interface ManageScheduleModalProps {
  schedule: FarmAnalysisSchedule;
  fields: PortfolioFieldRecord[];
  saving: boolean;
  onClose: () => void;
  onSave: (next: FarmAnalysisSchedule) => Promise<void>;
  onRunNow: () => Promise<void>;
}

export const ManageScheduleModal: React.FC<ManageScheduleModalProps> = ({
  schedule,
  fields,
  saving,
  onClose,
  onSave,
  onRunNow,
}) => {
  const [draft, setDraft] = useState<FarmAnalysisSchedule>(schedule);

  const handleFrequencyChange = (frequency: AnalysisFrequency) => {
    setDraft((prev) => ({
      ...prev,
      frequency,
      nextRunAt: computeNextScheduledRunIso(
        prev.lastRunAt ?? new Date().toISOString(),
        frequency,
        prev.timeOfDay
      ),
    }));
  };

  const handleTimeChange = (timeOfDay: string) => {
    setDraft((prev) => ({
      ...prev,
      timeOfDay,
      nextRunAt: computeNextScheduledRunIso(
        prev.lastRunAt ?? new Date().toISOString(),
        prev.frequency,
        timeOfDay
      ),
    }));
  };

  const toggleField = (fieldId: string) => {
    setDraft((prev) => {
      const current = prev.fieldScope === 'all' ? fields.map((f) => f.id) : prev.fieldScope;
      const nextList = current.includes(fieldId)
        ? current.filter((id) => id !== fieldId)
        : [...current, fieldId];
      if (nextList.length === 0 || nextList.length === fields.length) {
        return { ...prev, fieldScope: 'all' };
      }
      return { ...prev, fieldScope: nextList };
    });
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-[#030D18]/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage Analysis Schedule"
        className="w-full max-w-lg rounded-[24px] border border-[#00E99A]/40 bg-[#0A1E33]/95 text-[#F2F7FF] shadow-[0_24px_60px_rgba(0,0,0,0.75)] p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#00E99A]/15 border border-[#00E99A]/40 flex items-center justify-center text-[#00E99A]">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#F2F7FF]">Manage Analysis Schedule</h3>
              <p className="text-xs text-[#AAB9CA]">
                Configure cadence, field coverage, and change alerts
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close schedule modal"
            className="w-9 h-9 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#AAB9CA] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          {/* Enable / Pause Toggle */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#10263A]/80 px-4 py-3">
            <div>
              <div className="font-bold text-[#F2F7FF]">Automatic Scheduling</div>
              <div className="text-[#AAB9CA] mt-0.5">
                {draft.enabled ? 'Active and running smoothly' : 'Paused — manual runs only'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.enabled}
              onClick={() => setDraft((p) => ({ ...p, enabled: !p.enabled }))}
              className={`w-12 h-6 rounded-full p-0.5 transition-colors cursor-pointer ${
                draft.enabled ? 'bg-[#00E99A]' : 'bg-white/20'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  draft.enabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[#AAB9CA] font-medium">Frequency</span>
              <select
                value={draft.frequency}
                onChange={(e) => handleFrequencyChange(e.target.value as AnalysisFrequency)}
                className="w-full rounded-xl border border-white/15 bg-[#10263A] px-3 py-2.5 text-xs text-[#F2F7FF]"
              >
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Biweekly">Biweekly</option>
                <option value="Monthly">Monthly</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-[#AAB9CA] font-medium">Preferred Run Time</span>
              <select
                value={draft.timeOfDay}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-[#10263A] px-3 py-2.5 text-xs text-[#F2F7FF]"
              >
                <option value="06:00">06:00 AM</option>
                <option value="09:00">09:00 AM</option>
                <option value="12:00">12:00 PM</option>
                <option value="18:00">06:00 PM</option>
              </select>
            </label>
          </div>

          {fields.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#AAB9CA] font-medium">Fields Included</span>
                <button
                  type="button"
                  onClick={() => setDraft((p) => ({ ...p, fieldScope: 'all' }))}
                  className="text-[11px] font-semibold text-[#00E99A] hover:underline cursor-pointer"
                >
                  Select All ({fields.length})
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {fields.map((fl) => {
                  const checked =
                    draft.fieldScope === 'all' || draft.fieldScope.includes(fl.id);
                  return (
                    <button
                      key={fl.id}
                      type="button"
                      onClick={() => toggleField(fl.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer ${
                        checked
                          ? 'border-[#00E99A]/45 bg-[#00E99A]/12 text-[#F2F7FF]'
                          : 'border-white/10 bg-[#10263A]/60 text-[#AAB9CA]'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded flex items-center justify-center border ${
                          checked
                            ? 'bg-[#00E99A] border-[#00E99A] text-[#042419]'
                            : 'border-white/25'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 stroke-[3]" />}
                      </span>
                      <span className="truncate">{fl.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Change Alert Threshold */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#10263A]/80 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Bell className="w-4 h-4 text-[#00E99A]" />
              <div>
                <div className="font-semibold text-[#F2F7FF]">Important Change Alerts</div>
                <div className="text-[11px] text-[#AAB9CA]">
                  Notify when score shifts ≥ {draft.changeThresholdPct ?? 5}% or moisture drops
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.notifyOnImportantChanges}
              onClick={() =>
                setDraft((p) => ({
                  ...p,
                  notifyOnImportantChanges: !p.notifyOnImportantChanges,
                }))
              }
              className={`w-12 h-6 rounded-full p-0.5 transition-colors cursor-pointer ${
                draft.notifyOnImportantChanges ? 'bg-[#00E99A]' : 'bg-white/20'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  draft.notifyOnImportantChanges ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#07182B]/70 px-3.5 py-2.5 flex items-center justify-between text-[11px] text-[#AAB9CA] tabular-nums">
            <span>Next Scheduled Execution</span>
            <span className="font-semibold text-[#F2F7FF]">
              {formatScheduleDateTime(draft.nextRunAt).combined}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10">
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              onClose();
              await onRunNow();
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#00CFFF]/40 bg-[#0F2C47] hover:bg-[#14395A] text-xs font-semibold text-[#F2F7FF] cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#00CFFF]" />
            Run Analysis Now
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-white/15 text-xs font-semibold text-[#AAB9CA] hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                await onSave(draft);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#49FFA8] to-[#00C47D] text-[#042419] text-xs font-bold hover:brightness-105 cursor-pointer"
            >
              {saving ? 'Saving…' : 'Save Schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
