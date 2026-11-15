import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MyFarmRecord, PortfolioFieldRecord } from '../../../types/myFarms';
import { LonLat } from '../../../types/maps';
import { useMapTransition } from '../../../context/MapTransitionContext';
import {
  getBaseMapReferenceOverlaySpec,
  getBaseMapTileSpec,
} from '../../../services/mapsApi';
import { getGeometryBounds } from '../../../lib/mapGeometry';

interface FarmMapOnlyCardProps {
  farm: MyFarmRecord;
  fields: PortfolioFieldRecord[];
}

export const FarmMapOnlyCard: React.FC<FarmMapOnlyCardProps> = ({
  farm,
  fields,
}) => {
  const { lastBaseMapId, registerTargetElement, isTargetHidden } = useMapTransition();

  const cardRef = useRef<HTMLElement | null>(null);
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const refOverlayRef = useRef<L.TileLayer | null>(null);
  const polygonGroupRef = useRef<L.LayerGroup | null>(null);
  const fitTargetRef = useRef<(() => void) | null>(null);

  const hiddenByMorph = isTargetHidden(farm.id);

  // Register outer card element as morph landing target
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    registerTargetElement(farm.id, el);
    return () => {
      registerTargetElement(farm.id, null);
    };
  }, [farm.id, registerTargetElement]);

  // Initialize Leaflet map with zero controls or overlays — map only
  useEffect(() => {
    const el = mapElRef.current;
    if (!el || mapRef.current) return;

    const startLat = farm.centroid?.lat ?? 44.855;
    const startLon = farm.centroid?.lon ?? -123.153;

    const map = L.map(el, {
      center: [startLat, startLon],
      zoom: 14,
      minZoom: 3,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      boxZoom: false,
    });

    polygonGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    let prevWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      const nextWidth = el.clientWidth;
      if (nextWidth > 0 && Math.abs(nextWidth - prevWidth) > 24) {
        prevWidth = nextWidth;
        fitTargetRef.current?.();
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      refOverlayRef.current = null;
      polygonGroupRef.current = null;
      fitTargetRef.current = null;
    };
  }, []);

  // Sync basemap layer with user's active map style
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const spec = getBaseMapTileSpec(lastBaseMapId);
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    if (refOverlayRef.current) {
      map.removeLayer(refOverlayRef.current);
      refOverlayRef.current = null;
    }

    baseLayerRef.current = L.tileLayer(spec.url, {
      maxNativeZoom: spec.maxNativeZoom,
      maxZoom: spec.maxZoom,
      noWrap: true,
      bounds: [
        [-85, -180],
        [85, 180],
      ],
    }).addTo(map);
    baseLayerRef.current.bringToBack();

    const refSpec = getBaseMapReferenceOverlaySpec(lastBaseMapId);
    if (refSpec) {
      refOverlayRef.current = L.tileLayer(refSpec.url, {
        maxNativeZoom: refSpec.maxNativeZoom,
        maxZoom: refSpec.maxZoom,
        noWrap: true,
        opacity: 0.9,
      }).addTo(map);
    }
  }, [lastBaseMapId]);

  // Render farm boundary + field boundaries and fit tightly inside card
  useEffect(() => {
    const map = mapRef.current;
    const group = polygonGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const boundsPts: L.LatLngTuple[] = [];

    if (farm.geometry) {
      const polys: LonLat[][][] =
        farm.geometry.type === 'MultiPolygon'
          ? farm.geometry.coordinates
          : [farm.geometry.coordinates];

      polys.forEach((rings) => {
        const latLngRings = rings.map((ring) =>
          ring.map(([lon, lat]) => {
            boundsPts.push([lat, lon]);
            return [lat, lon] as [number, number];
          })
        );
        L.polygon(latLngRings, {
          color: '#46EE7E',
          weight: 2.2,
          opacity: 0.95,
          fillColor: '#38DF6E',
          fillOpacity: fields.length > 0 ? 0.14 : 0.34,
          interactive: false,
        }).addTo(group);
      });
    }

    fields.forEach((field) => {
      const ver =
        field.versions.find((v) => v.geometryVersionId === field.currentVersionId) ??
        field.versions[0];
      const geom = ver?.geometry;
      if (!geom) return;

      const latLngRings = geom.coordinates.map((ring) =>
        ring.map(([lon, lat]) => {
          boundsPts.push([lat, lon]);
          return [lat, lon] as [number, number];
        })
      );

      L.polygon(latLngRings, {
        color: '#5EEAD4',
        weight: 2,
        opacity: 0.95,
        fillColor: '#2DD4BF',
        fillOpacity: 0.28,
        interactive: false,
      }).addTo(group);
    });

    const applyFit = () => {
      if (farm.geometry) {
        const b = getGeometryBounds(farm.geometry);
        const bnd = L.latLngBounds([b.south, b.west], [b.north, b.east]);
        if (bnd.isValid()) {
          map.invalidateSize({ animate: false });
          map.fitBounds(bnd, { padding: [18, 18], maxZoom: 16, animate: false });
          return;
        }
      }

      if (boundsPts.length > 0) {
        const bnd = L.latLngBounds(boundsPts);
        if (bnd.isValid()) {
          map.invalidateSize({ animate: false });
          map.fitBounds(bnd, { padding: [18, 18], maxZoom: 16, animate: false });
          return;
        }
      }

      if (farm.centroid) {
        map.invalidateSize({ animate: false });
        map.setView([farm.centroid.lat, farm.centroid.lon], 14, { animate: false });
      }
    };

    fitTargetRef.current = applyFit;
    applyFit();
  }, [farm.id, farm.geometry, farm.centroid, fields]);

  return (
    <section
      ref={cardRef}
      aria-label="Farm map"
      style={{ opacity: hiddenByMorph ? 0 : 1 }}
      className="relative overflow-hidden rounded-[20px] border border-emerald-700/20 dark:border-[#78CC92]/28 bg-[#071A14] shadow-[0_12px_32px_rgba(4,40,26,0.12)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_32px_rgba(0,0,0,0.34)] h-[220px] xl:h-full transition-opacity duration-200"
    >
      <div ref={mapElRef} className="w-full h-full z-0" />
    </section>
  );
};
