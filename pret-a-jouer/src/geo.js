import { createHmac } from 'node:crypto';

const EARTH_KM = 6371;

export function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
}

// Bounding box used to pre-filter in SQL before the exact distance check.
export function boundingBox(lat, lng, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// Never expose a lender's home address: everyone else sees a stable point
// shifted 150–400 m in a direction derived from a server secret.
export function approximatePosition(userId, lat, lng, secret) {
  const h = createHmac('sha256', secret).update(String(userId)).digest();
  const angle = (h.readUInt16BE(0) / 65535) * 2 * Math.PI;
  const meters = 150 + (h.readUInt16BE(2) / 65535) * 250;
  const dLat = (meters * Math.cos(angle)) / 111320;
  const dLng = (meters * Math.sin(angle)) / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return { lat: round(lat + dLat, 4), lng: round(lng + dLng, 4) };
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function validCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
