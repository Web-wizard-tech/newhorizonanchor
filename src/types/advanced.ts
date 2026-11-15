export type ProviderState =
  | 'available'
  | 'configured'
  | 'tested'
  | 'degraded'
  | 'unavailable'
  | 'planned';

export type EvidenceType =
  | 'station_measurement'
  | 'observed'
  | 'farmer_reported'
  | 'satellite_derived'
  | 'modelled'
  | 'reanalysis'
  | 'forecast'
  | 'estimated'
  | 'calculated';

export type AggregationMethod =
  | 'area_weighted_mean'
  | 'median'
  | 'percentile'
  | 'nearest_cell'
  | 'not_applicable';

export type SpatialFit = 'field_scale' | 'coarse_context' | 'insufficient';

export interface SpatialCoverage {
  fieldAreaM2: number;
  sourcePixelSizeM?: number;
  intersectingPixelCount: number;
  validPixelCount: number;
  validAreaM2: number;
  validCoveragePct: number;
  aggregation: AggregationMethod;
  spatialFit: SpatialFit;
  geometryVersionId: string;
}

export interface ProviderHealth {
  id: string;
  name: string;
  category:
    | 'weather_forecast'
    | 'historical_climate'
    | 'soil_properties'
    | 'soil_moisture'
    | 'vegetation'
    | 'precipitation'
    | 'terrain'
    | 'hazards'
    | 'ai';
  endpoint: string;
  productId: string;
  version: string;
  resolutionLabel: string;
  cadenceLabel: string;
  authRequired: boolean;
  commercialNote: string;
  state: ProviderState;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  lastError: string | null;
  fallbackProviderId?: string | null;
  parameters: string[];
  units: string;
}

export interface ObservationEnvelope<TValue = number> {
  observationId: string;
  providerId: string;
  productId: string;
  variable: string;
  value: TValue;
  unit: string;
  evidenceType: EvidenceType;
  observedAt?: string;
  validFrom?: string;
  validTo?: string;
  retrievedAt: string;
  spatialResolution?: number;
  temporalResolution?: string;
  geometryId?: string;
  pixelCount?: number;
  validCoveragePct?: number;
  qualityFlags: string[];
  uncertainty?: { lower?: number; upper?: number; method?: string };
  sourceUrl: string;
  sourceVersion?: string;
  rawRecordRef: string;
  status: 'valid' | 'suspect' | 'missing' | 'stale';
}

export type StageStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'partial'
  | 'skipped'
  | 'failed'
  | 'cancelled';

export type PipelineStageName =
  | 'REQUESTED'
  | 'VALIDATING_SCOPE'
  | 'SNAPSHOTTING_INPUTS'
  | 'FETCHING_DATA'
  | 'VALIDATING_AND_NORMALISING'
  | 'SPATIAL_AGGREGATION'
  | 'CALCULATING_INDICATORS'
  | 'EVALUATING_FIELD_RULES'
  | 'BUILDING_FIELD_ASSESSMENTS'
  | 'BUILDING_FARM_SUMMARY'
  | 'COMPARING_PREVIOUS_REPORT'
  | 'GENERATING_EXPLANATIONS'
  | 'VALIDATING_REPORT'
  | 'PERSISTING_REPORT';

