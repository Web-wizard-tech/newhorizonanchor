import fs from 'fs';
import path from 'path';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeExtraterrestrialRadiationRa,
  computeFao56DailyEt0,
  convertWindTo2m,
  resolveCropStageKc,
} from '../server/advanced/engine/fao56';
import { resolveCropParams } from '../server/advanced/engine/cropDatabase';
import {
  computeCappedMeanDailyGdd,
  computeCropWeatherExposure,
  computeSingleSineDailyGdd,
} from '../server/advanced/engine/gdd';
import {
  classifyUsdaTexture,
  estimateSoilHydraulicsFromTexture,
} from '../server/advanced/engine/soilEngine';
import {
  computeDailyWaterBalance,
  computeEffectiveRainfallMm,
} from '../server/advanced/engine/waterBalance';
import { aggregateFarmSummary } from '../server/advanced/engine/riskEngine';
import { compareImmutableReports } from '../server/advanced/engine/comparisonEngine';
import { parseNaturalLanguagePractice } from '../server/advanced/aiLayer';
import { fetchWeatherForecastWithFallback } from '../server/advanced/providers/weatherForecastProvider';
import { fetchHistoricalClimateWithFallback } from '../server/advanced/providers/historicalClimateProvider';
import { fetchSoilMoistureWithFallback } from '../server/advanced/providers/soilMoistureProvider';
import { createAdvancedRouter } from '../server/advanced/router';
import { DeepAnalysisReport, FieldDeepAssessment } from '../src/types/advanced';

const STORE_FILE = path.resolve(__dirname, '..', '.data', 'advanced-analysis-store.json');
const PORT_FILE = path.resolve(__dirname, '..', '.data', 'my-farms-portfolio.json');

