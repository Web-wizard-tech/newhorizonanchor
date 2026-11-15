import crypto from 'crypto';
import { ProviderHealth, ProviderState } from '../../../src/types/advanced';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  retrievedAt: string;
}

const providerCache = new Map<string, CacheEntry>();

export function buildProviderCacheKey(parts: {
  providerId: string;
  productId: string;
  variable: string;
  cellOrGeomKey: string;
  timeWindow: string;
  version: string;
}): string {
  return [
    parts.providerId,
    parts.productId,
    parts.variable,
    parts.cellOrGeomKey,
    parts.timeWindow,
    parts.version,
  ].join('::');
}

export function getProviderCached<T>(key: string): { value: T; retrievedAt: string } | null {
  const hit = providerCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    providerCache.delete(key);
    return null;
  }
  return { value: hit.value as T, retrievedAt: hit.retrievedAt };
}

export function setProviderCached(key: string, value: unknown, ttlMs: number): void {
  providerCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    retrievedAt: new Date().toISOString(),
  });
}

interface ProviderRuntimeState {
  state: ProviderState;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  circuitOpenUntil: number;
}

const runtimeStates = new Map<string, ProviderRuntimeState>();

export function updateProviderRuntime(
  providerId: string,
  update: { ok: boolean; latencyMs?: number; error?: string | null; stateOverride?: ProviderState }
): void {
  const prev = runtimeStates.get(providerId) ?? {
    state: 'configured' as ProviderState,
    lastCheckedAt: null,
    latencyMs: null,
    lastError: null,
    consecutiveFailures: 0,
    circuitOpenUntil: 0,
  };
  const nowIso = new Date().toISOString();
  if (update.ok) {
    runtimeStates.set(providerId, {
      state: update.stateOverride ?? 'available',
      lastCheckedAt: nowIso,
      latencyMs: update.latencyMs ?? prev.latencyMs,
      lastError: null,
      consecutiveFailures: 0,
      circuitOpenUntil: 0,
    });
  } else {
    const failures = prev.consecutiveFailures + 1;
    const openCircuit = failures >= 3 ? Date.now() + 90_000 : 0;
    runtimeStates.set(providerId, {
      state: update.stateOverride ?? (failures >= 3 ? 'unavailable' : 'degraded'),
      lastCheckedAt: nowIso,
      latencyMs: update.latencyMs ?? prev.latencyMs,
      lastError: update.error ?? 'Request failed',
      consecutiveFailures: failures,
      circuitOpenUntil: openCircuit,
    });
  }
}

export function getProviderRuntime(providerId: string): ProviderRuntimeState | null {
  return runtimeStates.get(providerId) ?? null;
}

export function applyRuntimeHealth(base: ProviderHealth): ProviderHealth {
  const rt = runtimeStates.get(base.id);
  if (!rt) return base;
  return {
    ...base,
    state: rt.state,
    lastCheckedAt: rt.lastCheckedAt,
    latencyMs: rt.latencyMs,
    lastError: rt.lastError,
  };
}

export async function fetchWithResilience(opts: {
  providerId: string;
  url: string;
  init?: RequestInit;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<{ ok: true; response: Response; latencyMs: number; correlationId: string } | { ok: false; error: string; status?: number; latencyMs: number; correlationId: string }> {
  const { providerId, url, init, timeoutMs = 8500, maxRetries = 2 } = opts;
  const correlationId = crypto.randomUUID().slice(0, 12);

  const rt = runtimeStates.get(providerId);
  if (rt && rt.circuitOpenUntil > Date.now()) {
    return {
      ok: false,
      error: `Circuit breaker open after repeated errors (${rt.lastError || 'timeout'})`,
      latencyMs: 0,
      correlationId,
    };
  }

  const startedAt = Date.now();
  let lastErr = 'Unknown network error';
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers = new Headers(init?.headers || {});
      if (!headers.has('User-Agent')) {
        headers.set('User-Agent', 'FieldShift-Agronomy-Engine/1.0');
      }
      headers.set('X-Correlation-ID', correlationId);

      const resp = await fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const latencyMs = Date.now() - startedAt;
      if (resp.ok) {
        updateProviderRuntime(providerId, { ok: true, latencyMs });
        return { ok: true, response: resp, latencyMs, correlationId };
      }

      lastStatus = resp.status;
      lastErr = `HTTP ${resp.status} ${resp.statusText}`;

      // Do not retry non-retryable client errors (except 429 Too Many Requests)
      const retryable = resp.status === 429 || resp.status >= 500;
      if (!retryable || attempt === maxRetries) {
        updateProviderRuntime(providerId, { ok: false, latencyMs, error: lastErr });
        return { ok: false, error: lastErr, status: resp.status, latencyMs, correlationId };
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (attempt === maxRetries) {
        const latencyMs = Date.now() - startedAt;
        updateProviderRuntime(providerId, { ok: false, latencyMs, error: lastErr });
        return { ok: false, error: lastErr, latencyMs, correlationId };
      }
    }

    // Bounded exponential backoff + small jitter
    const backoffMs = Math.min(1800, 220 * Math.pow(2, attempt) + Math.round(Math.random() * 140));
    await new Promise((r) => setTimeout(r, backoffMs));
  }

  return {
    ok: false,
    error: lastErr,
    status: lastStatus,
    latencyMs: Date.now() - startedAt,
    correlationId,
  };
}
