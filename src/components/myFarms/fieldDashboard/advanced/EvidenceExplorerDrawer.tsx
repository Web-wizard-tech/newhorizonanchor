import React from 'react';
import {
  CheckCircle2,
  Database,
  ExternalLink,
  FlaskConical,
  Globe,
  Info,
  Layers,
  ShieldAlert,
  X,
} from 'lucide-react';
import { EvidenceRecord } from '../../../../types/advanced';

interface EvidenceExplorerDrawerProps {
  evidence: EvidenceRecord | null;
  onClose: () => void;
}

export const EvidenceExplorerDrawer: React.FC<EvidenceExplorerDrawerProps> = ({
  evidence,
  onClose,
}) => {
  if (!evidence) return null;

  return (
    <div
      className="fixed inset-0 z-[95] bg-[#030D18]/80 backdrop-blur-sm flex justify-end"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Evidence & Calculation Inspector"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl h-full overflow-y-auto border-l border-[#00CFFF]/30 bg-[#081A2E] text-[#F2F7FF] shadow-[-18px_0_48px_rgba(0,0,0,0.65)] p-5 sm:p-6 space-y-5"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div className="space-y-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#00CFFF]">
              <Database className="w-3.5 h-3.5" />
              <span>Section J · Evidence &amp; Provenance</span>
            </div>
            <h3 className="text-lg font-bold text-[#F2F7FF] truncate">{evidence.metricName}</h3>
            <p className="text-xs text-[#AAB9CA]">
              {evidence.fieldName}
              {evidence.geometryVersionId ? ` · Geometry ${evidence.geometryVersionId}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close evidence drawer"
            className="w-8 h-8 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#AAB9CA] hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Observed / Computed Value Banner */}
        <div className="rounded-xl border border-[#00E99A]/35 bg-[#0C253A] p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#AAB9CA]">Recorded Value</div>
            <div className="text-2xl font-bold text-[#00E99A] tabular-nums mt-0.5">
              {evidence.valueDisplay}
              {evidence.unit && !evidence.valueDisplay.includes(evidence.unit)
                ? ` ${evidence.unit}`
                : ''}
            </div>
          </div>
          <div className="text-right space-y-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border border-[#00CFFF]/35 bg-[#00CFFF]/10 text-[11px] font-semibold text-[#8CEBFF]">
              {evidence.sourceType}
            </span>
            <div className="text-[11px] text-[#AAB9CA] tabular-nums">
              Confidence: <strong className="text-[#F2F7FF]">{evidence.confidencePct}%</strong> (
              {evidence.confidenceLabel})
            </div>
          </div>
        </div>

        {/* Provider & Temporal Window */}
        <div className="rounded-xl border border-white/10 bg-[#0D2137] p-4 space-y-2.5 text-xs">
          <div className="flex items-center gap-2 font-semibold text-[#8CEBFF]">
            <Globe className="w-4 h-4" />
            <span>Data Source &amp; Timestamps</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <div className="text-[#8DA4BC]">Provider</div>
              <div className="font-medium text-[#F2F7FF]">{evidence.providerName}</div>
            </div>
            <div>
              <div className="text-[#8DA4BC]">Product / Dataset</div>
              <div className="font-mono text-[11px] text-[#E5F0FA]">{evidence.productId}</div>
            </div>
            <div>
              <div className="text-[#8DA4BC]">Observation / Validity Window</div>
              <div className="font-medium text-[#F2F7FF] tabular-nums">
                {evidence.observationPeriod}
              </div>
            </div>
            <div>
              <div className="text-[#8DA4BC]">Retrieved At</div>
              <div className="font-medium text-[#F2F7FF] tabular-nums">
                {new Date(evidence.retrievedAt).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[#8DA4BC]">Spatial Resolution</div>
              <div className="font-medium text-[#F2F7FF]">{evidence.spatialResolution}</div>
            </div>
            <div>
              <div className="text-[#8DA4BC]">Source Endpoint / Reference</div>
              <div className="font-mono text-[11px] text-[#8CEBFF] break-all flex items-center gap-1">
                <span>{evidence.sourceUrl}</span>
                {evidence.sourceUrl.startsWith('http') && <ExternalLink className="w-3 h-3 shrink-0" />}
              </div>
            </div>
          </div>
        </div>

        {/* Spatial Coverage Details if present */}
        {evidence.spatialCoverage && (
          <div className="rounded-xl border border-white/10 bg-[#0D2137] p-4 space-y-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-[#00E99A]">
              <Layers className="w-4 h-4" />
              <span>Spatial Fit &amp; Geometry Coverage</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 tabular-nums">
              <div>
                <div className="text-[#8DA4BC]">Spatial Fit</div>
                <div className="font-semibold text-[#F2F7FF]">
                  {evidence.spatialCoverage.spatialFit}
                </div>
              </div>
              <div>
                <div className="text-[#8DA4BC]">Valid Coverage</div>
                <div className="font-semibold text-[#00E99A]">
                  {evidence.spatialCoverage.validCoveragePct}%
                </div>
              </div>
              <div>
                <div className="text-[#8DA4BC]">Valid Pixels</div>
                <div className="font-semibold text-[#F2F7FF]">
                  {evidence.spatialCoverage.validPixelCount} /{' '}
                  {evidence.spatialCoverage.intersectingPixelCount}
                </div>
              </div>
              <div>
                <div className="text-[#8DA4BC]">Field Area</div>
                <div className="text-[#E5F0FA]">
                  {(evidence.spatialCoverage.fieldAreaM2 / 10000).toFixed(2)} ha
                </div>
              </div>
              <div>
                <div className="text-[#8DA4BC]">Aggregation</div>
                <div className="text-[#E5F0FA]">{evidence.spatialCoverage.aggregation}</div>
              </div>
            </div>
          </div>
        )}

        {/* Exact Formula & Inputs Used */}
        <div className="rounded-xl border border-white/10 bg-[#0D2137] p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-[#00CFFF]">
              <FlaskConical className="w-4 h-4" />
              <span>Deterministic Formula &amp; Inputs</span>
            </div>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white/5 text-[#AAB9CA]">
              {evidence.formulaVersion}
            </span>
          </div>
          <div className="rounded-lg border border-white/10 bg-[#071626] p-2.5 font-mono text-[11px] text-[#B7E9FF] leading-relaxed">
            {evidence.formulaDisplay}
          </div>
          {evidence.inputsUsed.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-[#AAB9CA]">Inputs Used</div>
              <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-[#091A2C]">
                {evidence.inputsUsed.map((inp, idx) => (
                  <div
                    key={`${inp.name}-${idx}`}
                    className="px-3 py-1.5 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[#E5F0FA]">{inp.name}</div>
                      <div className="text-[10.5px] text-[#8DA4BC]">{inp.source}</div>
                    </div>
                    <div className="font-mono text-[11px] text-[#00E99A] shrink-0">{inp.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Quality Flags, Missing Data & Model Versions */}
        <div className="rounded-xl border border-white/10 bg-[#0D2137] p-4 space-y-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-amber-300">
            <ShieldAlert className="w-4 h-4" />
            <span>Quality Control, Limitations &amp; Versions</span>
          </div>

          <div className="space-y-1">
            <div className="text-[#8DA4BC]">Quality Flags</div>
            {evidence.qualityFlags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {evidence.qualityFlags.map((flag) => (
                  <span
                    key={flag}
                    className="px-2 py-0.5 rounded border border-white/15 bg-white/5 text-[11px] text-[#E5F0FA]"
                  >
                    {flag}
                  </span>
                ))}
              </div>
            ) : (
              <div className="inline-flex items-center gap-1 text-[#00E99A]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>No quality anomalies detected</span>
              </div>
            )}
          </div>

          <div>
            <div className="text-[#8DA4BC]">Missing Value Handling</div>
            <div className="text-[#E5F0FA] mt-0.5">{evidence.missingValueHandling}</div>
          </div>

          <div>
            <div className="text-[#8DA4BC] flex items-center gap-1">
              <Info className="w-3.5 h-3.5" />
              <span>Known Limitations</span>
            </div>
            <div className="text-[#E5F0FA] mt-0.5 leading-relaxed">{evidence.limitations}</div>
          </div>

          <div className="pt-2 border-t border-white/10 flex flex-wrap gap-3 text-[10.5px] font-mono text-[#8DA4BC]">
            <span>Engine: {evidence.modelVersions.engineVersion}</span>
            <span>CropDB: {evidence.modelVersions.cropKnowledgeVersion}</span>
            <span>Rules: {evidence.modelVersions.ruleSetVersion}</span>
          </div>
        </div>
      </aside>
    </div>
  );
};
