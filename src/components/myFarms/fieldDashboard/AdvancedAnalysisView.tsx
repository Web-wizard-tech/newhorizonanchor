import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  FileBarChart2,
  FileText,
  GitCompare,
  Layers,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import {
  AnalysisFrequency,
  FarmAnalysisSchedule,
  MyFarmRecord,
  PortfolioFieldRecord,
  SavedFarmSnapshot,
} from '../../../types/myFarms';
import { EonetFetchResult, PowerClimateResult } from '../../../types';
import {
  AnalysisJob,
  AnalysisScope,
  AutomationSchedule,
  DeepAnalysisReport,
} from '../../../types/advanced';
import { LiveWeatherReading } from '../../../services/weather';
import {
  computeNextScheduledRunIso,
  resolveDefaultAnalysisSchedule,
} from '../../../lib/myFarmsEngine';
import {
  downloadDeepAnalysisPdf,
  downloadFullDeepAnalysisPdf,
} from '../../../lib/deepAnalysisPdfExport';
import {
  AdvancedSummaryResponse,
  cancelAnalysisRun,
  fetchAdvancedSummary,
  fetchFullReport,
  patchSchedule,
  pauseSchedule,
  resumeSchedule,
  startAnalysisRun,
  subscribeAnalysisRunStream,
} from '../../../services/advancedApi';
import { FieldIntelligenceViewModel } from './fieldDashboardModel';
import {
  AerialParcelThumbnail,
  AnalysisSummaryModal,
  CompareReportsModal,
  formatScheduleDateTime,
  FullReportModal,
  HeroAgriculturalOrb,
  ScheduleCalendar3D,
} from './DeepAnalysisVisuals';
import { AnalysisPreflightModal } from './advanced/AnalysisPreflightModal';
import { AnalysisJobProgressBanner } from './advanced/AnalysisJobProgressBanner';
import { DeepAnalysisReportViewer } from './advanced/DeepAnalysisReportViewer';
import { ReportCompareDrawer } from './advanced/ReportCompareDrawer';
import { ManageAutomationModal } from './advanced/ManageAutomationModal';
import { useToast } from '../../Toast';

interface AdvancedAnalysisViewProps {
  farm: MyFarmRecord;
  fields: PortfolioFieldRecord[];
  selectedField: PortfolioFieldRecord | null;
  fieldModel: FieldIntelligenceViewModel;
  snapshots: SavedFarmSnapshot[];
  liveWeather: LiveWeatherReading | null;
  climateResult: PowerClimateResult | null;
  eonetResult: EonetFetchResult | null;
  tempUnit: 'C' | 'F';
  isOnline: boolean;
  runningSnapshot: boolean;
  onRunNewAnalysis: (opts?: {
    fieldScope?: 'all' | string[];
    triggerReason?: string;
  }) => Promise<SavedFarmSnapshot | null>;
  onPatchFarm: (farm: MyFarmRecord, patch: Record<string, unknown>, label: string) => Promise<void>;
  onRunDeepAnalysis: (farm: MyFarmRecord) => void;
  onRefreshPortfolio?: () => Promise<void>;
  onOpenFieldOverview?: (fieldId: string) => void;
  onOpenOnMap?: () => void;
  onOpenRotationPlan?: () => void;
  onOpenWeatherForecast?: () => void;
}

const CAPABILITIES = [
  'Soil & Water Analysis',
  'Field Insights',
  'Crop Health Assessment',
  'Smart Recommendations',
  'Risk Detection',
  'Historical Comparison',
];

function toUiFrequency(freq: AutomationSchedule['frequency']): AnalysisFrequency {
  if (freq === 'daily') return 'Daily';
  if (freq === 'biweekly') return 'Biweekly';
  if (freq === 'monthly') return 'Monthly';
  return 'Weekly';
}

function toBackendFrequency(freq: AnalysisFrequency): AutomationSchedule['frequency'] {
  if (freq === 'Daily') return 'daily';
  if (freq === 'Biweekly') return 'biweekly';
  if (freq === 'Monthly') return 'monthly';
  return 'weekly';
}