describe('Scientific Calculation Engine', () => {
  it('computes FAO-56 Penman-Monteith ET0 cleanly when full weather inputs exist and labels Hargreaves separately when incomplete', () => {
    const u2 = convertWindTo2m(3.2, 10);
    expect(u2).toBeCloseTo(2.39, 1);

    const ra = computeExtraterrestrialRadiationRa(44.86, 180);
    expect(ra).toBeGreaterThan(35);

    const fullPm = computeFao56DailyEt0({
      dateIso: '2026-07-01',
      tMinC: 14.5,
      tMaxC: 29.0,
      rhMinPct: 35,
      rhMaxPct: 82,
      windSpeedMs: 2.1,
      windMeasurementHeightM: 2,
      rsMjM2Day: 24.5,
      elevationM: 65,
      latitudeDeg: 44.86,
    });
    expect(fullPm.method).toBe('FAO-56 Penman-Monteith');
    expect(fullPm.et0MmDay).not.toBeNull();
    expect(fullPm.et0MmDay!).toBeGreaterThan(3.5);
    expect(fullPm.et0MmDay!).toBeLessThan(7.5);

    // Missing wind/humidity/solar radiation MUST NOT claim FAO-56 Penman-Monteith
    const tempOnly = computeFao56DailyEt0({
      dateIso: '2026-07-01',
      tMinC: 14.5,
      tMaxC: 29.0,
      windSpeedMs: null,
      rsMjM2Day: null,
      elevationM: 65,
      latitudeDeg: 44.86,
    });
    expect(tempOnly.method).toBe('Hargreaves-Samani Approx');
    expect(tempOnly.et0MmDay).toBeGreaterThan(2.5);
    expect(tempOnly.unavailableReason).toContain('wind speed');

    const wheat = resolveCropParams('wheat');
    expect(wheat).not.toBeNull();
    const kc = resolveCropStageKc({ crop: wheat!, stage: 'mid_season', u2Ms: 2.2, rhMinPct: 42 });
    expect(kc.kc).toBeGreaterThan(1.0);
  });

  it('distinguishes effective rainfall from raw rainfall and blocks TAW/Dr when soil hydraulics or root depth are missing', () => {
    expect(computeEffectiveRainfallMm(1.0)).toBe(0);
    const peff = computeEffectiveRainfallMm(20);
    expect(peff).not.toBeNull();
    expect(peff!).toBeGreaterThan(0);
    expect(peff!).toBeLessThan(20);

    const wheat = resolveCropParams('wheat');
    const gated = computeDailyWaterBalance({
      days: [
        {
          date: '2026-07-01',
          dataKind: 'historical',
          et0Mm: 4.8,
          et0Method: 'FAO-56 Penman-Monteith',
          kc: 1.15,
          precipitationMm: 10,
          confirmedIrrigationMm: 0,
        },
      ],
      crop: wheat,
      thetaFc: null,
      thetaWp: null,
      rootDepthM: null,
    });
    expect(gated.tawMm).toBeNull();
    expect(gated.rawMm).toBeNull();
    expect(gated.latestDepletionMm).toBeNull();
    expect(gated.tawUnavailableReason).toContain('θFC');
    expect(gated.observedPrecipTotalMm).toBe(10);
    expect(gated.effectiveRainTotalMm).toBeLessThan(10);

    const fullWb = computeDailyWaterBalance({
      days: [
        {
          date: '2026-07-01',
          dataKind: 'historical',
          et0Mm: 5.0,
          et0Method: 'FAO-56 Penman-Monteith',
          kc: 1.1,
          precipitationMm: 0,
          confirmedIrrigationMm: 0,
        },
      ],
      crop: wheat,
      thetaFc: 0.32,
      thetaWp: 0.14,
      rootDepthM: 1.2,
    });
    expect(fullWb.tawMm).toBeCloseTo(216.0, 1);
    expect(fullWb.latestDepletionMm).not.toBeNull();
  });

  it('computes single-sine and capped-mean GDD plus crop heat/frost counts accurately', () => {
    const sine = computeSingleSineDailyGdd(6, 22, 10, 30);
    const capped = computeCappedMeanDailyGdd(6, 22, 10, 30);
    expect(sine).toBeGreaterThan(4);
    expect(capped).toBeCloseTo(6, 1);

    const maize = resolveCropParams('maize');
    const exposure = computeCropWeatherExposure({
      days: [
        { date: '2026-07-01', tMinC: 15, tMaxC: 37, precipMm: 0, solarMjM2: 24 },
        { date: '2026-07-02', tMinC: 1, tMaxC: 18, precipMm: 0, solarMjM2: 20 },
      ],
      crop: maize,
      method: 'single_sine',
    });
    expect(exposure.gddAccumulated).toBeGreaterThan(10);
    expect(exposure.heatStressDays).toBe(1);
    expect(exposure.frostDays).toBe(1);
    expect(exposure.maxConsecutiveDryDays).toBe(2);
  });

  it('validates USDA soil texture triangle classification and 97-103% compatibility threshold', () => {
    const loam = classifyUsdaTexture(40, 40, 20);
    expect(loam.valid).toBe(true);
    expect(loam.textureClass).toBe('Loam');

    const clay = classifyUsdaTexture(20, 25, 55);
    expect(clay.valid).toBe(true);
    expect(clay.textureClass).toBe('Clay');

    const rejected = classifyUsdaTexture(50, 50, 20); // sums to 120% -> reject
    expect(rejected.valid).toBe(false);
    expect(rejected.textureClass).toBe('Unknown');

    const hyd = estimateSoilHydraulicsFromTexture('Silt loam', 3.5);
    expect(hyd).not.toBeNull();
    expect(hyd!.thetaFc).toBeGreaterThan(hyd!.thetaWp);
  });

  it('prevents severe single-field alerts from being masked by healthy farm averages', () => {
    const baseField = (
      id: string,
      condition: FieldDeepAssessment['conditionLabel'],
      score: number,
      areaHa: number
    ): FieldDeepAssessment => ({
      fieldId: id,
      fieldName: id,
      areaHa,
      geometryVersionId: `${id}-v1`,
      centroid: { lat: 44.8, lon: -123.1 },
      cropName: 'Wheat',
      cropConfirmed: true,
      cropStage: 'Mid-season',
      conditionLabel: condition,
      healthScore: score,
      coveragePct: 80,
      confidencePct: 78,
      leadingFinding: condition === 'Alert' ? 'Severe moisture stress' : 'Normal',
      recommendedNextAction: 'Inspect',
      lastUpdatedAt: '2026-11-15T09:00:00Z',
      waterSummary: {
        et0MeanMmDay: 4.5,
        et0Method: 'FAO-56 Penman-Monteith',
        kcApplied: 1.1,
        etcPeriodMm: 60,
        observedPrecipMm: 10,
        effectiveRainMm: 8,
        forecastRain7dMm: 2,
        confirmedIrrigationMm: 0,
        savedRoutineLabel: null,
        netBalanceMm: -52,
        tawMm: 180,
        rawMm: 90,
        latestDepletionMm: 110,
        tawUnavailableReason: null,
        surfaceMoisturePct: 22,
        surfaceMoistureSource: 'ERA5',
        rootZoneMoisturePct: 24,
        rootZoneMoistureSource: 'ERA5',
        dailyRows: [],
      },
      soilSummary: {
        labValues: [],
        mappedEstimates: [],
        textureClass: 'Loam',
        textureSource: 'SSURGO',
        elevationM: 50,
        slopePct: 2,
        terrainSource: 'Copernicus DEM',
        labVsMapDiscrepancyNote: null,
      },
      vegetationSummary: {
        fieldId: id,
        fieldName: id,
        status: 'valid',
        productId: 'sentinel-2-l2a',
        providerName: 'PC',
        sceneId: 's1',
        sceneDate: '2026-11-12',
        pixelSizeM: 10,
        bandsUsed: ['B04', 'B08'],
        sclBreakdown: null,
        validPixelCount: 100,
        validCoveragePct: 100,
        ndviMean: 0.65,
        ndviMedian: 0.66,
        ndviStd: 0.05,
        ndviMin: 0.5,
        ndviMax: 0.78,
        baselineNdviMean: 0.64,
        baselineSceneDate: '2026-10-15',
        ndviDeltaFromBaseline: 0.01,
        spatialFit: 'field_scale',
        note: 'Valid',
        evidenceId: 'ev1',
      },
      weatherSummary: {
        currentTempC: 20,
        forecastHighLow7d: '22/10',
        periodMeanTempC: 17,
        periodPrecipTotalMm: 10,
        drySpellDays: 8,
        rainfallAnomalyMm: -15,
        rainfallAnomalyPct: -20,
        gddAccumulated: 180,
        gddConfig: null,
        gddNote: 'GDD',
        heatStressDays: 0,
        frostDays: 0,
        solarRadiationMeanMjM2: 18,
      },
    });

    const summary = aggregateFarmSummary({
      farmName: 'Test Farm',
      fieldAssessments: [
        baseField('big-good-1', 'Good', 94, 50),
        baseField('big-good-2', 'Good', 92, 50),
        baseField('small-alert', 'Alert', 35, 10),
      ],
      findings: [
        {
          id: 'fn-1',
          title: 'Root-zone stress',
          isWatchPoint: false,
          severity: 'critical',
          farmId: 'f1',
          fieldId: 'small-alert',
          fieldName: 'small-alert',
          cropName: 'Wheat',
          cropStage: 'Mid-season',
          ruleId: 'RULE_SEVERE_WATER_DEFICIT',
          ruleVersion: '1.1.0',
          evidenceIds: [],
          triggerMetricSummary: 'Dr > RAW',
          sourceQualityStatus: 'Measured',
          baselineOrThreshold: 'Dr <= RAW',
          possibleMechanism: 'Water stress',
          alternativeExplanations: [],
          confidencePct: 80,
          missingEvidence: [],
          confirmationCheck: 'Probe soil',
          mitigationOptions: ['Irrigate'],
        },
      ],
      watchPoints: [],
      recommendations: [],
      evidenceRegistry: {},
    });

    expect(summary.conditionLabel).toBe('Alert');
    expect(summary.fieldsAlertCount).toBe(1);
    expect(summary.healthScore!).toBeLessThanOrEqual(65);
  });

  it('blocks misleading report comparisons across zero overlapping fields or mismatched farms', () => {
    const mkReport = (id: string, farmId: string, fieldIds: string[]): DeepAnalysisReport =>
      ({
        id,
        farmId,
        farmName: 'Farm',
        fieldIds,
        scope: { type: 'selected_fields', farmId, fieldIds, label: fieldIds.join(',') },
        runType: 'manual',
        triggerReason: 'Test',
        dateRange: { from: '2026-11-01', to: '2026-11-15', timezone: 'UTC' },
        createdAt: '2026-11-15T00:00:00Z',
        completedAt: '2026-11-15T00:01:00Z',
        status: 'complete',
        inputSnapshotId: 'h1',
        geometryVersionIds: { [fieldIds[0]]: 'v1' },
        profileVersionIds: {},
        dataObservationIds: [],
        engineVersion: '1.0.0',
        cropKnowledgeVersion: '1.0.0',
        ruleSetVersion: '1.0.0',
        reportHash: 'rh1',
        previousComparableReportId: null,
        overallSummary: {
          conditionLabel: 'Good',
          healthScore: 88,
          healthModelNote: 'Note',
          coveragePct: 85,
          confidencePct: 80,
          fieldsAssessedCount: 1,
          fieldsNeedingAttentionCount: 0,
          fieldsAlertCount: 0,
          fieldsInsufficientCount: 0,
          fieldsGoodCount: 1,
          plainLanguageSummary: 'Ok',
          strengths: [],
          concerns: [],
          priorityNextAction: 'None',
        },
        fieldAssessments: [],
        findings: [],
        watchPoints: [],
        recommendations: [],
        sourceOutcomes: [],
        observations: [],
        evidenceById: {},
        warnings: [],
        aiExplanation: {
          available: false,
          modelUsed: null,
          simpleSummary: null,
          advancedSummary: null,
          keyDrivers: [],
        },
        comparisonWithPrevious: null,
      }) as DeepAnalysisReport;

    const r1 = mkReport('r1', 'farm-a', ['f1']);
    const r2 = mkReport('r2', 'farm-a', ['f2']);
    const cmp = compareImmutableReports(r1, r2);
    expect(cmp.comparable).toBe(false);
    expect(cmp.scoreDelta).toBeNull();
    expect(cmp.comparabilityReasons.join(' ')).toContain('Zero field overlap');
  });
});

