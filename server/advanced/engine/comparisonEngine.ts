import {
  ChangeCause,
  DeepAnalysisReport,
  ReportComparisonItem,
  ReportComparisonResult,
} from '../../../src/types/advanced';

export const COMPARISON_ENGINE_VERSION = 'report-diff-v1.0.0';

/**
 * Compares two immutable DeepAnalysisReport snapshots rigorously:
 * - Blocks misleading numeric deltas if farmId differs or field scopes have zero overlap.
 * - Flags geometry edits, profile/input changes, provider changes, and calculation/rule version changes.
 * - Attributes each apparent change to explicit ChangeCause categories.
 */
export function compareImmutableReports(
  baseline: DeepAnalysisReport,
  current: DeepAnalysisReport,
  actionsBetween: Array<{ title: string; status: string; completedAt?: string | null }> = []
): ReportComparisonResult {
  const causesSet = new Set<ChangeCause>();
  const comparabilityReasons: string[] = [];

  if (baseline.farmId !== current.farmId) {
    comparabilityReasons.push('Reports belong to different farms.');
  }

  const baseFields = new Set(baseline.fieldIds);
  const overlapFields = current.fieldIds.filter((id) => baseFields.has(id));
  if (
    baseline.fieldIds.length > 0 &&
    current.fieldIds.length > 0 &&
    overlapFields.length === 0
  ) {
    comparabilityReasons.push(
      `Zero field overlap between ${baseline.scope.label} and ${current.scope.label}.`
    );
  }

  if (baseline.status === 'failed' || current.status === 'failed') {
    comparabilityReasons.push('One or both runs failed before generating a complete valid report.');
  }

  const comparable = comparabilityReasons.length === 0;

  // Detect geometry changes
  let geometryChanged = false;
  for (const fId of overlapFields) {
    if (
      baseline.geometryVersionIds[fId] &&
      current.geometryVersionIds[fId] &&
      baseline.geometryVersionIds[fId] !== current.geometryVersionIds[fId]
    ) {
      geometryChanged = true;
    }
  }
  if (geometryChanged) {
    causesSet.add('geometry_change');
    comparabilityReasons.push('Field boundary geometry version changed between reports.');
  }

  // Detect profile/input changes
  if (baseline.inputSnapshotId !== current.inputSnapshotId) {
    causesSet.add('farmer_input_change');
  }

  // Detect calculation/ruleset/crop database version changes
  const versionChanged =
    baseline.engineVersion !== current.engineVersion ||
    baseline.ruleSetVersion !== current.ruleSetVersion ||
    baseline.cropKnowledgeVersion !== current.cropKnowledgeVersion;
  if (versionChanged) {
    causesSet.add('calculation_version_change');
  }

  // Detect provider availability / resolution differences
  const baseProviders = new Map(baseline.sourceOutcomes.map((s) => [s.category, s.providerId]));
  let providerShifted = false;
  for (const s of current.sourceOutcomes) {
    const prevProv = baseProviders.get(s.category);
    if (prevProv && prevProv !== s.providerId) {
      providerShifted = true;
    }
  }
  if (
    providerShifted ||
    Math.abs(current.overallSummary.coveragePct - baseline.overallSummary.coveragePct) >= 12
  ) {
    causesSet.add('source_or_coverage_change');
  }

  if (actionsBetween.some((a) => a.status === 'Completed')) {
    causesSet.add('management_event_change');
  }

  const items: ReportComparisonItem[] = [];

  if (!comparable) {
    items.push({
      category: 'version',
      label: 'Report Scope / Farm Compatibility Check',
      classification: 'Not comparable',
      baselineValue: `${baseline.scope.label} (${baseline.createdAt.slice(0, 10)})`,
      currentValue: `${current.scope.label} (${current.createdAt.slice(0, 10)})`,
      deltaDisplay: 'Blocked',
      causes: ['unknown_or_not_attributable'],
      explanation: comparabilityReasons.join(' '),
    });
    return {
      baselineReportId: baseline.id,
      currentReportId: current.id,
      comparable: false,
      comparabilityReasons,
      summaryHeadline: 'Reports are not directly comparable for numeric trend deltas.',
      primaryCauses: ['unknown_or_not_attributable'],
      scoreDelta: null,
      coverageDelta: current.overallSummary.coveragePct - baseline.overallSummary.coveragePct,
      confidenceDelta: current.overallSummary.confidencePct - baseline.overallSummary.confidencePct,
      items,
      actionsTakenBetweenReports: actionsBetween,
    };
  }

  // Metric deltas
  const baseScore = baseline.overallSummary.healthScore;
  const currScore = current.overallSummary.healthScore;
  const scoreDelta =
    baseScore !== null && currScore !== null ? currScore - baseScore : null;
  const covDelta = current.overallSummary.coveragePct - baseline.overallSummary.coveragePct;
  const confDelta = current.overallSummary.confidencePct - baseline.overallSummary.confidencePct;

  const baseMeanEt0 = avgNum(baseline.fieldAssessments.map((f) => f.waterSummary.et0MeanMmDay));
  const currMeanEt0 = avgNum(current.fieldAssessments.map((f) => f.waterSummary.et0MeanMmDay));
  if (baseMeanEt0 !== null && currMeanEt0 !== null && Math.abs(currMeanEt0 - baseMeanEt0) >= 0.2) {
    causesSet.add('environmental_observation_change');
  }

  items.push({
    category: 'metric',
    label: 'Calibrated Health Score',
    classification:
      scoreDelta === null
        ? 'Not comparable'
        : scoreDelta > 2
          ? 'Improved'
          : scoreDelta < -2
            ? 'Worsened'
            : 'Continuing finding',
    baselineValue: baseScore !== null ? `${baseScore}%` : 'Unavailable',
    currentValue: currScore !== null ? `${currScore}%` : 'Unavailable',
    deltaDisplay: scoreDelta !== null ? `${scoreDelta >= 0 ? '+' : ''}${scoreDelta}%` : 'N/A',
    causes: Array.from(causesSet).length > 0 ? Array.from(causesSet) : ['environmental_observation_change'],
    explanation: geometryChanged
      ? 'Note: Field geometry changed between reports; inspect boundary area difference.'
      : versionChanged
        ? 'Calculation or rule set version changed between these two snapshots.'
        : 'Score difference reflects underlying weather, moisture, and rule outcomes.',
  });

  items.push({
    category: 'metric',
    label: 'Evidence Coverage / Confidence',
    classification: covDelta >= 5 ? 'Improved' : covDelta <= -5 ? 'Worsened' : 'Continuing finding',
    baselineValue: `${baseline.overallSummary.coveragePct}% cov · ${baseline.overallSummary.confidencePct}% conf`,
    currentValue: `${current.overallSummary.coveragePct}% cov · ${current.overallSummary.confidencePct}% conf`,
    deltaDisplay: `${covDelta >= 0 ? '+' : ''}${covDelta}% cov / ${confDelta >= 0 ? '+' : ''}${confDelta}% conf`,
    causes: providerShifted ? ['source_or_coverage_change'] : ['farmer_input_change'],
    explanation: 'Tracks changes in satellite clear-pixel coverage, lab data entry, and active providers.',
  });

  if (baseMeanEt0 !== null || currMeanEt0 !== null) {
    const et0Diff =
      baseMeanEt0 !== null && currMeanEt0 !== null ? Number((currMeanEt0 - baseMeanEt0).toFixed(2)) : null;
    items.push({
      category: 'metric',
      label: 'Mean Reference ET₀',
      classification:
        et0Diff === null ? 'Not comparable' : et0Diff < -0.2 ? 'Improved' : et0Diff > 0.2 ? 'Worsened' : 'Continuing finding',
      baselineValue: baseMeanEt0 !== null ? `${baseMeanEt0.toFixed(2)} mm/d` : '—',
      currentValue: currMeanEt0 !== null ? `${currMeanEt0.toFixed(2)} mm/d` : '—',
      deltaDisplay: et0Diff !== null ? `${et0Diff >= 0 ? '+' : ''}${et0Diff} mm/d` : '—',
      causes: ['environmental_observation_change'],
      explanation: 'Atmospheric evaporative demand across the analyzed period.',
    });
  }

  // Finding-level diff keyed by ruleId + fieldId
  const keyFor = (ruleId: string, fieldId: string | null) => `${ruleId}::${fieldId ?? 'farm'}`;
  const prevFindingsMap = new Map(
    [...baseline.findings, ...baseline.watchPoints].map((f) => [keyFor(f.ruleId, f.fieldId), f])
  );
  const currFindingsMap = new Map(
    [...current.findings, ...current.watchPoints].map((f) => [keyFor(f.ruleId, f.fieldId), f])
  );

  for (const [k, cf] of currFindingsMap.entries()) {
    const pf = prevFindingsMap.get(k);
    if (!pf) {
      causesSet.add('environmental_observation_change');
      items.push({
        category: 'finding',
        label: `${cf.fieldName}: ${cf.title}`,
        classification: 'New finding',
        baselineValue: 'Not triggered',
        currentValue: `${cf.severity.toUpperCase()} (${cf.triggerMetricSummary})`,
        deltaDisplay: 'New trigger',
        causes: ['environmental_observation_change'],
        explanation: cf.possibleMechanism,
      });
    } else {
      const rank: Record<string, number> = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
      const diff = (rank[cf.severity] ?? 0) - (rank[pf.severity] ?? 0);
      items.push({
        category: 'finding',
        label: `${cf.fieldName}: ${cf.title}`,
        classification: diff > 0 ? 'Worsened' : diff < 0 ? 'Improved' : 'Continuing finding',
        baselineValue: `${pf.severity.toUpperCase()} (${pf.triggerMetricSummary})`,
        currentValue: `${cf.severity.toUpperCase()} (${cf.triggerMetricSummary})`,
        deltaDisplay: diff === 0 ? 'Unchanged severity' : diff > 0 ? 'Escalated' : 'Eased',
        causes: ['environmental_observation_change'],
        explanation: `Rule ${cf.ruleId} evaluated in both reports.`,
      });
    }
  }

  for (const [k, pf] of prevFindingsMap.entries()) {
    if (!currFindingsMap.has(k)) {
      items.push({
        category: 'finding',
        label: `${pf.fieldName}: ${pf.title}`,
        classification: 'Resolved',
        baselineValue: `${pf.severity.toUpperCase()} (${pf.triggerMetricSummary})`,
        currentValue: 'Clear under current rule threshold',
        deltaDisplay: 'Resolved',
        causes:
          actionsBetween.length > 0
            ? ['management_event_change', 'environmental_observation_change']
            : ['environmental_observation_change'],
        explanation: 'Current observations no longer cross the trigger threshold.',
      });
    }
  }

  const primaryCauses =
    causesSet.size > 0 ? Array.from(causesSet) : (['environmental_observation_change'] as ChangeCause[]);

  const summaryHeadline =
    scoreDelta !== null
      ? `Health ${scoreDelta >= 0 ? `+${scoreDelta}` : scoreDelta}% (${primaryCauses[0].replace(/_/g, ' ')})`
      : `Condition changed from ${baseline.overallSummary.conditionLabel} to ${current.overallSummary.conditionLabel}`;

  return {
    baselineReportId: baseline.id,
    currentReportId: current.id,
    comparable,
    comparabilityReasons,
    summaryHeadline,
    primaryCauses,
    scoreDelta,
    coverageDelta: covDelta,
    confidenceDelta: confDelta,
    items,
    actionsTakenBetweenReports: actionsBetween,
  };
}

function avgNum(vals: Array<number | null>): number | null {
  const valid = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (valid.length === 0) return null;
  return Number((valid.reduce((s, n) => s + n, 0) / valid.length).toFixed(2));
}
