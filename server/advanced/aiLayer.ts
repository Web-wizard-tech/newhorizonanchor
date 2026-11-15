import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';
import { DeepAnalysisReport, ParsedPracticeDraft } from '../../src/types/advanced';
import { HydratedFarmField } from './store';
import { updateProviderRuntime } from './providers/httpClient';

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const ExplanationResultSchema = z.object({
  simpleSummary: z.string(),
  advancedSummary: z.string(),
  keyDrivers: z.array(z.string()),
});

const ParsedDraftSchema = z.object({
  kind: z.enum(['irrigation_event', 'routine', 'observation', 'soil_test', 'unknown']),
  title: z.string(),
  fieldNameGuess: z.string().nullable(),
  dateGuess: z.string().nullable(),
  durationHoursGuess: z.number().nullable(),
  volumeM3Guess: z.number().nullable(),
  methodGuess: z.string().nullable(),
  notes: z.string(),
  ambiguityFlags: z.array(z.string()),
});

/**
 * Generates plain-language Simple + Advanced summaries strictly grounded in the validated deterministic findings
 * and aggregate metrics (never accesses full raw meteorological archives or coordinates).
 */
export async function generateBoundedReportExplanation(
  report: Pick<
    DeepAnalysisReport,
    'farmName' | 'scope' | 'dateRange' | 'overallSummary' | 'findings' | 'watchPoints' | 'recommendations'
  >
): Promise<DeepAnalysisReport['aiExplanation']> {
  const ai = getGeminiClient();
  const minimalContext = {
    farmName: report.farmName,
    scope: report.scope.label,
    window: `${report.dateRange.from} to ${report.dateRange.to}`,
    condition: report.overallSummary.conditionLabel,
    healthScore: report.overallSummary.healthScore,
    coveragePct: report.overallSummary.coveragePct,
    confidencePct: report.overallSummary.confidencePct,
    findings: report.findings.slice(0, 6).map((f) => ({
      field: f.fieldName,
      title: f.title,
      severity: f.severity,
      metric: f.triggerMetricSummary,
      mechanism: f.possibleMechanism,
      evidenceIds: f.evidenceIds,
    })),
    watchPoints: report.watchPoints.slice(0, 4).map((w) => ({
      field: w.fieldName,
      title: w.title,
      metric: w.triggerMetricSummary,
    })),
    topActions: report.recommendations.slice(0, 4).map((r) => r.title),
  };

  if (!ai) {
    return {
      available: false,
      modelUsed: null,
      simpleSummary: null,
      advancedSummary: null,
      keyDrivers: report.overallSummary.concerns.slice(0, 3),
      unavailableReason:
        'GEMINI_API_KEY is not configured — displaying verified deterministic findings without generative narrative.',
    };
  }

  const systemInstruction = `You are a scientific agronomy report explainer.
STRICT INTEGRITY RULES:
1. Summarize ONLY the validated deterministic findings, condition label, coverage/confidence metrics, and recommended actions supplied in JSON.
2. NEVER invent yield estimates, hidden measurements, unverified diseases/pests, or override any numeric score/threshold.
3. Preserve explicit uncertainty whenever coveragePct < 75 or watchPoints are mentioned.
4. Keep "simpleSummary" under 75 words for everyday farm operations; keep "advancedSummary" under 110 words citing the technical mechanisms/rules provided.
5. Return 3 concise "keyDrivers" grounded directly in the supplied findings/metrics.`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      simpleSummary: { type: Type.STRING },
      advancedSummary: { type: Type.STRING },
      keyDrivers: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['simpleSummary', 'advancedSummary', 'keyDrivers'],
  };

  const models = [
    { id: 'gemini-4-hydrogen', thinking: true },
    { id: 'gemini-3.1-flash-lite', thinking: false },
  ];

  for (const m of models) {
    const start = Date.now();
    try {
      const config: Record<string, unknown> = {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: schema,
      };
      if (m.thinking) {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      }
      const resp = await ai.models.generateContent({
        model: m.id,
        contents: `Summarize this deterministic deep analysis report without altering facts:\n${JSON.stringify(minimalContext)}`,
        config,
      });
      const obj = JSON.parse((resp.text ?? '{}').trim());
      const parsed = ExplanationResultSchema.safeParse(obj);
      if (parsed.success) {
        updateProviderRuntime('gemini_ai_explainer', {
          ok: true,
          latencyMs: Date.now() - start,
          stateOverride: 'available',
        });
        return {
          available: true,
          modelUsed: m.id,
          simpleSummary: parsed.data.simpleSummary,
          advancedSummary: parsed.data.advancedSummary,
          keyDrivers: parsed.data.keyDrivers.slice(0, 4),
          generatedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      updateProviderRuntime('gemini_ai_explainer', {
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 140) : 'Gemini unavailable',
      });
    }
  }

  return {
    available: false,
    modelUsed: null,
    simpleSummary: null,
    advancedSummary: null,
    keyDrivers: report.overallSummary.concerns.slice(0, 3),
    unavailableReason:
      'Gemini AI explainer was unreachable or quota-limited — deterministic calculations and evidence remain complete.',
  };
}

/**
 * Deterministic safety-net parser when Gemini is unconfigured or unreachable.
 * Strictly obeys: never converts irrigation hours -> m3 without an explicit volume/flow rate!
 */