export const AdvancedAnalysisView: React.FC<AdvancedAnalysisViewProps> = ({
  farm,
  fields,
  fieldModel,
  snapshots,
  liveWeather,
  climateResult,
  tempUnit,
  isOnline,
  runningSnapshot,
  onRunNewAnalysis,
  onPatchFarm,
  onRunDeepAnalysis,
  onRefreshPortfolio,
  onOpenFieldOverview,
  onOpenOnMap,
  onOpenRotationPlan,
  onOpenWeatherForecast,
}) => {
  const { showToast } = useToast();

  // Backend Advanced State
  const [summary, setSummary] = useState<AdvancedSummaryResponse | null>(null);
  const [activeJob, setActiveJob] = useState<AnalysisJob | null>(null);
  const streamUnsubRef = useRef<(() => void) | null>(null);

  const [preflightOpen, setPreflightOpen] = useState(false);
  const [inspectingFullReport, setInspectingFullReport] = useState<DeepAnalysisReport | null>(null);
  const [inspectingLegacySnapshot, setInspectingLegacySnapshot] =
    useState<SavedFarmSnapshot | null>(null);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [compareInitialLeft, setCompareInitialLeft] = useState<string>('');
  const [compareInitialRight, setCompareInitialRight] = useState<string>('');
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [manageScheduleOpen, setManageScheduleOpen] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const loadAdvancedSummary = useCallback(async () => {
    try {
      const data = await fetchAdvancedSummary(farm.id);
      setSummary(data);
    } catch {
      // Offline / fallback keeps using local snapshots cleanly
    }
  }, [farm.id]);

  useEffect(() => {
    loadAdvancedSummary();
    return () => {
      streamUnsubRef.current?.();
      streamUnsubRef.current = null;
    };
  }, [loadAdvancedSummary]);

  // Legacy sorted snapshots (used seamlessly when no v2 engine report has been created yet)
  const orderedSnapshots = useMemo(
    () =>
      [...snapshots].sort(
        (a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)
      ),
    [snapshots]
  );

  const backendLatestReport = summary?.latestReport ?? null;
  const backendRecentReports = summary?.recentReports ?? [];
  const primarySchedule = summary?.schedules?.[0] ?? null;

  const latestSnapshot = orderedSnapshots[0] ?? null;
  const previousSnapshot = orderedSnapshots[1] ?? null;
  const recentFourSnapshots = orderedSnapshots.slice(0, 4);

  // Unified Schedule view (backed by durable AutomationSchedule when available)
  const schedule: FarmAnalysisSchedule = useMemo(() => {
    const base = resolveDefaultAnalysisSchedule(
      farm.analysisSchedule,
      backendLatestReport?.completedAt ??
        latestSnapshot?.generatedAt ??
        farm.assessment.assessedAt
    );
    if (primarySchedule) {
      return {
        ...base,
        enabled: primarySchedule.enabled && primarySchedule.status === 'active',
        frequency: toUiFrequency(primarySchedule.frequency),
        timeOfDay: primarySchedule.preferredTime,
        nextRunAt: primarySchedule.nextRunAt,
        lastRunAt:
          primarySchedule.lastRunAt ??
          backendLatestReport?.completedAt ??
          latestSnapshot?.generatedAt ??
          base.lastRunAt,
        notifyOnImportantChanges: primarySchedule.notifyOnImportantChanges,
        fieldScope:
          primarySchedule.scope.type === 'all_fields' || primarySchedule.scope.type === 'whole_farm'
            ? 'all'
            : primarySchedule.scope.fieldIds,
      };
    }
    return {
      ...base,
      lastRunAt: latestSnapshot?.generatedAt ?? base.lastRunAt,
    };
  }, [
    backendLatestReport?.completedAt,
    farm.analysisSchedule,
    farm.assessment.assessedAt,
    latestSnapshot?.generatedAt,
    primarySchedule,
  ]);

  // Unified Latest Analysis metrics (calibrated score separate from coverage & confidence)
  const latestScore =
    backendLatestReport !== null
      ? backendLatestReport.overallSummary.healthScore
      : latestSnapshot?.suitabilityScore ?? farm.assessment.score ?? null;

  const previousEngineScore =
    backendRecentReports[1]?.overallSummary.healthScore ??
    previousSnapshot?.suitabilityScore ??
    null;

  const scoreDelta =
    latestScore !== null && previousEngineScore !== null
      ? latestScore - previousEngineScore
      : null;

  const latestCoveragePct =
    backendLatestReport?.overallSummary.coveragePct ??
    latestSnapshot?.completenessPct ??
    null;
  const latestConfidencePct =
    backendLatestReport?.overallSummary.confidencePct ??
    latestSnapshot?.confidencePct ??
    null;
  const latestConditionLabel =
    backendLatestReport?.overallSummary.conditionLabel ??
    (latestScore !== null ? (latestScore >= 80 ? 'Good' : 'Monitor') : 'Not Analysed');

  const latestTimestampIso =
    backendLatestReport?.completedAt ??
    latestSnapshot?.generatedAt ??
    farm.assessment.assessedAt;
  const latestDateDisplay = formatScheduleDateTime(latestTimestampIso);
  const nextRunDisplay = formatScheduleDateTime(schedule.nextRunAt);

  // Circular gauge SVG geometry
  const gaugeRadius = 58;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugePct = latestScore !== null ? Math.max(0, Math.min(100, latestScore)) : 0;
  const arcTotal = gaugeCircumference * 0.78;
  const arcProgress = (gaugePct / 100) * arcTotal;

  const orbTempLabel = useMemo(() => {
    const c =
      liveWeather?.tempC ??
      backendLatestReport?.fieldAssessments?.[0]?.weatherSummary.currentTempC ??
      (climateResult?.meanMaxC !== null &&
      climateResult?.meanMaxC !== undefined &&
      climateResult?.meanMinC !== null &&
      climateResult?.meanMinC !== undefined
        ? (climateResult.meanMaxC + climateResult.meanMinC) / 2
        : latestSnapshot?.keyMetrics.meanTempC ?? null);
    if (c === null || !Number.isFinite(c)) return 'Climate ready';
    return tempUnit === 'F' ? `${Math.round((c * 9) / 5 + 32)} °F` : `${c.toFixed(1)} °C`;
  }, [
    backendLatestReport?.fieldAssessments,
    climateResult,
    latestSnapshot?.keyMetrics.meanTempC,
    liveWeather?.tempC,
    tempUnit,
  ]);

  const isPipelineRunning =
    runningSnapshot ||
    (activeJob !== null &&
      (activeJob.status === 'queued' ||
        activeJob.status === 'running' ||
        activeJob.status === 'retrying'));

  const attachStreamToRun = useCallback(
    (runId: string) => {
      streamUnsubRef.current?.();
      streamUnsubRef.current = subscribeAnalysisRunStream(
        runId,
        (job) => setActiveJob(job),
        async (job, report) => {
          setActiveJob(job);
          await loadAdvancedSummary();
          await onRefreshPortfolio?.();
          if (report) {
            showToast(
              `Deep Analysis ${job.status}: ${report.overallSummary.conditionLabel} (${report.overallSummary.healthScore ?? 'Unscored'}%)`,
              job.status === 'complete' ? 'success' : 'info'
            );
          } else if (job.status === 'failed') {
            showToast(job.errorMessage || 'Deep Analysis failed', 'error');
          }
        },
        (msg) => showToast(msg, 'error')
      );
    },
    [loadAdvancedSummary, onRefreshPortfolio, showToast]
  );

  const handleLaunchBackendRun = async (opts: {
    scope: AnalysisScope;
    triggerReason: string;
    dateFrom: string;
    dateTo: string;
    consentConfirmed: boolean;
  }) => {
    if (!isOnline) {
      await onRunNewAnalysis({
        fieldScope:
          opts.scope.type === 'all_fields' || opts.scope.type === 'whole_farm'
            ? 'all'
            : opts.scope.fieldIds,
        triggerReason: opts.triggerReason,
      });
      return;
    }

    try {
      const { runId, job } = await startAnalysisRun(farm.id, opts);
      setActiveJob(job);
      attachStreamToRun(runId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to start Deep Analysis run', 'error');
    }
  };

  const handleFrequencyChange = async (frequency: AnalysisFrequency) => {
    setSavingSchedule(true);
    try {
      if (primarySchedule) {
        await patchSchedule(primarySchedule.id, {
          frequency: toBackendFrequency(frequency),
        });
        await loadAdvancedSummary();
        showToast(`Schedule frequency updated to ${frequency}`, 'success');
      } else {
        const nextRunAt = computeNextScheduledRunIso(
          schedule.lastRunAt ?? new Date().toISOString(),
          frequency,
          schedule.timeOfDay
        );
        await onPatchFarm(
          farm,
          { analysisSchedule: { ...schedule, frequency, nextRunAt } },
          `Analysis schedule updated to ${frequency}`
        );
      }
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleFieldScopeChange = async (value: string) => {
    setSavingSchedule(true);
    try {
      const fieldObj = fields.find((f) => f.id === value);
      if (primarySchedule) {
        const nextScope: AnalysisScope =
          value === 'all' || !fieldObj
            ? {
                type: fields.length > 0 ? 'all_fields' : 'whole_farm',
                farmId: farm.id,
                fieldIds: fields.map((f) => f.id),
                label: fields.length > 0 ? `All Fields (${fields.length})` : 'Whole Farm',
              }
            : {
                type: 'single_field',
                farmId: farm.id,
                fieldIds: [fieldObj.id],
                label: fieldObj.name,
              };
        await patchSchedule(primarySchedule.id, { scope: nextScope });
        await loadAdvancedSummary();
        showToast(`Analysis scope set to ${nextScope.label}`, 'success');
      } else {
        const fieldScope: 'all' | string[] = value === 'all' ? 'all' : [value];
        await onPatchFarm(
          farm,
          { analysisSchedule: { ...schedule, fieldScope } },
          'Analysis scope updated'
        );
      }
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleToggleNotify = async () => {
    setSavingSchedule(true);
    try {
      const nextVal = !schedule.notifyOnImportantChanges;
      if (primarySchedule) {
        await patchSchedule(primarySchedule.id, { notifyOnImportantChanges: nextVal });
        await loadAdvancedSummary();
        showToast(
          nextVal ? 'Change notifications enabled' : 'Change notifications paused',
          'success'
        );
      } else {
        await onPatchFarm(
          farm,
          { analysisSchedule: { ...schedule, notifyOnImportantChanges: nextVal } },
          nextVal ? 'Change notifications enabled' : 'Change notifications paused'
        );
      }
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleToggleScheduleEnabled = async () => {
    setSavingSchedule(true);
    try {
      if (primarySchedule) {
        if (primarySchedule.status === 'active') {
          await pauseSchedule(primarySchedule.id);
          showToast('Automatic scheduling paused', 'info');
        } else {
          await resumeSchedule(primarySchedule.id);
          showToast('Automatic scheduling resumed', 'success');
        }
        await loadAdvancedSummary();
      } else {
        await onPatchFarm(
          farm,
          { analysisSchedule: { ...schedule, enabled: !schedule.enabled } },
          schedule.enabled ? 'Automatic scheduling paused' : 'Automatic scheduling active'
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to toggle schedule', 'error');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleInspectLatestReport = async () => {
    if (backendLatestReport) {
      setInspectingFullReport(backendLatestReport);
    } else if (latestSnapshot) {
      setInspectingLegacySnapshot(latestSnapshot);
    } else {
      setPreflightOpen(true);
    }
  };

  const handleInspectReportById = async (reportId: string) => {
    try {
      const full = await fetchFullReport(reportId);
      setInspectingFullReport(full);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load report', 'error');
    }
  };

  const handleOpenCompare = (preferredId?: string) => {
    if (backendRecentReports.length > 0) {
      const right = preferredId || backendRecentReports[0].id;
      const left =
        backendRecentReports.find((r) => r.id !== right)?.id ||
        backendRecentReports[0].id;
      setCompareInitialLeft(left);
      setCompareInitialRight(right);
      setCompareModalOpen(true);
      return;
    }

    const right = preferredId || latestSnapshot?.id || '';
    const left =
      orderedSnapshots.find((s) => s.id !== right)?.id ||
      previousSnapshot?.id ||
      latestSnapshot?.id ||
      '';
    setCompareInitialLeft(left);
    setCompareInitialRight(right);
    setCompareModalOpen(true);
  };

  const handleExportPdf = () => {
    if (backendLatestReport) {
      const filename = downloadFullDeepAnalysisPdf(backendLatestReport);
      showToast(`Downloaded ${filename}`, 'success');
      return;
    }
    if (!latestSnapshot) {
      showToast('Run an analysis first to export a PDF report.', 'info');
      return;
    }
    const idx = orderedSnapshots.findIndex((s) => s.id === latestSnapshot.id);
    const prev = idx >= 0 ? orderedSnapshots[idx + 1] ?? null : null;
    const filename = downloadDeepAnalysisPdf(farm, latestSnapshot, prev);
    showToast(`Downloaded ${filename}`, 'success');
  };

  const fieldScopeSelectValue =
    schedule.fieldScope === 'all'
      ? 'all'
      : schedule.fieldScope[0] && fields.some((f) => f.id === schedule.fieldScope[0])
        ? schedule.fieldScope[0]
        : 'all';

  const defaultPreflightScope: AnalysisScope =
    fieldScopeSelectValue === 'all'
      ? {
          type: fields.length > 0 ? 'all_fields' : 'whole_farm',
          farmId: farm.id,
          fieldIds: fields.map((f) => f.id),
          label: fields.length > 0 ? `All Fields (${fields.length})` : 'Whole Farm',
        }
      : {
          type: 'single_field',
          farmId: farm.id,
          fieldIds: [fieldScopeSelectValue],
          label:
            fields.find((f) => f.id === fieldScopeSelectValue)?.name ?? 'Selected Field',
        };

  const unreadNotifications = summary?.unreadNotificationCount ?? 0;

  return (
    <div className="space-y-4 text-[#F2F7FF]">
      {/* Active Background Pipeline Banner (non-blocking progress + cancel) */}
      {activeJob && (
        <AnalysisJobProgressBanner
          job={activeJob}
          onCancel={async (runId) => {
            const updated = await cancelAnalysisRun(runId);
            setActiveJob(updated);
            showToast('Cancellation requested.', 'info');
          }}
          onDismiss={() => setActiveJob(null)}
        />
      )}

      {/* ==================================================================== */}
      {/* SECTION 1: DEEP ANALYSIS HERO (71%) + LATEST ANALYSIS CARD (29%)     */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-[71fr_29fr] gap-4 items-stretch">
        {/* 2.1 Main Deep Analysis Hero Panel */}
        <section
          aria-label="Deep Analysis Hero"
          className="relative overflow-hidden rounded-[22px] border border-[#00CFFF]/25 bg-[#0A1D31]/74 backdrop-blur-md shadow-[0_18px_42px_rgba(3,12,24,0.6),inset_0_1px_0_rgba(186,240,255,0.14)] px-5 py-6 sm:px-7 sm:py-7 flex flex-col justify-center"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -left-16 w-[340px] h-[240px] rounded-full blur-3xl opacity-30"
            style={{
              background:
                'radial-gradient(circle, rgba(0, 233, 154, 0.45) 0%, rgba(0, 207, 255, 0.25) 55%, transparent 75%)',
            }}
          />

          <div className="relative z-10 flex flex-col lg:flex-row items-center gap-6 lg:gap-8">
            <HeroAgriculturalOrb
              moisturePct={fieldModel.water.soilMoisturePct}
              meanTempLabel={orbTempLabel}
              healthScore={latestScore}
              cropName={fieldModel.cropName}
              isRunning={isPipelineRunning}
            />

            <div className="flex-1 min-w-0 space-y-4 text-center lg:text-left">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#00CFFF]/40 bg-[#0D273E]/80 text-xs font-semibold text-[#A5F3FC] shadow-[0_0_14px_rgba(0,207,255,0.18)]">
                <Sparkles className="w-3.5 h-3.5 text-[#00CFFF]" />
                <span>AI-Powered</span>
              </div>

              <div className="space-y-2">
                <h1 className="text-3xl sm:text-[38px] font-bold tracking-tight leading-[1.08] text-[#F2F7FF]">
                  Deep <span className="text-[#00E99A]">Analysis</span>
                </h1>
                <p className="text-sm sm:text-[15px] text-[#B8C7D9] leading-relaxed max-w-xl mx-auto lg:mx-0">
                  Run a comprehensive analysis of your farm using real-time data, satellite insights
                  and expert AI.
                </p>
              </div>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 pt-1 text-left max-w-xl mx-auto lg:mx-0">
                {CAPABILITIES.map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-[13.5px] font-medium text-[#E5F0FA]">
                    <span className="w-4 h-4 rounded-full bg-[#00B979] text-white flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(0,233,154,0.45)]">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <div className="pt-2 flex flex-col sm:flex-row items-center lg:items-start gap-3">
                <button
                  type="button"
                  disabled={isPipelineRunning}
                  onClick={() => setPreflightOpen(true)}
                  className="inline-flex items-center justify-center gap-3.5 px-8 py-3.5 rounded-full bg-gradient-to-r from-[#5CFFB4] via-[#00E99A] to-[#00C781] text-[#042419] text-[15px] font-bold shadow-[0_0_28px_rgba(0,233,154,0.50),0_8px_20px_rgba(0,0,0,0.35)] hover:brightness-105 active:scale-[0.99] disabled:opacity-65 transition-all cursor-pointer whitespace-nowrap"
                >
                  {isPipelineRunning ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                      <span>Analysing Satellite &amp; Soil Data…</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-[#042419] shrink-0" />
                      <span>Run New Analysis</span>
                      <ArrowRight className="w-4 h-4 shrink-0" />
                    </>
                  )}
                </button>
                {!isOnline && (
                  <span className="text-[11px] text-amber-300 flex items-center gap-1 self-center">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Offline mode (local profile engine)
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 3. Latest Analysis Summary Card (29%) */}
        <section
          aria-label="Latest Analysis Summary"
          className="relative overflow-hidden rounded-[22px] border border-[#6CB2FF]/25 bg-[#0D2136]/80 backdrop-blur-md shadow-[0_18px_42px_rgba(3,12,24,0.6),inset_0_1px_0_rgba(186,240,255,0.14)] p-5 sm:p-6 flex flex-col justify-between gap-4"
        >
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[#F2F7FF]">
                  <Clock className="w-4 h-4 text-[#8CEBFF] shrink-0" />
                  <h2 className="text-[17px] font-bold tracking-tight">Latest Analysis</h2>
                </div>
                <p className="text-xs text-[#AAB9CA] tabular-nums">
                  {backendLatestReport || latestSnapshot
                    ? latestDateDisplay.combined
                    : 'No analysis run yet'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-[#8CEBFF]">
                {latestConditionLabel}
              </span>
              {backendLatestReport || latestSnapshot ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#00E99A]/45 bg-[#00E99A]/15 text-xs font-semibold text-[#00E99A] shadow-[0_0_14px_rgba(0,233,154,0.18)]">
                  <span>
                    {backendLatestReport?.status === 'partial' ? 'Partial Data' : 'Completed'}
                  </span>
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-400/40 bg-amber-400/12 text-xs font-semibold text-amber-300">
                  <span>Pending First Run</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center justify-center py-1">
            <div className="relative w-[156px] h-[156px] flex items-center justify-center">
              <svg viewBox="0 0 144 144" className="w-full h-full" aria-hidden="true">
                <defs>
                  <linearGradient id="daLatestGaugeGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#00E99A" />
                    <stop offset="55%" stopColor="#00D9B8" />
                    <stop offset="100%" stopColor="#00CFFF" />
                  </linearGradient>
                  <filter id="daGaugeGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <circle
                  cx="72"
                  cy="72"
                  r={gaugeRadius}
                  fill="none"
                  stroke="#163149"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${arcTotal} ${gaugeCircumference}`}
                  transform="rotate(130 72 72)"
                />

                {latestScore !== null && (
                  <circle
                    cx="72"
                    cy="72"
                    r={gaugeRadius}
                    fill="none"
                    stroke="url(#daLatestGaugeGrad)"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${arcProgress} ${gaugeCircumference}`}
                    transform="rotate(130 72 72)"
                    filter="url(#daGaugeGlow)"
                  />
                )}
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pt-1">
                <span className="text-[32px] font-bold leading-none text-[#F2F7FF] tabular-nums">
                  {latestScore !== null ? `${latestScore}%` : '—'}
                </span>
                <span className="text-[11px] font-medium text-[#B8C7D9] mt-1.5 leading-tight">
                  Overall
                  <br />
                  Farm Health
                </span>
              </div>
            </div>

            <div className="text-xs font-semibold tabular-nums mt-1 text-center">
              {scoreDelta !== null ? (
                <span className={scoreDelta >= 0 ? 'text-[#00E99A]' : 'text-amber-300'}>
                  {scoreDelta >= 0 ? `↑ +${scoreDelta}%` : `↓ ${scoreDelta}%`}{' '}
                  <span className="text-[#C7D6E6] font-medium">vs last analysis</span>
                </span>
              ) : backendLatestReport || latestSnapshot ? (
                <span className="text-[#8CEBFF]">Baseline analysis recorded</span>
              ) : (
                <span className="text-[#AAB9CA]">Run analysis to compute health score</span>
              )}
              {(latestCoveragePct !== null || latestConfidencePct !== null) && (
                <div className="text-[10.5px] font-normal text-[#9FB4CA] mt-1">
                  Coverage {latestCoveragePct ?? '—'}% · Confidence {latestConfidencePct ?? '—'}%
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleInspectLatestReport}
            className="w-full py-2.5 px-4 rounded-full border border-[#6CB2FF]/35 bg-gradient-to-r from-[#132F4C]/90 to-[#193D60]/90 hover:from-[#183B5E] hover:to-[#1F4A73] text-xs font-semibold text-[#F2F7FF] shadow-[0_0_16px_rgba(0,207,255,0.14)] flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
          >
            <span>
              {backendLatestReport || latestSnapshot ? 'View Full Report' : 'Run First Report'}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-[#8CEBFF]" />
          </button>
        </section>
      </div>

      {/* ==================================================================== */}
      {/* SECTION 2: SCHEDULING & AUTOMATION (FULL WIDTH HORIZONTAL PANEL)     */}
      {/* ==================================================================== */}
      <section
        aria-label="Scheduling & Automation"
        className="relative overflow-hidden rounded-[22px] border border-[#00CFFF]/22 bg-[#0A1D31]/76 backdrop-blur-md shadow-[0_18px_42px_rgba(3,12,24,0.6),inset_0_1px_0_rgba(186,240,255,0.12)] px-5 py-5 sm:px-7 sm:py-6 space-y-5"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 -right-12 w-[300px] h-[180px] rounded-full blur-3xl opacity-25"
          style={{
            background: 'radial-gradient(circle, rgba(0, 233, 154, 0.5) 0%, transparent 70%)',
          }}
        />

        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#00E99A]/15 border border-[#00E99A]/40 flex items-center justify-center text-[#00E99A] shadow-[0_0_16px_rgba(0,233,154,0.28)] shrink-0 mt-0.5">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-[22px] font-bold tracking-tight text-[#F2F7FF]">
                Scheduling &amp; Automation
              </h2>
              <p className="text-xs sm:text-[13px] text-[#AAB9CA] mt-0.5">
                Set up recurring Deep Analysis and get notified of important changes.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {unreadNotifications > 0 && (
              <button
                type="button"
                onClick={() => setManageScheduleOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#00CFFF]/45 bg-[#00CFFF]/15 text-xs font-semibold text-[#8CEBFF] cursor-pointer"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>{unreadNotifications} Alert{unreadNotifications > 1 ? 's' : ''}</span>
              </button>
            )}

            <button
              type="button"
              disabled={savingSchedule}
              onClick={handleToggleScheduleEnabled}
              title="Toggle automatic scheduling"
              className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                schedule.enabled
                  ? 'border-[#00E99A]/45 bg-[#00E99A]/15 text-[#00E99A] shadow-[0_0_14px_rgba(0,233,154,0.2)]'
                  : 'border-amber-400/40 bg-amber-400/12 text-amber-300'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center ${
                  schedule.enabled ? 'bg-[#00E99A] text-[#042419]' : 'bg-amber-300 text-[#1F1503]'
                }`}
              >
                <Check className="w-2.5 h-2.5 stroke-[3]" />
              </span>
              <span>{schedule.enabled ? 'Active' : 'Paused'}</span>
            </button>
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-[27fr_39fr_34fr] gap-6 items-center">
          <div className="flex items-center justify-center">
            <ScheduleCalendar3D
              frequency={schedule.frequency}
              nextRunAt={schedule.nextRunAt}
              timeOfDay={schedule.timeOfDay}
              enabled={schedule.enabled}
            />
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-[120px_1fr] items-center gap-3">
              <label
                htmlFor="da-frequency-select"
                className="text-[13px] font-medium text-[#D6E4F2]"
              >
                Frequency
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-[#8CEBFF] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  id="da-frequency-select"
                  disabled={savingSchedule}
                  value={schedule.frequency}
                  onChange={(e) => handleFrequencyChange(e.target.value as AnalysisFrequency)}
                  className="w-full appearance-none rounded-xl border border-white/15 bg-[#122B44]/85 hover:border-[#00CFFF]/45 pl-10 pr-9 py-2.5 text-[13px] font-medium text-[#F2F7FF] transition-colors cursor-pointer"
                >
                  <option value="Daily">Daily</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Biweekly">Biweekly</option>
                  <option value="Monthly">Monthly</option>
                </select>
                <ChevronDown className="w-4 h-4 text-[#AAB9CA] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div className="grid grid-cols-[120px_1fr] items-center gap-3">
              <span className="text-[13px] font-medium text-[#D6E4F2]">Next Run</span>
              <button
                type="button"
                onClick={() => setManageScheduleOpen(true)}
                className="w-full flex items-center gap-2.5 rounded-xl border border-white/15 bg-[#122B44]/85 hover:border-[#00CFFF]/45 px-3.5 py-2.5 text-[13px] font-medium text-[#F2F7FF] tabular-nums text-left transition-colors cursor-pointer"
              >
                <Calendar className="w-4 h-4 text-[#8CEBFF] shrink-0" />
                <span className="truncate">
                  {schedule.enabled ? nextRunDisplay.combined : 'Paused'}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-[120px_1fr] items-center gap-3">
              <label
                htmlFor="da-fields-select"
                className="text-[13px] font-medium text-[#D6E4F2]"
              >
                Fields to Analyse
              </label>
              <div className="relative">
                <Layers className="w-4 h-4 text-[#00E99A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  id="da-fields-select"
                  disabled={savingSchedule}
                  value={fieldScopeSelectValue}
                  onChange={(e) => handleFieldScopeChange(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-white/15 bg-[#122B44]/85 hover:border-[#00CFFF]/45 pl-10 pr-9 py-2.5 text-[13px] font-medium text-[#F2F7FF] transition-colors cursor-pointer"
                >
                  <option value="all">
                    All Fields ({fields.length > 0 ? fields.length : 1})
                  </option>
                  {fields.map((fl) => (
                    <option key={fl.id} value={fl.id}>
                      {fl.name} ({fl.cropName || farm.primaryCrop || 'Crop'})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-[#AAB9CA] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div className="border-t border-white/10 my-1" />

            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/14 bg-[#122B44]/85 px-3.5 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <Bell className="w-4 h-4 text-[#00E99A] shrink-0" />
                <span className="text-[13px] font-medium text-[#E5F0FA] truncate">
                  Notify me of important changes
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={schedule.notifyOnImportantChanges}
                aria-label="Notify me of important changes"
                disabled={savingSchedule}
                onClick={handleToggleNotify}
                className={`w-12 h-6 rounded-full p-0.5 transition-colors shrink-0 cursor-pointer ${
                  schedule.notifyOnImportantChanges
                    ? 'bg-[#00E99A] shadow-[0_0_12px_rgba(0,233,154,0.45)]'
                    : 'bg-white/20'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    schedule.notifyOnImportantChanges ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="lg:border-l lg:border-white/12 lg:pl-6 space-y-4">
            <h3 className="text-[15px] font-bold text-[#F2F7FF]">Schedule Status</h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-start gap-2.5">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    schedule.enabled
                      ? 'bg-[#00E99A] text-[#042419] shadow-[0_0_10px_rgba(0,233,154,0.45)]'
                      : 'bg-amber-400 text-[#1F1503]'
                  }`}
                >
                  <Check className="w-3 h-3 stroke-[3]" />
                </span>
                <div>
                  <div
                    className={`font-semibold text-[13px] ${
                      schedule.enabled ? 'text-[#00E99A]' : 'text-amber-300'
                    }`}
                  >
                    {schedule.enabled ? 'Active and running smoothly' : 'Automation paused'}
                  </div>
                  <div className="text-[#AAB9CA] mt-0.5">
                    {schedule.enabled
                      ? 'Current schedule is active'
                      : 'Re-enable in Manage Schedule'}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#00E99A] text-[#042419] flex items-center justify-center shrink-0 mt-0.5">
                  <Check className="w-3 h-3 stroke-[3]" />
                </span>
                <div>
                  <div className="font-semibold text-[13px] text-[#F2F7FF]">Last Run</div>
                  <div className="text-[#AAB9CA] tabular-nums mt-0.5">
                    {schedule.lastRunAt ? formatScheduleDateTime(schedule.lastRunAt).combined : 'No run recorded yet'}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full border border-[#8CEBFF]/60 text-[#8CEBFF] flex items-center justify-center shrink-0 mt-0.5">
                  <Clock className="w-3 h-3" />
                </span>
                <div>
                  <div className="font-semibold text-[13px] text-[#F2F7FF]">Next Run</div>
                  <div className="text-[#AAB9CA] tabular-nums mt-0.5">
                    {schedule.enabled ? nextRunDisplay.combined : 'Not scheduled while paused'}
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setManageScheduleOpen(true)}
              className="w-full py-2.5 px-4 rounded-full border border-[#00E99A]/70 bg-[#0A2536]/80 hover:bg-[#0D3244] text-xs font-semibold text-[#F2F7FF] shadow-[0_0_18px_rgba(0,233,154,0.22)] flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
            >
              <span>Manage Schedule</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#00E99A]" />
            </button>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* SECTION 3: REPORTS & HISTORY (73% CARDS + 27% QUICK ACTIONS)         */}
      {/* ==================================================================== */}
      <section
        aria-label="Reports & History"
        className="relative overflow-hidden rounded-[22px] border border-[#6CB2FF]/22 bg-[#0A1D31]/78 backdrop-blur-md shadow-[0_18px_42px_rgba(3,12,24,0.6),inset_0_1px_0_rgba(186,240,255,0.12)] px-5 py-5 sm:px-7 sm:py-6 space-y-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#00CFFF]/15 border border-[#00CFFF]/40 flex items-center justify-center text-[#00CFFF] shadow-[0_0_16px_rgba(0,207,255,0.28)] shrink-0 mt-0.5">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-[22px] font-bold tracking-tight text-[#F2F7FF]">
                Reports &amp; History
              </h2>
              <p className="text-xs sm:text-[13px] text-[#AAB9CA] mt-0.5">
                Access all past Deep Analysis reports, compare results and track your farm&apos;s
                progress.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleOpenCompare()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#6CB2FF]/35 bg-[#122B44]/85 hover:bg-[#173756] text-xs font-semibold text-[#F2F7FF] shadow-[0_0_14px_rgba(0,207,255,0.12)] transition-all cursor-pointer whitespace-nowrap"
          >
            <span>Compare Reports</span>
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#8CEBFF]" />
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[73fr_27fr] gap-4 items-stretch">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {Array.from({ length: 4 }).map((_, idx) => {
              const engineRep = backendRecentReports[idx] ?? null;
              const snap = !engineRep ? recentFourSnapshots[idx] ?? null : null;

              if (!engineRep && !snap) {
                return (
                  <div
                    key={`empty-${idx}`}
                    className="rounded-[16px] border border-dashed border-white/15 bg-[#0C2136]/45 p-4 flex flex-col items-center justify-center text-center gap-2.5 min-h-[238px]"
                  >
                    <div className="w-9 h-9 rounded-full border border-white/15 bg-white/5 flex items-center justify-center text-[#8CEBFF]">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="text-xs font-semibold text-[#C7D6E6]">
                      {idx === 0 ? 'No Reports Recorded Yet' : 'Awaiting Next Analysis'}
                    </div>
                    <p className="text-[11px] text-[#8DA4BC] leading-relaxed">
                      Run a Deep Analysis to record an immutable report here.
                    </p>
                  </div>
                );
              }

              const isLatestCard = idx === 0;
              const itemId = engineRep ? engineRep.id : snap!.id;
              const timestamp = engineRep ? engineRep.completedAt : snap!.generatedAt;
              const dt = formatScheduleDateTime(timestamp);
              const score = engineRep
                ? engineRep.overallSummary.healthScore
                : snap!.suitabilityScore;
              const isCautionScore = score !== null && score < 85;
              const condText = engineRep
                ? engineRep.overallSummary.conditionLabel
                : score !== null
                  ? score >= 85
                    ? 'Good'
                    : 'Monitor'
                  : 'Recorded';

              return (
                <article
                  key={itemId}
                  className={`group rounded-[16px] flex flex-col justify-between transition-all ${
                    isLatestCard
                      ? 'border border-[#00E99A]/70 bg-gradient-to-b from-[#0E2B3E]/90 to-[#0A2033]/92 shadow-[0_0_24px_rgba(0,233,154,0.20)]'
                      : 'border border-[#6CB2FF]/24 bg-[#0D2238]/82 hover:border-[#00CFFF]/45'
                  }`}
                >
                  <div>
                    <AerialParcelThumbnail
                      index={idx}
                      highlighted={isLatestCard}
                      alt={`${farm.name} aerial field snapshot ${dt.dateText}`}
                    />
                    <div className="px-3.5 pt-3 pb-2 space-y-2">
                      <div>
                        <div className="text-[13px] font-semibold text-[#F2F7FF] tabular-nums">
                          {dt.dateText}
                        </div>
                        <div className="text-[11px] text-[#AAB9CA] tabular-nums">
                          {dt.timeText} · {condText}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-0.5">
                        <span
                          className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                            isCautionScore
                              ? 'bg-[#F5B83D] text-[#1E1403]'
                              : 'bg-[#00E99A] text-[#042419]'
                          }`}
                        >
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                        <span className="text-xl font-bold text-[#F2F7FF] tabular-nums">
                          {score !== null ? `${score}%` : '—'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="px-3.5 pb-3.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (engineRep) handleInspectReportById(engineRep.id);
                        else if (snap) setInspectingLegacySnapshot(snap);
                      }}
                      className={`w-full py-2 px-3 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                        isLatestCard
                          ? 'border border-[#00E99A]/70 bg-[#0D383D]/85 hover:bg-[#11484C] text-[#F2F7FF] shadow-[0_0_16px_rgba(0,233,154,0.22)]'
                          : 'border border-[#6CB2FF]/35 bg-[#122B44]/90 hover:bg-[#183857] text-[#F2F7FF]'
                      }`}
                    >
                      <span>View Report</span>
                      <ArrowRight
                        className={`w-3.5 h-3.5 ${
                          isLatestCard ? 'text-[#00E99A]' : 'text-[#8CEBFF]'
                        }`}
                      />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <aside
            aria-label="Quick Actions"
            className="rounded-[18px] border border-[#6CB2FF]/25 bg-[#0D2238]/85 p-4 sm:p-5 flex flex-col justify-between"
          >
            <div>
              <h3 className="text-[15px] font-bold text-[#F2F7FF] pb-3 border-b border-white/10">
                Quick Actions
              </h3>

              <div className="divide-y divide-white/10">
                <button
                  type="button"
                  onClick={() => handleOpenCompare()}
                  className="w-full py-3.5 px-1 flex items-center justify-between gap-3 text-left hover:bg-white/[0.04] rounded-lg transition-colors cursor-pointer group"
                >
                  <span className="inline-flex items-center gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-[#00CFFF]/12 border border-[#00CFFF]/30 flex items-center justify-center text-[#00CFFF] shrink-0">
                      <FileBarChart2 className="w-4 h-4" />
                    </span>
                    <span className="text-[13px] font-medium text-[#E5F0FA] group-hover:text-white truncate">
                      Compare Two Reports
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-[#AAB9CA] group-hover:text-[#00CFFF] shrink-0 transition-colors" />
                </button>

                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="w-full py-3.5 px-1 flex items-center justify-between gap-3 text-left hover:bg-white/[0.04] rounded-lg transition-colors cursor-pointer group"
                >
                  <span className="inline-flex items-center gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-[#00CFFF]/12 border border-[#00CFFF]/30 flex items-center justify-center text-[#00CFFF] shrink-0">
                      <FileText className="w-4 h-4" />
                    </span>
                    <span className="text-[13px] font-medium text-[#E5F0FA] group-hover:text-white truncate">
                      Export as PDF
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-[#AAB9CA] group-hover:text-[#00CFFF] shrink-0 transition-colors" />
                </button>

                <button
                  type="button"
                  onClick={() => setSummaryModalOpen(true)}
                  className="w-full py-3.5 px-1 flex items-center justify-between gap-3 text-left hover:bg-white/[0.04] rounded-lg transition-colors cursor-pointer group"
                >
                  <span className="inline-flex items-center gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-[#00CFFF]/12 border border-[#00CFFF]/30 flex items-center justify-center text-[#00CFFF] shrink-0">
                      <ClipboardList className="w-4 h-4" />
                    </span>
                    <span className="text-[13px] font-medium text-[#E5F0FA] group-hover:text-white truncate">
                      View Analysis Summary
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-[#AAB9CA] group-hover:text-[#00CFFF] shrink-0 transition-colors" />
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onRunDeepAnalysis(farm)}
              className="mt-3 w-full py-2 px-3 rounded-xl border border-white/12 bg-white/[0.04] hover:bg-white/[0.08] text-[11.5px] font-semibold text-[#AAB9CA] hover:text-[#F2F7FF] flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <GitCompare className="w-3.5 h-3.5 text-[#00CFFF]" />
              <span>Open Detailed Analysis Studio</span>
            </button>
          </aside>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* MODALS & DRAWERS                                                     */}
      {/* ==================================================================== */}
      {preflightOpen && (
        <AnalysisPreflightModal
          farm={farm}
          fields={fields}
          initialScope={defaultPreflightScope}
          providers={summary?.providers ?? []}
          routines={summary?.routines ?? []}
          lastConfirmedIrrigation={summary?.lastConfirmedIrrigation ?? null}
          onProvidersUpdated={(nextProviders) =>
            setSummary((prev) => (prev ? { ...prev, providers: nextProviders } : prev))
          }
          onPracticeSaved={async () => {
            await loadAdvancedSummary();
            await onRefreshPortfolio?.();
          }}
          onLaunchRun={handleLaunchBackendRun}
          onClose={() => setPreflightOpen(false)}
        />
      )}

      {inspectingFullReport && (
        <DeepAnalysisReportViewer
          report={inspectingFullReport}
          latestJob={
            summary?.jobs?.find((j) => j.reportId === inspectingFullReport.id) ?? activeJob
          }
          tempUnit={tempUnit}
          onClose={() => setInspectingFullReport(null)}
          onReportUpdated={(updated) => {
            setInspectingFullReport(updated);
            setSummary((prev) =>
              prev && prev.latestReport?.id === updated.id
                ? { ...prev, latestReport: updated }
                : prev
            );
          }}
          onOpenCompare={(repId) => {
            setInspectingFullReport(null);
            handleOpenCompare(repId);
          }}
          onRunNewAnalysisClick={() => setPreflightOpen(true)}
          onOpenScheduleAutomation={() => setManageScheduleOpen(true)}
          onOpenFieldOverview={onOpenFieldOverview}
          onOpenOnMap={onOpenOnMap}
          onOpenRotationPlan={onOpenRotationPlan}
          onOpenWeatherForecast={onOpenWeatherForecast}
          onPortfolioChanged={onRefreshPortfolio}
        />
      )}

      {inspectingLegacySnapshot && (
        <FullReportModal
          farm={farm}
          snapshot={inspectingLegacySnapshot}
          previousSnapshot={
            orderedSnapshots[
              orderedSnapshots.findIndex((s) => s.id === inspectingLegacySnapshot.id) + 1
            ] ?? null
          }
          tempUnit={tempUnit}
          onClose={() => setInspectingLegacySnapshot(null)}
          onExportPdf={() => handleExportPdf()}
          onOpenCompare={(snapId) => {
            setInspectingLegacySnapshot(null);
            handleOpenCompare(snapId);
          }}
          onOpenAnalyzeStudio={() => {
            setInspectingLegacySnapshot(null);
            onRunDeepAnalysis(farm);
          }}
        />
      )}

      {compareModalOpen && backendRecentReports.length > 0 && (
        <ReportCompareDrawer
          reports={backendRecentReports}
          initialBaselineId={compareInitialLeft}
          initialCurrentId={compareInitialRight}
          onClose={() => setCompareModalOpen(false)}
        />
      )}

      {compareModalOpen && backendRecentReports.length === 0 && (
        <CompareReportsModal
          snapshots={orderedSnapshots}
          initialLeftId={compareInitialLeft}
          initialRightId={compareInitialRight}
          tempUnit={tempUnit}
          onClose={() => setCompareModalOpen(false)}
          onRunNewAnalysis={() => {
            setCompareModalOpen(false);
            setPreflightOpen(true);
          }}
        />
      )}

      {summaryModalOpen && (
        <AnalysisSummaryModal
          farm={farm}
          latestBackendReport={backendLatestReport}
          latestSnapshot={latestSnapshot}
          previousSnapshot={previousSnapshot}
          onClose={() => setSummaryModalOpen(false)}
          onExportPdf={() => handleExportPdf()}
          onOpenFullReport={handleInspectLatestReport}
        />
      )}

      {manageScheduleOpen && (
        <ManageAutomationModal
          farm={farm}
          fields={fields}
          schedules={summary?.schedules ?? []}
          routines={summary?.routines ?? []}
          jobs={summary?.jobs ?? []}
          notifications={summary?.notifications ?? []}
          providers={summary?.providers ?? []}
          onRefreshSummary={loadAdvancedSummary}
          onRunStarted={(runId) => {
            attachStreamToRun(runId);
          }}
          onClose={() => setManageScheduleOpen(false)}
        />
      )}
    </div>
  );
};
