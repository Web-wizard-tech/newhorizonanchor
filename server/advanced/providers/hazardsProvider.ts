import { z } from 'zod';
import {
  buildProviderCacheKey,
  fetchWithResilience,
  getProviderCached,
  setProviderCached,
} from './httpClient';
import { ObservationEnvelope } from '../../../src/types/advanced';

export interface NearbyHazardEvent {
  id: string;
  title: string;
  category: string;
  distanceKm: number;
  date: string;
  link: string;
}

export interface HazardsScanResult {
  providerId: string;
  providerName: string;
  retrievedAt: string;
  nearbyEvents: NearbyHazardEvent[];
  observations: ObservationEnvelope<unknown>[];
  sourceUrl: string;
  error?: string;
}

const EonetSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      link: z.string().optional(),
      categories: z.array(z.object({ title: z.string() })).optional(),
      geometry: z
        .array(
          z.object({
            date: z.string().optional(),
            coordinates: z.unknown(),
          })
        )
        .optional(),
    })
  ),
});

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export async function fetchEonetHazards(opts: {
  lat: number;
  lon: number;
  radiusKm?: number;
}): Promise<HazardsScanResult> {
  const { lat, lon, radiusKm = 300 } = opts;
  const cacheKey = buildProviderCacheKey({
    providerId: 'nasa_eonet_v3',
    productId: 'open_events',
    variable: `radius_${radiusKm}km`,
    cellOrGeomKey: `${lat.toFixed(1)},${lon.toFixed(1)}`,
    timeWindow: new Date().toISOString().slice(0, 10),
    version: 'v3',
  });
  const cached = getProviderCached<HazardsScanResult>(cacheKey);
  if (cached) return cached.value;

  const url = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=120';
  const res = await fetchWithResilience({
    providerId: 'nasa_eonet_v3',
    url,
    timeoutMs: 8000,
    maxRetries: 1,
  });

  if (!res.ok) {
    return {
      providerId: 'nasa_eonet_v3',
      providerName: 'NASA EONET v3 Natural Events',
      retrievedAt: new Date().toISOString(),
      nearbyEvents: [],
      observations: [],
      sourceUrl: url,
      error: res.error,
    };
  }

  try {
    const json = await res.response.json();
    const parsed = EonetSchema.safeParse(json);
    if (!parsed.success) throw new Error('Invalid EONET schema');

    const nearbyEvents: NearbyHazardEvent[] = [];
    for (const ev of parsed.data.events) {
      const g = ev.geometry?.[ev.geometry.length - 1];
      const coords = g?.coordinates;
      let evLon: number | null = null;
      let evLat: number | null = null;
      if (Array.isArray(coords) && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        evLon = coords[0];
        evLat = coords[1];
      }
      if (evLat !== null && evLon !== null) {
        const dist = haversineKm(lat, lon, evLat, evLon);
        if (dist <= radiusKm) {
          nearbyEvents.push({
            id: ev.id,
            title: ev.title,
            category: ev.categories?.[0]?.title ?? 'Natural Event',
            distanceKm: Math.round(dist),
            date: g?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
            link: ev.link || 'https://eonet.gsfc.nasa.gov/',
          });
        }
      }
    }
    nearbyEvents.sort((a, b) => a.distanceKm - b.distanceKm);

    const nowIso = new Date().toISOString();
    const result: HazardsScanResult = {
      providerId: 'nasa_eonet_v3',
      providerName: 'NASA EONET v3 Open Events Feed',
      retrievedAt: nowIso,
      nearbyEvents,
      sourceUrl: 'https://eonet.gsfc.nasa.gov/docs/v3',
      observations: [
        {
          observationId: `obs-eonet-${res.correlationId}`,
          providerId: 'nasa_eonet_v3',
          productId: 'eonet-v3-open',
          variable: 'nearby_hazards_count',
          value: nearbyEvents.length,
          unit: 'events',
          evidenceType: 'observed',
          observedAt: nowIso.slice(0, 10),
          retrievedAt: nowIso,
          spatialResolution: radiusKm * 1000,
          qualityFlags: [`radius_${radiusKm}km`],
          sourceUrl: url,
          rawRecordRef: `eonet:${res.correlationId}`,
          status: 'valid',
        },
      ],
    };
    setProviderCached(cacheKey, result, 60 * 60 * 1000);
    return result;
  } catch (err) {
    return {
      providerId: 'nasa_eonet_v3',
      providerName: 'NASA EONET v3 Open Events Feed',
      retrievedAt: new Date().toISOString(),
      nearbyEvents: [],
      observations: [],
      sourceUrl: url,
      error: err instanceof Error ? err.message : 'Parse error',
    };
  }
}
