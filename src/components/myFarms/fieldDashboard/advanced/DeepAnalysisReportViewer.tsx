import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  CloudSun,
  Compass,
  Database,
  Download,
  Droplets,
  FileSpreadsheet,
  FileText,
  Flame,
  GitCompare,
  HeartPulse,
  Info,
  Layers,
  Leaf,
  Lightbulb,
  Map as MapIcon,
  Printer,
  RefreshCw,
  Repeat,
  Satellite,
  Settings2,
  ShieldCheck,
  Sprout,
  Wrench,
  X,
} from 'lucide-react';
import {
  ActionStatus,
  AnalysisJob,
  DeepAnalysisReport,
  EvidenceRecord,
  FieldDeepAssessment,
} from '../../../../types/advanced';
import { downloadFullDeepAnalysisPdf } from '../../../../lib/deepAnalysisPdfExport';
import {
  exportReportFile,
  regenerateAiExplanation,
  updateReportActionStatus,
} from '../../../../services/advancedApi';
import { EvidenceExplorerDrawer } from './EvidenceExplorerDrawer';
import { useToast } from '../../../Toast';
import heroFarmlandImg from '../../../../assets/images/hero_farmland_1790691713410.jpg';
import deepAnalysisBgImg from '../../../../assets/images/deep_analysis_farmland_bg_1794768906869.jpg';

export interface DeepAnalysisReportViewerProps {
  report: DeepAnalysisReport;
  latestJob?: AnalysisJob | null;
  tempUnit: 'C' | 'F';
  onClose: () => void;
  onReportUpdated: (report: DeepAnalysisReport) => void;
  onOpenCompare: (reportId: string) => void;
  onRunNewAnalysisClick?: () => void;
  onOpenScheduleAutomation?: () => void;
  onOpenFieldOverview?: (fieldId: string) => void;
  onOpenOnMap?: () => void;
  onOpenRotationPlan?: () => void;
  onOpenWeatherForecast?: () => void;
  onPortfolioChanged?: () => Promise<void>;
}

const ACTION_STATUSES: ActionStatus[] = [
  'Suggested',
  'Accepted',
  'Scheduled',
  'In progress',
  'Completed',
  'Deferred',
  'Dismissed',
];

function formatShortDate(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return 'Unavailable';
  const parsed = Date.parse(isoOrDate);
  if (!Number.isFinite(parsed)) return isoOrDate;
  return new Date(parsed).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateRangeShort(from: string, to: string): string {
  const f = Date.parse(from);
  const t = Date.parse(to);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return `${from} – ${to}`;
  const df = new Date(f);
  const dt = new Date(t);
  const sameYear = df.getUTCFullYear() === dt.getUTCFullYear();
  const left = df.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const right = dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return sameYear ? `${left} – ${right}` : `${formatShortDate(from)} – ${right}`;
}

function formatRunDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${datePart} · ${timePart}`;
}

function formatTimelineDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${datePart}, ${timePart}`;
}

function formatFreshness(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Timestamp unavailable';
  const diffMin = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (diffMin < 2) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.round(diffMin / 60);
  if (diffHrs < 48) return `${diffHrs}h ago`;
  const diffDays = Math.round(diffHrs / 24);
  return `${diffDays}d ago`;
}

function confidenceWord(pct: number): 'High' | 'Moderate' | 'Low' {
  if (pct >= 75) return 'High';
  if (pct >= 45) return 'Moderate';
  return 'Low';
}

