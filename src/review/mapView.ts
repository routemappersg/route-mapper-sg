import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Vite does not emit MapLibre's worker by itself: ship it as a static asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(workerUrl);
import type { LatLng } from '../domain/types';

/** OneMap basemap (Singapore Land Authority). Attribution is required and always shown. */
const TILES = 'https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png';
export const MAP_ATTRIBUTION =
  '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener">OneMap</a> © contributors | Singapore Land Authority · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

export interface MapPoint {
  position: LatLng;
  label: string;
  kind: 'depot' | 'stop' | 'gated' | 'late' | 'done' | 'current';
  locked?: boolean;
  /** Deliver-by badge shown on the pin: the time, and how it sits against the planned arrival. */
  due?: { time: string; state: 'plain' | 'ok' | 'tight' | 'late' };
}

export interface RouteMap {
  /** `focus`: when fitting, frame these points instead of all of them. */
  update(points: MapPoint[], line: LatLng[], fit?: boolean, focus?: LatLng[]): void;
  /** Call after the container was hidden or resized. */
  resize(): void;
  destroy(): void;
}

export function createMap(container: HTMLElement): RouteMap {
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: { onemap: { type: 'raster', tiles: [TILES], tileSize: 256, maxzoom: 19, attribution: MAP_ATTRIBUTION } },
      layers: [{ id: 'onemap', type: 'raster', source: 'onemap' }],
    },
    center: [103.8198, 1.3521],
    zoom: 10.5,
    attributionControl: { compact: false },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  let markers: maplibregl.Marker[] = [];
  let ready = false;
  let pending: (() => void) | null = null;
  map.on('load', () => {
    map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#0f766e', 'line-width': 4, 'line-opacity': 0.85 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
    ready = true;
    pending?.();
  });

  return {
    update(points, line, fit = false, focus) {
      const apply = (): void => {
        markers.forEach((m) => m.remove());
        markers = points.map((p) => {
          const el = document.createElement('div');
          el.className = `pin ${p.kind}`;
          const num = document.createElement('span');
          num.className = 'pinnum';
          num.textContent = p.label;
          el.append(num);
          if (p.due) {
            const b = document.createElement('span');
            b.className = `pindue ${p.due.state}`;
            b.textContent = `⏰ ${p.due.time}`;
            el.append(b);
          }
          el.setAttribute('aria-label', p.due ? `Stop ${p.label}, deliver by ${p.due.time}` : `Stop ${p.label}`);
          if (p.locked) el.dataset.locked = 'true';
          return new maplibregl.Marker({ element: el }).setLngLat([p.position.lng, p.position.lat]).addTo(map);
        });
        const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
        src?.setData({
          type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.map((c) => [c.lng, c.lat]) },
        });
        if (fit && points.length) {
          const b = new maplibregl.LngLatBounds();
          (focus && focus.length ? focus : points.map((p) => p.position)).forEach((p) => b.extend([p.lng, p.lat]));
          map.fitBounds(b, { padding: { top: 40, left: 40, right: 40, bottom: 75 }, maxZoom: 16, duration: 0 });
        }
      };
      // Pins do not need the style or tiles; the route line is applied again once the style is ready.
      apply();
      if (!ready) pending = apply;
    },
    resize() {
      map.resize();
    },
    destroy() {
      markers.forEach((m) => m.remove());
      map.remove();
    },
  };
}