export interface PipelineStageRecord {
  stage: PipelineStageName;
  label: string;
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  detail?: string;
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'partial'
  | 'failed'
  | 'retrying'
  | 'cancelled'
  | 'skipped';

export interface AnalysisScope {
  type: 'whole_farm' | 'all_fields' | 'selected_fields' | 'single_field';
  farmId: string;
  fieldIds: string[];
  label: string;
}

export interface AnalysisConsent {
  allowRemoteProviderRequests: boolean;
  allowRemoteJobProcessing: boolean;
  consentedAt?: string;
  disclosedProviders?: string[];
}

export interface AnalysisJob {
  id: string;
  scheduleId?: string;
  farmId: string;
  scope: AnalysisScope;
  runType: 'manual' | 'scheduled';
  triggerReason: string;
  dateRange: { from: string; to: string; timezone: string };
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: JobStatus;
  currentStage: PipelineStageName | 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  stages: PipelineStageRecord[];
  attempt: number;
  idempotencyKey: string;
  reportId?: string;
  errorCode?: string;
  errorMessage?: string;
  cancellationRequested?: boolean;
}

export type ConditionLabel =
  | 'Good'
  | 'Monitor'
  | 'Needs Attention'
  | 'Alert'
  | 'Insufficient Data'
  | 'Not Analysed';

export interface SourceOutcome {
  providerId: string;
  providerName: string;
  productId: string;
  category: ProviderHealth['category'];
  status: 'complete' | 'partial' | 'fallback' | 'unavailable' | 'skipped';
  resolutionLabel: string;
  spatialFit: SpatialFit;
  retrievedAt: string;
  observationWindow: string;
  note: string;
  fallbackUsed?: string | null;
  errorMessage?: string | null;
}

export interface EvidenceRecord {
  evidenceId: string;
  metricName: string;
  valueDisplay: string;
  unit: string;
  farmId: string;
  fieldId: string | null;
  fieldName: string;
  geometryVersionId: string | null;
  observationPeriod: string;
  retrievedAt: string;
  providerId: string;
  providerName: string;
  productId: string;
  sourceUrl: string;
  sourceType: EvidenceType | 'unavailable';
  spatialResolution: string;
  spatialCoverage?: SpatialCoverage;
  qualityFlags: string[];
  missingValueHandling: string;
  formulaDisplay: string;
  formulaVersion: string;
  inputsUsed: Array<{ name: string; value: string; source: string }>;
  modelVersions: {
    engineVersion: string;
    cropKnowledgeVersion: string;
    ruleSetVersion: string;
  };
  confidencePct: number;
  confidenceLabel: 'High' | 'Moderate' | 'Low' | 'Unavailable';
  limitations: string;
}

export interface GddConfig {
  baseTempC: number;
  upperTempC?: number;
  method: 'single_sine' | 'capped_mean';
  sourceId: string;
  version: string;
}

export interface WaterBalanceDayRow {
  date: string;
  dataKind: 'historical' | 'forecast';
  et0Mm: number | null;
  et0Method: 'FAO-56 Penman-Monteith' | 'Hargreaves-Samani Approx' | 'Unavailable';
  kc: number | null;
  etcMm: number | null;
  precipitationMm: number | null;
  effectiveRainMm: number | null;
  confirmedIrrigationMm: number | null;
  runoffMm: number | null;
  deepPercolationMm: number | null;
  depletionMm: number | null;
  rootZoneStatus: 'optimal' | 'drawdown' | 'stress_risk' | 'unavailable';
  sourceStatus: 'valid' | 'partial' | 'unavailable';
}

export interface SoilLayerDisplayValue {
  property: string;
  depthInterval: string;
  valueDisplay: string;
  unit: string;
  sourceType: 'farmer_lab' | 'national_survey' | 'mapped_grid' | 'derived' | 'unavailable';
  providerLabel: string;
  dateLabel: string;
  uncertaintyNote: string;
  evidenceId: string;
}

export interface FieldVegetationSummary {
  fieldId: string;
  fieldName: string;
  status: 'valid' | 'insufficient_coverage' | 'cloudy' | 'unavailable';
  productId: string;
  providerName: string;
  sceneId: string | null;
  sceneDate: string | null;
  pixelSizeM: number;
  bandsUsed: string[];
  sclBreakdown: {
    vegetationPixels: number;
    bareSoilPixels: number;
    waterPixels: number;
    cloudShadowPixels: number;
    cloudPixels: number;
    snowPixels: number;
    nodataPixels: number;
    totalPixels: number;
    cloudFreePct: number;
  } | null;
  validPixelCount: number;
  validCoveragePct: number;
  ndviMean: number | null;
  ndviMedian: number | null;
  ndviStd: number | null;
  ndviMin: number | null;
  ndviMax: number | null;
  baselineNdviMean: number | null;
  baselineSceneDate: string | null;
  ndviDeltaFromBaseline: number | null;
  spatialFit: SpatialFit;
  note: string;
  evidenceId: string;
}

export type RiskSeverity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

export interface RiskFinding {
  id: string;
  title: string;
  isWatchPoint: boolean;
  severity: RiskSeverity;
  farmId: string;
  fieldId: string | null;
  fieldName: string;
  cropName: string | null;
  cropStage: string | null;
  ruleId: string;
  ruleVersion: string;
  evidenceIds: string[];
  triggerMetricSummary: string;
  sourceQualityStatus: string;
  baselineOrThreshold: string;
  possibleMechanism: string;
  alternativeExplanations: string[];
  confidencePct: number;
  missingEvidence: string[];
  confirmationCheck: string;
  mitigationOptions: string[];
}

export type ActionStatus =
  | 'Suggested'
  | 'Accepted'
  | 'Scheduled'
  | 'In progress'
  | 'Completed'
  | 'Deferred'
  | 'Dismissed';

export interface ActionRecommendation {
  id: string;
  title: string;
  verb: string;
  whySuggested: string;
  fieldId: string | null;
  fieldName: string;
  cropName: string | null;
  priority: 'high' | 'normal' | 'low';
  suggestedDueWindow: string;
  requiredToolsOrInfo: string[];
  linkedFindingIds: string[];
  evidenceIds: string[];
  status: ActionStatus;
  linkedTaskId?: string | null;
  note?: string;
}

export interface FieldDeepAssessment {
  fieldId: string;
  fieldName: string;
  areaHa: number;
  geometryVersionId: string;
  centroid: { lat: number; lon: number };
  cropName: string | null;
  cropConfirmed: boolean;
  cropStage: string | null;
  conditionLabel: ConditionLabel;
  healthScore: number | null;
  coveragePct: number;
  confidencePct: number;
  leadingFinding: string;
  recommendedNextAction: string;
  lastUpdatedAt: string;
  waterSummary: {
    et0MeanMmDay: number | null;
    et0Method: string;
    kcApplied: number | null;
    etcPeriodMm: number | null;
    observedPrecipMm: number | null;
    effectiveRainMm: number | null;
    forecastRain7dMm: number | null;
    confirmedIrrigationMm: number;
    savedRoutineLabel: string | null;
    netBalanceMm: number | null;
    tawMm: number | null;
    rawMm: number | null;
    latestDepletionMm: number | null;
    tawUnavailableReason: string | null;
    surfaceMoisturePct: number | null;
    surfaceMoistureSource: string;
    rootZoneMoisturePct: number | null;
    rootZoneMoistureSource: string;
    dailyRows: WaterBalanceDayRow[];
  };
  soilSummary: {
    labValues: SoilLayerDisplayValue[];
    mappedEstimates: SoilLayerDisplayValue[];
    textureClass: string;
    textureSource: string;
    elevationM: number | null;
    slopePct: number | null;
    terrainSource: string;
    labVsMapDiscrepancyNote: string | null;
  };
  vegetationSummary: FieldVegetationSummary;
  weatherSummary: {
    currentTempC: number | null;
    forecastHighLow7d: string;
    periodMeanTempC: number | null;
    periodPrecipTotalMm: number | null;
    drySpellDays: number | null;
    rainfallAnomalyMm: number | null;
    rainfallAnomalyPct: number | null;
    gddAccumulated: number | null;
    gddConfig: GddConfig | null;
    gddNote: string;
    heatStressDays: number | null;
    frostDays: number | null;
    solarRadiationMeanMjM2: number | null;
  };
}

export type ChangeCause =
  | 'environmental_observation_change'
  | 'farmer_input_change'
  | 'management_event_change'
  | 'geometry_change'
  | 'source_or_coverage_change'
  | 'calculation_version_change'
  | 'unknown_or_not_attributable';

export interface ReportComparisonItem {
  category: 'finding' | 'metric' | 'input' | 'version';
  label: string;
  classification:
    | 'New finding'
    | 'Continuing finding'
    | 'Resolved'
    | 'Improved'
    | 'Worsened'
    | 'Not comparable';
  baselineValue: string;
  currentValue: string;
  deltaDisplay: string;
  causes: ChangeCause[];
  explanation: string;
}

export interface ReportComparisonResult {
  baselineReportId: string;
  currentReportId: string;
  comparable: boolean;
  comparabilityReasons: string[];
  summaryHeadline: string;
  primaryCauses: ChangeCause[];
  scoreDelta: number | null;
  coverageDelta: number;
  confidenceDelta: number;
  items: ReportComparisonItem[];
  actionsTakenBetweenReports: Array<{ title: string; status: string; completedAt?: string | null }>;
}

export interface DeepAnalysisReport {
  id: string;
  farmId: string;
  farmName: string;
  fieldIds: string[];
  scope: AnalysisScope;
  runType: 'manual' | 'scheduled';
  triggerReason: string;
  dateRange: { from: string; to: string; timezone: string };
  createdAt: string;
  completedAt: string;
  status: 'complete' | 'partial' | 'failed' | 'cancelled';
  inputSnapshotId: string;
  geometryVersionIds: Record<string, string>;
  profileVersionIds: Record<string, string>;
  dataObservationIds: string[];
  engineVersion: string;
  cropKnowledgeVersion: string;
  ruleSetVersion: string;
  reportHash: string;
  previousComparableReportId: string | null;
  overallSummary: {
    conditionLabel: ConditionLabel;
    healthScore: number | null;
    healthModelNote: string;
    coveragePct: number;
    confidencePct: number;
    fieldsAssessedCount: number;
    fieldsNeedingAttentionCount: number;
    fieldsAlertCount: number;
    fieldsInsufficientCount: number;
    fieldsGoodCount: number;
    plainLanguageSummary: string;
    strengths: string[];
    concerns: string[];
    priorityNextAction: string;
  };
  fieldAssessments: FieldDeepAssessment[];
  findings: RiskFinding[];
  watchPoints: RiskFinding[];
  recommendations: ActionRecommendation[];
  sourceOutcomes: SourceOutcome[];
  observations: ObservationEnvelope<unknown>[];
  evidenceById: Record<string, EvidenceRecord>;
  warnings: string[];
  aiExplanation: {
    available: boolean;
    modelUsed: string | null;
    simpleSummary: string | null;
    advancedSummary: string | null;
    keyDrivers: string[];
    unavailableReason?: string;
    generatedAt?: string;
  };
  comparisonWithPrevious: ReportComparisonResult | null;
}

export interface AutomationSchedule {
  id: string;
  farmId: string;
  name: string;
  enabled: boolean;
  status: 'active' | 'paused' | 'consent_revoked';
  scope: AnalysisScope;
  frequency: 'daily' | 'every_3_days' | 'weekly' | 'biweekly' | 'monthly';
  preferredTime: string; // HH:mm
  timezone: string; // IANA tz
  refreshProviders: string[]; // 'all' or specific provider IDs
  useSavedRoutines: boolean;
  routineReconfirmDays: number;
  notifyOnImportantChanges: boolean;
  quietHours: { start: string; end: string } | null;
  consent: AnalysisConsent;
  nextRunAt: string;
  lastRunAt: string | null;
  lastJobId: string | null;
  lastJobStatus: JobStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface FarmPracticeRoutine {
  id: string;
  farmId: string;
  fieldId: string | null;
  fieldName: string;
  category: 'irrigation_routine' | 'fertilizer_routine' | 'scouting_routine';
  description: string;
  cadenceLabel: string;
  assumedMethod: string;
  assumedVolumePerEventM3: number | null;
  lastConfirmedAt: string;
  needsReconfirmation: boolean;
  userConfirmed: boolean;
  createdAt: string;
}

export interface ParsedPracticeDraft {
  draftId: string;
  rawText: string;
  kind: 'irrigation_event' | 'routine' | 'observation' | 'soil_test' | 'unknown';
  title: string;
  fieldNameGuess: string | null;
  fieldIdGuess: string | null;
  dateGuess: string | null;
  durationHoursGuess: number | null;
  volumeM3Guess: number | null;
  methodGuess: string | null;
  notes: string;
  ambiguityFlags: string[];
  userConfirmed: false;
  aiModelUsed: string | null;
}

export interface NotificationRecord {
  id: string;
  farmId: string;
  scheduleId?: string | null;
  jobId?: string | null;
  reportId?: string | null;
  kind:
    | 'scheduled_complete'
    | 'scheduled_partial_or_failed'
    | 'new_high_finding'
    | 'finding_changed'
    | 'source_unavailable'
    | 'routine_reconfirm';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  dedupeKey: string;
  createdAt: string;
  read: boolean;
}