export const DeepAnalysisReportViewer: React.FC<DeepAnalysisReportViewerProps> = ({
  report,
  latestJob,
  tempUnit,
  onClose,
  onReportUpdated,
  onOpenCompare,
  onRunNewAnalysisClick,
  onOpenScheduleAutomation,
  onOpenFieldOverview,
  onOpenOnMap,
  onOpenRotationPlan,
  onOpenWeatherForecast,
  onPortfolioChanged,
}) => {
  const { showToast } = useToast();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const section6To15Refs = useRef<Record<string, HTMLDivElement | null>>({});
  const topBarRef = useRef<HTMLDivElement | null>(null);

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [includePrivateCoords, setIncludePrivateCoords] = useState(false);
  const [explanationMode, setExplanationMode] = useState<'simple' | 'advanced'>('simple');
  const [regeneratingAi, setRegeneratingAi] = useState(false);
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null);

  // Selected field for Section 5 Water chart/table (defaults to field with highest risk / first field)
  const [waterFieldId, setWaterFieldId] = useState<string>(() => {
    const flagged = report.fieldAssessments.find(
      (f) => f.conditionLabel === 'Alert' || f.conditionLabel === 'Needs Attention'
    );
    return flagged?.fieldId ?? report.fieldAssessments[0]?.fieldId ?? '';
  });
  const [showAllWaterRows, setShowAllWaterRows] = useState(false);

  // Accordion states for Sections 6–15
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});
  // Sub-modals & drawers (preserve scroll position seamlessly)
  const [inspectedField, setInspectedField] = useState<FieldDeepAssessment | null>(null);
  const [allFindingsOpen, setAllFindingsOpen] = useState(false);
  const [fullLogOpen, setFullLogOpen] = useState(false);
  const [inspectedEvidence, setInspectedEvidence] = useState<EvidenceRecord | null>(null);
  const [navMenuOpen, setNavMenuOpen] = useState(false);

  const toggleSection = (num: number) => {
    setExpandedSections((prev) => ({ ...prev, [num]: !prev[num] }));
  };

  const jumpToSection = (num: number) => {
    if (num >= 6 && num <= 15) {
      setExpandedSections((prev) => ({ ...prev, [num]: true }));
    }
    const el = section6To15Refs.current[String(num)];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setNavMenuOpen(false);
  };

  const formatTemp = (c: number | null | undefined) => {
    if (c === null || c === undefined || !Number.isFinite(c)) return 'Unavailable';
    return tempUnit === 'F'
      ? `${((c * 9) / 5 + 32).toFixed(1)} °F`
      : `${c.toFixed(1)} °C`;
  };

  const inspectEvidenceById = (id: string, fallbackTitle: string, fieldId?: string | null) => {
    const rec = report.evidenceById[id];
    if (rec) {
      setInspectedEvidence(rec);
      return;
    }
    const match = Object.values(report.evidenceById).find(
      (e) =>
        (!fieldId || e.fieldId === fieldId) &&
        e.metricName.toLowerCase().includes(fallbackTitle.toLowerCase())
    );
    if (match) {
      setInspectedEvidence(match);
    } else {
      showToast('Detailed provenance record not attached for this metric.', 'info');
    }
  };

  const EvidenceBtn: React.FC<{ id: string; label?: string; fieldId?: string | null }> = ({
    id,
    label = 'Evidence',
    fieldId = null,
  }) => (
    <button
      type="button"
      onClick={() => inspectEvidenceById(id, label, fieldId)}
      className="no-print inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#55C7DB]/35 bg-[#55C7DB]/10 hover:bg-[#55C7DB]/20 text-[10.5px] font-semibold text-[#55C7DB] cursor-pointer"
    >
      <Database className="w-3 h-3" />
      <span>{label}</span>
    </button>
  );

  const handleExportPdf = () => {
    const file = downloadFullDeepAnalysisPdf(report);
    showToast(`Downloaded ${file}`, 'success');
    setExportMenuOpen(false);
  };

  const handlePrint = () => {
    setExportMenuOpen(false);
    window.print();
  };

  const handleRegenerateAi = async () => {
    setRegeneratingAi(true);
    try {
      const nextAi = await regenerateAiExplanation(report.id);
      onReportUpdated({ ...report, aiExplanation: nextAi });
      showToast(
        nextAi.available
          ? `Regenerated summary (${nextAi.modelUsed ?? 'Gemini'})`
          : 'Updated deterministic engine summary (AI unavailable)',
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to regenerate explanation', 'error');
    } finally {
      setRegeneratingAi(false);
    }
  };

  const handleActionChange = async (
    actionId: string,
    status: ActionStatus,
    createTask = false
  ) => {
    setUpdatingActionId(actionId);
    try {
      const res = await updateReportActionStatus(report.id, actionId, {
        status,
        createTask,
      });
      const updatedRecs = report.recommendations.map((r) =>
        r.id === actionId ? res.action : r
      );
      onReportUpdated({ ...report, recommendations: updatedRecs });
      if (createTask && res.createdTaskId) {
        showToast('Added recommendation to Farm Tasks / Calendar.', 'success');
        await onPortfolioChanged?.();
      } else {
        showToast(`Action marked ${res.action.status}`, 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed updating action status', 'error');
    } finally {
      setUpdatingActionId(null);
    }
  };

  // Derived values (all grounded strictly in report)
  const confLabel = confidenceWord(report.overallSummary.confidencePct);
  const totalScopedFields = Math.max(
    report.fieldIds.length,
    report.overallSummary.fieldsAssessedCount,
    report.fieldAssessments.length
  );
  const dataReadinessLabel =
    report.status === 'complete' && report.overallSummary.coveragePct >= 80
      ? 'Complete'
      : report.status === 'failed'
        ? 'Failed'
        : report.overallSummary.coveragePct >= 50
          ? 'Partial'
          : 'Limited';

  const farmConditionColor =
    report.overallSummary.conditionLabel === 'Good'
      ? { text: 'text-[#EDF5EC]', bar: 'bg-[#4DCE79]', icon: 'text-[#4DCE79]' }
      : report.overallSummary.conditionLabel === 'Monitor'
        ? { text: 'text-[#55C7DB]', bar: 'bg-[#55C7DB]', icon: 'text-[#55C7DB]' }
        : report.overallSummary.conditionLabel === 'Needs Attention'
          ? { text: 'text-[#E8B84E]', bar: 'bg-[#E8B84E]', icon: 'text-[#E8B84E]' }
          : report.overallSummary.conditionLabel === 'Alert'
            ? { text: 'text-[#F06A68]', bar: 'bg-[#F06A68]', icon: 'text-[#F06A68]' }
            : { text: 'text-[#B6C8B8]', bar: 'bg-[#879B8D]', icon: 'text-[#879B8D]' };

  const statusBadge = useMemo(() => {
    if (report.status === 'complete') {
      return {
        label: 'COMPLETE REPORT',
        cls: 'border-[#4DCE79]/70 bg-[#4DCE79]/15 text-[#77D88C]',
        dot: 'bg-[#4DCE79]',
      };
    }
    if (report.status === 'partial') {
      return {
        label: 'PARTIAL REPORT',
        cls: 'border-[#E8B84E]/75 bg-[#E8B84E]/15 text-[#E8B84E]',
        dot: 'bg-[#E8B84E]',
      };
    }
    if (report.status === 'failed') {
      return {
        label: 'FAILED REPORT',
        cls: 'border-[#F06A68]/75 bg-[#F06A68]/15 text-[#F06A68]',
        dot: 'bg-[#F06A68]',
      };
    }
    return {
      label: report.status.toUpperCase(),
      cls: 'border-[#55C7DB]/60 bg-[#55C7DB]/15 text-[#55C7DB]',
      dot: 'bg-[#55C7DB]',
    };
  }, [report.status]);

  // Overall summary text — ensures field-level alerts/exceptions are never hidden
  const overallNarrative = useMemo(() => {
    const base =
      explanationMode === 'simple'
        ? report.aiExplanation.simpleSummary || report.overallSummary.plainLanguageSummary
        : report.aiExplanation.advancedSummary || report.overallSummary.plainLanguageSummary;
    const flaggedFields = report.fieldAssessments.filter(
      (f) => f.conditionLabel === 'Alert' || f.conditionLabel === 'Needs Attention'
    );
    if (flaggedFields.length > 0) {
      const missingMention = flaggedFields.filter(
        (f) => !base.toLowerCase().includes(f.fieldName.toLowerCase())
      );
      if (missingMention.length > 0) {
        const suffix = missingMention
          .map((f) => `${f.conditionLabel} in ${f.fieldName} (${f.leadingFinding})`)
          .join('; ');
        return `${base} Field exception flagged: ${suffix}.`;
      }
    }
    return base;
  }, [explanationMode, report]);

  const combinedFindings = useMemo(
    () => [...report.findings, ...report.watchPoints],
    [report.findings, report.watchPoints]
  );

  const selectedWaterField = useMemo(
    () =>
      report.fieldAssessments.find((f) => f.fieldId === waterFieldId) ??
      report.fieldAssessments[0] ??
      null,
    [report.fieldAssessments, waterFieldId]
  );

  // Water chart series (up to 15 days)
  const waterChartData = useMemo(() => {
    if (!selectedWaterField) return { rows: [], maxPrecipMm: 10, hasMoistureSeries: false, moistureNote: '' };
    const allRows = selectedWaterField.waterSummary.dailyRows;
    const rows = allRows.slice(-15);
    const maxPrecip = Math.max(
      10,
      ...rows.map((r) =>
        Math.max(r.precipitationMm ?? 0, r.confirmedIrrigationMm ?? 0)
      )
    );
    const taw = selectedWaterField.waterSummary.tawMm;
    const surfaceVwc = selectedWaterField.waterSummary.surfaceMoisturePct;
    const rootVwc = selectedWaterField.waterSummary.rootZoneMoisturePct;
    const hasDepletionTrend =
      taw !== null && taw > 0 && rows.some((r) => r.depletionMm !== null);
    const baselineVwc = surfaceVwc ?? rootVwc;

    const points = rows.map((r) => {
      let moisturePct: number | null = null;
      if (hasDepletionTrend && taw !== null && r.depletionMm !== null) {
        // Compute remaining plant-available root-zone moisture % from FAO-56 Dr & TAW
        moisturePct = Math.max(0, Math.min(100, Math.round(((taw - r.depletionMm) / taw) * 100)));
      } else if (baselineVwc !== null) {
        moisturePct = Math.max(0, Math.min(100, Math.round(baselineVwc)));
      }
      return {
        date: r.date,
        label: new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }),
        rainMm: r.precipitationMm ?? 0,
        irrigMm: r.confirmedIrrigationMm ?? 0,
        moisturePct,
        row: r,
      };
    });

    const hasMoistureSeries = points.some((p) => p.moisturePct !== null);
    const moistureNote = hasDepletionTrend
      ? 'Soil Moisture (0–30cm / Root-Zone %)'
      : baselineVwc !== null
        ? `Soil Moisture (${selectedWaterField.waterSummary.surfaceMoistureSource})`
        : 'Soil Moisture unavailable';

    return {
      rows: points,
      maxPrecipMm: Math.ceil(maxPrecip / 5) * 5,
      hasMoistureSeries,
      moistureNote,
    };
  }, [selectedWaterField]);

  // Collapsible Section Previews (Sections 6–15) — grounded strictly in real report
  const section6Preview = useMemo(() => {
    const primary = report.fieldAssessments[0];
    if (!primary) return 'No field soil data available';
    const labPh = primary.soilSummary.labValues.find((v) =>
      v.property.toLowerCase().includes('ph')
    );
    const gridPh = primary.soilSummary.mappedEstimates.find((v) =>
      v.property.toLowerCase().includes('ph')
    );
    const om =
      primary.soilSummary.labValues.find((v) =>
        v.property.toLowerCase().includes('organic')
      ) ??
      primary.soilSummary.mappedEstimates.find((v) =>
        v.property.toLowerCase().includes('organic')
      );
    const phText = labPh
      ? `pH ${labPh.valueDisplay} (lab)`
      : gridPh
        ? `pH ${gridPh.valueDisplay} (grid)`
        : 'pH untested';
    const omText = om ? `Organic Matter ${om.valueDisplay}${om.unit}` : 'OM unavailable';
    return `Key: ${primary.soilSummary.textureClass}, ${phText}, ${omText}`;
  }, [report.fieldAssessments]);

  const section7Preview = useMemo(() => {
    const primary = report.fieldAssessments[0];
    if (!primary) return 'Weather data unavailable';
    const ws = primary.weatherSummary;
    const temp =
      ws.periodMeanTempC !== null
        ? `Mean ${formatTemp(ws.periodMeanTempC)}`
        : ws.currentTempC !== null
          ? `Now ${formatTemp(ws.currentTempC)}`
          : 'Temp unavailable';
    const rain =
      ws.periodPrecipTotalMm !== null
        ? `Rain: ${ws.periodPrecipTotalMm} mm`
        : 'Rain unavailable';
    const anom =
      ws.rainfallAnomalyPct !== null
        ? `Anomaly: ${ws.rainfallAnomalyPct >= 0 ? '+' : ''}${ws.rainfallAnomalyPct}%`
        : 'No 20y baseline';
    return `${temp}, ${rain}, ${anom}`;
  }, [report.fieldAssessments, tempUnit]);

  const section8Preview = useMemo(() => {
    const validVeg = report.fieldAssessments.find(
      (f) => f.vegetationSummary.ndviMean !== null
    );
    if (!validVeg) {
      const firstVeg = report.fieldAssessments[0]?.vegetationSummary;
      return firstVeg
        ? `Sentinel-2 NDVI: ${firstVeg.status.replace('_', ' ')} (${firstVeg.validCoveragePct}% valid pixels)`
        : 'Satellite NDVI unavailable';
    }
    const v = validVeg.vegetationSummary;
    const deltaStr =
      v.ndviDeltaFromBaseline !== null
        ? ` (${v.ndviDeltaFromBaseline >= 0 ? '↑ +' : '↓ '}${v.ndviDeltaFromBaseline.toFixed(2)} vs baseline)`
        : ` (${v.validCoveragePct}% cloud-free)`;
    return `NDVI: ${v.ndviMean!.toFixed(2)}${deltaStr}`;
  }, [report.fieldAssessments]);

  const section9Preview = useMemo(() => {
    const crops = Array.from(
      new Set(report.fieldAssessments.map((f) => f.cropName).filter(Boolean))
    );
    if (crops.length === 0) return 'No confirmed field crop sequence yet';
    const stages = report.fieldAssessments
      .map((f) => (f.cropName ? `${f.cropName}${f.cropStage ? ` (${f.cropStage})` : ''}` : null))
      .filter(Boolean);
    return stages.slice(0, 2).join(' · ') + (stages.length > 2 ? ` +${stages.length - 2}` : '');
  }, [report.fieldAssessments]);

  const section10Preview = useMemo(() => {
    const totalIrr = report.fieldAssessments.reduce(
      (acc, f) => acc + f.waterSummary.confirmedIrrigationMm,
      0
    );
    const routineField = report.fieldAssessments.find((f) => f.waterSummary.savedRoutineLabel);
    if (totalIrr > 0) {
      return `${totalIrr.toFixed(1)} mm confirmed irrigation${routineField ? ` + routine (${routineField.waterSummary.savedRoutineLabel})` : ''}`;
    }
    if (routineField) {
      return `Routine context: ${routineField.waterSummary.savedRoutineLabel} (0 mm confirmed events)`;
    }
    return 'No confirmed irrigation logs in window';
  }, [report.fieldAssessments]);

  const section12Preview = useMemo(() => {
    if (!report.comparisonWithPrevious) {
      return 'Baseline report — no prior compatible report yet';
    }
    return report.comparisonWithPrevious.summaryHeadline;
  }, [report.comparisonWithPrevious]);

  const dataGapsList = useMemo(() => {
    const gaps: Array<{ missing: string; why: string; action: string }> = [];
    const anyUntestedPh = report.fieldAssessments.some(
      (f) => !f.soilSummary.labValues.some((v) => v.property.toLowerCase().includes('ph'))
    );
    const anyMissingMoisture = report.fieldAssessments.some(
      (f) => f.waterSummary.surfaceMoisturePct === null && f.waterSummary.rootZoneMoisturePct === null
    );
    const anyZeroIrrig = report.fieldAssessments.every(
      (f) => f.waterSummary.confirmedIrrigationMm === 0
    );
    const anyCloudyVeg = report.fieldAssessments.some(
      (f) => f.vegetationSummary.status !== 'valid'
    );
    const unconfirmedCrop = report.fieldAssessments.some((f) => !f.cropConfirmed);

    if (anyUntestedPh) {
      gaps.push({
        missing: 'Measured Soil Lab pH & Organic Matter',
        why: 'Grid soil estimates carry spatial uncertainty and cannot confirm lime or nutrient availability.',
        action: 'Collect 0–20 cm composite soil cores and log lab test results in Soil & Land.',
      });
    }
    if (anyMissingMoisture) {
      gaps.push({
        missing: 'In-Situ Soil Moisture Readings',
        why: 'Direct sensor or gravimetric VWC values calibrate FAO-56 root-zone depletion thresholds.',
        action: 'Log field probe moisture % VWC or enable ERA5 soil moisture telemetry.',
      });
    }
    if (anyZeroIrrig) {
      gaps.push({
        missing: 'Confirmed Irrigation Amounts (mm)',
        why: 'Saved irrigation routines are context only and are excluded from quantitative water balance.',
        action: 'Record applied irrigation dates & volumes in Water & Irrigation logs.',
      });
    }
    if (anyCloudyVeg) {
      gaps.push({
        missing: 'Cloud-Free Sentinel-2 NDVI Scene',
        why: 'Cloud or shadow pixels masked valid canopy reflectance across the full parcel.',
        action: 'Re-run after the next clear Sentinel-2 overpass (~5 day revisit).',
      });
    }
    if (unconfirmedCrop) {
      gaps.push({
        missing: 'Confirmed Crop & Growth Stage',
        why: 'Crop coefficient Kc and GDD base temperature thresholds rely on accurate crop selection.',
        action: 'Verify each field’s active crop and planting/stage date in Field Settings.',
      });
    }
    report.warnings.forEach((w) => {
      if (!gaps.some((g) => w.toLowerCase().includes(g.missing.toLowerCase().split(' ')[0]))) {
        gaps.push({
          missing: w,
          why: 'Reported by assessment pipeline quality check.',
          action: 'Inspect Source Register (Section 14) or re-run when provider telemetry recovers.',
        });
      }
    });
    return gaps;
  }, [report.fieldAssessments, report.warnings]);

  const section13Preview = useMemo(() => {
    if (dataGapsList.length === 0) return 'No critical data gaps detected';
    return dataGapsList
      .slice(0, 3)
      .map((g) => g.missing.split(' (')[0])
      .join(', ');
  }, [dataGapsList]);

  const okSourceCount = useMemo(
    () =>
      report.sourceOutcomes.filter(
        (s) => s.status === 'complete' || s.status === 'partial' || s.status === 'fallback'
      ).length,
    [report.sourceOutcomes]
  );

  // Timeline events sorted newest-first (Section 17)
  const timelineEvents = useMemo(() => {
    const evs: Array<{ ts: string; label: string; tone: 'green' | 'cyan' | 'amber' }> = [];
    evs.push({
      ts: report.completedAt,
      label: `Analysis ${report.status === 'complete' ? 'completed' : 'finished'} (${report.overallSummary.coveragePct}% coverage)`,
      tone: report.status === 'complete' ? 'green' : 'amber',
    });

    const latestScene = report.fieldAssessments
      .map((f) => f.vegetationSummary)
      .find((v) => v.sceneDate);
    if (latestScene?.sceneDate) {
      evs.push({
        ts: `${latestScene.sceneDate}T12:00:00Z`,
        label: `Satellite scene (${latestScene.providerName}) · ${latestScene.validCoveragePct}% valid`,
        tone: latestScene.status === 'valid' ? 'green' : 'amber',
      });
    }

    const weatherSrc = report.sourceOutcomes.find((s) => s.category === 'weather_forecast');
    if (weatherSrc?.retrievedAt) {
      evs.push({
        ts: weatherSrc.retrievedAt,
        label: `Weather update (${weatherSrc.providerName})`,
        tone: 'cyan',
      });
    }

    evs.push({
      ts: report.createdAt,
      label: `Analysis started (${report.runType})`,
      tone: 'cyan',
    });

    const irrigDay = report.fieldAssessments
      .flatMap((f) =>
        f.waterSummary.dailyRows
          .filter((r) => (r.confirmedIrrigationMm ?? 0) > 0)
          .map((r) => ({ field: f.fieldName, date: r.date, mm: r.confirmedIrrigationMm! }))
      )
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
    if (irrigDay) {
      evs.push({
        ts: `${irrigDay.date}T08:00:00Z`,
        label: `Irrigation event (${irrigDay.field}: ${irrigDay.mm} mm)`,
        tone: 'green',
      });
    }

    return evs
      .filter((e) => Number.isFinite(Date.parse(e.ts)))
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, 5);
  }, [report]);

  // Run duration calculation for Section 16
  const runDurationLabel = useMemo(() => {
    const startMs = Date.parse(latestJob?.startedAt ?? report.createdAt);
    const endMs = Date.parse(latestJob?.finishedAt ?? report.completedAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      return 'Snapshot recorded';
    }
    const totalSec = Math.max(1, Math.round((endMs - startMs) / 1000));
    if (totalSec < 60) return `${totalSec}s`;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}m ${secs}s`;
  }, [latestJob?.finishedAt, latestJob?.startedAt, report.completedAt, report.createdAt]);

  // Sidebar Key Insights (3 items grounded in report)
  const sidebarInsights = useMemo(() => {
    const items: Array<{ text: string; type: 'good' | 'warn' }> = [];
    if (report.overallSummary.strengths[0]) {
      items.push({ text: report.overallSummary.strengths[0], type: 'good' });
    } else {
      items.push({
        text: `Overall farm condition: ${report.overallSummary.conditionLabel}`,
        type:
          report.overallSummary.conditionLabel === 'Good' ||
          report.overallSummary.conditionLabel === 'Monitor'
            ? 'good'
            : 'warn',
      });
    }

    const topFinding = combinedFindings[0];
    if (topFinding) {
      items.push({
        text: `${topFinding.title} in ${topFinding.fieldName}`,
        type: 'warn',
      });
    } else if (report.overallSummary.concerns[0]) {
      items.push({ text: report.overallSummary.concerns[0], type: 'warn' });
    } else {
      items.push({ text: 'No elevated field risks detected', type: 'good' });
    }

    if (report.overallSummary.strengths[1]) {
      items.push({ text: report.overallSummary.strengths[1], type: 'good' });
    } else if (report.recommendations[0]) {
      items.push({
        text: `${report.recommendations[0].fieldName}: ${report.recommendations[0].title}`,
        type: report.recommendations[0].priority === 'high' ? 'warn' : 'good',
      });
    } else {
      items.push({
        text: `Evidence coverage at ${report.overallSummary.coveragePct}%`,
        type: report.overallSummary.coveragePct >= 75 ? 'good' : 'warn',
      });
    }
    return items.slice(0, 3);
  }, [combinedFindings, report]);

  const severityPill = (sev: string) => {
    if (sev === 'critical' || sev === 'high') {
      return 'bg-[#F06A68]/20 border-[#F06A68]/55 text-[#F06A68]';
    }
    if (sev === 'moderate') {
      return 'bg-[#E8B84E]/20 border-[#E8B84E]/55 text-[#E8B84E]';
    }
    return 'bg-[#4DCE79]/18 border-[#4DCE79]/50 text-[#77D88C]';
  };

  const conditionBadge = (cond: string) => {
    if (cond === 'Good') {
      return 'bg-[#4DCE79]/20 border-[#4DCE79]/55 text-[#77D88C]';
    }
    if (cond === 'Monitor' || cond === 'Needs Attention') {
      return 'bg-[#E8B84E]/20 border-[#E8B84E]/55 text-[#E8B84E]';
    }
    if (cond === 'Alert') {
      return 'bg-[#F06A68]/20 border-[#F06A68]/55 text-[#F06A68]';
    }
    return 'bg-[#879B8D]/20 border-[#879B8D]/40 text-[#B6C8B8]';
  };

  const navJumpSections = [
    { num: 1, label: '1. Overall Farm Picture' },
    { num: 2, label: '2. Field-by-Field Assessment' },
    { num: 3, label: '3–4. Priority Findings & Strengths' },
    { num: 5, label: '5. Water Conditions' },
    { num: 6, label: '6. Soil and Land' },
    { num: 7, label: '7. Weather and Climate' },
    { num: 8, label: '8. Vegetation & NDVI' },
    { num: 9, label: '9. Crop & Rotation' },
    { num: 10, label: '10. Management Practices' },
    { num: 11, label: '11. Recommended Actions' },
    { num: 12, label: '12. What Changed' },
    { num: 13, label: '13. Data Gaps Coach' },
    { num: 14, label: '14. Data Sources' },
    { num: 15, label: '15. Methods & Provenance' },
    { num: 16, label: '16–18. Audit, Timeline & Seasonal' },
  ];

  return (
    <div
      className="fs-report-print-backdrop fixed inset-0 z-[85] bg-black/82 backdrop-blur-md flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${report.farmName} Deep Analysis Report`}
        onClick={(e) => e.stopPropagation()}
        className="fs-report-print-root relative w-full max-w-[1380px] h-[94vh] flex flex-col rounded-[14px] border border-[#28543B] bg-[#06170F] text-[#EDF5EC] shadow-[0_32px_85px_rgba(0,0,0,0.88)] overflow-hidden"
      >
        {/* Atmospheric deep forest glow (non-interactive) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -right-24 w-[480px] h-[380px] rounded-full blur-3xl opacity-35"
          style={{
            background:
              'radial-gradient(circle, rgba(77, 206, 121, 0.34) 0%, rgba(17, 47, 34, 0.25) 55%, transparent 75%)',
          }}
        />

        {/* ================================================================== */}
        {/* 2. TOP REPORT CONTROL BAR (Full Width)                             */}
        {/* ================================================================== */}
        <div
          ref={topBarRef}
          className="relative z-20 shrink-0 px-4 sm:px-5 py-2.5 border-b border-[#28543B] bg-[#092016]/95 flex flex-col gap-1.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left Metadata Blocks: Assessment Period | Last Run | Status + Freshness */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-5">
              {/* Block A: Assessment Period */}
              <div className="flex items-center gap-2.5 pr-3 sm:pr-5 border-r border-[#28543B]">
                <Calendar className="w-4 h-4 text-[#4DCE79] shrink-0" />
                <div>
                  <div className="text-[10.5px] font-medium text-[#879B8D] leading-tight">
                    Assessment Period
                  </div>
                  <div className="text-[12.5px] font-semibold text-[#EDF5EC] tabular-nums">
                    {formatDateRangeShort(report.dateRange.from, report.dateRange.to)}
                  </div>
                </div>
              </div>

              {/* Block B: Last Run */}
              <div className="flex items-center gap-2.5 pr-3 sm:pr-5 border-r border-[#28543B]">
                <Clock className="w-4 h-4 text-[#879B8D] shrink-0" />
                <div>
                  <div className="text-[10.5px] font-medium text-[#879B8D] leading-tight">
                    Last Run
                  </div>
                  <div className="text-[12.5px] font-semibold text-[#EDF5EC] tabular-nums">
                    {formatRunDateTime(report.completedAt)}
                  </div>
                </div>
              </div>

              {/* Block C: Status Badge & Freshness */}
              <div className="flex flex-col items-start gap-0.5">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[7px] border text-[10.5px] font-bold tracking-wide uppercase ${statusBadge.cls}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
                  {statusBadge.label}
                </span>
                <span className="text-[10.5px] text-[#879B8D] tabular-nums">
                  Freshness: {formatFreshness(report.completedAt)}
                </span>
              </div>
            </div>

            {/* Right Action Cluster: Sections Jump | Export Report | Print | Run New Analysis | Close */}
            <div className="no-print flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNavMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border border-[#28543B] bg-[#0D261B] hover:border-[#4DCE79]/50 text-[11.5px] font-medium text-[#B6C8B8] hover:text-[#EDF5EC] cursor-pointer"
                >
                  <Compass className="w-3.5 h-3.5 text-[#55C7DB]" />
                  <span>Jump</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                {navMenuOpen && (
                  <div className="absolute right-0 mt-1.5 w-60 max-h-80 overflow-y-auto fs-thin-scroll rounded-[10px] border border-[#28543B] bg-[#092016] shadow-2xl p-1.5 z-50">
                    {navJumpSections.map((s) => (
                      <button
                        key={s.num}
                        type="button"
                        onClick={() => jumpToSection(s.num)}
                        className="w-full text-left px-2.5 py-1.5 rounded-md text-[11.5px] text-[#B6C8B8] hover:bg-[#112F22] hover:text-[#EDF5EC] cursor-pointer"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setExportMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[#28543B] bg-[#0D261B] hover:border-[#4DCE79]/60 text-xs font-semibold text-[#EDF5EC] cursor-pointer"
                >
                  <span>Export Report</span>
                  <Download className="w-3.5 h-3.5 text-[#B6C8B8]" />
                </button>
                {exportMenuOpen && (
                  <div className="absolute right-0 mt-1.5 w-60 rounded-[10px] border border-[#28543B] bg-[#092016] shadow-2xl p-2 z-50 space-y-1 text-xs">
                    <button
                      type="button"
                      onClick={handleExportPdf}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[#112F22] text-[#EDF5EC] font-semibold cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-[#4DCE79]" />
                      <span>Download PDF Report</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const file = await exportReportFile(
                          report.id,
                          'csv',
                          includePrivateCoords
                        );
                        showToast(`Exported ${file}`, 'success');
                        setExportMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[#112F22] text-[#B6C8B8] hover:text-[#EDF5EC] cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-[#55C7DB]" />
                      <span>Export CSV Ledger</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const file = await exportReportFile(
                          report.id,
                          'json',
                          includePrivateCoords
                        );
                        showToast(`Exported ${file}`, 'success');
                        setExportMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[#112F22] text-[#B6C8B8] hover:text-[#EDF5EC] cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#58A9ED]" />
                      <span>Export Immutable JSON</span>
                    </button>
                    <label className="flex items-center gap-2 px-2.5 pt-1.5 pb-0.5 border-t border-[#28543B] text-[10.5px] text-[#879B8D] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includePrivateCoords}
                        onChange={(e) => setIncludePrivateCoords(e.target.checked)}
                        className="accent-[#4DCE79]"
                      />
                      <span>Include coordinates in JSON</span>
                    </label>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[#28543B] bg-[#0D261B] hover:border-[#4DCE79]/60 text-xs font-semibold text-[#EDF5EC] cursor-pointer"
              >
                <span>Print</span>
                <Printer className="w-3.5 h-3.5 text-[#B6C8B8]" />
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRunNewAnalysisClick?.();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] bg-gradient-to-r from-[#4DCE79] to-[#28A85B] hover:brightness-110 text-xs font-bold text-[#04180D] shadow-[0_0_16px_rgba(77,206,121,0.3)] cursor-pointer"
              >
                <span>Run New Analysis</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close report popup"
                className="w-8 h-8 rounded-[8px] border border-[#28543B] bg-[#0D261B] hover:bg-[#112F22] flex items-center justify-center text-[#B6C8B8] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Lower-right metadata bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-[#879B8D] tabular-nums">
            <span className="truncate">
              <strong className="text-[#B6C8B8]">{report.farmName}</strong> · Report {report.id}
            </span>
            <span>
              Scope: <strong className="text-[#B6C8B8]">{report.scope.label}</strong> | Input Snapshot:{' '}
              <strong className="text-[#B6C8B8]">{report.inputSnapshotId.slice(0, 12)}</strong> ({report.engineVersion})
            </span>
          </div>
        </div>

        {/* ================================================================== */}
        {/* MAIN SCROLLABLE WORKSPACE: 83–85% MAIN REPORT + 15–17% SIDEBAR     */}
        {/* ================================================================== */}
        <div
          ref={scrollContainerRef}
          className="fs-report-print-scroll relative z-10 flex-1 overflow-y-auto fs-thin-scroll p-3 sm:p-4"
        >
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_228px] xl:grid-cols-[minmax(0,1fr)_248px] gap-3 items-start">
            {/* ==================== LEFT: MAIN REPORT COLUMN ==================== */}
            <div className="space-y-3 min-w-0">
              {/* 3. FOUR SUMMARY METRIC CARDS */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {/* Card 1: Farm Condition */}
                <div className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 p-3 flex flex-col justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#B6C8B8]">
                      <Leaf className={`w-3.5 h-3.5 ${farmConditionColor.icon}`} />
                      <span>Farm Condition</span>
                    </div>
                    <div className={`text-[22px] sm:text-[24px] font-bold leading-tight mt-1 ${farmConditionColor.text}`}>
                      {report.overallSummary.conditionLabel}
                    </div>
                    <div className="text-[10.5px] text-[#879B8D] mt-0.5 truncate">
                      {report.overallSummary.conditionLabel === 'Good'
                        ? 'Overall health is strong'
                        : report.overallSummary.healthScore !== null
                          ? `Score ${report.overallSummary.healthScore}% · ${report.overallSummary.fieldsAlertCount + report.overallSummary.fieldsNeedingAttentionCount} flagged`
                          : 'Partial telemetry check'}
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#06170F] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${farmConditionColor.bar}`}
                      style={{
                        width: `${Math.max(12, Math.min(100, report.overallSummary.healthScore ?? 55))}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Card 2: Evidence Coverage */}
                <div className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 p-3 flex flex-col justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#B6C8B8]">
                      <HeartPulse className="w-3.5 h-3.5 text-[#4DCE79]" />
                      <span>Evidence Coverage</span>
                    </div>
                    <div className="text-[22px] sm:text-[24px] font-bold leading-tight text-[#EDF5EC] tabular-nums mt-1">
                      {report.overallSummary.coveragePct}%
                    </div>
                    <div className="text-[10.5px] text-[#879B8D] mt-0.5">
                      Available evidence
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#06170F] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#4DCE79]"
                      style={{ width: `${Math.min(100, report.overallSummary.coveragePct)}%` }}
                    />
                  </div>
                </div>

                {/* Card 3: Confidence (Blue Indicator — Distinct from Coverage!) */}
                <div className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 p-3 flex flex-col justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#B6C8B8]">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#58A9ED]" />
                      <span>Confidence</span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-[22px] sm:text-[24px] font-bold leading-tight text-[#EDF5EC]">
                        {confLabel}
                      </span>
                      <span className="text-[11px] font-semibold text-[#58A9ED] tabular-nums">
                        {report.overallSummary.confidencePct}%
                      </span>
                    </div>
                    <div className="text-[10.5px] text-[#879B8D] mt-0.5">
                      Analysis confidence
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#06170F] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#58A9ED]"
                      style={{ width: `${Math.min(100, report.overallSummary.confidencePct)}%` }}
                    />
                  </div>
                </div>

                {/* Card 4: Fields Assessed (with Mini Isometric Plot Illustration) */}
                <div className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 p-3 flex flex-col justify-between gap-1.5 relative overflow-hidden">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#B6C8B8]">
                        <Layers className="w-3.5 h-3.5 text-[#E8B84E]" />
                        <span>Fields Assessed</span>
                      </div>
                      <div className="text-[22px] sm:text-[24px] font-bold leading-tight text-[#EDF5EC] tabular-nums mt-1">
                        {report.overallSummary.fieldsAssessedCount} / {totalScopedFields}
                      </div>
                      <div className="text-[10.5px] text-[#879B8D] mt-0.5">
                        {report.overallSummary.fieldsAssessedCount === totalScopedFields
                          ? 'All fields assessed'
                          : `${report.overallSummary.fieldsAssessedCount} of ${totalScopedFields} assessed`}
                      </div>
                    </div>
                  </div>

                  {/* Isometric agricultural plots graphic */}
                  <div className="flex justify-end -mt-1">
                    <svg viewBox="0 0 110 34" className="w-24 h-7 opacity-90" aria-hidden="true">
                      <polygon points="55,2 104,16 55,31 6,16" fill="#287042" stroke="#4DCE79" strokeWidth="1.2" />
                      <polygon points="55,2 79,9 55,16 31,9" fill="#3C9658" />
                      <polygon points="79,9 104,16 79,23 55,16" fill="#2E8048" />
                      <polygon points="31,9 55,16 31,23 6,16" fill="#4DCE79" fillOpacity="0.55" />
                      <polygon points="55,16 79,23 55,31 31,23" fill="#246339" />
                      <line x1="31" y1="9" x2="79" y2="23" stroke="#77D88C" strokeWidth="0.7" strokeOpacity="0.6" />
                      <line x1="79" y1="9" x2="31" y2="23" stroke="#77D88C" strokeWidth="0.7" strokeOpacity="0.6" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* 4. SECTION 1 — OVERALL FARM PICTURE */}
              <section
                ref={(el) => {
                  section6To15Refs.current['1'] = el as HTMLDivElement | null;
                }}
                className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 p-3.5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#4DCE79] text-[#04180D] text-[11px] font-bold flex items-center justify-center shrink-0">
                      1
                    </span>
                    <h2 className="text-[14px] font-semibold text-[#EDF5EC]">
                      Overall Farm Picture
                    </h2>
                  </div>

                  <div className="no-print flex items-center gap-1.5 text-[10.5px]">
                    <button
                      type="button"
                      onClick={() =>
                        setExplanationMode((m) => (m === 'simple' ? 'advanced' : 'simple'))
                      }
                      className="px-2 py-0.5 rounded border border-[#28543B] bg-[#112F22] text-[#B6C8B8] hover:text-[#EDF5EC] cursor-pointer"
                    >
                      {explanationMode === 'simple' ? 'Technical Detail' : 'Simple Summary'}
                    </button>
                    <button
                      type="button"
                      disabled={regeneratingAi}
                      onClick={handleRegenerateAi}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#28543B] bg-[#112F22] text-[#55C7DB] hover:border-[#55C7DB]/50 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${regeneratingAi ? 'animate-spin' : ''}`} />
                      <span>{report.aiExplanation.available ? 'AI Summary' : 'Refresh'}</span>
                    </button>
                  </div>
                </div>

                {/* 3-Part Horizontal Layout: Photo (26%) | Summary + 3 Indicators (48%) | Top Next Action (26%) */}
                <div className="grid grid-cols-1 md:grid-cols-[26fr_48fr_26fr] gap-3.5 items-center">
                  {/* Left: Rounded Farm Photo */}
                  <div className="rounded-[10px] overflow-hidden border border-[#28543B] h-[126px] bg-[#092016]">
                    <img
                      src={heroFarmlandImg}
                      alt={`${report.farmName} agricultural landscape`}
                      className="w-full h-full object-cover object-center"
                    />
                  </div>

                  {/* Middle: Plain-Language Summary + Divider + 3 Indicators */}
                  <div className="space-y-3 min-w-0">
                    <p className="text-[12.5px] leading-relaxed text-[#EDF5EC]">
                      {overallNarrative}
                    </p>

                    <div className="border-t border-[#28543B] pt-2.5 grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-[10.5px] text-[#879B8D]">Evidence Coverage</div>
                        <div className="text-[14px] font-bold text-[#77D88C] tabular-nums">
                          {report.overallSummary.coveragePct}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[10.5px] text-[#879B8D]">Confidence</div>
                        <div className="text-[14px] font-bold text-[#77D88C]">
                          {confLabel}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10.5px] text-[#879B8D]">Data Readiness</div>
                        <div className="text-[14px] font-bold text-[#77D88C]">
                          {dataReadinessLabel}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right: Top Next Action Card */}
                  <div className="rounded-[10px] border border-[#28543B] bg-[#112F22] p-3 flex flex-col justify-between gap-2.5 h-full">
                    <div className="space-y-2">
                      <div className="text-[12.5px] font-semibold text-[#EDF5EC]">
                        Top Next Action
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="w-6 h-6 rounded-full bg-[#E8B84E]/15 border border-[#E8B84E]/40 flex items-center justify-center text-[#E8B84E] shrink-0 mt-0.5">
                          <Flame className="w-3.5 h-3.5" />
                        </span>
                        <p className="text-[11.5px] leading-snug text-[#EDF5EC] font-medium">
                          {report.overallSummary.priorityNextAction ||
                            report.recommendations[0]?.title ||
                            'Continue scheduled field monitoring.'}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => jumpToSection(11)}
                      className="no-print w-full py-1.5 px-3 rounded-[8px] border border-[#4DCE79]/55 bg-[#0D261B] hover:bg-[#153C2A] text-[11.5px] font-semibold text-[#77D88C] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>View Details</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </section>

              {/* 5. SECTION 2 — FIELD-BY-FIELD ASSESSMENT */}
              <section
                ref={(el) => {
                  section6To15Refs.current['2'] = el as HTMLDivElement | null;
                }}
                className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 overflow-hidden"
              >
                <div className="px-3.5 py-2.5 border-b border-[#28543B] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#4DCE79] text-[#04180D] text-[11px] font-bold flex items-center justify-center shrink-0">
                      2
                    </span>
                    <h2 className="text-[14px] font-semibold text-[#EDF5EC]">
                      Field-by-Field Assessment
                    </h2>
                  </div>
                  <span className="text-[10.5px] text-[#879B8D]">
                    Individual field risk is preserved separately from whole-farm averages
                  </span>
                </div>

                <div className="overflow-x-auto fs-thin-scroll">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#112F22] text-[#879B8D] text-[10.5px] font-semibold border-b border-[#28543B]">
                      <tr>
                        <th className="py-2 px-3">Field</th>
                        <th className="py-2 px-2.5 text-right">Area</th>
                        <th className="py-2 px-2.5">Crop / Stage</th>
                        <th className="py-2 px-2.5">Condition</th>
                        <th className="py-2 px-2.5 text-center">Coverage</th>
                        <th className="py-2 px-2.5">Key Finding</th>
                        <th className="py-2 px-2.5">Next Action</th>
                        <th className="py-2 px-2.5 whitespace-nowrap">Last Observation</th>
                        <th className="no-print py-2 px-3 text-right">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#28543B]/65 text-[11.5px]">
                      {report.fieldAssessments.map((fa) => (
                        <tr key={fa.fieldId} className="hover:bg-[#112F22]/75 transition-colors">
                          <td className="py-2 px-3 font-semibold text-[#EDF5EC] whitespace-nowrap">
                            {fa.fieldName}
                          </td>
                          <td className="py-2 px-2.5 text-right tabular-nums text-[#B6C8B8] whitespace-nowrap">
                            {fa.areaHa.toFixed(1)} ha
                          </td>
                          <td className="py-2 px-2.5 text-[#EDF5EC] whitespace-nowrap">
                            {fa.cropName || 'Unknown'}
                            {fa.cropStage ? ` – ${fa.cropStage}` : ''}
                          </td>
                          <td className="py-2 px-2.5 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${conditionBadge(
                                fa.conditionLabel
                              )}`}
                            >
                              {fa.conditionLabel}
                            </span>
                          </td>
                          <td className="py-2 px-2.5 text-center tabular-nums text-[#EDF5EC]">
                            {fa.coveragePct}%
                          </td>
                          <td className="py-2 px-2.5 text-[#B6C8B8] max-w-[180px] truncate" title={fa.leadingFinding}>
                            {fa.leadingFinding}
                          </td>
                          <td className="py-2 px-2.5 text-[#B6C8B8] max-w-[170px] truncate" title={fa.recommendedNextAction}>
                            {fa.recommendedNextAction}
                          </td>
                          <td className="py-2 px-2.5 text-[#B6C8B8] whitespace-nowrap tabular-nums">
                            {formatShortDate(fa.lastUpdatedAt)}
                          </td>
                          <td className="no-print py-2 px-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setInspectedField(fa)}
                              className="px-2.5 py-0.5 rounded-[6px] border border-[#58A9ED]/50 bg-[#58A9ED]/18 hover:bg-[#58A9ED]/30 text-[10.5px] font-semibold text-[#58A9ED] cursor-pointer"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 6. SIDE-BY-SIDE SECTIONS: 3. PRIORITY FINDINGS & 4. STRENGTHS */}
              <div
                ref={(el) => {
                  section6To15Refs.current['3'] = el as HTMLDivElement | null;
                }}
                className="grid grid-cols-1 lg:grid-cols-[54fr_46fr] gap-2.5"
              >
                {/* Section 3: Priority Findings and Risks */}
                <section className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 p-3.5 flex flex-col justify-between gap-2.5">
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-[#F06A68] shrink-0" />
                      <h2 className="text-[14px] font-semibold text-[#EDF5EC]">
                        Priority Findings and Risks
                      </h2>
                    </div>

                    {combinedFindings.length === 0 ? (
                      <div className="rounded-[8px] border border-[#28543B] bg-[#112F22] p-3 text-[11.5px] text-[#77D88C]">
                        No priority risks or watch points crossed alert thresholds in this period.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="text-[10px] font-semibold text-[#879B8D] border-b border-[#28543B]">
                            <tr>
                              <th className="py-1.5 pr-2">#</th>
                              <th className="py-1.5 px-1.5">Severity</th>
                              <th className="py-1.5 px-1.5">Finding</th>
                              <th className="py-1.5 px-1.5">Affected Field</th>
                              <th className="py-1.5 px-1.5">Evidence</th>
                              <th className="py-1.5 pl-1.5 text-right">Confidence</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#28543B]/60 text-[11px]">
                            {combinedFindings.slice(0, 4).map((fn, idx) => {
                              const matchingField = report.fieldAssessments.find(
                                (f) => f.fieldId === fn.fieldId
                              );
                              return (
                                <tr key={fn.id}>
                                  <td className="py-2 pr-2 tabular-nums text-[#879B8D]">
                                    {idx + 1}
                                  </td>
                                  <td className="py-2 px-1.5 whitespace-nowrap">
                                    <span
                                      className={`px-2 py-0.5 rounded-full border text-[10px] font-bold capitalize ${severityPill(
                                        fn.severity
                                      )}`}
                                    >
                                      {fn.isWatchPoint ? 'Watch' : fn.severity}
                                    </span>
                                  </td>
                                  <td className="py-2 px-1.5 text-[#EDF5EC] font-medium">
                                    {fn.title}
                                  </td>
                                  <td className="py-2 px-1.5 whitespace-nowrap">
                                    {matchingField ? (
                                      <button
                                        type="button"
                                        onClick={() => setInspectedField(matchingField)}
                                        className="text-[#55C7DB] hover:underline font-medium cursor-pointer"
                                      >
                                        {fn.fieldName}
                                      </button>
                                    ) : (
                                      <span className="text-[#55C7DB]">{fn.fieldName}</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-1.5 whitespace-nowrap">
                                    {fn.evidenceIds[0] ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          inspectEvidenceById(
                                            fn.evidenceIds[0],
                                            fn.title,
                                            fn.fieldId
                                          )
                                        }
                                        className="text-[#B6C8B8] hover:text-[#55C7DB] underline decoration-dotted cursor-pointer"
                                      >
                                        {formatDateRangeShort(
                                          report.dateRange.from,
                                          report.dateRange.to
                                        ).split(',')[0]}
                                      </button>
                                    ) : (
                                      <span className="text-[#879B8D]">
                                        {fn.sourceQualityStatus}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2 pl-1.5 text-right tabular-nums font-semibold text-[#EDF5EC]">
                                    {fn.confidencePct}%
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="no-print pt-1">
                    <button
                      type="button"
                      onClick={() => setAllFindingsOpen(true)}
                      className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#55C7DB] hover:underline cursor-pointer"
                    >
                      <span>View All Findings ({combinedFindings.length})</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </section>

                {/* Section 4: Strengths and Favourable Conditions */}
                <section className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#4DCE79] text-[#04180D] text-[11px] font-bold flex items-center justify-center shrink-0">
                      4
                    </span>
                    <h2 className="text-[14px] font-semibold text-[#EDF5EC]">
                      Strengths and Favourable Conditions
                    </h2>
                  </div>

                  {report.overallSummary.strengths.length === 0 ? (
                    <div className="rounded-[8px] border border-[#28543B] bg-[#112F22] p-3 text-[11.5px] text-[#B6C8B8]">
                      Limited favourable indicators verified until soil/moisture telemetry coverage increases.
                    </div>
                  ) : (
                    <ul className="space-y-2 pt-0.5">
                      {report.overallSummary.strengths.map((str, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-[12px] text-[#EDF5EC]">
                          <span className="w-4 h-4 rounded-full bg-[#4DCE79] text-[#04180D] flex items-center justify-center shrink-0 mt-0.5">
                            <Check className="w-2.5 h-2.5 stroke-[3]" />
                          </span>
                          <span className="leading-snug">{str}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              {/* 7. SECTION 5 — WATER CONDITIONS */}
              <section
                ref={(el) => {
                  section6To15Refs.current['5'] = el as HTMLDivElement | null;
                }}
                className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 p-3.5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Droplets className="w-4 h-4 text-[#58A9ED] shrink-0" />
                    <h2 className="text-[14px] font-semibold text-[#EDF5EC]">
                      Water Conditions
                    </h2>
                    {selectedWaterField && (
                      <span className="text-[10.5px] text-[#879B8D]">
                        ({selectedWaterField.waterSummary.et0Method})
                      </span>
                    )}
                  </div>

                  {report.fieldAssessments.length > 1 && (
                    <div className="no-print flex flex-wrap items-center gap-1">
                      {report.fieldAssessments.map((f) => (
                        <button
                          key={f.fieldId}
                          type="button"
                          onClick={() => setWaterFieldId(f.fieldId)}
                          className={`px-2 py-0.5 rounded-md text-[10.5px] font-semibold cursor-pointer ${
                            selectedWaterField?.fieldId === f.fieldId
                              ? 'bg-[#55C7DB]/20 border border-[#55C7DB]/60 text-[#55C7DB]'
                              : 'bg-[#112F22] border border-[#28543B] text-[#B6C8B8]'
                          }`}
                        >
                          {f.fieldName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedWaterField && (
                  <div className="grid grid-cols-1 lg:grid-cols-[52fr_48fr] gap-3.5 items-stretch">
                    {/* Left: Soil Moisture & Rainfall Trend Combo Chart */}
                    <div className="lg:pr-3 lg:border-r lg:border-[#28543B] flex flex-col justify-between">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[11.5px] font-semibold text-[#B6C8B8]">
                          Soil Moisture &amp; Rainfall Trend
                        </span>
                        <span className="text-[10px] text-[#879B8D]">
                          {selectedWaterField.fieldName} · Rain/Irrig scaled to {waterChartData.maxPrecipMm} mm
                        </span>
                      </div>

                      <div className="rounded-[8px] border border-[#28543B]/70 bg-[#092016] p-2.5 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <svg
                            viewBox="0 0 380 155"
                            className="w-full h-[148px]"
                            role="img"
                            aria-label="Soil moisture, rainfall and confirmed irrigation trend"
                          >
                            {/* Horizontal Y gridlines (0% to 100%) */}
                            {[0, 25, 50, 75, 100].map((pct) => {
                              const y = 130 - (pct / 100) * 112;
                              return (
                                <g key={pct}>
                                  <line
                                    x1="34"
                                    y1={y}
                                    x2="372"
                                    y2={y}
                                    stroke="#28543B"
                                    strokeOpacity="0.55"
                                    strokeWidth="0.7"
                                  />
                                  <text
                                    x="29"
                                    y={y + 3}
                                    textAnchor="end"
                                    fill="#879B8D"
                                    fontSize="8.5"
                                  >
                                    {pct}%
                                  </text>
                                </g>
                              );
                            })}

                            {/* Bars for Rainfall (Blue) and Confirmed Irrigation (Green) */}
                            {waterChartData.rows.map((pt, i) => {
                              const count = Math.max(1, waterChartData.rows.length);
                              const plotW = 334;
                              const step = plotW / count;
                              const cx = 38 + step * i + step / 2;
                              const rainH =
                                (pt.rainMm / waterChartData.maxPrecipMm) * 98;
                              const irrigH =
                                (pt.irrigMm / waterChartData.maxPrecipMm) * 98;

                              return (
                                <g key={pt.date}>
                                  {pt.rainMm > 0 && (
                                    <rect
                                      x={cx - 6}
                                      y={130 - rainH}
                                      width="5.5"
                                      height={Math.max(2, rainH)}
                                      rx="1.2"
                                      fill="#58A9ED"
                                    >
                                      <title>{`${pt.label}: Rain ${pt.rainMm} mm`}</title>
                                    </rect>
                                  )}
                                  {pt.irrigMm > 0 && (
                                    <rect
                                      x={cx + 0.5}
                                      y={130 - irrigH}
                                      width="5.5"
                                      height={Math.max(2, irrigH)}
                                      rx="1.2"
                                      fill="#4DCE79"
                                    >
                                      <title>{`${pt.label}: Confirmed Irrigation ${pt.irrigMm} mm`}</title>
                                    </rect>
                                  )}
                                  {(i === 0 ||
                                    i === Math.floor(count / 3) ||
                                    i === Math.floor((2 * count) / 3) ||
                                    i === count - 1) && (
                                    <text
                                      x={cx}
                                      y="145"
                                      textAnchor="middle"
                                      fill="#879B8D"
                                      fontSize="8.5"
                                    >
                                      {pt.label}
                                    </text>
                                  )}
                                </g>
                              );
                            })}

                            {/* Soil Moisture Trend Line (Cyan) */}
                            {waterChartData.hasMoistureSeries && (
                              <>
                                <polyline
                                  fill="none"
                                  stroke="#55C7DB"
                                  strokeWidth="2.2"
                                  strokeLinejoin="round"
                                  strokeLinecap="round"
                                  points={waterChartData.rows
                                    .map((pt, i) => {
                                      if (pt.moisturePct === null) return null;
                                      const count = Math.max(1, waterChartData.rows.length);
                                      const step = 334 / count;
                                      const x = 38 + step * i + step / 2;
                                      const y = 130 - (pt.moisturePct / 100) * 112;
                                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                                    })
                                    .filter(Boolean)
                                    .join(' ')}
                                />
                                {waterChartData.rows.map((pt, i) => {
                                  if (pt.moisturePct === null) return null;
                                  const count = Math.max(1, waterChartData.rows.length);
                                  const step = 334 / count;
                                  const x = 38 + step * i + step / 2;
                                  const y = 130 - (pt.moisturePct / 100) * 112;
                                  return (
                                    <circle
                                      key={`m-${pt.date}`}
                                      cx={x}
                                      cy={y}
                                      r="2.4"
                                      fill="#55C7DB"
                                    >
                                      <title>{`${pt.label}: Moisture ${pt.moisturePct}%`}</title>
                                    </circle>
                                  );
                                })}
                              </>
                            )}
                          </svg>
                        </div>

                        {/* Dedicated Right Legend (Never Covers Chart) */}
                        <div className="shrink-0 w-28 space-y-2 text-[10px]">
                          <div className="flex items-start gap-1.5">
                            <span className="w-3 h-0.5 bg-[#55C7DB] mt-1.5 shrink-0" />
                            <span className="text-[#B6C8B8] leading-tight">
                              {waterChartData.hasMoistureSeries
                                ? 'Soil Moisture (0–30cm)'
                                : 'Moisture (N/A)'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-[2px] bg-[#58A9ED] shrink-0" />
                            <span className="text-[#B6C8B8]">Rainfall (mm)</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-[2px] bg-[#4DCE79] shrink-0" />
                            <span className="text-[#B6C8B8]">Irrigation (mm)</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Compact Water Daily Table (Horizontally Scrollable) */}
                    <div className="flex flex-col justify-between space-y-2 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <EvidenceBtn
                          id={`ev-${selectedWaterField.fieldId}-water`}
                          label="Water Provenance"
                          fieldId={selectedWaterField.fieldId}
                        />
                        {selectedWaterField.waterSummary.dailyRows.length > 5 && (
                          <button
                            type="button"
                            onClick={() => setShowAllWaterRows((v) => !v)}
                            className="no-print text-[10.5px] font-semibold text-[#55C7DB] hover:underline cursor-pointer"
                          >
                            {showAllWaterRows
                              ? 'Show Latest Days'
                              : `Show All (${selectedWaterField.waterSummary.dailyRows.length}d)`}
                          </button>
                        )}
                      </div>

                      <div className="overflow-x-auto fs-thin-scroll rounded-[8px] border border-[#28543B]/70 bg-[#092016] max-h-[164px]">
                        <table className="w-full text-center border-collapse tabular-nums">
                          <thead className="bg-[#112F22] text-[#879B8D] text-[10px] font-semibold sticky top-0 border-b border-[#28543B]">
                            <tr>
                              <th className="py-1.5 px-2 text-left">Date</th>
                              <th className="py-1.5 px-1.5">ET₀</th>
                              <th className="py-1.5 px-1.5">Kc</th>
                              <th className="py-1.5 px-1.5">ETc (mm)</th>
                              <th className="py-1.5 px-1.5">Rain (mm)</th>
                              <th className="py-1.5 px-1.5">Eff. Rain</th>
                              <th className="py-1.5 px-2">Irrigation</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#28543B]/50 text-[10.5px] text-[#EDF5EC]">
                            {(showAllWaterRows
                              ? selectedWaterField.waterSummary.dailyRows
                              : selectedWaterField.waterSummary.dailyRows.slice(-5)
                            ).map((r) => (
                              <tr key={`${r.date}-${r.dataKind}`}>
                                <td className="py-1.5 px-2 text-left whitespace-nowrap text-[#B6C8B8]">
                                  {new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    timeZone: 'UTC',
                                  })}
                                  {r.dataKind === 'forecast' && (
                                    <span className="ml-1 text-[9px] text-[#55C7DB]">F</span>
                                  )}
                                </td>
                                <td className="py-1.5 px-1.5">
                                  {r.et0Mm !== null ? r.et0Mm.toFixed(1) : '—'}
                                </td>
                                <td className="py-1.5 px-1.5">
                                  {r.kc !== null ? r.kc.toFixed(2) : '—'}
                                </td>
                                <td className="py-1.5 px-1.5">
                                  {r.etcMm !== null ? r.etcMm.toFixed(1) : '—'}
                                </td>
                                <td className="py-1.5 px-1.5">
                                  {r.precipitationMm !== null ? r.precipitationMm.toFixed(1) : '—'}
                                </td>
                                <td className="py-1.5 px-1.5">
                                  {r.effectiveRainMm !== null ? r.effectiveRainMm.toFixed(1) : '—'}
                                </td>
                                <td className="py-1.5 px-2">
                                  {(r.confirmedIrrigationMm ?? 0).toFixed(1)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* 8. COLLAPSIBLE DIAGNOSTIC SECTIONS (6–15) */}
              <div className="space-y-2">
                {[
                  {
                    num: 6,
                    title: 'Soil and Land',
                    preview: section6Preview,
                    icon: AlertTriangle,
                    iconColor: 'text-[#ED8951]',
                  },
                  {
                    num: 7,
                    title: 'Weather and Climate Exposure',
                    preview: section7Preview,
                    icon: CloudSun,
                    iconColor: 'text-[#E8B84E]',
                  },
                  {
                    num: 8,
                    title: 'Vegetation and Field Change',
                    preview: section8Preview,
                    icon: Sprout,
                    iconColor: 'text-[#4DCE79]',
                  },
                  {
                    num: 9,
                    title: 'Crop and Rotation Implications',
                    preview: section9Preview,
                    icon: Repeat,
                    iconColor: 'text-[#4DCE79]',
                  },
                  {
                    num: 10,
                    title: 'Management Practices Used',
                    preview: section10Preview,
                    icon: Wrench,
                    iconColor: 'text-[#E8B84E]',
                  },
                  {
                    num: 11,
                    title: 'Recommended Actions',
                    preview: `${report.recommendations.length} Action${report.recommendations.length === 1 ? '' : 's'}`,
                    isActionBadge: true,
                    icon: Lightbulb,
                    iconColor: 'text-[#E8B84E]',
                  },
                  {
                    num: 12,
                    title: 'What Changed Since Previous Report',
                    preview: section12Preview,
                    icon: GitCompare,
                    iconColor: 'text-[#55C7DB]',
                  },
                  {
                    num: 13,
                    title: 'Data Gaps and Data Gap Coach',
                    preview: section13Preview,
                    icon: Info,
                    iconColor: 'text-[#58A9ED]',
                  },
                  {
                    num: 14,
                    title: 'Data Coverage and Source Register',
                    preview: `${okSourceCount} sources, ${report.overallSummary.coveragePct}% coverage`,
                    icon: Database,
                    iconColor: 'text-[#58A9ED]',
                  },
                  {
                    num: 15,
                    title: 'Methods, Formulas and Provenance',
                    preview: 'See technical details →',
                    isCyanLink: true,
                    icon: Settings2,
                    iconColor: 'text-[#58A9ED]',
                  },
                ].map((sec) => {
                  const isOpen = !!expandedSections[sec.num];
                  const Icon = sec.icon;
                  return (
                    <div
                      key={sec.num}
                      ref={(el) => {
                        section6To15Refs.current[String(sec.num)] = el;
                      }}
                      className="rounded-[10px] border border-[#28543B] bg-[#0D261B]/90 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSection(sec.num)}
                        aria-expanded={isOpen}
                        className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-[#112F22]/85 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className={`w-4 h-4 shrink-0 ${sec.iconColor}`} />
                          <span className="text-[12px] font-bold text-[#879B8D] tabular-nums w-4">
                            {sec.num}
                          </span>
                          <span className="text-[12.5px] font-semibold text-[#EDF5EC] truncate">
                            {sec.title}
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0 max-w-[52%]">
                          {sec.isActionBadge ? (
                            <span className="px-2.5 py-0.5 rounded-[6px] border border-[#E8B84E]/65 bg-[#E8B84E]/15 text-[11px] font-bold text-[#E8B84E]">
                              {sec.preview}
                            </span>
                          ) : sec.isCyanLink ? (
                            <span className="text-[11.5px] font-semibold text-[#55C7DB]">
                              {sec.preview}
                            </span>
                          ) : (
                            <span className="text-[11.5px] text-[#B6C8B8] truncate hidden sm:inline">
                              {sec.preview}
                            </span>
                          )}
                          <ChevronRight
                            className={`w-4 h-4 text-[#879B8D] transition-transform ${
                              isOpen ? 'rotate-90 text-[#4DCE79]' : ''
                            }`}
                          />
                        </div>
                      </button>

                      {/* Expanded Content Body */}
                      {isOpen && (
                        <div className="px-4 py-3 border-t border-[#28543B] bg-[#092016] text-[12px] space-y-3">
                          {/* Section 6: Soil and Land */}
                          {sec.num === 6 &&
                            report.fieldAssessments.map((fa) => (
                              <div
                                key={fa.fieldId}
                                className="rounded-[8px] border border-[#28543B] bg-[#0D261B] p-3 space-y-2"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold text-[#EDF5EC]">
                                    {fa.fieldName} · {fa.soilSummary.textureClass} (
                                    {fa.soilSummary.textureSource})
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-[#55C7DB] tabular-nums">
                                      Elev: {fa.soilSummary.elevationM ?? '—'} m · Slope:{' '}
                                      {fa.soilSummary.slopePct ?? '—'}%
                                    </span>
                                    <EvidenceBtn
                                      id={`ev-${fa.fieldId}-soil`}
                                      label="Soil Src"
                                      fieldId={fa.fieldId}
                                    />
                                  </div>
                                </div>
                                {fa.soilSummary.labVsMapDiscrepancyNote && (
                                  <div className="text-[11px] text-[#E8B84E]">
                                    Notice: {fa.soilSummary.labVsMapDiscrepancyNote}
                                  </div>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px]">
                                  <div className="rounded border border-[#28543B]/70 bg-[#092016] p-2 space-y-1">
                                    <div className="font-semibold text-[#77D88C]">
                                      Farmer Lab Measurements
                                    </div>
                                    {fa.soilSummary.labValues.length === 0 ? (
                                      <div className="text-[#879B8D]">No soil lab records entered.</div>
                                    ) : (
                                      fa.soilSummary.labValues.map((v, idx) => (
                                        <div key={idx} className="flex justify-between gap-2">
                                          <span className="text-[#B6C8B8]">
                                            {v.property} ({v.depthInterval})
                                          </span>
                                          <span className="font-semibold text-[#EDF5EC] tabular-nums">
                                            {v.valueDisplay} {v.unit}
                                          </span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  <div className="rounded border border-[#28543B]/70 bg-[#092016] p-2 space-y-1">
                                    <div className="font-semibold text-[#55C7DB]">
                                      National Survey &amp; Grid Estimates
                                    </div>
                                    {fa.soilSummary.mappedEstimates.length === 0 ? (
                                      <div className="text-[#879B8D]">
                                        Grid soil estimate unavailable for coordinates.
                                      </div>
                                    ) : (
                                      fa.soilSummary.mappedEstimates.map((v, idx) => (
                                        <div key={idx} className="flex justify-between gap-2">
                                          <span className="text-[#B6C8B8]">
                                            {v.property} ({v.providerLabel})
                                          </span>
                                          <span className="font-semibold text-[#EDF5EC] tabular-nums">
                                            {v.valueDisplay} {v.unit}
                                          </span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}

                          {/* Section 7: Weather and Climate Exposure */}
                          {sec.num === 7 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                              {report.fieldAssessments.map((fa) => (
                                <div
                                  key={fa.fieldId}
                                  className="rounded-[8px] border border-[#28543B] bg-[#0D261B] p-3 space-y-1.5 text-[11.5px]"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-[#EDF5EC]">
                                      {fa.fieldName}
                                    </span>
                                    <EvidenceBtn
                                      id={`ev-${fa.fieldId}-weather`}
                                      label="Weather Src"
                                      fieldId={fa.fieldId}
                                    />
                                  </div>
                                  <div className="text-[#B6C8B8]">
                                    Current: <strong className="text-[#EDF5EC]">{formatTemp(fa.weatherSummary.currentTempC)}</strong> · Period Mean:{' '}
                                    <strong className="text-[#EDF5EC]">{formatTemp(fa.weatherSummary.periodMeanTempC)}</strong>
                                  </div>
                                  <div className="text-[#B6C8B8]">
                                    7-Day Forecast: <strong className="text-[#EDF5EC]">{fa.weatherSummary.forecastHighLow7d}</strong>
                                  </div>
                                  <div className="text-[#B6C8B8]">
                                    Observed Rain: <strong className="text-[#77D88C]">{fa.weatherSummary.periodPrecipTotalMm ?? '—'} mm</strong> · Dry Spell:{' '}
                                    <strong className="text-[#EDF5EC]">{fa.weatherSummary.drySpellDays ?? '—'}d</strong> · Heat/Frost:{' '}
                                    <strong className="text-[#EDF5EC]">
                                      {fa.weatherSummary.heatStressDays ?? 0} / {fa.weatherSummary.frostDays ?? 0}d
                                    </strong>
                                  </div>
                                  <div className="text-[#879B8D] text-[11px]">
                                    GDD: {fa.weatherSummary.gddAccumulated !== null ? `${fa.weatherSummary.gddAccumulated} °C·d` : 'Unavailable'} — {fa.weatherSummary.gddNote}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Section 8: Vegetation and Field Change */}
                          {sec.num === 8 &&
                            report.fieldAssessments.map((fa) => (
                              <div
                                key={fa.fieldId}
                                className="rounded-[8px] border border-[#28543B] bg-[#0D261B] p-3 space-y-2 text-[11.5px]"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold text-[#EDF5EC] flex items-center gap-1.5">
                                    <Satellite className="w-3.5 h-3.5 text-[#4DCE79]" />
                                    {fa.fieldName} · {fa.vegetationSummary.providerName}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded border border-[#28543B] bg-[#112F22] text-[10px] uppercase font-bold text-[#77D88C]">
                                      {fa.vegetationSummary.status}
                                    </span>
                                    <EvidenceBtn
                                      id={fa.vegetationSummary.evidenceId}
                                      label="NDVI Src"
                                      fieldId={fa.fieldId}
                                    />
                                  </div>
                                </div>
                                <p className="text-[#B6C8B8]">{fa.vegetationSummary.note}</p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 tabular-nums">
                                  <div>
                                    Mean NDVI:{' '}
                                    <strong className="text-[#77D88C]">
                                      {fa.vegetationSummary.ndviMean !== null
                                        ? fa.vegetationSummary.ndviMean.toFixed(3)
                                        : 'Masked/Unavail'}
                                    </strong>
                                  </div>
                                  <div>
                                    Baseline Delta:{' '}
                                    <strong className="text-[#55C7DB]">
                                      {fa.vegetationSummary.ndviDeltaFromBaseline !== null
                                        ? `${fa.vegetationSummary.ndviDeltaFromBaseline >= 0 ? '+' : ''}${fa.vegetationSummary.ndviDeltaFromBaseline.toFixed(3)}`
                                        : 'None'}
                                    </strong>
                                  </div>
                                  <div>
                                    Valid Coverage:{' '}
                                    <strong>{fa.vegetationSummary.validCoveragePct}%</strong>
                                  </div>
                                  <div>
                                    Scene Date:{' '}
                                    <strong>{fa.vegetationSummary.sceneDate || 'Unavailable'}</strong>
                                  </div>
                                </div>
                                {fa.vegetationSummary.sclBreakdown && (
                                  <div className="text-[10.5px] text-[#879B8D] tabular-nums">
                                    SCL Pixels — Veg: {fa.vegetationSummary.sclBreakdown.vegetationPixels} · Bare Soil:{' '}
                                    {fa.vegetationSummary.sclBreakdown.bareSoilPixels} · Cloud:{' '}
                                    {fa.vegetationSummary.sclBreakdown.cloudPixels} · Shadow:{' '}
                                    {fa.vegetationSummary.sclBreakdown.cloudShadowPixels} · Cloud-Free:{' '}
                                    {fa.vegetationSummary.sclBreakdown.cloudFreePct}%
                                  </div>
                                )}
                              </div>
                            ))}

                          {/* Section 9: Crop and Rotation Implications */}
                          {sec.num === 9 && (
                            <div className="space-y-2">
                              {report.fieldAssessments.map((fa) => (
                                <div
                                  key={fa.fieldId}
                                  className="rounded-[8px] border border-[#28543B] bg-[#0D261B] p-2.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px]"
                                >
                                  <div>
                                    <strong className="text-[#EDF5EC]">{fa.fieldName}</strong>:{' '}
                                    <span className="text-[#77D88C]">
                                      {fa.cropName || 'Crop unspecified'}
                                    </span>{' '}
                                    {fa.cropStage ? `(${fa.cropStage})` : ''} ·{' '}
                                    <span className="text-[#879B8D]">
                                      {fa.cropConfirmed ? 'Confirmed crop' : 'Unconfirmed default'}
                                    </span>
                                  </div>
                                  <div className="text-[#B6C8B8] tabular-nums">
                                    Kc applied: {fa.waterSummary.kcApplied ?? 'Unavailable'} ·{' '}
                                    {fa.recommendedNextAction}
                                  </div>
                                </div>
                              ))}
                              {onOpenRotationPlan && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    onOpenRotationPlan();
                                  }}
                                  className="no-print text-[11px] font-semibold text-[#55C7DB] hover:underline cursor-pointer"
                                >
                                  Open Full Crop Rotation Planner →
                                </button>
                              )}
                            </div>
                          )}

                          {/* Section 10: Management Practices Used */}
                          {sec.num === 10 && (
                            <div className="space-y-2 text-[11.5px]">
                              <p className="text-[#B6C8B8]">
                                Confirmed field events are kept strictly separate from saved routine assumptions. Saved routines serve as operational context only and are never treated as proof that irrigation occurred.
                              </p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {report.fieldAssessments.map((fa) => (
                                  <div
                                    key={fa.fieldId}
                                    className="rounded-[8px] border border-[#28543B] bg-[#0D261B] p-2.5 space-y-1"
                                  >
                                    <div className="font-semibold text-[#EDF5EC]">
                                      {fa.fieldName}
                                    </div>
                                    <div className="text-[#77D88C] tabular-nums">
                                      Confirmed Irrigation Applied:{' '}
                                      <strong>{fa.waterSummary.confirmedIrrigationMm} mm</strong>
                                    </div>
                                    <div className="text-[#879B8D]">
                                      Saved Routine Context:{' '}
                                      {fa.waterSummary.savedRoutineLabel || 'None logged'}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Section 11: Recommended Actions */}
                          {sec.num === 11 && (
                            <div className="space-y-2">
                              {report.recommendations.length === 0 ? (
                                <div className="text-[#879B8D]">
                                  No corrective actions generated for this assessment window.
                                </div>
                              ) : (
                                report.recommendations.map((act) => (
                                  <div
                                    key={act.id}
                                    className="rounded-[8px] border border-[#28543B] bg-[#0D261B] p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                                  >
                                    <div className="space-y-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span
                                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                            act.priority === 'high'
                                              ? 'bg-[#F06A68]/20 text-[#F06A68]'
                                              : 'bg-[#55C7DB]/15 text-[#55C7DB]'
                                          }`}
                                        >
                                          {act.priority}
                                        </span>
                                        <span className="font-semibold text-[#EDF5EC]">
                                          {act.fieldName}: {act.title}
                                        </span>
                                        <span className="text-[10.5px] text-[#879B8D]">
                                          Due {act.suggestedDueWindow}
                                        </span>
                                      </div>
                                      <p className="text-[11.5px] text-[#B6C8B8]">
                                        {act.whySuggested}
                                      </p>
                                      {act.evidenceIds[0] && (
                                        <EvidenceBtn
                                          id={act.evidenceIds[0]}
                                          label="Supporting Evidence"
                                          fieldId={act.fieldId}
                                        />
                                      )}
                                    </div>

                                    <div className="no-print flex flex-wrap items-center gap-2 shrink-0">
                                      <select
                                        disabled={updatingActionId === act.id}
                                        value={act.status}
                                        onChange={(e) =>
                                          handleActionChange(
                                            act.id,
                                            e.target.value as ActionStatus,
                                            false
                                          )
                                        }
                                        className="rounded-lg border border-[#28543B] bg-[#092016] px-2.5 py-1 text-[11px] font-semibold text-[#EDF5EC]"
                                      >
                                        {ACTION_STATUSES.map((st) => (
                                          <option key={st} value={st}>
                                            {st}
                                          </option>
                                        ))}
                                      </select>

                                      {act.linkedTaskId ? (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#4DCE79]/45 bg-[#4DCE79]/15 text-[11px] font-semibold text-[#77D88C]">
                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                          <span>Task Linked</span>
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          disabled={updatingActionId === act.id}
                                          onClick={() =>
                                            handleActionChange(act.id, 'Scheduled', true)
                                          }
                                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#4DCE79]/55 bg-[#4DCE79]/15 hover:bg-[#4DCE79]/25 text-[11px] font-semibold text-[#77D88C] cursor-pointer"
                                        >
                                          <CalendarPlus className="w-3.5 h-3.5" />
                                          <span>Add to Tasks</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}

                          {/* Section 12: What Changed Since Previous Report */}
                          {sec.num === 12 && (
                            <div className="space-y-2">
                              {!report.comparisonWithPrevious ? (
                                <div className="text-[#B6C8B8]">
                                  No prior compatible report exists yet for comparison. Future runs with matching scope/fields will highlight new vs continuing findings automatically.
                                </div>
                              ) : (
                                <>
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-semibold text-[#EDF5EC]">
                                      {report.comparisonWithPrevious.summaryHeadline}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => onOpenCompare(report.id)}
                                      className="no-print text-[11px] font-semibold text-[#55C7DB] hover:underline cursor-pointer"
                                    >
                                      Open Full Report Compare →
                                    </button>
                                  </div>
                                  {!report.comparisonWithPrevious.comparable && (
                                    <div className="text-[#E8B84E] text-[11px]">
                                      Comparability note:{' '}
                                      {report.comparisonWithPrevious.comparabilityReasons.join(' ')}
                                    </div>
                                  )}
                                  <div className="space-y-1.5">
                                    {report.comparisonWithPrevious.items.map((it, i) => (
                                      <div
                                        key={i}
                                        className="rounded border border-[#28543B] bg-[#0D261B] px-2.5 py-1.5 flex flex-wrap justify-between gap-2 text-[11px]"
                                      >
                                        <span>
                                          <strong className="text-[#55C7DB]">[{it.classification}]</strong>{' '}
                                          {it.label}: {it.baselineValue} → {it.currentValue} (
                                          {it.deltaDisplay})
                                        </span>
                                        <span className="text-[#879B8D]">{it.explanation}</span>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          )}

                          {/* Section 13: Data Gaps and Data Gap Coach */}
                          {sec.num === 13 && (
                            <div className="space-y-2">
                              {dataGapsList.length === 0 ? (
                                <div className="text-[#77D88C]">
                                  All expected observation layers, crop confirmations, and weather inputs are present.
                                </div>
                              ) : (
                                dataGapsList.map((g, i) => (
                                  <div
                                    key={i}
                                    className="rounded-[8px] border border-[#28543B] bg-[#0D261B] p-2.5 space-y-1 text-[11.5px]"
                                  >
                                    <div className="font-semibold text-[#E8B84E]">
                                      Missing: {g.missing}
                                    </div>
                                    <div className="text-[#B6C8B8]">Why it matters: {g.why}</div>
                                    <div className="text-[#77D88C]">How to improve: {g.action}</div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}

                          {/* Section 14: Data Coverage and Source Register */}
                          {sec.num === 14 && (
                            <div className="space-y-2">
                              {report.sourceOutcomes.map((s, i) => (
                                <div
                                  key={`${s.providerId}-${i}`}
                                  className="rounded-[8px] border border-[#28543B] bg-[#0D261B] p-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                                >
                                  <div>
                                    <div className="font-semibold text-[#EDF5EC]">
                                      {s.providerName}{' '}
                                      <span className="font-mono text-[10px] text-[#879B8D]">
                                        ({s.productId})
                                      </span>
                                    </div>
                                    <div className="text-[#B6C8B8]">{s.note}</div>
                                    <div className="text-[10px] text-[#879B8D]">
                                      Window: {s.observationWindow} · Fit: {s.spatialFit} ·{' '}
                                      {s.resolutionLabel}
                                    </div>
                                  </div>
                                  <span
                                    className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${
                                      s.status === 'complete'
                                        ? 'border-[#4DCE79]/50 bg-[#4DCE79]/15 text-[#77D88C]'
                                        : s.status === 'partial' || s.status === 'fallback'
                                          ? 'border-[#E8B84E]/55 bg-[#E8B84E]/15 text-[#E8B84E]'
                                          : 'border-[#F06A68]/55 bg-[#F06A68]/15 text-[#F06A68]'
                                    }`}
                                  >
                                    {s.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Section 15: Methods, Formulas and Provenance */}
                          {sec.num === 15 && (
                            <div className="space-y-2.5 text-[11px]">
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 font-mono text-[#B6C8B8]">
                                <div>Engine: {report.engineVersion}</div>
                                <div>Crop KB: {report.cropKnowledgeVersion}</div>
                                <div>Ruleset: {report.ruleSetVersion}</div>
                                <div>Input Hash: {report.inputSnapshotId}</div>
                                <div>Report Hash: {report.reportHash}</div>
                                <div>Evidence Records: {Object.keys(report.evidenceById).length}</div>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.values(report.evidenceById)
                                  .slice(0, 12)
                                  .map((ev) => (
                                    <button
                                      key={ev.evidenceId}
                                      type="button"
                                      onClick={() => setInspectedEvidence(ev)}
                                      className="no-print px-2.5 py-1 rounded border border-[#55C7DB]/40 bg-[#0D261B] hover:bg-[#112F22] text-[10.5px] font-semibold text-[#55C7DB] cursor-pointer"
                                    >
                                      {ev.fieldName}: {ev.metricName}
                                    </button>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 9. BOTTOM REPORT INFORMATION PANELS (Sections 16, 17, 18) */}
              <div
                ref={(el) => {
                  section6To15Refs.current['16'] = el as HTMLDivElement | null;
                }}
                className="grid grid-cols-1 md:grid-cols-3 gap-2.5"
              >
                {/* Section 16: Run Summary and Audit */}
                <section className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 p-3.5 flex flex-col justify-between gap-2.5">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#4DCE79] text-[#04180D] text-[10.5px] font-bold flex items-center justify-center shrink-0">
                        16
                      </span>
                      <h3 className="text-[13px] font-semibold text-[#EDF5EC]">
                        Run Summary and Audit
                      </h3>
                    </div>

                    <div className="flex items-center gap-2 text-[12px] font-medium text-[#77D88C]">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        {report.status === 'complete'
                          ? 'Analysis completed successfully'
                          : report.status === 'partial'
                            ? 'Completed with partial sources'
                            : `Analysis ${report.status}`}
                      </span>
                    </div>

                    <div className="space-y-1 text-[11px] text-[#B6C8B8] tabular-nums">
                      <div>
                        Run ID: <strong className="text-[#EDF5EC] font-mono">{report.id.slice(0, 18)}</strong>
                      </div>
                      <div>
                        Duration: <strong className="text-[#EDF5EC]">{runDurationLabel}</strong>
                      </div>
                      <div>
                        Model Version: <strong className="text-[#EDF5EC]">{report.engineVersion}</strong>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setFullLogOpen(true)}
                    className="no-print inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#55C7DB] hover:underline cursor-pointer w-fit"
                  >
                    <span>View Full Log</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </section>

                {/* Section 17: Field Evidence Timeline */}
                <section className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#4DCE79] text-[#04180D] text-[10.5px] font-bold flex items-center justify-center shrink-0">
                      17
                    </span>
                    <h3 className="text-[13px] font-semibold text-[#EDF5EC]">
                      Field Evidence Timeline
                    </h3>
                  </div>

                  <div className="relative pl-4 space-y-2.5">
                    <div
                      aria-hidden="true"
                      className="absolute left-[5px] top-1.5 bottom-1.5 w-[1.5px] bg-[#28543B]"
                    />
                    {timelineEvents.map((ev, i) => (
                      <div key={i} className="relative flex items-baseline gap-2 text-[11px]">
                        <span
                          className={`absolute -left-4 top-1 w-2.5 h-2.5 rounded-full border border-[#06170F] ${
                            ev.tone === 'green'
                              ? 'bg-[#4DCE79]'
                              : ev.tone === 'amber'
                                ? 'bg-[#E8B84E]'
                                : 'bg-[#55C7DB]'
                          }`}
                        />
                        <span className="text-[#879B8D] tabular-nums shrink-0 w-[68px]">
                          {formatTimelineDateTime(ev.ts)}
                        </span>
                        <span className="text-[#EDF5EC] truncate" title={ev.label}>
                          {ev.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Section 18: Seasonal Review */}
                <section className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/90 p-3.5 flex flex-col justify-between gap-2">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-[#4DCE79] shrink-0" />
                        <h3 className="text-[13px] font-semibold text-[#EDF5EC]">
                          Seasonal Review
                        </h3>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[10.5px]">
                      <span className="text-[#B6C8B8]">Field Coverage vs Score</span>
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex items-center gap-1 text-[#B6C8B8]">
                          <span className="w-2 h-2 rounded-full bg-[#4DCE79]" />
                          Coverage
                        </span>
                        <span className="inline-flex items-center gap-1 text-[#B6C8B8]">
                          <span className="w-2 h-2 rounded-full bg-[#58A9ED]" />
                          Health
                        </span>
                      </div>
                    </div>

                    {/* Grouped Bar Chart across up to 5 fields */}
                    <div className="rounded-[8px] border border-[#28543B]/60 bg-[#092016] px-2 pt-2 pb-1.5">
                      <div className="h-[74px] flex items-end justify-around gap-1.5">
                        {report.fieldAssessments.slice(0, 5).map((fa) => {
                          const covH = Math.max(8, Math.round((fa.coveragePct / 100) * 56));
                          const healthH =
                            fa.healthScore !== null
                              ? Math.max(8, Math.round((fa.healthScore / 100) * 56))
                              : 6;
                          return (
                            <div
                              key={fa.fieldId}
                              className="flex-1 flex flex-col items-center gap-1 min-w-0"
                            >
                              <div className="flex items-end gap-1 h-[58px]">
                                <div
                                  className="w-2.5 rounded-t-[2px] bg-[#4DCE79]"
                                  style={{ height: `${covH}px` }}
                                  title={`${fa.fieldName} Coverage: ${fa.coveragePct}%`}
                                />
                                <div
                                  className="w-2.5 rounded-t-[2px] bg-[#58A9ED]"
                                  style={{ height: `${healthH}px` }}
                                  title={`${fa.fieldName} Health: ${fa.healthScore ?? 'Unscored'}%`}
                                />
                              </div>
                              <span className="text-[9px] text-[#879B8D] truncate w-full text-center">
                                {fa.fieldName}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenCompare(report.id)}
                    className="no-print inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#55C7DB] hover:underline cursor-pointer w-fit"
                  >
                    <span>View Seasonal Trends</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </section>
              </div>
            </div>

            {/* ==================== RIGHT: UTILITY SIDEBAR ==================== */}
            <aside className="space-y-2.5 lg:sticky lg:top-0">
              {/* A. Key Insights */}
              <div className="rounded-[12px] border border-[#28543B] bg-[#0D261B]/95 p-3 space-y-2.5">
                <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#EDF5EC]">
                  <Lightbulb className="w-3.5 h-3.5 text-[#E8B84E]" />
                  <span>Key Insights</span>
                </div>
                <ul className="space-y-2 text-[11.5px]">
                  {sidebarInsights.map((ins, i) => (
                    <li key={i} className="flex items-start gap-2">
                      {ins.type === 'good' ? (
                        <span className="w-4 h-4 rounded-full bg-[#4DCE79] text-[#04180D] flex items-center justify-center shrink-0 mt-0.5">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-[#F06A68] shrink-0 mt-0.5" />
                      )}
                      <span className="text-[#EDF5EC] leading-snug">{ins.text}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* B. Report Actions */}
              <div className="no-print rounded-[12px] border border-[#28543B] bg-[#0D261B]/95 p-3 space-y-2">
                <div className="text-[12.5px] font-semibold text-[#EDF5EC] pb-1 border-b border-[#28543B]">
                  Report Actions
                </div>
                <div className="space-y-1 text-[11.5px]">
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    className="w-full flex items-center gap-2 py-1.5 px-1.5 rounded-lg hover:bg-[#112F22] text-[#EDF5EC] cursor-pointer text-left"
                  >
                    <Download className="w-3.5 h-3.5 text-[#55C7DB]" />
                    <span>Export Report</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="w-full flex items-center gap-2 py-1.5 px-1.5 rounded-lg hover:bg-[#112F22] text-[#EDF5EC] cursor-pointer text-left"
                  >
                    <Printer className="w-3.5 h-3.5 text-[#55C7DB]" />
                    <span>Print Report</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenScheduleAutomation?.();
                    }}
                    className="w-full flex items-center gap-2 py-1.5 px-1.5 rounded-lg hover:bg-[#112F22] text-[#EDF5EC] cursor-pointer text-left"
                  >
                    <Clock className="w-3.5 h-3.5 text-[#58A9ED]" />
                    <span>Schedule Automation</span>
                  </button>
                </div>
              </div>

              {/* C. Quick Links */}
              <div className="no-print rounded-[12px] border border-[#28543B] bg-[#0D261B]/95 p-3 space-y-2">
                <div className="text-[12.5px] font-semibold text-[#EDF5EC] pb-1 border-b border-[#28543B]">
                  Quick Links
                </div>
                <div className="space-y-1 text-[11.5px]">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenOnMap?.();
                    }}
                    className="w-full flex items-center gap-2 py-1.5 px-1.5 rounded-lg hover:bg-[#112F22] text-[#B6C8B8] hover:text-[#EDF5EC] cursor-pointer text-left"
                  >
                    <MapIcon className="w-3.5 h-3.5 text-[#55C7DB]" />
                    <span>View Farm Map</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenRotationPlan?.();
                    }}
                    className="w-full flex items-center gap-2 py-1.5 px-1.5 rounded-lg hover:bg-[#112F22] text-[#B6C8B8] hover:text-[#EDF5EC] cursor-pointer text-left"
                  >
                    <Repeat className="w-3.5 h-3.5 text-[#4DCE79]" />
                    <span>Crop Rotation Plan</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenWeatherForecast?.();
                    }}
                    className="w-full flex items-center gap-2 py-1.5 px-1.5 rounded-lg hover:bg-[#112F22] text-[#B6C8B8] hover:text-[#EDF5EC] cursor-pointer text-left"
                  >
                    <CloudSun className="w-3.5 h-3.5 text-[#E8B84E]" />
                    <span>Weather Forecast</span>
                  </button>
                </div>
              </div>

              {/* D. Agricultural Brand Visual */}
              <div className="rounded-[12px] border border-[#28543B] bg-[#092016] overflow-hidden relative flex flex-col justify-between min-h-[250px]">
                {/* Top botanical line art + brand message */}
                <div className="relative p-4 pt-6 space-y-3 z-10">
                  <svg
                    viewBox="0 0 180 70"
                    className="w-full h-14 opacity-45"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 62 C36 28, 72 14, 118 12 C104 42, 74 58, 12 62 Z"
                      stroke="#4DCE79"
                      strokeWidth="1.2"
                    />
                    <path d="M16 60 C52 44, 82 28, 112 15" stroke="#4DCE79" strokeWidth="1" />
                    <path
                      d="M95 58 C115 35, 145 26, 174 25 C164 46, 138 58, 95 58 Z"
                      stroke="#77D88C"
                      strokeWidth="1"
                    />
                  </svg>
                  <div className="text-[16px] font-bold leading-snug text-[#EDF5EC]">
                    Smarter Decisions.
                    <br />
                    <span className="text-[#77D88C]">Healthier Farms.</span>
                  </div>
                </div>

                {/* Bottom Farmland Photography */}
                <div className="relative h-32 w-full">
                  <img
                    src={deepAnalysisBgImg}
                    alt="Sunlit green agricultural rows"
                    className="w-full h-full object-cover object-center"
                  />
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-gradient-to-b from-[#092016] via-[#092016]/35 to-transparent"
                  />
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* FIELD DETAIL SUB-MODAL (Preserves Report Scroll Position!)           */}
      {/* ==================================================================== */}
      {inspectedField && (
        <div
          className="fixed inset-0 z-[95] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setInspectedField(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${inspectedField.fieldName} Field Assessment`}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[88vh] overflow-y-auto fs-thin-scroll rounded-[14px] border border-[#28543B] bg-[#092016] text-[#EDF5EC] shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#28543B] pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${conditionBadge(
                      inspectedField.conditionLabel
                    )}`}
                  >
                    {inspectedField.conditionLabel}
                  </span>
                  <span className="text-xs text-[#879B8D] tabular-nums">
                    {inspectedField.areaHa.toFixed(1)} ha · Coverage {inspectedField.coveragePct}% · Confidence{' '}
                    {inspectedField.confidencePct}%
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[#EDF5EC] mt-1">
                  {inspectedField.fieldName} — {inspectedField.cropName || 'Unknown'}{' '}
                  {inspectedField.cropStage ? `(${inspectedField.cropStage})` : ''}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectedField(null)}
                className="w-8 h-8 rounded-lg border border-[#28543B] bg-[#0D261B] flex items-center justify-center text-[#B6C8B8] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-[10px] border border-[#28543B] bg-[#0D261B] p-3 space-y-1.5">
                <div className="font-semibold text-[#58A9ED] flex items-center justify-between">
                  <span>Water &amp; ET₀</span>
                  <EvidenceBtn
                    id={`ev-${inspectedField.fieldId}-et0`}
                    label="ET₀ Src"
                    fieldId={inspectedField.fieldId}
                  />
                </div>
                <div>
                  Mean ET₀:{' '}
                  <strong>
                    {inspectedField.waterSummary.et0MeanMmDay ?? 'Unavailable'} mm/d
                  </strong>{' '}
                  ({inspectedField.waterSummary.et0Method})
                </div>
                <div>
                  Rain / Effective:{' '}
                  <strong>
                    {inspectedField.waterSummary.observedPrecipMm ?? '—'} /{' '}
                    {inspectedField.waterSummary.effectiveRainMm ?? '—'} mm
                  </strong>
                </div>
                <div>
                  Confirmed Irrigation:{' '}
                  <strong className="text-[#77D88C]">
                    {inspectedField.waterSummary.confirmedIrrigationMm} mm
                  </strong>
                </div>
                <div>
                  TAW / RAW / Depletion:{' '}
                  <strong>
                    {inspectedField.waterSummary.tawMm !== null
                      ? `${inspectedField.waterSummary.tawMm} / ${inspectedField.waterSummary.rawMm} / ${inspectedField.waterSummary.latestDepletionMm ?? '—'} mm`
                      : 'Unavailable'}
                  </strong>
                </div>
              </div>

              <div className="rounded-[10px] border border-[#28543B] bg-[#0D261B] p-3 space-y-1.5">
                <div className="font-semibold text-[#77D88C] flex items-center justify-between">
                  <span>Vegetation &amp; Soil</span>
                  <EvidenceBtn
                    id={inspectedField.vegetationSummary.evidenceId}
                    label="NDVI Src"
                    fieldId={inspectedField.fieldId}
                  />
                </div>
                <div>
                  Sentinel-2 NDVI:{' '}
                  <strong>
                    {inspectedField.vegetationSummary.ndviMean !== null
                      ? inspectedField.vegetationSummary.ndviMean.toFixed(3)
                      : 'Masked/Unavail'}
                  </strong>{' '}
                  ({inspectedField.vegetationSummary.validCoveragePct}% valid)
                </div>
                <div>
                  Soil Texture:{' '}
                  <strong>{inspectedField.soilSummary.textureClass}</strong> (
                  {inspectedField.soilSummary.textureSource})
                </div>
                <div>
                  Elevation / Slope:{' '}
                  <strong>
                    {inspectedField.soilSummary.elevationM ?? '—'} m ·{' '}
                    {inspectedField.soilSummary.slopePct ?? '—'}%
                  </strong>
                </div>
                <div>
                  GDD Accumulated:{' '}
                  <strong>
                    {inspectedField.weatherSummary.gddAccumulated ?? '—'} °C·d
                  </strong>
                </div>
              </div>
            </div>

            <div className="rounded-[10px] border border-[#28543B] bg-[#112F22] p-3 space-y-1 text-xs">
              <div className="font-semibold text-[#EDF5EC]">Leading Finding &amp; Action</div>
              <div className="text-[#B6C8B8]">Finding: {inspectedField.leadingFinding}</div>
              <div className="text-[#77D88C]">
                Next Action: {inspectedField.recommendedNextAction}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {onOpenFieldOverview && (
                <button
                  type="button"
                  onClick={() => {
                    const id = inspectedField.fieldId;
                    setInspectedField(null);
                    onClose();
                    onOpenFieldOverview(id);
                  }}
                  className="px-3.5 py-1.5 rounded-lg border border-[#4DCE79]/55 bg-[#4DCE79]/15 text-xs font-semibold text-[#77D88C] cursor-pointer"
                >
                  Open in Field Overview
                </button>
              )}
              <button
                type="button"
                onClick={() => setInspectedField(null)}
                className="px-3.5 py-1.5 rounded-lg border border-[#28543B] bg-[#0D261B] text-xs font-semibold text-[#EDF5EC] cursor-pointer"
              >
                Back to Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* ALL FINDINGS MODAL                                                   */}
      {/* ==================================================================== */}
      {allFindingsOpen && (
        <div
          className="fixed inset-0 z-[95] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setAllFindingsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="All Findings and Watch Points"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[88vh] overflow-y-auto fs-thin-scroll rounded-[14px] border border-[#28543B] bg-[#092016] text-[#EDF5EC] shadow-2xl p-5 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-[#28543B] pb-3">
              <h3 className="text-base font-bold text-[#EDF5EC]">
                All Priority Findings &amp; Watch Points ({combinedFindings.length})
              </h3>
              <button
                type="button"
                onClick={() => setAllFindingsOpen(false)}
                className="w-8 h-8 rounded-lg border border-[#28543B] bg-[#0D261B] flex items-center justify-center text-[#B6C8B8] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {combinedFindings.length === 0 ? (
              <div className="text-xs text-[#77D88C] py-4">
                No risk findings or watch points flagged in this report.
              </div>
            ) : (
              <div className="space-y-2.5 text-xs">
                {combinedFindings.map((fn) => (
                  <div
                    key={fn.id}
                    className="rounded-[10px] border border-[#28543B] bg-[#0D261B] p-3.5 space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${severityPill(
                            fn.severity
                          )}`}
                        >
                          {fn.isWatchPoint ? 'WATCH' : fn.severity}
                        </span>
                        <span className="font-bold text-[#EDF5EC]">
                          {fn.fieldName}: {fn.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10.5px] text-[#879B8D]">
                          {fn.ruleId} v{fn.ruleVersion} · Conf {fn.confidencePct}%
                        </span>
                        {fn.evidenceIds[0] && (
                          <EvidenceBtn
                            id={fn.evidenceIds[0]}
                            label="Evidence"
                            fieldId={fn.fieldId}
                          />
                        )}
                      </div>
                    </div>
                    <div className="text-[#EDF5EC]">
                      <strong>Trigger:</strong> {fn.triggerMetricSummary} (Threshold:{' '}
                      {fn.baselineOrThreshold})
                    </div>
                    <div className="text-[#B6C8B8]">
                      <strong>Mechanism:</strong> {fn.possibleMechanism}
                    </div>
                    <div className="text-[#77D88C]">
                      <strong>Confirmation Check:</strong> {fn.confirmationCheck}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* FULL EXECUTION LOG MODAL                                             */}
      {/* ==================================================================== */}
      {fullLogOpen && (
        <div
          className="fixed inset-0 z-[95] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setFullLogOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Execution Audit Log"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[86vh] overflow-y-auto fs-thin-scroll rounded-[14px] border border-[#28543B] bg-[#092016] text-[#EDF5EC] shadow-2xl p-5 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-[#28543B] pb-3">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-[#4DCE79]" />
                <h3 className="text-base font-bold text-[#EDF5EC]">
                  Analysis Execution &amp; Audit Log
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setFullLogOpen(false)}
                className="w-8 h-8 rounded-lg border border-[#28543B] bg-[#0D261B] flex items-center justify-center text-[#B6C8B8] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-[10px] border border-[#28543B] bg-[#0D261B] p-3 font-mono text-[11px] text-[#B6C8B8]">
              <div>Report ID: {report.id}</div>
              <div>Trigger: {report.triggerReason}</div>
              <div>Input Hash: {report.inputSnapshotId}</div>
              <div>Report Hash: {report.reportHash}</div>
              <div>Created: {formatRunDateTime(report.createdAt)}</div>
              <div>Completed: {formatRunDateTime(report.completedAt)}</div>
            </div>

            {latestJob && latestJob.reportId === report.id && latestJob.stages.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-semibold text-[#EDF5EC]">Pipeline Stages</div>
                {latestJob.stages.map((st) => (
                  <div
                    key={st.stage}
                    className="rounded-lg border border-[#28543B] bg-[#0D261B] px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-semibold text-[#EDF5EC]">{st.label}</div>
                      {st.detail && <div className="text-[10.5px] text-[#879B8D]">{st.detail}</div>}
                    </div>
                    <span className="px-2 py-0.5 rounded bg-[#112F22] border border-[#28543B] text-[10px] font-bold uppercase text-[#77D88C]">
                      {st.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="font-semibold text-[#EDF5EC]">
                Provider Fetch Register ({report.sourceOutcomes.length})
              </div>
              {report.sourceOutcomes.map((s, idx) => (
                <div
                  key={`${s.providerId}-${idx}`}
                  className="rounded-lg border border-[#28543B] bg-[#0D261B] px-3 py-2 flex items-center justify-between gap-2"
                >
                  <div>
                    <span className="font-semibold text-[#EDF5EC]">{s.providerName}</span>{' '}
                    <span className="text-[#879B8D]">({s.productId})</span>
                    <div className="text-[10.5px] text-[#B6C8B8]">{s.note}</div>
                  </div>
                  <span className="text-[10px] font-bold uppercase text-[#55C7DB]">
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <EvidenceExplorerDrawer
        evidence={inspectedEvidence}
        onClose={() => setInspectedEvidence(null)}
      />
    </div>
  );
};
