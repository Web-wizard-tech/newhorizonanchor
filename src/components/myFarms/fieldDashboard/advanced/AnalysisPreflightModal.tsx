import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Droplets,
  Layers,
  Loader2,
  Play,
  Radio,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import {
  AnalysisScope,
  FarmPracticeRoutine,
  ParsedPracticeDraft,
  ProviderHealth,
} from '../../../../types/advanced';
import { MyFarmRecord, PortfolioFieldRecord } from '../../../../types/myFarms';
import {
  confirmPracticeDraft,
  parsePracticeText,
  testProviderLive,
} from '../../../../services/advancedApi';
import { useToast } from '../../../Toast';

interface AnalysisPreflightModalProps {
  farm: MyFarmRecord;
  fields: PortfolioFieldRecord[];
  initialScope: AnalysisScope;
  providers: ProviderHealth[];
  routines: FarmPracticeRoutine[];
  lastConfirmedIrrigation: Record<string, unknown> | null;
  onProvidersUpdated: (providers: ProviderHealth[]) => void;
  onPracticeSaved: () => Promise<void>;
  onLaunchRun: (opts: {
    scope: AnalysisScope;
    triggerReason: string;
    dateFrom: string;
    dateTo: string;
    consentConfirmed: boolean;
  }) => Promise<void>;
  onClose: () => void;
}

