import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTheme } from '../../theme/ThemeContext';
import { validPoint, type LocalMapProps } from './types';

/** Persistent map; only marker positions change during tracking polls. */
export default function LocalMap({
  points,
  pin,
  onPinChange,
  label = 'Order locations',
}: LocalMapProps) {
  const { colors: c, isDark } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layers = useRef<Leaflet.LayerGroup | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const courier = useRef<Leaflet.Marker | null>(null);
  const frame = useRef<number | null>(null);
  const fitted = useRef(false);
  const pinCallback = useRef(onPinChange);
  pinCallback.current = onPinChange;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    setReady(false);
    setError(false);
    void import('leaflet')
      .then((L) => {
        if (disposed || !host.current) return;
        leaflet.current = L;
        const map = L.map(host.current, {
          scrollWheelZoom: false,
          zoomAnimation: false,
          fadeAnimation: false,
        }).setView([45.496339, -73.578666], 15);
        mapRef.current = map;
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(map);
        if (isDark) tiles.getContainer()?.style.setProperty('filter', 'grayscale(1) invert(.9)');
        tiles.on('tileerror', () => {
          if (!disposed) setError(true);
        });
        layers.current = L.layerGroup().addTo(map);
        map.on('click', (event) =>
          pinCallback.current?.({ latitude: event.latlng.lat, longitude: event.latlng.lng }),
        );
        const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
        observer.observe(host.current);
        cleanup = () => {
          observer.disconnect();
          if (frame.current !== null) cancelAnimationFrame(frame.current);
          map.remove();
          mapRef.current = null;
          layers.current = null;
          courier.current = null;
          fitted.current = false;
        };
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [isDark]);
  useEffect(() => {
    const L = leaflet.current,
      map = mapRef.current,
      group = layers.current;
    if (!ready || !L || !map || !group) return;
    group.clearLayers();
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const all = points.filter(validPoint);
    if (!all.some((p) => p.kind === 'courier') && courier.current) {
      courier.current.remove();
      courier.current = null;
    }
    for (const p of all) {
      if (p.kind === 'courier') {
        const icon = L.divIcon({
          className: '',
          html: `<div class="localgo-courier ${p.live ? 'localgo-live' : ''}" style="background:${c.orange};color:${c.onBrand}"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2L3 21l9-5 9 5z"/></svg></div>`,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        });
        if (!courier.current)
          courier.current = L.marker([p.latitude, p.longitude], { icon, title: p.label }).addTo(
            map,
          );
        else {
          const marker = courier.current;
          marker.setIcon(icon);
          const start = marker.getLatLng(),
            began = performance.now();
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            marker.setLatLng([p.latitude, p.longitude]);
          else {
            const animate = (now: number) => {
              const fraction = Math.min(1, (now - began) / 1000);
              marker.setLatLng([
                start.lat + (p.latitude - start.lat) * fraction,
                start.lng + (p.longitude - start.lng) * fraction,
              ]);
              if (fraction < 1) frame.current = requestAnimationFrame(animate);
            };
            frame.current = requestAnimationFrame(animate);
          }
        }
        continue;
      }
      const color = p.kind === 'destination' ? c.brandNavy : c.orange;
      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: 8,
        color,
        fillColor: color,
        fillOpacity: 0.95,
        weight: 3,
      }).addTo(group);
      const text = document.createElement('span');
      text.textContent = p.label;
      marker.bindTooltip(text);
    }
    if (pin && validPoint(pin)) {
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;background:${c.orange};border:3px solid ${c.onBrand};transform:rotate(-45deg);box-shadow:0 2px 6px ${c.shadow}33"></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
      });
      const marker = L.marker([pin.latitude, pin.longitude], {
        icon,
        draggable: Boolean(onPinChange),
        keyboard: true,
        title: 'Delivery pin: drag or click the map',
      }).addTo(group);
      marker.on('dragend', () => {
        const point = marker.getLatLng();
        pinCallback.current?.({ latitude: point.lat, longitude: point.lng });
      });
    }
    const coordinates = [...all, ...(pin && validPoint(pin) ? [pin] : [])];
    if (!fitted.current && coordinates.length) {
      map.fitBounds(L.latLngBounds(coordinates.map((p) => [p.latitude, p.longitude])), {
        padding: [40, 40],
        maxZoom: 16,
        animate: false,
      });
      fitted.current = true;
    }
  }, [points, pin, ready, onPinChange, c]);
  return (
    <View
      style={{
        height: 280,
        width: '100%',
        backgroundColor: c.gray100,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      <style>{`.localgo-courier{width:38px;height:38px;border:3px solid ${c.onBrand};border-radius:50%;display:flex;align-items:center;justify-content:center;box-sizing:border-box;box-shadow:0 2px 8px ${c.shadow}33}.localgo-live{animation:localgo-pulse 2s infinite}@keyframes localgo-pulse{50%{box-shadow:0 0 0 10px ${c.orange}22}}@media(prefers-reduced-motion:reduce){.localgo-live{animation:none}}`}</style>
      <div ref={host} role="region" aria-label={label} style={{ height: '100%', width: '100%' }} />
      {error ? (
        <Text
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            right: 12,
            padding: 10,
            backgroundColor: c.white,
            color: c.navy,
            fontSize: 12,
          }}
        >
          Map tiles are unavailable. Use the address details below.
        </Text>
      ) : null}
    </View>
  );
}
