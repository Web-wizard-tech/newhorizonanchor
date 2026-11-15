import {
  ActionRecommendation,
  ConditionLabel,
  EvidenceRecord,
  FieldDeepAssessment,
  RiskFinding,
  RiskSeverity,
} from '../../../src/types/advanced';
import { CropParams } from './cropDatabase';

export const RULESET_VERSION = 'risk-rules-v1.1.0';
export const HEALTH_MODEL_VERSION = 'fieldshift-health-v2.0.0';

export interface RiskRule {
  id: string;
  version: string;
  name: string;
  metricDependencies: string[];
  cropContextRequired: boolean;
  stageContextRequired: boolean;
  thresholdConfig: Record<string, number | string>;
  minimumCoverage: number;
  minimumConfidence: number;
  severity: RiskSeverity;
  evidenceRequirements: string[];
  actionTemplateId: string;
}

export const DOCUMENTED_RISK_RULES: RiskRule[] = [
  {
    id: 'RULE_SEVERE_WATER_DEFICIT',
    version: '1.1.0',
    name: 'Root-Zone Moisture & Depletion Deficit',
    metricDependencies: ['depletionMm', 'rawMm', 'rootZoneMoisturePct'],
    cropContextRequired: false,
    stageContextRequired: false,
    thresholdConfig: { vwcCriticalPct: 19, depletionRatioThreshold: 1.0 },
    minimumCoverage: 35,
    minimumConfidence: 45,
    severity: 'high',
    evidenceRequirements: ['Measured probe moisture OR valid RAW depletion balance'],
    actionTemplateId: 'ACT_IRRIGATION_TIMING',
  },
  {
    id: 'RULE_WATER_CAPACITY_CONSTRAINT',
    version: '1.0.0',
    name: 'Irrigation Supply Reliability Bottleneck',
    metricDependencies: ['waterReliability', 'netBalanceMm'],
    cropContextRequired: false,
    stageContextRequired: false,
    thresholdConfig: { constrainedReliability: 'Frequently limited|Highly unreliable' },
    minimumCoverage: 25,
    minimumConfidence: 40,
    severity: 'moderate',
    evidenceRequirements: ['Farm water configuration reliability & seasonal ETc demand'],
    actionTemplateId: 'ACT_WATER_AUDIT',
  },
  {
    id: 'RULE_HEAT_STRESS_EXPOSURE',
    version: '1.0.0',
    name: 'Crop Thermal Heat-Threshold Exceedance',
    metricDependencies: ['heatStressDays', 'tMaxSeries'],
    cropContextRequired: true,
    stageContextRequired: false,
    thresholdConfig: { minHeatDaysWarning: 2, minHeatDaysAlert: 5 },
    minimumCoverage: 50,
    minimumConfidence: 55,
    severity: 'moderate',
    evidenceRequirements: ['Daily Tmax series & crop heatThresholdC'],
    actionTemplateId: 'ACT_HEAT_MITIGATION',
  },
  {
    id: 'RULE_FROST_COLD_EXPOSURE',
    version: '1.0.0',
    name: 'Frost / Low-Temperature Threshold Exposure',
    metricDependencies: ['frostDays', 'tMinSeries'],
    cropContextRequired: true,
    stageContextRequired: false,
    thresholdConfig: { minFrostDays: 1 },
    minimumCoverage: 50,
    minimumConfidence: 55,
    severity: 'high',
    evidenceRequirements: ['Daily Tmin series & crop frostThresholdC'],
    actionTemplateId: 'ACT_FROST_PROTECT',
  },
  {
    id: 'RULE_SOIL_PH_MISMATCH',
    version: '1.0.0',
    name: 'Soil Reaction (pH) Outside Crop Range',
    metricDependencies: ['soilPh', 'cropOptimalPh'],
    cropContextRequired: false,
    stageContextRequired: false,
    thresholdConfig: { acidicFloor: 5.5, alkalineCeiling: 8.1 },
    minimumCoverage: 40,
    minimumConfidence: 60,
    severity: 'moderate',
    evidenceRequirements: ['Lab soil pH test OR SoilGrids WCS estimate'],
    actionTemplateId: 'ACT_SOIL_AMENDMENT',
  },
  {
    id: 'RULE_SALINITY_EC_ELEVATED',
    version: '1.0.0',
    name: 'Irrigation / Soil Salinity EC Exceedance',
    metricDependencies: ['ecDsM', 'cropEcThreshold'],
    cropContextRequired: false,
    stageContextRequired: false,
    thresholdConfig: { defaultWarningDsM: 2.0 },
    minimumCoverage: 40,
    minimumConfidence: 65,
    severity: 'high',
    evidenceRequirements: ['Measured electrical conductivity (dS/m)'],
    actionTemplateId: 'ACT_SALINITY_LEACH',
  },
  {
    id: 'RULE_DRY_SPELL_RAIN_DEFICIT',
    version: '1.0.0',
    name: 'Extended Dry Spell & Negative Precipitation Anomaly',
    metricDependencies: ['maxConsecutiveDryDays', 'rainfallAnomalyPct'],
    cropContextRequired: false,
    stageContextRequired: false,
    thresholdConfig: { minDryDays: 10, anomalyWarnPct: -35 },
    minimumCoverage: 50,
    minimumConfidence: 55,
    severity: 'moderate',
    evidenceRequirements: ['Daily rainfall sequence + 20-year NASA POWER baseline'],
    actionTemplateId: 'ACT_MOISTURE_CONSERVATION',
  },
  {
    id: 'RULE_SLOPE_RUNOFF_SUSCEPTIBILITY',
    version: '1.0.0',
    name: 'Elevated Terrain Slope Runoff Context',
    metricDependencies: ['slopePct'],
    cropContextRequired: false,
    stageContextRequired: false,
    thresholdConfig: { slopeWarnPct: 8.0 },
    minimumCoverage: 40,
    minimumConfidence: 55,
    severity: 'low',
    evidenceRequirements: ['Copernicus GLO-30/90 DEM or SRTM terrain slope'],
    actionTemplateId: 'ACT_CONTOUR_COVER',
  },
  {
    id: 'RULE_NDVI_BELOW_BASELINE',
    version: '1.0.0',
    name: 'Satellite Vegetation Index Below Field Baseline',
    metricDependencies: ['ndviMean', 'baselineNdviMean'],
    cropContextRequired: false,
    stageContextRequired: false,
    thresholdConfig: { minNegativeDelta: -0.12 },
    minimumCoverage: 45,
    minimumConfidence: 55,
    severity: 'low',
    evidenceRequirements: ['Cloud-masked Sentinel-2 L2A valid coverage >= 40%'],
    actionTemplateId: 'ACT_SCOUT_CANOPY',
  },
];