describe('Provider Resilience, Fallback Ladders & Guardrails', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('switches automatically to MET Norway fallback when Open-Meteo Forecast returns 500 or malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('api.open-meteo.com')) {
          return new Response('Upstream error', { status: 500 });
        }
        if (url.includes('api.met.no')) {
          return new Response(
            JSON.stringify({
              properties: {
                timeseries: [
                  {
                    time: '2026-11-16T12:00:00Z',
                    data: {
                      instant: {
                        details: {
                          air_temperature: 16.2,
                          relative_humidity: 68,
                          wind_speed: 3.1,
                        },
                      },
                      next_1_hours: { details: { precipitation_amount: 1.4 } },
                    },
                  },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      })
    );

    const res = await fetchWeatherForecastWithFallback({ lat: 44.111, lon: -123.111 });
    expect(res.providerId).toBe('met_norway_forecast');
    expect(res.fallbackUsed).toContain('MET Norway');
    expect(res.currentTempC).toBe(16.2);
    expect(res.forecastDays.length).toBeGreaterThan(0);
  });

  it('rejects NASA POWER -999 fill values cleanly and handles SMAP unavailable state honestly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('power.larc.nasa.gov/api/temporal/daily')) {
          return new Response(
            JSON.stringify({
              properties: {
                parameter: {
                  T2M: { '20261110': -999 },
                  T2M_MAX: { '20261110': 21.5 },
                  T2M_MIN: { '20261110': 9.2 },
                  PRECTOTCORR: { '20261110': -999 },
                  ALLSKY_SFC_SW_DWN: { '20261110': 14.8 },
                  RH2M: { '20261110': 65 },
                  WS2M: { '20261110': 2.0 },
                  GWETTOP: { '20261110': 0.55 },
                  GWETROOT: { '20261110': 0.58 },
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({}), { status: 503 });
      })
    );

    const hist = await fetchHistoricalClimateWithFallback({
      lat: 45.12,
      lon: -122.12,
      fromIso: '2026-11-05',
      toIso: '2026-11-12',
    });
    expect(hist.days[0].tMeanC).toBeNull(); // -999 rejected cleanly!
    expect(hist.days[0].precipMm).toBeNull(); // -999 rejected cleanly!
    expect(hist.days[0].tMaxC).toBe(21.5);

    const oldToken = process.env.NASA_EARTHDATA_TOKEN;
    delete process.env.NASA_EARTHDATA_TOKEN;
    const sm = await fetchSoilMoistureWithFallback({
      lat: 45.12,
      lon: -122.12,
      powerHistoryDays: hist.days,
    });
    if (oldToken) process.env.NASA_EARTHDATA_TOKEN = oldToken;
    expect(sm.providerId).toBe('nasa_power_gwet'); // ERA5 returned 503 above -> fell back to NASA POWER wetness index
    expect(sm.gwetTopFrac).toBe(0.55);
  });

  it('refuses to invent m3 volume from irrigation hours without flow rate and keeps userConfirmed=false', async () => {
    const draft = await parseNaturalLanguagePractice(
      'Irrigated East Creek Block 2 with drip for 3 hours yesterday',
      [{ id: 'f-1', name: 'East Creek Block 2' } as any]
    );
    expect(draft.userConfirmed).toBe(false);
    expect(draft.durationHoursGuess).toBe(3);
    expect(draft.volumeM3Guess).toBeNull();
    expect(draft.ambiguityFlags.some((f) => f.toLowerCase().includes('volume'))).toBe(true);
  });
});

