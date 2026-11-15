import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BaseMapId,
  FarmGeoJsonGeometry,
  FarmHealthStatus,
} from '../types/maps';

export interface MorphRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MorphFarmPayload {
  id: string;
  name: string;
  geometry: FarmGeoJsonGeometry;
  centroid: { lat: number; lon: number };
  healthStatus: FarmHealthStatus;
}

export interface MapMorphSession {
  nonce: number;
  farm: MorphFarmPayload;
  baseMapId: BaseMapId;
  fromRect: MorphRect;
  startCenter: { lat: number; lon: number };
  startZoom: number;
}

interface StartMorphInput {
  farm: MorphFarmPayload;
  baseMapId: BaseMapId;
  fromRect: DOMRect | MorphRect;
  startCenter: { lat: number; lon: number };
  startZoom: number;
}

interface MapTransitionContextValue {
  lastBaseMapId: BaseMapId;
  setLastBaseMapId: (id: BaseMapId) => void;
  activeMorph: MapMorphSession | null;
  handoffRevealed: boolean;
  startMapToCardMorph: (input: StartMorphInput) => void;
  revealTargetCard: () => void;
  clearMorph: () => void;
  registerTargetElement: (farmId: string, el: HTMLElement | null) => void;
  getTargetElement: (farmId: string) => HTMLElement | null;
  isTargetHidden: (farmId: string) => boolean;
}

const MapTransitionContext = createContext<MapTransitionContextValue | null>(null);

export const MapTransitionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [lastBaseMapId, setLastBaseMapId] = useState<BaseMapId>('satellite');
  const [activeMorph, setActiveMorph] = useState<MapMorphSession | null>(null);
  const [handoffRevealed, setHandoffRevealed] = useState(false);

  const targetsRef = useRef<Map<string, HTMLElement>>(new Map());
  const nonceRef = useRef(0);

  const registerTargetElement = useCallback((farmId: string, el: HTMLElement | null) => {
    if (el) {
      targetsRef.current.set(farmId, el);
    } else {
      targetsRef.current.delete(farmId);
    }
  }, []);

  const getTargetElement = useCallback((farmId: string): HTMLElement | null => {
    const el = targetsRef.current.get(farmId) ?? null;
    if (el && !el.isConnected) {
      targetsRef.current.delete(farmId);
      return null;
    }
    return el;
  }, []);

  const startMapToCardMorph = useCallback((input: StartMorphInput) => {
    setLastBaseMapId(input.baseMapId);

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced || input.fromRect.width <= 0 || input.fromRect.height <= 0) {
      setActiveMorph(null);
      setHandoffRevealed(true);
      return;
    }

    nonceRef.current += 1;
    setHandoffRevealed(false);
    setActiveMorph({
      nonce: nonceRef.current,
      farm: input.farm,
      baseMapId: input.baseMapId,
      fromRect: {
        left: input.fromRect.left,
        top: input.fromRect.top,
        width: input.fromRect.width,
        height: input.fromRect.height,
      },
      startCenter: input.startCenter,
      startZoom: input.startZoom,
    });
  }, []);

  const revealTargetCard = useCallback(() => {
    setHandoffRevealed(true);
  }, []);

  const clearMorph = useCallback(() => {
    setActiveMorph(null);
    setHandoffRevealed(false);
  }, []);

  const isTargetHidden = useCallback(
    (farmId: string) =>
      Boolean(activeMorph && activeMorph.farm.id === farmId && !handoffRevealed),
    [activeMorph, handoffRevealed]
  );

  const value = useMemo<MapTransitionContextValue>(
    () => ({
      lastBaseMapId,
      setLastBaseMapId,
      activeMorph,
      handoffRevealed,
      startMapToCardMorph,
      revealTargetCard,
      clearMorph,
      registerTargetElement,
      getTargetElement,
      isTargetHidden,
    }),
    [
      lastBaseMapId,
      activeMorph,
      handoffRevealed,
      startMapToCardMorph,
      revealTargetCard,
      clearMorph,
      registerTargetElement,
      getTargetElement,
      isTargetHidden,
    ]
  );

  return (
    <MapTransitionContext.Provider value={value}>
      {children}
    </MapTransitionContext.Provider>
  );
};

export function useMapTransition(): MapTransitionContextValue {
  const ctx = useContext(MapTransitionContext);
  if (!ctx) {
    throw new Error('useMapTransition must be used within a MapTransitionProvider');
  }
  return ctx;
}