export const AnalysisPreflightModal: React.FC<AnalysisPreflightModalProps> = ({
  farm,
  fields,
  initialScope,
  providers,
  routines,
  lastConfirmedIrrigation,
  onProvidersUpdated,
  onPracticeSaved,
  onLaunchRun,
  onClose,
}) => {
  const { showToast } = useToast();

  const [scopeType, setScopeType] = useState<AnalysisScope['type']>(
    fields.length > 0 ? initialScope.type : 'whole_farm'
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialScope.fieldIds.length > 0
      ? initialScope.fieldIds
      : fields.length > 0
        ? [fields[0].id]
        : []
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultFromIso = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(defaultFromIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [triggerReason, setTriggerReason] = useState('On-demand Deep Analysis run');

  // 5 Pre-flight checkboxes
  const [chkBoundaries, setChkBoundaries] = useState(true);
  const [chkIrrigation, setChkIrrigation] = useState(true);
  const [chkCrops, setChkCrops] = useState(true);
  const [chkSoil, setChkSoil] = useState(true);
  const [consentConfirmed, setConsentConfirmed] = useState(true);

  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  // NL Practice Assistant state (creates UNCONFIRMED draft -> requires user confirm before save)
  const [nlText, setNlText] = useState('');
  const [parsingNl, setParsingNl] = useState(false);
  const [draft, setDraft] = useState<ParsedPracticeDraft | null>(null);
  const [draftKind, setDraftKind] = useState<
    'irrigation_event' | 'routine' | 'observation' | 'soil_test'
  >('irrigation_event');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDate, setDraftDate] = useState(todayIso);
  const [draftVolumeM3, setDraftVolumeM3] = useState('');
  const [draftMethod, setDraftMethod] = useState('Drip irrigation');
  const [draftFieldId, setDraftFieldId] = useState<string>(fields[0]?.id ?? '');
  const [savingPractice, setSavingPractice] = useState(false);

  const resolvedScope = useMemo<AnalysisScope>(() => {
    if (scopeType === 'whole_farm' || fields.length === 0) {
      return {
        type: 'whole_farm',
        farmId: farm.id,
        fieldIds: fields.map((f) => f.id),
        label: 'Whole Farm',
      };
    }
    if (scopeType === 'all_fields') {
      return {
        type: 'all_fields',
        farmId: farm.id,
        fieldIds: fields.map((f) => f.id),
        label: `All Fields (${fields.length})`,
      };
    }
    if (scopeType === 'single_field') {
      const target = fields.find((f) => f.id === selectedIds[0]) ?? fields[0];
      return {
        type: 'single_field',
        farmId: farm.id,
        fieldIds: target ? [target.id] : [],
        label: target ? target.name : 'Selected Field',
      };
    }
    const valid = fields.filter((f) => selectedIds.includes(f.id));
    return {
      type: 'selected_fields',
      farmId: farm.id,
      fieldIds: valid.map((f) => f.id),
      label:
        valid.length === 1
          ? valid[0].name
          : `${valid.length} Selected Fields`,
    };
  }, [farm.id, fields, scopeType, selectedIds]);

  const handleToggleField = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleTestProvider = async (providerId: string) => {
    setTestingProviderId(providerId);
    try {
      const lat = farm.centroid?.lat ?? 44.8602;
      const lon = farm.centroid?.lon ?? -123.1462;
      const updated = await testProviderLive(providerId, lat, lon);
      onProvidersUpdated(
        providers.map((p) => (p.id === updated.id ? updated : p))
      );
      showToast(
        `${updated.name}: ${updated.state}${updated.latencyMs ? ` (${updated.latencyMs} ms)` : ''}`,
        updated.state === 'tested' || updated.state === 'available' ? 'success' : 'info'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Provider test failed', 'error');
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleParsePractice = async () => {
    if (!nlText.trim()) return;
    setParsingNl(true);
    try {
      const res = await parsePracticeText(farm.id, nlText.trim());
      setDraft(res);
      setDraftKind(res.kind === 'unknown' ? 'observation' : res.kind);
      setDraftTitle(res.title);
      setDraftDate(res.dateGuess || todayIso);
      setDraftVolumeM3(res.volumeM3Guess !== null ? String(res.volumeM3Guess) : '');
      setDraftMethod(res.methodGuess || 'Drip irrigation');
      if (res.fieldIdGuess) setDraftFieldId(res.fieldIdGuess);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to parse practice text', 'error');
    } finally {
      setParsingNl(false);
    }
  };

  const handleConfirmPractice = async () => {
    if (!draft) return;
    const vol = Number(draftVolumeM3);
    if (draftKind === 'irrigation_event' && (!Number.isFinite(vol) || vol <= 0)) {
      showToast(
        'Enter an exact positive water volume (m³) before logging a confirmed irrigation event, or switch Kind to Routine.',
        'error'
      );
      return;
    }
    setSavingPractice(true);
    try {
      const fieldObj = fields.find((f) => f.id === draftFieldId);
      await confirmPracticeDraft(farm.id, {
        kind: draftKind,
        fieldId: fieldObj?.id ?? null,
        fieldName: fieldObj?.name ?? farm.name,
        date: draftDate,
        volumeM3: Number.isFinite(vol) && vol > 0 ? vol : null,
        method: draftMethod,
        title: draftTitle.trim() || draft.title,
        notes: draft.rawText,
        userConfirmed: true,
      });
      showToast('Confirmed and saved to farm ledger.', 'success');
      setDraft(null);
      setNlText('');
      await onPracticeSaved();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save practice', 'error');
    } finally {
      setSavingPractice(false);
    }
  };

  const handleLaunch = async () => {
    if (!consentConfirmed) {
      showToast('Confirm remote telemetry API processing consent before running analysis.', 'error');
      return;
    }
    if (scopeType === 'selected_fields' && selectedIds.length === 0) {
      showToast('Select at least one field to analyse.', 'error');
      return;
    }
    setLaunching(true);
    try {
      await onLaunchRun({
        scope: resolvedScope,
        triggerReason: triggerReason.trim() || 'On-demand Deep Analysis run',
        dateFrom,
        dateTo,
        consentConfirmed,
      });
      onClose();
    } finally {
      setLaunching(false);
    }
  };

  const stateBadge = (state: ProviderHealth['state']) => {
    if (state === 'tested' || state === 'available') {
      return 'border-[#00E99A]/40 bg-[#00E99A]/12 text-[#00E99A]';
    }
    if (state === 'configured') {
      return 'border-[#00CFFF]/40 bg-[#00CFFF]/12 text-[#8CEBFF]';
    }
    if (state === 'degraded') {
      return 'border-amber-400/40 bg-amber-400/12 text-amber-300';
    }
    if (state === 'planned') {
      return 'border-slate-400/30 bg-slate-500/15 text-slate-300';
    }
    return 'border-rose-400/40 bg-rose-500/15 text-rose-300';
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-[#030D18]/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pre-Analysis Preflight Check"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[22px] border border-[#00CFFF]/35 bg-[#081A2E] text-[#F2F7FF] shadow-[0_24px_64px_rgba(0,0,0,0.7)] p-5 sm:p-6 space-y-5"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#00E99A]">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Pre-Analysis Verification &amp; Live Data Registry</span>
            </div>
            <h2 className="text-xl font-bold text-[#F2F7FF]">
              Run Deep Analysis — {farm.name}
            </h2>
            <p className="text-xs text-[#AAB9CA]">
              Confirm field scope, telemetry sources, and recent irrigation before executing the
              14-stage deterministic &amp; satellite analysis pipeline.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#AAB9CA] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Row 1: Scope & Window */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-white/10 bg-[#0D2137] p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#8CEBFF]">
              <Layers className="w-4 h-4" />
              <span>1. Analysis Scope</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {(
                [
                  { id: 'whole_farm', label: 'Whole Farm' },
                  { id: 'all_fields', label: `All Fields (${fields.length})` },
                  { id: 'selected_fields', label: 'Selected Fields' },
                  { id: 'single_field', label: 'Single Field' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={opt.id !== 'whole_farm' && fields.length === 0}
                  onClick={() => setScopeType(opt.id)}
                  className={`px-3 py-2 rounded-lg border text-left font-medium transition-colors cursor-pointer disabled:opacity-40 ${
                    scopeType === opt.id
                      ? 'border-[#00E99A] bg-[#00E99A]/15 text-[#00E99A]'
                      : 'border-white/10 bg-[#0A1A2B] text-[#C7D6E6] hover:border-white/25'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {(scopeType === 'selected_fields' || scopeType === 'single_field') &&
              fields.length > 0 && (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {fields.map((fl) => {
                    const checked =
                      scopeType === 'single_field'
                        ? selectedIds[0] === fl.id
                        : selectedIds.includes(fl.id);
                    return (
                      <label
                        key={fl.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#081726] px-3 py-1.5 text-xs cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type={scopeType === 'single_field' ? 'radio' : 'checkbox'}
                            name="preflight-field"
                            checked={checked}
                            onChange={() =>
                              scopeType === 'single_field'
                                ? setSelectedIds([fl.id])
                                : handleToggleField(fl.id)
                            }
                            className="accent-[#00E99A]"
                          />
                          <span className="font-medium text-[#F2F7FF]">{fl.name}</span>
                        </span>
                        <span className="text-[11px] text-[#AAB9CA]">
                          {fl.cropName || farm.primaryCrop || 'Unassigned'} ·{' '}
                          {(fl.versions?.[0]?.netAreaHectares ?? 0).toFixed(1)} ha
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0D2137] p-4 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-[#8CEBFF]">
              2. Observation Window &amp; Trigger Note
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[#AAB9CA] mb-1">From Date</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-[#081726] px-3 py-2 text-[#F2F7FF]"
                />
              </div>
              <div>
                <label className="block text-[#AAB9CA] mb-1">To Date</label>
                <input
                  type="date"
                  value={dateTo}
                  max={todayIso}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-[#081726] px-3 py-2 text-[#F2F7FF]"
                />
              </div>
            </div>
            <div className="text-xs">
              <label className="block text-[#AAB9CA] mb-1">Run Label / Reason</label>
              <input
                type="text"
                value={triggerReason}
                onChange={(e) => setTriggerReason(e.target.value)}
                maxLength={140}
                className="w-full rounded-lg border border-white/15 bg-[#081726] px-3 py-2 text-[#F2F7FF]"
              />
            </div>
          </div>
        </div>

        {/* Row 2: Routine vs Confirmed Irrigation + NL Practice Parser */}
        <div className="rounded-xl border border-white/10 bg-[#0D2137] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#00E99A]">
              <Droplets className="w-4 h-4" />
              <span>3. Water Ledger vs Saved Routines</span>
            </div>
            <span className="text-[11px] text-[#AAB9CA]">
              Saved routines are context only — water balance strictly uses confirmed irrigation logs.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-white/10 bg-[#081726] p-3">
              <div className="text-[#8DA4BC] font-semibold">Last Confirmed Irrigation Log</div>
              {lastConfirmedIrrigation ? (
                <div className="mt-1 text-[#F2F7FF]">
                  {String(lastConfirmedIrrigation.date)} ·{' '}
                  <strong className="text-[#00E99A]">
                    {String(lastConfirmedIrrigation.volumeM3 ?? '—')} m³
                  </strong>{' '}
                  ({String(lastConfirmedIrrigation.method || 'Logged')})
                </div>
              ) : (
                <div className="mt-1 text-amber-300">No confirmed irrigation events logged yet.</div>
              )}
            </div>
            <div className="rounded-lg border border-white/10 bg-[#081726] p-3">
              <div className="text-[#8DA4BC] font-semibold">
                Saved Practices ({routines.length})
              </div>
              {routines.length > 0 ? (
                <div className="mt-1 text-[#E5F0FA]">
                  {routines[0].fieldName}: {routines[0].cadenceLabel}
                  {routines.some((r) => r.needsReconfirmation) && (
                    <span className="ml-2 text-amber-300">(Needs reconfirmation)</span>
                  )}
                </div>
              ) : (
                <div className="mt-1 text-[#AAB9CA]">No recurring routines saved.</div>
              )}
            </div>
          </div>

          {/* AI Natural Language Practice Assistant */}
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#8CEBFF]">
              <Wand2 className="w-3.5 h-3.5" />
              <span>Quick Log via Natural Language (Creates Unconfirmed Draft First)</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={nlText}
                onChange={(e) => setNlText(e.target.value)}
                placeholder='e.g. "Irrigated East Creek Block 2 with 120 m3 drip yesterday"'
                className="flex-1 rounded-lg border border-white/15 bg-[#081726] px-3 py-2 text-xs text-[#F2F7FF]"
              />
              <button
                type="button"
                disabled={parsingNl || nlText.trim().length < 3}
                onClick={handleParsePractice}
                className="px-4 py-2 rounded-lg border border-[#00CFFF]/40 bg-[#00CFFF]/15 hover:bg-[#00CFFF]/25 text-xs font-semibold text-[#8CEBFF] disabled:opacity-40 cursor-pointer whitespace-nowrap"
              >
                {parsingNl ? 'Parsing…' : 'Parse Practice'}
              </button>
            </div>

            {draft && (
              <div className="rounded-xl border border-amber-400/40 bg-amber-950/25 p-3.5 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-amber-200 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Unconfirmed Draft (userConfirmed: false) — Review &amp; Confirm Before Saving
                  </span>
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="text-[#AAB9CA] hover:text-white cursor-pointer"
                  >
                    Discard
                  </button>
                </div>

                {draft.ambiguityFlags.length > 0 && (
                  <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-2 text-amber-200 space-y-0.5">
                    {draft.ambiguityFlags.map((f, i) => (
                      <div key={i}>• {f}</div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#AAB9CA] mb-0.5">Record Kind</label>
                    <select
                      value={draftKind}
                      onChange={(e) => setDraftKind(e.target.value as typeof draftKind)}
                      className="w-full rounded border border-white/15 bg-[#081726] px-2 py-1.5 text-xs text-[#F2F7FF]"
                    >
                      <option value="irrigation_event">Confirmed Irrigation</option>
                      <option value="routine">Saved Routine</option>
                      <option value="observation">Field Observation</option>
                      <option value="soil_test">Soil Test Note</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#AAB9CA] mb-0.5">Field</label>
                    <select
                      value={draftFieldId}
                      onChange={(e) => setDraftFieldId(e.target.value)}
                      className="w-full rounded border border-white/15 bg-[#081726] px-2 py-1.5 text-xs text-[#F2F7FF]"
                    >
                      <option value="">Whole Farm</option>
                      {fields.map((fl) => (
                        <option key={fl.id} value={fl.id}>
                          {fl.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#AAB9CA] mb-0.5">Date</label>
                    <input
                      type="date"
                      value={draftDate}
                      onChange={(e) => setDraftDate(e.target.value)}
                      className="w-full rounded border border-white/15 bg-[#081726] px-2 py-1.5 text-xs text-[#F2F7FF]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#AAB9CA] mb-0.5">Volume (m³)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="Required for irrigation"
                      value={draftVolumeM3}
                      onChange={(e) => setDraftVolumeM3(e.target.value)}
                      className="w-full rounded border border-white/15 bg-[#081726] px-2 py-1.5 text-xs text-[#F2F7FF]"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={savingPractice}
                    onClick={handleConfirmPractice}
                    className="px-4 py-1.5 rounded-lg bg-[#00E99A] text-[#042419] font-bold hover:brightness-105 cursor-pointer"
                  >
                    {savingPractice ? 'Saving…' : 'Confirm & Save to Ledger'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 3: Live Data Provider Registry */}
        <div className="rounded-xl border border-white/10 bg-[#0D2137] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#8CEBFF]">
              <Radio className="w-4 h-4" />
              <span>4. Live Telemetry &amp; Satellite Provider Registry</span>
            </div>
            <span className="text-[11px] text-[#AAB9CA]">
              Honest live status — fallback ladders activate automatically if any upstream fails.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1 text-xs">
            {providers.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-white/10 bg-[#081726] p-2.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#F2F7FF] truncate">{p.name}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${stateBadge(p.state)}`}
                    >
                      {p.state}
                    </span>
                  </div>
                  <div className="text-[10.5px] text-[#8DA4BC] truncate mt-0.5">
                    {p.resolutionLabel} · {p.cadenceLabel}
                    {p.latencyMs !== null ? ` · ${p.latencyMs}ms` : ''}
                  </div>
                  {p.lastError && (
                    <div className="text-[10px] text-amber-300 truncate mt-0.5" title={p.lastError}>
                      {p.lastError}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={testingProviderId === p.id || p.state === 'planned'}
                  onClick={() => handleTestProvider(p.id)}
                  className="px-2.5 py-1 rounded border border-white/15 bg-white/5 hover:bg-white/10 text-[11px] font-medium text-[#E5F0FA] disabled:opacity-40 cursor-pointer shrink-0"
                >
                  {testingProviderId === p.id ? 'Testing…' : 'Test Live'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Row 4: 5 Quick Pre-flight Checkboxes */}
        <div className="rounded-xl border border-white/10 bg-[#0D2137] p-4 space-y-2 text-xs">
          <div className="font-bold uppercase tracking-wider text-[#00E99A] mb-1">
            5. Pre-Flight Confirmation
          </div>
          {[
            {
              checked: chkBoundaries,
              set: setChkBoundaries,
              label: 'Field boundaries & areas are accurate for the selected scope',
            },
            {
              checked: chkIrrigation,
              set: setChkIrrigation,
              label: 'Recent confirmed irrigation events are logged (routines kept separate)',
            },
            {
              checked: chkCrops,
              set: setChkCrops,
              label: 'Current crop assignments reflect what is growing in each field',
            },
            {
              checked: chkSoil,
              set: setChkSoil,
              label: 'Any recent lab soil pH or moisture tests have been entered',
            },
            {
              checked: consentConfirmed,
              set: setConsentConfirmed,
              label:
                'Required: Consent to query external meteorological, soil, hazard & satellite APIs for this farm centroid/polygon',
            },
          ].map((item, idx) => (
            <label
              key={idx}
              className={`flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer ${
                idx === 4 && !consentConfirmed
                  ? 'border-rose-400/50 bg-rose-500/10'
                  : 'border-white/5 bg-[#081726]/70'
              }`}
            >
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => item.set(e.target.checked)}
                className="accent-[#00E99A] w-4 h-4 shrink-0"
              />
              <span className="text-[#E5F0FA]">{item.label}</span>
            </label>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
          <div className="text-xs text-[#AAB9CA] flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-[#00E99A]" />
            <span>
              Scope: <strong className="text-[#F2F7FF]">{resolvedScope.label}</strong> ({dateFrom} →{' '}
              {dateTo})
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-semibold text-[#D6E4F2] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={launching || !consentConfirmed}
              onClick={handleLaunch}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-gradient-to-r from-[#5CFFB4] via-[#00E99A] to-[#00C781] text-[#042419] text-xs sm:text-sm font-bold shadow-[0_0_24px_rgba(0,233,154,0.45)] hover:brightness-105 disabled:opacity-50 cursor-pointer"
            >
              {launching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Starting Pipeline…</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-[#042419]" />
                  <span>Launch Deep Analysis</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