export interface EvaluateFieldRiskInputs {
  farmId: string;
  fieldId: string;
  fieldName: string;
  crop: CropParams | null;
  cropConfirmed: boolean;
  cropStage: string | null;
  coveragePct: number;
  confidencePct: number;
  probeMoisturePct: number | null;
  probeMoistureStatus: 'measured' | 'estimated' | 'unknown';
  phValue: number | null;
  phIsLab: boolean;
  ecDsM: number | null;
  waterReliability: string;
  fieldAssessment: FieldDeepAssessment;
  eonetNearbyTitles: string[];
  evidenceIds: {
    water?: string;
    soilPh?: string;
    terrain?: string;
    weather?: string;
    vegetation?: string;
    ec?: string;
    eonet?: string;
  };
  farmerPestWatchNotes: string[];
}

export function evaluateFieldRisksAndActions(input: EvaluateFieldRiskInputs): {
  findings: RiskFinding[];
  watchPoints: RiskFinding[];
  recommendations: ActionRecommendation[];
  conditionLabel: ConditionLabel;
  healthScore: number | null;
} {
  const findings: RiskFinding[] = [];
  const watchPoints: RiskFinding[] = [];
  const recommendations: ActionRecommendation[] = [];

  const { fieldAssessment: fa, crop } = input;
  const cropLabel = crop?.name ?? fa.cropName;

  const pushFinding = (f: RiskFinding, rec?: Omit<ActionRecommendation, 'id' | 'linkedFindingIds'>) => {
    if (f.isWatchPoint) {
      watchPoints.push(f);
    } else {
      findings.push(f);
    }
    if (rec) {
      recommendations.push({
        id: `act-${input.fieldId}-${recommendations.length + 1}`,
        linkedFindingIds: [f.id],
        ...rec,
      });
    }
  };

  // 1. Water Deficit / Depletion Check
  const depletionRatio =
    fa.waterSummary.latestDepletionMm !== null &&
    fa.waterSummary.rawMm !== null &&
    fa.waterSummary.rawMm > 0
      ? fa.waterSummary.latestDepletionMm / fa.waterSummary.rawMm
      : null;

  const hasLowProbe =
    input.probeMoisturePct !== null &&
    input.probeMoisturePct < 19 &&
    input.probeMoistureStatus !== 'unknown';

  if (hasLowProbe || (depletionRatio !== null && depletionRatio > 1.0)) {
    const rule = DOCUMENTED_RISK_RULES[0];
    const meetsGate = input.coveragePct >= rule.minimumCoverage && input.confidencePct >= rule.minimumConfidence;
    const isCritical =
      (input.probeMoisturePct !== null && input.probeMoisturePct < 16) ||
      (depletionRatio !== null && depletionRatio > 1.25);
    pushFinding(
      {
        id: `find-${input.fieldId}-water-def`,
        title: hasLowProbe
          ? `Low Root-Zone Moisture (${input.probeMoisturePct}% VWC)`
          : 'Root-Zone Depletion Exceeds Readily Available Water (RAW)',
        isWatchPoint: !meetsGate,
        severity: isCritical ? 'critical' : 'high',
        farmId: input.farmId,
        fieldId: input.fieldId,
        fieldName: input.fieldName,
        cropName: cropLabel,
        cropStage: input.cropStage,
        ruleId: rule.id,
        ruleVersion: rule.version,
        evidenceIds: input.evidenceIds.water ? [input.evidenceIds.water] : [],
        triggerMetricSummary: hasLowProbe
          ? `Measured moisture ${input.probeMoisturePct}% VWC (< 19% threshold)`
          : `Dr ${fa.waterSummary.latestDepletionMm} mm > RAW ${fa.waterSummary.rawMm} mm`,
        sourceQualityStatus: input.probeMoistureStatus === 'measured' ? 'Measured probe + weather series' : 'Modelled depletion',
        baselineOrThreshold: 'Threshold: < 19% VWC or Dr > 1.0× RAW',
        possibleMechanism:
          'Crop evapotranspiration (ETc) and drainage drew root-zone soil water below easily extracted threshold without offsetting effective rain or logged irrigation.',
        alternativeExplanations: [
          'Unrecorded recent irrigation event not yet logged in Field Shift.',
          'Coarse sub-block variability if probe reading represents sandy upper bench only.',
        ],
        confidencePct: Math.min(92, input.confidencePct + (input.probeMoistureStatus === 'measured' ? 12 : 0)),
        missingEvidence:
          input.probeMoistureStatus !== 'measured'
            ? ['In-field soil moisture probe check at 15–30 cm depth']
            : [],
        confirmationCheck: 'Verify midday soil moisture at 15–30 cm depth and inspect canopy leaf roll.',
        mitigationOptions: [
          'Schedule pre-dawn drip or targeted irrigation pass matching net ETc deficit.',
          'Check irrigation system flow rate and header pressure before applying set.',
        ],
      },
      {
        title: `Inspect root-zone moisture & schedule pre-dawn irrigation check on ${input.fieldName}`,
        verb: 'Inspect & irrigate',
        whySuggested: hasLowProbe
          ? `Soil moisture dropped to ${input.probeMoisturePct}% VWC against crop ETc ${fa.waterSummary.etcPeriodMm ?? '—'} mm.`
          : `Modelled root-zone depletion (${fa.waterSummary.latestDepletionMm} mm) exceeded RAW (${fa.waterSummary.rawMm} mm).`,
        fieldId: input.fieldId,
        fieldName: input.fieldName,
        cropName: cropLabel,
        priority: 'high',
        suggestedDueWindow: 'Within 24–48 hours',
        requiredToolsOrInfo: ['TDR/capacitance soil probe or tensiometer', 'Flow meter reading (m³)'],
        evidenceIds: input.evidenceIds.water ? [input.evidenceIds.water] : [],
        status: 'Suggested',
      }
    );
  }

  // 2. Irrigation Supply Constraint
  if (
    input.waterReliability === 'Frequently limited' ||
    input.waterReliability === 'Highly unreliable'
  ) {
    const rule = DOCUMENTED_RISK_RULES[1];
    pushFinding(
      {
        id: `find-${input.fieldId}-supply-cap`,
        title: `Constrained Water Supply (${input.waterReliability})`,
        isWatchPoint: false,
        severity: 'moderate',
        farmId: input.farmId,
        fieldId: input.fieldId,
        fieldName: input.fieldName,
        cropName: cropLabel,
        cropStage: input.cropStage,
        ruleId: rule.id,
        ruleVersion: rule.version,
        evidenceIds: input.evidenceIds.water ? [input.evidenceIds.water] : [],
        triggerMetricSummary: `Water reliability: ${input.waterReliability}; Period net water balance: ${
          fa.weatherSummary.periodPrecipTotalMm !== null ? `${fa.waterSummary.netBalanceMm} mm` : 'Pending'
        }`,
        sourceQualityStatus: 'Farmer-reported infrastructure capacity + FAO-56 ETc',
        baselineOrThreshold: 'Trigger: Frequently limited / Highly unreliable supply during active crop cycle',
        possibleMechanism: 'Peak-stage crop ETc demand can exceed well drawdown or canal allocation window.',
        alternativeExplanations: ['Upcoming multi-day rainfall events may temporarily relieve pump demand.'],
        confidencePct: 82,
        missingEvidence: ['Verified daily well/canal meter capacity (m³/day)'],
        confirmationCheck: 'Measure sustainable daily pump output (m³/day) vs peak ETc volume.',
        mitigationOptions: [
          'Shift peak water-sensitive stages outside driest months or evaluate low-ETc rotation crops.',
          'Prioritize irrigation sets to sensitive reproductive stages rather than uniform late passes.',
        ],
      },
      {
        title: `Audit pump delivery capacity vs peak crop ETc on ${input.fieldName}`,
        verb: 'Audit',
        whySuggested: `Reported ${input.waterReliability.toLowerCase()} water supply creates vulnerability during peak evapotranspiration.`,
        fieldId: input.fieldId,
        fieldName: input.fieldName,
        cropName: cropLabel,
        priority: 'normal',
        suggestedDueWindow: 'This week',
        requiredToolsOrInfo: ['Well recovery rate / water meter', 'Irrigated hectare verification'],
        evidenceIds: input.evidenceIds.water ? [input.evidenceIds.water] : [],
        status: 'Suggested',
      }
    );
  }

  // 3. Heat Stress Exposure (requires confirmed/mapped crop)
  if (crop && fa.weatherSummary.heatStressDays !== null && fa.weatherSummary.heatStressDays >= 2) {
    const rule = DOCUMENTED_RISK_RULES[2];
    const isAlert = fa.weatherSummary.heatStressDays >= 5;
    pushFinding(
      {
        id: `find-${input.fieldId}-heat`,
        title: `${fa.weatherSummary.heatStressDays} Heat-Stress Day(s) ≥ ${crop.heatThresholdC} °C`,
        isWatchPoint: !input.cropConfirmed,
        severity: isAlert ? 'high' : 'moderate',
        farmId: input.farmId,
        fieldId: input.fieldId,
        fieldName: input.fieldName,
        cropName: crop.name,
        cropStage: input.cropStage,
        ruleId: rule.id,
        ruleVersion: rule.version,
        evidenceIds: input.evidenceIds.weather ? [input.evidenceIds.weather] : [],
        triggerMetricSummary: `${fa.weatherSummary.heatStressDays} days ≥ ${crop.heatThresholdC} °C threshold`,
        sourceQualityStatus: 'Gridded daily temperature + FAO-56 crop thermal threshold',
        baselineOrThreshold: `Threshold: Tmax ≥ ${crop.heatThresholdC} °C for ${crop.name}`,
        possibleMechanism: 'High afternoon canopy temperature increases VPD and impairs pollination or grain filling if paired with dry topsoil.',
        alternativeExplanations: [
          '0.5° / ~11 km grid cell may differ by 1–2 °C from shaded microclimate or valley floor.',
          !input.cropConfirmed ? 'Crop stage/variety not yet explicitly confirmed on this block.' : '',
        ].filter(Boolean),
        confidencePct: input.cropConfirmed ? 76 : 52,
        missingEvidence: input.cropConfirmed ? [] : ['Confirm exact crop growth stage on field card'],
        confirmationCheck: 'Inspect anthers/florets or upper canopy curl during late afternoon.',
        mitigationOptions: ['Maintain non-stressed root-zone hydration prior to afternoon heat peaks.'],
      }
    );
  }

  // 4. Frost Exposure
  if (crop && fa.weatherSummary.frostDays !== null && fa.weatherSummary.frostDays >= 1) {
    const rule = DOCUMENTED_RISK_RULES[3];
    pushFinding(
      {
        id: `find-${input.fieldId}-frost`,
        title: `Frost / Cold Threshold Exposure (${fa.weatherSummary.frostDays} day(s) ≤ ${crop.frostThresholdC} °C)`,
        isWatchPoint: !input.cropConfirmed,
        severity: 'high',
        farmId: input.farmId,
        fieldId: input.fieldId,
        fieldName: input.fieldName,
        cropName: crop.name,
        cropStage: input.cropStage,
        ruleId: rule.id,
        ruleVersion: rule.version,
        evidenceIds: input.evidenceIds.weather ? [input.evidenceIds.weather] : [],
        triggerMetricSummary: `${fa.weatherSummary.frostDays} day(s) with Tmin ≤ ${crop.frostThresholdC} °C`,
        sourceQualityStatus: 'Gridded minimum temperature + crop frost tolerance threshold',
        baselineOrThreshold: `Threshold: Tmin ≤ ${crop.frostThresholdC} °C (${crop.name})`,
        possibleMechanism: 'Radiative or advective cooling below crop freezing tolerance damages emerging tissue or sensitive floral organs.',
        alternativeExplanations: ['Low-lying cold-air pockets may be colder than grid mean; sloped benches may stay slightly warmer.'],
        confidencePct: 74,
        missingEvidence: ['Field-level min/max thermometer verification'],
        confirmationCheck: 'Check emerging growing point / stem node discoloration after thaw.',
        mitigationOptions: ['Delay sensitive foliar sprays or mechanical pass until freeze risk clears.'],
      }
    );
  }

  // 5. Soil pH Mismatch (never claims lab result if only mapped)
  if (input.phValue !== null) {
    const rule = DOCUMENTED_RISK_RULES[4];
    const lowLim = crop?.optimalPh[0] ?? 5.6;
    const highLim = crop?.optimalPh[1] ?? 7.8;
    if (input.phValue < lowLim - 0.2 || input.phValue > highLim + 0.3) {
      const isAcid = input.phValue < lowLim;
      pushFinding(
        {
          id: `find-${input.fieldId}-ph`,
          title: `Soil pH (${input.phValue.toFixed(1)}) Outside Ideal Range (${lowLim}–${highLim})`,
          isWatchPoint: !input.phIsLab,
          severity: input.phValue < 5.3 || input.phValue > 8.2 ? 'high' : 'moderate',
          farmId: input.farmId,
          fieldId: input.fieldId,
          fieldName: input.fieldName,
          cropName: cropLabel,
          cropStage: input.cropStage,
          ruleId: rule.id,
          ruleVersion: rule.version,
          evidenceIds: input.evidenceIds.soilPh ? [input.evidenceIds.soilPh] : [],
          triggerMetricSummary: `pH ${input.phValue.toFixed(1)} (${input.phIsLab ? 'Lab test' : 'Mapped soil grid'})`,
          sourceQualityStatus: input.phIsLab ? 'Lab-measured soil sample' : 'Mapped 250 m / SSURGO soil estimate (watch point)',
          baselineOrThreshold: `Target pH: ${lowLim}–${highLim}`,
          possibleMechanism: isAcid
            ? 'Low pH reduces phosphorus availability and increases soluble Al/Mn toxicity risk.'
            : 'High pH can lock out Fe, Zn, and P micronutrients.',
          alternativeExplanations: !input.phIsLab
            ? ['Gridded SoilGrids/SSURGO map estimate (~250 m) has not yet been confirmed with composite field soil cores.']
            : ['Liming applied after last recorded soil test date may have raised topsoil pH.'],
          confidencePct: input.phIsLab ? 88 : 54,
          missingEvidence: input.phIsLab ? [] : ['Composite 0–20 cm laboratory soil pH test'],
          confirmationCheck: 'Collect 0–20 cm composite soil cores across uniform zones for laboratory pH & buffer index.',
          mitigationOptions: [
            isAcid
              ? 'Consult buffer pH test before applying agricultural lime prior to next seeding.'
              : 'Evaluate elemental sulfur / acidifying starter or chelated micronutrients if lab confirms.',
          ],
        },
        {
          title: input.phIsLab
            ? `Review lime / pH amendment plan for ${input.fieldName} (lab pH ${input.phValue.toFixed(1)})`
            : `Collect 0–20 cm composite lab soil pH sample on ${input.fieldName}`,
          verb: input.phIsLab ? 'Review' : 'Sample',
          whySuggested: `Soil pH (${input.phValue.toFixed(1)}) lies outside ${lowLim}–${highLim} optimum.`,
          fieldId: input.fieldId,
          fieldName: input.fieldName,
          cropName: cropLabel,
          priority: 'normal',
          suggestedDueWindow: 'Before next fertilisation pass',
          requiredToolsOrInfo: ['Soil auger/core sampler', 'Accredited soil laboratory assay'],
          evidenceIds: input.evidenceIds.soilPh ? [input.evidenceIds.soilPh] : [],
          status: 'Suggested',
        }
      );
    }
  }

  // 6. Salinity / EC Check
  if (input.ecDsM !== null) {
    const ecLimit = crop?.ecThresholdDsM ?? 2.0;
    if (input.ecDsM > ecLimit) {
      const rule = DOCUMENTED_RISK_RULES[5];
      pushFinding(
        {
          id: `find-${input.fieldId}-ec`,
          title: `Elevated Salinity EC (${input.ecDsM.toFixed(2)} dS/m > ${ecLimit} threshold)`,
          isWatchPoint: false,
          severity: 'high',
          farmId: input.farmId,
          fieldId: input.fieldId,
          fieldName: input.fieldName,
          cropName: cropLabel,
          cropStage: input.cropStage,
          ruleId: rule.id,
          ruleVersion: rule.version,
          evidenceIds: input.evidenceIds.ec ? [input.evidenceIds.ec] : [],
          triggerMetricSummary: `Water EC ${input.ecDsM.toFixed(2)} dS/m`,
          sourceQualityStatus: 'Measured water electrical conductivity',
          baselineOrThreshold: `Threshold: EC ≤ ${ecLimit} dS/m`,
          possibleMechanism: 'High dissolved salts elevate osmotic potential, reducing root water uptake.',
          alternativeExplanations: ['Seasonal well drawdown spikes EC late in summer compared with spring recharge.'],
          confidencePct: 86,
          missingEvidence: ['Saturation paste soil ECe test to quantify root-zone salt accumulation'],
          confirmationCheck: 'Retest irrigation source EC and check drainage outlets for salt crusting.',
          mitigationOptions: ['Include leaching fraction where drainage allows or rotate higher salt-tolerance crops (e.g. barley).'],
        }
      );
    }
  }

  // 7. Dry Spell & Negative Rain Anomaly
  if (
    fa.weatherSummary.drySpellDays !== null &&
    fa.weatherSummary.drySpellDays >= 10 &&
    fa.weatherSummary.rainfallAnomalyPct !== null &&
    fa.weatherSummary.rainfallAnomalyPct <= -35
  ) {
    const rule = DOCUMENTED_RISK_RULES[6];
    pushFinding({
      id: `find-${input.fieldId}-dryspell`,
      title: `Extended Dry Spell (${fa.weatherSummary.drySpellDays}d) & ${fa.weatherSummary.rainfallAnomalyPct}% Rain Anomaly`,
      isWatchPoint: false,
      severity: 'moderate',
      farmId: input.farmId,
      fieldId: input.fieldId,
      fieldName: input.fieldName,
      cropName: cropLabel,
      cropStage: input.cropStage,
      ruleId: rule.id,
      ruleVersion: rule.version,
      evidenceIds: input.evidenceIds.weather ? [input.evidenceIds.weather] : [],
      triggerMetricSummary: `${fa.weatherSummary.drySpellDays} dry days (< 1 mm); ${fa.weatherSummary.rainfallAnomalyPct}% vs baseline`,
      sourceQualityStatus: 'Daily climate series + NASA POWER multi-year baseline',
      baselineOrThreshold: 'Threshold: ≥ 10 consecutive dry days & ≥ 35% negative rainfall anomaly',
      possibleMechanism: 'Prolonged dry window reduces surface soil moisture replenishment compared with historical seasonal norms.',
      alternativeExplanations: ['Convective local showers may not be captured in coarse precipitation grid cells.'],
      confidencePct: 74,
      missingEvidence: ['On-farm rain gauge record'],
      confirmationCheck: 'Verify local rain gauge total and inspect 0–15 cm soil moisture.',
      mitigationOptions: ['Retain surface residue cover to curb bare-soil evaporation.'],
    });
  }

  // 8. NDVI Below Baseline (Careful wording — NEVER claims disease/pest from NDVI alone)
  if (
    fa.vegetationSummary.status === 'valid' &&
    fa.vegetationSummary.ndviDeltaFromBaseline !== null &&
    fa.vegetationSummary.ndviDeltaFromBaseline <= -0.12
  ) {
    const rule = DOCUMENTED_RISK_RULES[8];
    pushFinding(
      {
        id: `find-${input.fieldId}-ndvi`,
        title: `Vegetation Index Below Recent Baseline (${fa.vegetationSummary.ndviDeltaFromBaseline.toFixed(2)} NDVI)`,
        isWatchPoint: true, // optical reflectance alone is always a scouting watch point, never a diagnosed pathology
        severity: 'low',
        farmId: input.farmId,
        fieldId: input.fieldId,
        fieldName: input.fieldName,
        cropName: cropLabel,
        cropStage: input.cropStage,
        ruleId: rule.id,
        ruleVersion: rule.version,
        evidenceIds: input.evidenceIds.vegetation ? [input.evidenceIds.vegetation] : [],
        triggerMetricSummary: `Mean NDVI ${fa.vegetationSummary.ndviMean?.toFixed(2)} vs baseline ${fa.vegetationSummary.baselineNdviMean?.toFixed(2)} (${fa.vegetationSummary.validCoveragePct.toFixed(0)}% cloud-free pixels)`,
        sourceQualityStatus: 'Sentinel-2 L2A cloud-masked reflectance',
        baselineOrThreshold: 'Watch threshold: NDVI delta ≤ -0.12 vs prior clear scene',
        possibleMechanism: 'Lower near-infrared reflectance indicates reduced active green canopy cover or senescence.',
        alternativeExplanations: [
          'Intentional harvest, mowing, tillage, or seasonal crop maturation between acquisition dates.',
          'Varietal growth-stage progression or bare soil exposure along edges.',
        ],
        confidencePct: 68,
        missingEvidence: ['In-field visual scouting verification'],
        confirmationCheck: 'Conduct visual walk-through on field zones showing lower canopy vigour.',
        mitigationOptions: ['Log ground scouting observation before attributing change to abiotic or biotic stress.'],
      },
      {
        title: `Walk-check canopy cover uniformity on ${input.fieldName} after lower NDVI scene`,
        verb: 'Scout',
        whySuggested: `Cloud-masked Sentinel-2 NDVI (${fa.vegetationSummary.ndviMean?.toFixed(2)}) measured ${fa.vegetationSummary.ndviDeltaFromBaseline.toFixed(2)} below recent field baseline.`,
        fieldId: input.fieldId,
        fieldName: input.fieldName,
        cropName: cropLabel,
        priority: 'low',
        suggestedDueWindow: 'Next scouting pass',
        requiredToolsOrInfo: ['Field scouting notes'],
        evidenceIds: input.evidenceIds.vegetation ? [input.evidenceIds.vegetation] : [],
        status: 'Suggested',
      }
    );
  }

  // 9. EONET Natural Hazard Watch Point
  if (input.eonetNearbyTitles.length > 0) {
    watchPoints.push({
      id: `watch-${input.fieldId}-eonet`,
      title: `Nearby Regional Hazard Event (${input.eonetNearbyTitles[0]})`,
      isWatchPoint: true,
      severity: 'moderate',
      farmId: input.farmId,
      fieldId: input.fieldId,
      fieldName: input.fieldName,
      cropName: cropLabel,
      cropStage: input.cropStage,
      ruleId: 'WATCH_EONET_PROXIMITY',
      ruleVersion: '1.0.0',
      evidenceIds: input.evidenceIds.eonet ? [input.evidenceIds.eonet] : [],
      triggerMetricSummary: `${input.eonetNearbyTitles.length} open NASA EONET event(s) within 300 km`,
      sourceQualityStatus: 'NASA EONET v3 Regional Hazard Feed',
      baselineOrThreshold: '300 km radius watch buffer',
      possibleMechanism: 'Regional wildfires, severe storms, or flooding may affect air quality, smoke haze (solar radiation), or regional water advisories.',
      alternativeExplanations: ['Event located tens/hundreds of km away in neighbouring watershed or mountain range.'],
      confidencePct: 70,
      missingEvidence: ['Local meteorological impact verification'],
      confirmationCheck: 'Monitor local county advisories and smoke/storm track.',
      mitigationOptions: ['Review contingency work windows if storm/smoke advisories intersect farm.'],
    });
  }

  // 10. Farmer-reported scouting/pest notes (strictly labelled as farmer-reported watch point)
  for (let i = 0; i < input.farmerPestWatchNotes.length; i++) {
    watchPoints.push({
      id: `watch-${input.fieldId}-pest-${i}`,
      title: 'Farmer-Reported Pest / Disease Observation (Watch Point)',
      isWatchPoint: true,
      severity: 'moderate',
      farmId: input.farmId,
      fieldId: input.fieldId,
      fieldName: input.fieldName,
      cropName: cropLabel,
      cropStage: input.cropStage,
      ruleId: 'WATCH_FARMER_REPORTED_SCOUTING',
      ruleVersion: '1.0.0',
      evidenceIds: [],
      triggerMetricSummary: input.farmerPestWatchNotes[i],
      sourceQualityStatus: 'Farmer-reported scouting log',
      baselineOrThreshold: 'User observation log',
      possibleMechanism: 'Directly reported biotic/field symptom awaiting targeted agronomist inspection.',
      alternativeExplanations: ['Requires in-field specimen/symptom verification to confirm causal pressure.'],
      confidencePct: 65,
      missingEvidence: ['Follow-up quantitative incidence percentage'],
      confirmationCheck: 'Re-inspect affected rows across 5+ field locations.',
      mitigationOptions: ['Record follow-up severity percentage after inspection.'],
    });
  }

  // Missing Soil Lab advisory recommendation when only gridded data exists
  if (!input.phIsLab && input.coveragePct < 80) {
    recommendations.push({
      id: `act-${input.fieldId}-soil-lab`,
      title: `Submit composite topsoil (0–20 cm) lab test for ${input.fieldName}`,
      verb: 'Sample',
      whySuggested: 'Gridded soil predictions (~250 m) cannot replace field-specific soil pH, salinity, and hydraulic lab measurements.',
      fieldId: input.fieldId,
      fieldName: input.fieldName,
      cropName: cropLabel,
      priority: 'normal',
      suggestedDueWindow: 'Before next seasonal planning cycle',
      requiredToolsOrInfo: ['Composite soil sample bag', 'Lab analysis sheet'],
      linkedFindingIds: [],
      evidenceIds: input.evidenceIds.soilPh ? [input.evidenceIds.soilPh] : [],
      status: 'Suggested',
    });
  }

  // Determine field condition label from findings + coverage gate
  let conditionLabel: ConditionLabel = 'Good';
  if (input.coveragePct < 30 || input.confidencePct < 30) {
    conditionLabel = 'Insufficient Data';
  } else if (findings.some((f) => f.severity === 'critical' || f.severity === 'high')) {
    conditionLabel = 'Alert';
  } else if (findings.some((f) => f.severity === 'moderate')) {
    conditionLabel = 'Needs Attention';
  } else if (watchPoints.length > 0 || findings.some((f) => f.severity === 'low')) {
    conditionLabel = 'Monitor';
  }

  // Optional calibrated composite score ONLY when coverage >= 40% (never fabricated on empty fields!)
  let healthScore: number | null = null;
  if (input.coveragePct >= 40) {
    let s = 92;
    for (const f of findings) {
      if (f.severity === 'critical') s -= 28;
      else if (f.severity === 'high') s -= 18;
      else if (f.severity === 'moderate') s -= 10;
      else if (f.severity === 'low') s -= 4;
    }
    for (const w of watchPoints) {
      if (w.severity === 'high') s -= 7;
      else if (w.severity === 'moderate') s -= 4;
      else s -= 2;
    }
    healthScore = Math.max(15, Math.min(97, Math.round(s)));
  }

  return {
    findings,
    watchPoints,
    recommendations,
    conditionLabel,
    healthScore,
  };
}

