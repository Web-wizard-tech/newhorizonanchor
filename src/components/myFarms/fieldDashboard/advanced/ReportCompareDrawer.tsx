import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  GitCompare,
  Loader2,
  X,
} from 'lucide-react';
import { DeepAnalysisReport, ReportComparisonResult } from '../../../../types/advanced';
import { compareReports, RecentReportMeta } from '../../../../services/advancedApi';

interface ReportCompareDrawerProps {
  reports: RecentReportMeta[];
  initialBaselineId?: string;
  initialCurrentId?: string;
  onClose: () => void;
}

const CAUSE_LABELS: Record<string, string> = {
  environmental_observation_change: 'Weather / Satellite Shift',
  farmer_input_change: 'Farmer Input Updated',
  management_event_change: 'Irrigation / Field Action',
  geometry_change: 'Field Geometry Changed',
  source_or_coverage_change: 'Data Source / Coverage Shift',
  calculation_version_change: 'Model Version Change',
  unknown_or_not_attributable: 'Not Attributable',
};

export const ReportCompareDrawer: React.FC<ReportCompareDrawerProps> = ({
  reports,
  initialBaselineId,
  initialCurrentId,
  onClose,
}) => {
  const [baselineId, setBaselineId] = useState(
    initialBaselineId || reports[1]?.id || reports[0]?.id || ''
  );
  const [currentId, setCurrentId] = useState(initialCurrentId || reports[0]?.id || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    comparison: ReportComparisonResult;
    baseline: DeepAnalysisReport;
    current: DeepAnalysisReport;
  } | null>(null);

  useEffect(() => {
    if (!baselineId || !currentId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    compareReports(baselineId, currentId)
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Comparison failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baselineId, currentId]);

  return (
    <div
      className="fixed inset-0 z-[88] bg-[#030D18]/85 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compare Immutable Deep Analysis Reports"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[22px] border border-[#00CFFF]/35 bg-[#081A2E] text-[#F2F7FF] shadow-[0_24px_64px_rgba(0,0,0,0.72)] p-5 sm:p-6 space-y-5"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#00CFFF]">
              <GitCompare className="w-3.5 h-3.5" />
              <span>Immutable Report Comparison</span>
            </div>
            <h2 className="text-xl font-bold text-[#F2F7FF]">Compare Two Deep Analysis Reports</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#AAB9CA] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div>
            <label className="block text-[11px] text-[#AAB9CA] mb-1">Baseline Report</label>
            <select
              value={baselineId}
              onChange={(e) => setBaselineId(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-[#0D2137] px-3 py-2 text-xs text-[#F2F7FF]"
            >
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.completedAt).toLocaleString()} · {r.scope.label} (
                  {r.overallSummary.healthScore ?? '—'}%)
                </option>
              ))}
            </select>
          </div>

          <ArrowRight className="w-5 h-5 text-[#00CFFF] hidden md:block mt-5" />

          <div>
            <label className="block text-[11px] text-[#AAB9CA] mb-1">Current / Target Report</label>
            <select
              value={currentId}
              onChange={(e) => setCurrentId(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-[#0D2137] px-3 py-2 text-xs text-[#F2F7FF]"
            >
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.completedAt).toLocaleString()} · {r.scope.label} (
                  {r.overallSummary.healthScore ?? '—'}%)
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading && (
          <div className="py-10 flex items-center justify-center gap-2 text-xs text-[#8CEBFF]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Computing attributed deltas…</span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 p-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        {result && !loading && (
          <div className="space-y-4">
            {/* Comparability Gate */}
            <div
              className={`rounded-xl border p-4 space-y-2 text-xs ${
                result.comparison.comparable
                  ? 'border-[#00E99A]/40 bg-[#0D253A]'
                  : 'border-amber-400/45 bg-amber-950/30'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                {result.comparison.comparable ? (
                  <CheckCircle2 className="w-4 h-4 text-[#00E99A]" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-300" />
                )}
                <span>{result.comparison.summaryHeadline}</span>
              </div>
              {result.comparison.comparabilityReasons.length > 0 && (
                <ul className="space-y-1 text-[#C7D6E6]">
                  {result.comparison.comparabilityReasons.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {result.comparison.primaryCauses.map((c) => (
                  <span
                    key={c}
                    className="px-2 py-0.5 rounded border border-[#00CFFF]/35 bg-[#00CFFF]/10 text-[10.5px] font-semibold text-[#8CEBFF]"
                  >
                    {CAUSE_LABELS[c] || c}
                  </span>
                ))}
              </div>
            </div>

            {/* Score & Quality Deltas */}
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl border border-white/10 bg-[#0D2137] p-3">
                <div className="text-[#8DA4BC]">Health Score Delta</div>
                <div className="text-xl font-bold text-[#00E99A] tabular-nums mt-0.5">
                  {result.comparison.scoreDelta !== null
                    ? `${result.comparison.scoreDelta >= 0 ? '+' : ''}${result.comparison.scoreDelta}%`
                    : 'Not comparable'}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0D2137] p-3">
                <div className="text-[#8DA4BC]">Coverage Delta</div>
                <div className="text-xl font-bold text-[#8CEBFF] tabular-nums mt-0.5">
                  {result.comparison.coverageDelta >= 0 ? '+' : ''}
                  {result.comparison.coverageDelta}%
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0D2137] p-3">
                <div className="text-[#8DA4BC]">Confidence Delta</div>
                <div className="text-xl font-bold text-[#F2F7FF] tabular-nums mt-0.5">
                  {result.comparison.confidenceDelta >= 0 ? '+' : ''}
                  {result.comparison.confidenceDelta}%
                </div>
              </div>
            </div>

            {/* Diff Table */}
            <div className="rounded-xl border border-white/10 bg-[#0D2137] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/10 text-xs font-bold text-[#F2F7FF]">
                Attributed Changes ({result.comparison.items.length})
              </div>
              {result.comparison.items.length === 0 ? (
                <div className="p-4 text-xs text-[#AAB9CA]">
                  No metric, finding, or input differences detected between these reports.
                </div>
              ) : (
                <div className="divide-y divide-white/10 text-xs">
                  {result.comparison.items.map((item, idx) => (
                    <div key={idx} className="p-3.5 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-[#F2F7FF]">{item.label}</span>
                        <span className="px-2 py-0.5 rounded bg-white/10 text-[10.5px] font-semibold text-[#8CEBFF]">
                          {item.classification} ({item.deltaDisplay})
                        </span>
                      </div>
                      <div className="text-[#AAB9CA] tabular-nums">
                        {item.baselineValue} → <strong className="text-[#E5F0FA]">{item.currentValue}</strong>
                      </div>
                      <div className="text-[#C7D6E6]">{item.explanation}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {result.comparison.actionsTakenBetweenReports.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-[#0D2137] p-3.5 text-xs space-y-1.5">
                <div className="font-bold text-[#00E99A]">
                  Actions Scheduled / Completed Since Baseline
                </div>
                {result.comparison.actionsTakenBetweenReports.map((a, i) => (
                  <div key={i} className="text-[#E5F0FA]">
                    • {a.title} ({a.status})
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