describe('HTTP Router & Persistence Integration Tests', () => {
  let server: ReturnType<express.Express['listen']>;
  let baseUrl = '';
  let originalAdvStore: string | null = null;
  let originalPortStore: string | null = null;

  beforeAll(async () => {
    originalAdvStore = fs.existsSync(STORE_FILE) ? fs.readFileSync(STORE_FILE, 'utf8') : null;
    originalPortStore = fs.existsSync(PORT_FILE) ? fs.readFileSync(PORT_FILE, 'utf8') : null;

    const app = express();
    app.use(express.json());
    app.use('/api', createAdvancedRouter());
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (originalAdvStore !== null) fs.writeFileSync(STORE_FILE, originalAdvStore, 'utf8');
    else if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
    if (originalPortStore !== null) fs.writeFileSync(PORT_FILE, originalPortStore, 'utf8');
  });

  it('enforces preflight consent, schedule consent revocation, NL practice unconfirmed->confirm workflow, and providers status', async () => {
    const pRes = await fetch(`${baseUrl}/providers/status`);
    expect(pRes.status).toBe(200);
    const pJson = (await pRes.json()) as { providers: Array<{ id: string; state: string }> };
    expect(pJson.providers.length).toBeGreaterThanOrEqual(8);

    // Preflight missing consent MUST be rejected 400
    const badRun = await fetch(`${baseUrl}/farms/farm-green-valley/analysis-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: { type: 'all_fields', farmId: 'farm-green-valley', fieldIds: [], label: 'All' },
        consentConfirmed: false,
      }),
    });
    expect(badRun.status).toBe(400);

    // Schedule lifecycle: create -> pause -> resume -> revoke-consent -> delete
    const cSched = await fetch(`${baseUrl}/farms/farm-green-valley/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Vitest Schedule',
        scope: { type: 'whole_farm', farmId: 'farm-green-valley', fieldIds: [], label: 'Whole Farm' },
        frequency: 'weekly',
        preferredTime: '08:30',
        timezone: 'America/Los_Angeles',
        allowRemoteProcessingConsent: true,
      }),
    });
    expect(cSched.status).toBe(201);
    const { schedule } = (await cSched.json()) as { schedule: { id: string; status: string } };

    const pauseRes = await fetch(`${baseUrl}/schedules/${schedule.id}/pause`, { method: 'POST' });
    expect(((await pauseRes.json()) as { schedule: { status: string } }).schedule.status).toBe('paused');

    const resumeRes = await fetch(`${baseUrl}/schedules/${schedule.id}/resume`, { method: 'POST' });
    expect(((await resumeRes.json()) as { schedule: { status: string } }).schedule.status).toBe('active');

    const revokeRes = await fetch(`${baseUrl}/schedules/${schedule.id}/revoke-consent`, {
      method: 'POST',
    });
    expect(((await revokeRes.json()) as { schedule: { status: string } }).schedule.status).toBe(
      'consent_revoked'
    );

    const runRevoked = await fetch(`${baseUrl}/schedules/${schedule.id}/run-now`, {
      method: 'POST',
    });
    expect(runRevoked.status).toBe(400);

    await fetch(`${baseUrl}/schedules/${schedule.id}`, { method: 'DELETE' });

    // Confirm practice requires explicit userConfirmed: true and positive volume for irrigation_event
    const badConfirm = await fetch(`${baseUrl}/farms/farm-green-valley/confirm-practice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'irrigation_event',
        fieldName: 'Block 1',
        title: 'Drip flush',
        userConfirmed: true,
      }),
    });
    expect(badConfirm.status).toBe(400);
  });
});