/**
 * Non-masking farm-level aggregation:
 * Healthy fields NEVER hide an Alert or Needs Attention field!
 */
export function aggregateFarmSummary(opts: {
  farmName: string;
  fieldAssessments: FieldDeepAssessment[];
  findings: RiskFinding[];
  watchPoints: RiskFinding[];
  recommendations: ActionRecommendation[];
  evidenceRegistry: Record<string, EvidenceRecord>;
}): {
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
} {
  const { fieldAssessments, findings, watchPoints, recommendations, farmName } = opts;
  const total = fieldAssessments.length;
  if (total === 0) {
    return {
      conditionLabel: 'Not Analysed',
      healthScore: null,
      healthModelNote: `No fields included in scope (${HEALTH_MODEL_VERSION}).`,
      coveragePct: 0,
      confidencePct: 0,
      fieldsAssessedCount: 0,
      fieldsNeedingAttentionCount: 0,
      fieldsAlertCount: 0,
      fieldsInsufficientCount: 0,
      fieldsGoodCount: 0,
      plainLanguageSummary: `${farmName} has no mapped fields or assessment inputs in this scope yet.`,
      strengths: [],
      concerns: ['No field boundaries or baseline farm parameters are available in scope.'],
      priorityNextAction: 'Map or select at least one field boundary and run Deep Analysis.',
    };
  }

  let alertN = 0;
  let attentionN = 0;
  let insufficientN = 0;
  let goodN = 0;
  let monitorN = 0;

  let areaSum = 0;
  let weightedCov = 0;
  let weightedConf = 0;
  let weightedScore = 0;
  let scoreArea = 0;
  let minFieldScore = Infinity;

  for (const fa of fieldAssessments) {
    const w = Math.max(0.5, fa.areaHa || 1);
    areaSum += w;
    weightedCov += fa.coveragePct * w;
    weightedConf += fa.confidencePct * w;
    if (fa.healthScore !== null) {
      weightedScore += fa.healthScore * w;
      scoreArea += w;
      if (fa.healthScore < minFieldScore) minFieldScore = fa.healthScore;
    }
    if (fa.conditionLabel === 'Alert') alertN++;
    else if (fa.conditionLabel === 'Needs Attention') attentionN++;
    else if (fa.conditionLabel === 'Insufficient Data' || fa.conditionLabel === 'Not Analysed') insufficientN++;
    else if (fa.conditionLabel === 'Monitor') monitorN++;
    else goodN++;
  }

  const coveragePct = Math.round(weightedCov / Math.max(1, areaSum));
  const confidencePct = Math.round(weightedConf / Math.max(1, areaSum));

  // Non-masking severity rule: worst material condition propagates upward
  let conditionLabel: ConditionLabel = 'Good';
  if (insufficientN === total) {
    conditionLabel = 'Insufficient Data';
  } else if (alertN > 0) {
    conditionLabel = 'Alert';
  } else if (attentionN > 0) {
    conditionLabel = 'Needs Attention';
  } else if (monitorN > 0 || insufficientN > 0) {
    conditionLabel = 'Monitor';
  }

  // Area-weighted score capped so severe field anomalies cannot be averaged away by benign blocks
  let healthScore: number | null = null;
  if (scoreArea > 0) {
    const meanScore = weightedScore / scoreArea;
    healthScore =
      alertN > 0
        ? Math.round(Math.min(meanScore, minFieldScore + 12))
        : attentionN > 0
          ? Math.round(Math.min(meanScore, minFieldScore + 16))
          : Math.round(meanScore);
    healthScore = Math.max(12, Math.min(97, healthScore));
  }

  const worstField = [...fieldAssessments].sort(
    (a, b) => (a.healthScore ?? 999) - (b.healthScore ?? 999)
  )[0];

  const strengths: string[] = [];
  if (goodN > 0) strengths.push(`${goodN} of ${total} field(s) currently rate Good under active thresholds.`);
  const labPhCount = fieldAssessments.filter((f) => f.soilSummary.labValues.some((v) => v.property === 'Soil pH')).length;
  if (labPhCount > 0) strengths.push(`Laboratory soil pH recorded on ${labPhCount} block(s).`);
  const satCount = fieldAssessments.filter((f) => f.vegetationSummary.status === 'valid').length;
  if (satCount > 0) strengths.push(`Cloud-masked Sentinel-2 NDVI retrieved for ${satCount} block(s).`);
  if (strengths.length === 0) strengths.push('Multi-provider atmospheric & terrain telemetry synchronized.');

  const concerns = [
    ...findings.slice(0, 3).map((f) => `${f.fieldName}: ${f.title}`),
    ...(findings.length === 0 ? watchPoints.slice(0, 2).map((w) => `Watch: ${w.fieldName} — ${w.title}`) : []),
  ];
  if (concerns.length === 0 && insufficientN > 0) {
    concerns.push(`${insufficientN} block(s) have incomplete lab or moisture observations.`);
  }

  const topAction =
    recommendations.find((r) => r.priority === 'high') ??
    recommendations[0];
  const priorityNextAction = topAction
    ? topAction.title
    : 'Continue routine scouting cadence and log confirmed irrigation volumes.';

  const plainLanguageSummary =
    conditionLabel === 'Insufficient Data'
      ? `${farmName} assessed with limited evidence coverage (${coveragePct}%). Complete soil lab and moisture records to unlock full water-balance modelling.`
      : `${farmName} overall condition is ${conditionLabel}${healthScore !== null ? ` (${healthScore}% calibrated health score)` : ''} with ${coveragePct}% data coverage and ${confidencePct}% evidence confidence. ${
          alertN + attentionN > 0 && worstField
            ? `Priority focus: ${worstField.fieldName} — ${worstField.leadingFinding}.`
            : 'No high-severity risk rules triggered across assessed fields.'
        }`;

  return {
    conditionLabel,
    healthScore,
    healthModelNote: `${HEALTH_MODEL_VERSION}: Non-masking field-weighted aggregation (Health Score separated from ${coveragePct}% Coverage & ${confidencePct}% Confidence).`,
    coveragePct,
    confidencePct,
    fieldsAssessedCount: total - insufficientN,
    fieldsNeedingAttentionCount: attentionN,
    fieldsAlertCount: alertN,
    fieldsInsufficientCount: insufficientN,
    fieldsGoodCount: goodN,
    plainLanguageSummary,
    strengths,
    concerns,
    priorityNextAction,
  };
}