function deterministicPracticeFallback(
  rawText: string,
  fields: HydratedFarmField[],
  aiModelUsed: string | null = null
): ParsedPracticeDraft {
  const lower = rawText.toLowerCase();
  const matchedField =
    fields.find((f) => lower.includes(f.name.toLowerCase())) ?? null;

  const isRoutine = /every\s+(day|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|weekly|routine|normally/i.test(
    rawText
  );
  const isIrrig = /irrigat|watered|drip|sprinkler|flood|furrow|pump/i.test(rawText);
  const isSoil = /ph|soil\s+test|lab|probe|vwc|moisture/i.test(rawText);

  const hrsMatch = rawText.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  const volMatch = rawText.match(/(\d+(?:\.\d+)?)\s*(?:m3|m³|cubic\s*meters?|liters?)/i);
  const durationHours = hrsMatch ? Number(hrsMatch[1]) : null;
  let volumeM3: number | null = null;
  if (volMatch) {
    const rawNum = Number(volMatch[1]);
    volumeM3 = /liters?/i.test(volMatch[0]) ? Number((rawNum / 1000).toFixed(2)) : rawNum;
  }

  const method = /drip/i.test(rawText)
    ? 'Drip irrigation'
    : /sprinkler/i.test(rawText)
      ? 'Sprinkler irrigation'
      : /flood/i.test(rawText)
        ? 'Flood irrigation'
        : /furrow/i.test(rawText)
          ? 'Furrow irrigation'
          : null;

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dateGuess = /yesterday/i.test(rawText)
    ? yesterday
    : /today|this morning/i.test(rawText)
      ? today
      : null;

  const ambiguityFlags: string[] = [];
  if (durationHours !== null && volumeM3 === null) {
    ambiguityFlags.push(
      `Duration (${durationHours} h) mentioned without emitter flow rate or metered volume — cannot infer m³ safely.`
    );
  }
  if (!matchedField && fields.length > 1) {
    ambiguityFlags.push('Field name not explicitly matched; confirm target field before saving.');
  }
  if (isIrrig && !dateGuess) {
    ambiguityFlags.push('Exact event date not stated; please confirm date before recording.');
  }

  return {
    draftId: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    rawText: rawText.trim(),
    kind: isRoutine
      ? 'routine'
      : isIrrig
        ? 'irrigation_event'
        : isSoil
          ? 'soil_test'
          : 'observation',
    title: rawText.trim().slice(0, 90),
    fieldNameGuess: matchedField?.name ?? null,
    fieldIdGuess: matchedField?.id ?? null,
    dateGuess,
    durationHoursGuess: durationHours,
    volumeM3Guess: volumeM3,
    methodGuess: method,
    notes: rawText.trim(),
    ambiguityFlags,
    userConfirmed: false,
    aiModelUsed,
  };
}

export async function parseNaturalLanguagePractice(
  rawText: string,
  fields: HydratedFarmField[]
): Promise<ParsedPracticeDraft> {
  const text = rawText.trim();
  const ai = getGeminiClient();
  if (!ai) {
    return deterministicPracticeFallback(text, fields, null);
  }

  const schema = {
    type: Type.OBJECT,
    properties: {
      kind: { type: Type.STRING },
      title: { type: Type.STRING },
      fieldNameGuess: { type: Type.STRING, nullable: true },
      dateGuess: { type: Type.STRING, nullable: true },
      durationHoursGuess: { type: Type.NUMBER, nullable: true },
      volumeM3Guess: { type: Type.NUMBER, nullable: true },
      methodGuess: { type: Type.STRING, nullable: true },
      notes: { type: Type.STRING },
      ambiguityFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: [
      'kind',
      'title',
      'fieldNameGuess',
      'dateGuess',
      'durationHoursGuess',
      'volumeM3Guess',
      'methodGuess',
      'notes',
      'ambiguityFlags',
    ],
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const systemInstruction = `You extract farmer-described management practices into an UNCONFIRMED structured draft.
CRITICAL SAFETY RULES:
1. NEVER convert hours/duration into m³ water volume unless a flow rate or explicit m³ volume was actually written by the farmer. If only hours are written, keep volumeM3Guess = null and add an ambiguityFlag stating volume/flow rate is required.
2. NEVER invent dates or field names that were not mentioned; leave null and add an ambiguityFlag.
3. Current reference date is ${todayIso}.
4. Allowed kinds: "irrigation_event" | "routine" | "observation" | "soil_test" | "unknown".
5. Known farm fields: ${fields.map((f) => f.name).join(', ') || 'Whole Farm'}.`;

  try {
    const resp = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: `Parse this farmer note into an unconfirmed draft:\n"${text}"`,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });
    const obj = JSON.parse((resp.text ?? '{}').trim());
    const parsed = ParsedDraftSchema.safeParse(obj);
    if (parsed.success) {
      const matched = parsed.data.fieldNameGuess
        ? fields.find(
            (f) => f.name.toLowerCase() === parsed.data.fieldNameGuess!.toLowerCase()
          ) ?? null
        : null;
      const flags = [...parsed.data.ambiguityFlags];
      if (parsed.data.durationHoursGuess !== null && parsed.data.volumeM3Guess === null) {
        if (!flags.some((f) => f.toLowerCase().includes('flow') || f.toLowerCase().includes('volume'))) {
          flags.push('Duration provided without pump flow rate — confirm exact m³ volume before saving.');
        }
      }
      return {
        draftId: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        rawText: text,
        kind: parsed.data.kind,
        title: parsed.data.title.slice(0, 100),
        fieldNameGuess: matched?.name ?? parsed.data.fieldNameGuess,
        fieldIdGuess: matched?.id ?? null,
        dateGuess: parsed.data.dateGuess,
        durationHoursGuess: parsed.data.durationHoursGuess,
        volumeM3Guess: parsed.data.volumeM3Guess,
        methodGuess: parsed.data.methodGuess,
        notes: parsed.data.notes,
        ambiguityFlags: flags,
        userConfirmed: false,
        aiModelUsed: 'gemini-3.1-flash-lite',
      };
    }
  } catch {
    // Fall back cleanly to deterministic parser
  }

  return deterministicPracticeFallback(text, fields, null);
}
