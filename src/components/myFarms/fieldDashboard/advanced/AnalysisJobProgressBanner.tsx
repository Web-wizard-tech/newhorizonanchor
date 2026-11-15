import React from 'react';
import { AlertTriangle, Check, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { AnalysisJob } from '../../../../types/advanced';

interface AnalysisJobProgressBannerProps {
  job: AnalysisJob;
  onCancel: (runId: string) => void;
  onDismiss: () => void;
}

export const AnalysisJobProgressBanner: React.FC<AnalysisJobProgressBannerProps> = ({
  job,
  onCancel,
  onDismiss,
}) => {
  const isTerminal =
    job.status === 'complete' ||
    job.status === 'partial' ||
    job.status === 'failed' ||
    job.status === 'cancelled';

  const completedStages = job.stages.filter(
    (s) => s.status === 'complete' || s.status === 'partial' || s.status === 'skipped'
  ).length;
  const pct =
    job.status === 'complete' || job.status === 'partial'
      ? 100
      : Math.min(95, Math.round((completedStages / Math.max(1, job.stages.length)) * 100));

  const currentStageObj =
    job.stages.find((s) => s.status === 'running') ??
    job.stages.find((s) => s.stage === job.currentStage) ??
    job.stages[job.stages.length - 1];

  return (
    <div
      role="status"
      className={`rounded-[18px] border p-4 backdrop-blur-md space-y-3 ${
        job.status === 'failed'
          ? 'border-rose-400/45 bg-rose-950/55 text-rose-100'
          : job.status === 'partial'
            ? 'border-amber-400/45 bg-[#1C2332]/85 text-amber-100'
            : job.status === 'cancelled'
              ? 'border-white/20 bg-[#10263A]/85 text-[#D6E4F2]'
              : 'border-[#00CFFF]/40 bg-[#0B2339]/90 text-[#F2F7FF]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {!isTerminal ? (
            <Loader2 className="w-4 h-4 text-[#00E99A] animate-spin shrink-0" />
          ) : job.status === 'failed' ? (
            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : job.status === 'partial' ? (
            <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
          ) : (
            <Check className="w-4 h-4 text-[#00E99A] shrink-0" />
          )}
          <div>
            <div className="text-xs sm:text-sm font-bold flex items-center gap-2">
              <span>
                {!isTerminal
                  ? `Running Deep Analysis (${pct}%)`
                  : job.status === 'complete'
                    ? 'Deep Analysis Completed'
                    : job.status === 'partial'
                      ? 'Deep Analysis Completed with Partial Provider Coverage'
                      : job.status === 'cancelled'
                        ? 'Deep Analysis Cancelled (Last Valid Report Preserved)'
                        : 'Deep Analysis Failed (Last Valid Report Preserved)'}
              </span>
              <span className="text-[11px] font-normal text-[#AAB9CA]">· {job.scope.label}</span>
            </div>
            <div className="text-[11px] text-[#AAB9CA] mt-0.5">
              {job.errorMessage
                ? job.errorMessage
                : currentStageObj
                  ? `${currentStageObj.label}${currentStageObj.detail ? `: ${currentStageObj.detail}` : ''}`
                  : job.triggerReason}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isTerminal && !job.cancellationRequested && (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              className="px-3 py-1 rounded-lg border border-rose-400/40 bg-rose-500/15 hover:bg-rose-500/25 text-xs font-semibold text-rose-200 cursor-pointer"
            >
              Cancel Run
            </button>
          )}
          {isTerminal && (
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-semibold text-[#D6E4F2] cursor-pointer"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>

      {/* Stage Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5">
        {job.stages.slice(0, 14).map((st) => {
          const stClass =
            st.status === 'complete'
              ? 'border-[#00E99A]/40 bg-[#00E99A]/12 text-[#00E99A]'
              : st.status === 'running'
                ? 'border-[#00CFFF]/60 bg-[#00CFFF]/15 text-[#8CEBFF]'
                : st.status === 'partial'
                  ? 'border-amber-400/40 bg-amber-400/12 text-amber-200'
                  : st.status === 'failed'
                    ? 'border-rose-400/45 bg-rose-500/15 text-rose-200'
                    : 'border-white/10 bg-white/[0.03] text-[#8DA4BC]';
          return (
            <div
              key={st.stage}
              title={st.detail || st.label}
              className={`rounded-lg border px-2 py-1 text-[10px] font-medium truncate flex items-center gap-1 ${stClass}`}
            >
              {st.status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
              {st.status === 'complete' && <Check className="w-2.5 h-2.5 shrink-0" />}
              {st.status === 'partial' && <ShieldAlert className="w-2.5 h-2.5 shrink-0" />}
              <span className="truncate">{st.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
