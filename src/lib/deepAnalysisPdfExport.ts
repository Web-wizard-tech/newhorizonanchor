import { MyFarmRecord, SavedFarmSnapshot } from '../types/myFarms';
import { DeepAnalysisReport } from '../types/advanced';

function sanitizePdfText(input: string): string {
  const replaced = input
    .replace(/→/g, '->')
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    .replace(/±/g, '+/-')
    .replace(/°/g, ' deg ')
    .replace(/³/g, '3')
    .replace(/₂/g, '2')
    .replace(/[^\x20-\x7E]/g, ' ');
  return replaced
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(text: string, maxChars = 86): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function finalizePdfPages(pagesOps: string[][]): Uint8Array {
  const pageCount = pagesOps.length;
  const fontRegularNum = 3 + pageCount * 2;
  const fontBoldNum = 4 + pageCount * 2;
  const pageRefs: string[] = [];
  const pageAndStreamObjects: string[] = [];

  for (let i = 0; i < pageCount; i++) {
    const pageObjNum = 3 + i * 2;
    const contentObjNum = 4 + i * 2;
    const streamStr = pagesOps[i].join('\n');
    pageRefs.push(`${pageObjNum} 0 R`);
    pageAndStreamObjects.push(
      `${pageObjNum} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 ${fontRegularNum} 0 R /F2 ${fontBoldNum} 0 R >> >> >> endobj`
    );
    pageAndStreamObjects.push(
      `${contentObjNum} 0 obj << /Length ${streamStr.length} >>\nstream\n${streamStr}\nendstream\nendobj`
    );
  }

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    `2 0 obj << /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageCount} >> endobj`,
    ...pageAndStreamObjects,
    `${fontRegularNum} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,
    `${fontBoldNum} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj + '\n';
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

export function buildDeepAnalysisPdfBytes(
  farm: MyFarmRecord,
  snapshot: SavedFarmSnapshot,
  previousSnapshot?: SavedFarmSnapshot | null
): Uint8Array {
  const pagesOps: string[][] = [[]];
  let y = 758;

  const ensureRoom = (needed = 18) => {
    if (y - needed < 46) {
      pagesOps.push([]);
      y = 758;
    }
  };

  const currentOps = () => pagesOps[pagesOps.length - 1];

  const pushText = (text: string, size = 10, bold = false, x = 44) => {
    ensureRoom(size + 5);
    const font = bold ? '/F2' : '/F1';
    currentOps().push(`BT ${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${sanitizePdfText(text)}) Tj ET`);
    y -= size + 4.5;
  };

  const pushParagraph = (text: string, size = 9.5, x = 44) => {
    for (const line of wrapText(text, 88)) {
      pushText(line, size, false, x);
    }
  };

  const pushDivider = () => {
    ensureRoom(16);
    currentOps().push(`0.80 0.85 0.91 RG 0.6 w 44 ${y + 3} m 568 ${y + 3} l S`);
    y -= 10;
  };

  const dateLabel = new Date(snapshot.generatedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  pushText('ANCHOR FIELD SHIFT - DEEP ANALYSIS FARM REPORT', 15, true, 44);
  pushText(
    `Farm: ${farm.name} (${farm.regionLabel || farm.locationLabel}) | Scope: ${snapshot.fieldScopeLabel || snapshot.fieldName || 'Whole Farm'}`,
    9.5,
    false,
    44
  );
  pushText(
    `Generated: ${dateLabel} | Model: ${snapshot.modelVersion} | Trigger: ${snapshot.triggerReason}`,
    8.5,
    false,
    44
  );
  y -= 4;
  pushDivider();

  pushText('1. OVERALL FARM HEALTH & DATA CONFIDENCE', 11, true, 44);
  const scoreText =
    snapshot.suitabilityScore !== null ? `${snapshot.suitabilityScore}%` : 'Unassessed';
  const deltaText =
    previousSnapshot &&
    previousSnapshot.suitabilityScore !== null &&
    snapshot.suitabilityScore !== null
      ? ` (${snapshot.suitabilityScore - previousSnapshot.suitabilityScore >= 0 ? '+' : ''}${
          snapshot.suitabilityScore - previousSnapshot.suitabilityScore
        }% vs previous report)`
      : '';
  pushText(
    `Overall Farm Health Score: ${scoreText}${deltaText} | Confidence: ${snapshot.confidencePct}% | Completeness: ${snapshot.completenessPct}%`,
    10,
    true,
    44
  );
  if (snapshot.aiSummary) {
    pushParagraph(snapshot.aiSummary, 9.5, 44);
  } else {
    pushParagraph(farm.assessment.summary, 9.5, 44);
  }
  y -= 4;
  pushDivider();

  pushText('2. ENVIRONMENTAL, SOIL & WATER TELEMETRY', 11, true, 44);
  pushParagraph(`Climate Window: ${snapshot.weatherWindowSummary}`, 9.5, 44);
  pushText(
    `Mean Temp: ${snapshot.keyMetrics.meanTempC !== null ? `${snapshot.keyMetrics.meanTempC.toFixed(1)} deg C` : 'N/A'} | Precipitation: ${snapshot.keyMetrics.precipMmDay !== null ? `${snapshot.keyMetrics.precipMmDay.toFixed(2)} mm/day` : 'N/A'} | ET0: ${snapshot.keyMetrics.et0MmDay !== null ? `${snapshot.keyMetrics.et0MmDay.toFixed(2)} mm/day` : 'N/A'}`,
    9.2,
    false,
    44
  );
  pushText(
    `Soil Moisture: ${snapshot.keyMetrics.soilMoisturePct !== null ? `${snapshot.keyMetrics.soilMoisturePct}% VWC` : 'N/A'} | Soil pH: ${snapshot.keyMetrics.phValue !== null ? snapshot.keyMetrics.phValue.toFixed(1) : 'Untested'} | Mapped Area: ${snapshot.keyMetrics.mappedAreaHa.toFixed(1)} ha`,
    9.2,
    false,
    44
  );
  pushText(
    `Data Sources -> NASA POWER: ${snapshot.dataAvailability.nasaPower} | Open-Meteo: ${snapshot.dataAvailability.openMeteo} | NASA EONET: ${snapshot.dataAvailability.nasaEonet} | Soil Lab: ${snapshot.dataAvailability.soilLab}`,
    8.8,
    false,
    44
  );
  y -= 4;
  pushDivider();

  if (snapshot.keyDrivers && snapshot.keyDrivers.length > 0) {
    pushText('3. KEY DRIVERS & RISK SIGNALS', 11, true, 44);
    for (const driver of snapshot.keyDrivers) {
      pushParagraph(`- ${driver}`, 9.2, 44);
    }
    if (snapshot.risksDetected && snapshot.risksDetected.length > 0) {
      for (const risk of snapshot.risksDetected) {
        pushParagraph(`! Risk: ${risk}`, 9.2, 44);
      }
    }
    y -= 4;
    pushDivider();
  }

  pushText(
    snapshot.keyDrivers && snapshot.keyDrivers.length > 0
      ? '4. SMART RECOMMENDATIONS'
      : '3. SMART RECOMMENDATIONS',
    11,
    true,
    44
  );
  if (snapshot.recommendations.length > 0) {
    for (const rec of snapshot.recommendations) {
      pushParagraph(`+ ${rec}`, 9.5, 44);
    }
  } else {
    pushParagraph('No specific corrective actions flagged; continue regular monitoring.', 9.5, 44);
  }

  return finalizePdfPages(pagesOps);
}

export function downloadDeepAnalysisPdf(
  farm: MyFarmRecord,
  snapshot: SavedFarmSnapshot,
  previousSnapshot?: SavedFarmSnapshot | null
): string {
  const bytes = buildDeepAnalysisPdfBytes(farm, snapshot, previousSnapshot);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const slug = farm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'farm';
  const dateSlug = snapshot.generatedAt.slice(0, 10);
  const filename = `${slug}-deep-analysis-${dateSlug}.pdf`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return filename;
}

export function buildFullReportPdfBytes(report: DeepAnalysisReport): Uint8Array {
  const pagesOps: string[][] = [[]];
  let y = 758;

  const ensureRoom = (needed = 18) => {
    if (y - needed < 46) {
      pagesOps.push([]);
      y = 758;
    }
  };
  const currentOps = () => pagesOps[pagesOps.length - 1];

  const pushText = (text: string, size = 9.5, bold = false, x = 42) => {
    ensureRoom(size + 5);
    const font = bold ? '/F2' : '/F1';
    currentOps().push(`BT ${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${sanitizePdfText(text)}) Tj ET`);
    y -= size + 4.2;
  };
  const pushParagraph = (text: string, size = 9, x = 42) => {
    for (const line of wrapText(text, 92)) {
      pushText(line, size, false, x);
    }
  };
  const pushDivider = () => {
    ensureRoom(14);
    currentOps().push(`0.80 0.85 0.91 RG 0.6 w 42 ${y + 3} m 570 ${y + 3} l S`);
    y -= 9;
  };

  pushText('DEEP ANALYSIS REPORT (IMMUTABLE SCIENTIFIC RECORD)', 14, true);
  pushText(
    `Farm: ${report.farmName} (${report.scope.label}) | Window: ${report.dateRange.from} to ${report.dateRange.to} (${report.dateRange.timezone})`,
    9
  );
  pushText(
    `Report ID: ${report.id} | Completed: ${report.completedAt} | Status: ${report.status.toUpperCase()}`,
    8.5
  );
  pushText(
    `Versions -> Engine: ${report.engineVersion} | Crop DB: ${report.cropKnowledgeVersion} | Rules: ${report.ruleSetVersion} | Hash: ${report.reportHash}`,
    8
  );
  pushDivider();

  // Section A: Executive Summary
  pushText('SECTION A - EXECUTIVE FARM SUMMARY', 11, true);
  pushText(
    `Condition: ${report.overallSummary.conditionLabel} | Calibrated Health Score: ${
      report.overallSummary.healthScore !== null ? `${report.overallSummary.healthScore}%` : 'Unscored'
    } | Coverage: ${report.overallSummary.coveragePct}% | Confidence: ${report.overallSummary.confidencePct}%`,
    9.5,
    true
  );
  pushText(
    `Fields: ${report.overallSummary.fieldsAssessedCount} assessed (${report.overallSummary.fieldsGoodCount} good, ${report.overallSummary.fieldsNeedingAttentionCount} needs attention, ${report.overallSummary.fieldsAlertCount} alert, ${report.overallSummary.fieldsInsufficientCount} insufficient)`,
    8.8
  );
  pushParagraph(report.aiExplanation.simpleSummary || report.overallSummary.plainLanguageSummary, 9);
  if (report.overallSummary.healthModelNote) {
    pushParagraph(`Calibration note: ${report.overallSummary.healthModelNote}`, 8.3);
  }
  pushDivider();

  // Section B: Field-by-Field Assessment Table
  pushText('SECTION B - FIELD-BY-FIELD ASSESSMENT', 11, true);
  for (const fa of report.fieldAssessments) {
    pushText(
      `${fa.fieldName} (${fa.areaHa.toFixed(1)} ha | Crop: ${fa.cropName ?? 'Unknown'} ${fa.cropStage ? `[${fa.cropStage}]` : ''})`,
      9.2,
      true
    );
    pushText(
      `Condition: ${fa.conditionLabel} | Health: ${fa.healthScore ?? 'N/A'}% | Coverage: ${fa.coveragePct}% | Confidence: ${fa.confidencePct}%`,
      8.5,
      false,
      50
    );
    pushParagraph(`Leading Finding: ${fa.leadingFinding} | Next Action: ${fa.recommendedNextAction}`, 8.4, 50);
  }
  pushDivider();

  // Sections C, D, E, F: Per-Field Technical Hydrology, Soil, Vegetation & Weather
  pushText('SECTIONS C-F - WATER, SOIL, VEGETATION & CLIMATE BY FIELD', 11, true);
  for (const fa of report.fieldAssessments) {
    pushText(`${fa.fieldName}`, 9.5, true);
    pushParagraph(
      `Water (${fa.waterSummary.et0Method}): ET0=${fa.waterSummary.et0MeanMmDay ?? 'N/A'} mm/d, Kc=${fa.waterSummary.kcApplied ?? 'N/A'}, ETc=${fa.waterSummary.etcPeriodMm ?? 'N/A'} mm, Peff=${fa.waterSummary.effectiveRainMm ?? 'N/A'} mm (Obs Rain=${fa.waterSummary.observedPrecipMm ?? 'N/A'} mm), Confirmed Irrig=${fa.waterSummary.confirmedIrrigationMm} mm, Net=${fa.waterSummary.netBalanceMm ?? 'N/A'} mm, TAW=${fa.waterSummary.tawMm ?? 'Unavailable'} mm, Dr=${fa.waterSummary.latestDepletionMm ?? 'N/A'} mm.`,
      8.4,
      50
    );
    if (fa.waterSummary.savedRoutineLabel) {
      pushParagraph(`Routine context (unconfirmed event): ${fa.waterSummary.savedRoutineLabel}`, 8.2, 50);
    }
    pushParagraph(
      `Soil & Terrain: Texture=${fa.soilSummary.textureClass} (${fa.soilSummary.textureSource}) | Elev=${fa.soilSummary.elevationM ?? 'N/A'} m | Slope=${fa.soilSummary.slopePct ?? 'N/A'}% (${fa.soilSummary.terrainSource})`,
      8.4,
      50
    );
    pushParagraph(
      `Satellite Vegetation (${fa.vegetationSummary.providerName}): Status=${fa.vegetationSummary.status} | Scene=${fa.vegetationSummary.sceneDate ?? 'N/A'} | Valid Pixels=${fa.vegetationSummary.validCoveragePct}% | NDVI Mean=${fa.vegetationSummary.ndviMean ?? 'N/A'} (${fa.vegetationSummary.note})`,
      8.4,
      50
    );
    pushParagraph(
      `Weather & GDD: Mean Temp=${fa.weatherSummary.periodMeanTempC ?? 'N/A'} deg C | Rain=${fa.weatherSummary.periodPrecipTotalMm ?? 'N/A'} mm (Anomaly ${fa.weatherSummary.rainfallAnomalyPct ?? 'N/A'}%) | Dry Spell=${fa.weatherSummary.drySpellDays ?? 'N/A'} d | GDD=${fa.weatherSummary.gddAccumulated ?? 'N/A'} (${fa.weatherSummary.gddNote})`,
      8.4,
      50
    );
  }
  pushDivider();

  // Section G: Findings & Watch Points
  pushText('SECTION G - FORMAL FINDINGS & WATCH POINTS', 11, true);
  if (report.findings.length === 0 && report.watchPoints.length === 0) {
    pushParagraph('No active findings or watch points flagged.', 9);
  } else {
    for (const f of [...report.findings, ...report.watchPoints]) {
      pushText(
        `[${f.isWatchPoint ? 'WATCH' : f.severity.toUpperCase()}] ${f.fieldName}: ${f.title} (${f.ruleId} v${f.ruleVersion}, Conf ${f.confidencePct}%)`,
        8.8,
        true
      );
      pushParagraph(`Trigger: ${f.triggerMetricSummary} | Check: ${f.confirmationCheck}`, 8.3, 50);
    }
  }
  pushDivider();

  // Section H: Action Recommendations
  pushText('SECTION H - ACTION RECOMMENDATIONS', 11, true);
  if (report.recommendations.length === 0) {
    pushParagraph('No corrective actions generated.', 9);
  } else {
    for (const a of report.recommendations) {
      pushText(`[${a.priority.toUpperCase()} | ${a.status}] ${a.fieldName}: ${a.title} (Due ${a.suggestedDueWindow})`, 8.8, true);
      pushParagraph(a.whySuggested, 8.3, 50);
    }
  }
  pushDivider();

  // Section I: Provider Outcomes & Comparison
  pushText('SECTION I - DATA PROVIDER OUTCOMES & AUDIT', 11, true);
  for (const s of report.sourceOutcomes) {
    pushParagraph(
      `- ${s.providerName} (${s.productId}): ${s.status.toUpperCase()} | Fit: ${s.spatialFit} | Window: ${s.observationWindow} | ${s.note}`,
      8.2,
      46
    );
  }
  if (report.comparisonWithPrevious) {
    pushParagraph(
      `Comparison vs ${report.comparisonWithPrevious.baselineReportId}: ${report.comparisonWithPrevious.summaryHeadline}`,
      8.5,
      42
    );
  }

  return finalizePdfPages(pagesOps);
}

export function downloadFullDeepAnalysisPdf(report: DeepAnalysisReport): string {
  const bytes = buildFullReportPdfBytes(report);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const slug =
    report.farmName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'farm';
  const dateSlug = report.completedAt.slice(0, 10);
  const filename = `${slug}-deep-analysis-full-${dateSlug}.pdf`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return filename;
}

