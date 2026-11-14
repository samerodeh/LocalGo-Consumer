export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  kind: 'store' | 'courier' | 'destination';
  live?: boolean;
}
export interface LocalMapProps {
  points: MapPoint[];
  pin?: { latitude: number; longitude: number };
  onPinChange?: (point: { latitude: number; longitude: number }) => void;
  label?: string;
}
export function validPoint(p: { latitude: number; longitude: number }) {
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  );
}
