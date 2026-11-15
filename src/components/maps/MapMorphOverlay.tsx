import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { useLocation } from 'react-router-dom';
import { useMapTransition, MorphRect } from '../../context/MapTransitionContext';
import {
  getBaseMapReferenceOverlaySpec,
  getBaseMapTileSpec,
} from '../../services/mapsApi';
import { getGeometryBounds } from '../../lib/mapGeometry';
import { FarmHealthStatus, LonLat } from '../../types/maps';

const MORPH_DURATION_MS = 620;
const REVEAL_AT_MS = 460;
const FADE_OUT_MS = 180;

const HEALTH_STYLE: Record<FarmHealthStatus, { stroke: string; fill: string }> = {
  healthy: { stroke: '#5CF892', fill: '#38DF6E' },
  moderate: { stroke: '#FFC74E', fill: '#EEA21A' },
  at_risk: { stroke: '#FF5E66', fill: '#DF363E' },
  no_data: { stroke: '#B8C4D0', fill: '#7E8A96' },
};

export const MapMorphOverlay: React.FC = () => {
  const location = useLocation();
  const {
    activeMorph,
    getTargetElement,
    revealTargetCard,
    clearMorph,
  } = useMapTransition();

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);

  const [targetRect, setTargetRect] = useState<MorphRect | null>(null);
  const [phase, setPhase] = useState<'init' | 'morphing' | 'fading'>('init');

  // Abort morph cleanly if the user navigates away from the destination farm detail route
  useEffect(() => {
    if (!activeMorph) return;
    const expectedPath = `/my-farms/${encodeURIComponent(activeMorph.farm.id)}`;
    const decodedMatch = decodeURIComponent(location.pathname) === `/my-farms/${activeMorph.farm.id}`;
    if (location.pathname !== expectedPath && !decodedMatch) {
      clearMorph();
    }
  }, [location.pathname, activeMorph, clearMorph]);

  useEffect(() => {
    if (!activeMorph) {
      setTargetRect(null);
      setPhase('init');
      return;
    }

    setTargetRect(null);
    setPhase('init');

    let cancelled = false;
    let rafHandle = 0;
    let morphStartTimer = 0;
    let revealTimer = 0;
    let fadeEndTimer = 0;
    let pollTimeout = 0;

    // Mount live Leaflet map inside the morph stage matching the starting viewport
    const host = mapContainerRef.current;
    if (host) {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }

      const map = L.map(host, {
        center: [activeMorph.startCenter.lat, activeMorph.startCenter.lon],
        zoom: activeMorph.startZoom,
        minZoom: 3,
        maxZoom: 19,
        zoomControl: false,
        attributionControl: false,
        keyboard: false,
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
      });

      const spec = getBaseMapTileSpec(activeMorph.baseMapId);
      L.tileLayer(spec.url, {
        maxNativeZoom: spec.maxNativeZoom,
        maxZoom: spec.maxZoom,
        noWrap: true,
        bounds: [
          [-85, -180],
          [85, 180],
        ],
      }).addTo(map);

      const refSpec = getBaseMapReferenceOverlaySpec(activeMorph.baseMapId);
      if (refSpec) {
        L.tileLayer(refSpec.url, {
          maxNativeZoom: refSpec.maxNativeZoom,
          maxZoom: refSpec.maxZoom,
          noWrap: true,
          opacity: 0.9,
        }).addTo(map);
      }

      const style = HEALTH_STYLE[activeMorph.farm.healthStatus] ?? HEALTH_STYLE.healthy;
      const polys: LonLat[][][] =
        activeMorph.farm.geometry.type === 'MultiPolygon'
          ? activeMorph.farm.geometry.coordinates
          : [activeMorph.farm.geometry.coordinates];

      polys.forEach((rings) => {
        const latLngRings = rings.map((ring) =>
          ring.map(([lon, lat]) => [lat, lon] as [number, number])
        );
        L.polygon(latLngRings, {
          color: style.stroke,
          weight: 2.6,
          opacity: 1,
          fillColor: style.fill,
          fillOpacity: 0.36,
          interactive: false,
        }).addTo(map);
      });

      leafletMapRef.current = map;
    }

    // Wait for the destination FarmMapOnlyCard to mount cleanly on /my-farms/:farmId
    const startedAt = performance.now();
    const waitForTarget = () => {
      if (cancelled) return;
      const targetEl = getTargetElement(activeMorph.farm.id);
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        if (rect.width >= 40 && rect.height >= 40) {
          const captured: MorphRect = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          };
          setTargetRect(captured);

          // Animate the internal camera gently to frame the clicked farm polygon
          const map = leafletMapRef.current;
          if (map) {
            const b = getGeometryBounds(activeMorph.farm.geometry);
            const bounds = L.latLngBounds([b.south, b.west], [b.north, b.east]);
            if (bounds.isValid()) {
              map.flyToBounds(bounds, {
                padding: [28, 28],
                maxZoom: 16,
                duration: 0.52,
              });
            }
          }

          // Allow initial frame paint before activating GPU transform + clip-path transition
          rafHandle = window.requestAnimationFrame(() => {
            morphStartTimer = window.requestAnimationFrame(() => {
              if (!cancelled) setPhase('morphing');
            });
          });

          revealTimer = window.setTimeout(() => {
            if (cancelled) return;
            revealTargetCard();
            setPhase('fading');
            fadeEndTimer = window.setTimeout(() => {
              if (!cancelled) clearMorph();
            }, FADE_OUT_MS);
          }, REVEAL_AT_MS);
          return;
        }
      }

      if (performance.now() - startedAt > 1600) {
        // Safety fallback if destination card didn't mount (e.g. farm not found)
        revealTargetCard();
        clearMorph();
        return;
      }

      pollTimeout = window.setTimeout(waitForTarget, 16);
    };

    waitForTarget();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafHandle);
      window.cancelAnimationFrame(morphStartTimer);
      window.clearTimeout(revealTimer);
      window.clearTimeout(fadeEndTimer);
      window.clearTimeout(pollTimeout);
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [activeMorph, getTargetElement, revealTargetCard, clearMorph]);

  if (!activeMorph) return null;

  const { fromRect } = activeMorph;

  // Compute GPU transform + aspect-preserving clip-path to morph from full map into rounded card
  let stageStyle: React.CSSProperties = {
    left: `${fromRect.left}px`,
    top: `${fromRect.top}px`,
    width: `${fromRect.width}px`,
    height: `${fromRect.height}px`,
    transformOrigin: '50% 50%',
    transform: 'translate3d(0px, 0px, 0px) scale(1)',
    clipPath: 'inset(0px 0px 0px 0px round 0px)',
    opacity: phase === 'fading' ? 0 : 1,
    transition:
      phase === 'init'
        ? 'none'
        : `transform ${MORPH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), clip-path ${MORPH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${FADE_OUT_MS}ms ease-out`,
    willChange: 'transform, clip-path, opacity',
  };

  let frameBorderStyle: React.CSSProperties = {
    left: `${fromRect.left}px`,
    top: `${fromRect.top}px`,
    width: `${fromRect.width}px`,
    height: `${fromRect.height}px`,
    borderRadius: '0px',
    opacity: 0,
    transition: `left ${MORPH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), top ${MORPH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), width ${MORPH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), height ${MORPH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), border-radius ${MORPH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out`,
  };

  if (targetRect && (phase === 'morphing' || phase === 'fading')) {
    const uScale = Math.max(
      targetRect.width / fromRect.width,
      targetRect.height / fromRect.height
    );
    const fromCenterX = fromRect.left + fromRect.width / 2;
    const fromCenterY = fromRect.top + fromRect.height / 2;
    const toCenterX = targetRect.left + targetRect.width / 2;
    const toCenterY = targetRect.top + targetRect.height / 2;
    const tx = toCenterX - fromCenterX;
    const ty = toCenterY - fromCenterY;

    const scaledW = fromRect.width * uScale;
    const scaledH = fromRect.height * uScale;
    const insetX = Math.max(0, (scaledW - targetRect.width) / (2 * uScale));
    const insetY = Math.max(0, (scaledH - targetRect.height) / (2 * uScale));
    const clipRadius = 20 / uScale;

    stageStyle = {
      ...stageStyle,
      transform: `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0px) scale(${uScale.toFixed(5)})`,
      clipPath: `inset(${insetY.toFixed(2)}px ${insetX.toFixed(2)}px ${insetY.toFixed(2)}px ${insetX.toFixed(2)}px round ${clipRadius.toFixed(2)}px)`,
    };

    frameBorderStyle = {
      ...frameBorderStyle,
      left: `${targetRect.left}px`,
      top: `${targetRect.top}px`,
      width: `${targetRect.width}px`,
      height: `${targetRect.height}px`,
      borderRadius: '20px',
      opacity: phase === 'fading' ? 0 : 1,
    };
  }

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-[900] overflow-hidden"
    >
      <div
        style={stageStyle}
        className="fixed bg-[#071A14] overflow-hidden shadow-[0_18px_48px_rgba(0,0,0,0.42)]"
      >
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>

      <div
        style={frameBorderStyle}
        className="fixed border border-emerald-700/25 dark:border-[#78CC92]/35 shadow-[0_12px_32px_rgba(0,0,0,0.34)]"
      />
    </div>
  );
};
