/**
 * Pure GPX route parsing — distance + total climbing from a route/track file.
 * Client- and server-safe (no DOM, no deps): a cyclist exports their race route
 * as GPX from Strava / RideWithGPS / Komoot / Garmin and we read the exact
 * distance and elevation gain from it — more accurate than the rounded numbers
 * on a race page, and universal across providers (no API, no auth).
 */

export interface GpxRouteStats {
  name: string | null;
  distanceMeters: number;
  elevationGainMeters: number;
  pointCount: number;
}

const EARTH_RADIUS_M = 6371000;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

interface Pt {
  lat: number;
  lon: number;
  ele: number | null;
}

/** Extract track/route points (lat, lon, optional <ele>) from GPX, in order. */
function extractPoints(xml: string): Pt[] {
  const pts: Pt[] = [];
  // Match <trkpt …>…</trkpt>, <rtept …>…</rtept>, and self-closing variants.
  const tagRe = /<(?:trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:trkpt|rtept)>)/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const attrs = m[1] ?? '';
    const inner = m[2] ?? '';
    const lat = Number(/\blat="([-\d.]+)"/.exec(attrs)?.[1]);
    const lon = Number(/\blon="([-\d.]+)"/.exec(attrs)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleRaw = /<ele>\s*([-\d.]+)\s*<\/ele>/i.exec(inner)?.[1];
    const ele = eleRaw != null ? Number(eleRaw) : null;
    pts.push({ lat, lon, ele: Number.isFinite(ele as number) ? (ele as number) : null });
  }
  return pts;
}

/**
 * Parse a GPX document → distance (m) + total ascent (m). Distance sums haversine
 * segments; ascent uses a hysteresis with a noise floor so GPS jitter doesn't
 * inflate the climbing (small dips within the floor don't reset the reference).
 * Returns null if there aren't enough points to be a route.
 */
export function parseGpxRoute(xml: string, opts?: { elevationNoiseMeters?: number }): GpxRouteStats | null {
  const noise = opts?.elevationNoiseMeters ?? 2;
  const pts = extractPoints(xml);
  if (pts.length < 2) return null;

  let distance = 0;
  for (let i = 1; i < pts.length; i++) {
    distance += haversineMeters(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
  }

  // Total ascent over the points that carry elevation.
  const eles = pts.map((p) => p.ele).filter((e): e is number => e != null);
  let gain = 0;
  if (eles.length >= 2) {
    let ref = eles[0];
    for (let i = 1; i < eles.length; i++) {
      const e = eles[i];
      if (e >= ref) {
        gain += e - ref;
        ref = e;
      } else if (e < ref - noise) {
        ref = e; // a real descent (beyond noise) resets the base
      }
    }
  }

  const name = /<name>\s*([\s\S]*?)\s*<\/name>/i.exec(xml)?.[1]?.trim() || null;
  return {
    name,
    distanceMeters: Math.round(distance),
    elevationGainMeters: Math.round(gain),
    pointCount: pts.length,
  };
}
