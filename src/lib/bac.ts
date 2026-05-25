// BAC calculation — Widmark formula, mirroring BacCalculator.java

const ELIMINATION_RATE_PER_HOUR = 0.015; // %/hr
const SESSION_WINDOW_MS = 24 * 60 * 60_000; // 24 hours

const SERVING_ML: Record<string, number> = {
  draft:          568, // pint
  pint:           568,
  bottle:         355,
  can:            355,
  cask:           568,
  nitro:          568,
  'small bottle': 330,
  'medium bottle':500,
  schooner:       425,
  growler:        1893,
  taster:         118,
};
const DEFAULT_SERVING_ML = 400;

export interface Checkin {
  createdAtMs: number;
  abv: number;           // percentage, e.g. 5.0
  servingType: string;
  volumeMlOverride?: number;
}

export interface BacResult {
  bac: number;
  soberMs: number;
  drinkCount: number;
  calculatedAt: number; // epoch ms
}

function servingMl(servingType: string, override?: number): number {
  if (override && override > 0) return override;
  return SERVING_ML[servingType.toLowerCase()] ?? DEFAULT_SERVING_ML;
}

/**
 * Resolves the effective serving volume for a checkin, exported so the
 * frontend can show the real ml instead of "Auto" in the size dropdown.
 * Priority: per-checkin override → user default → beer-style lookup.
 */
export function resolveServingMl(
  servingType: string,
  volumeMlOverride?: number,
  userDefaultMl?: number,
): number {
  if (volumeMlOverride && volumeMlOverride > 0) return volumeMlOverride;
  if (userDefaultMl   && userDefaultMl   > 0) return userDefaultMl;
  return SERVING_ML[servingType.toLowerCase()] ?? DEFAULT_SERVING_ML;
}

export function calculateBac(
  checkins: Checkin[],
  weightKg: number,
  gender: 'male' | 'female',
  userDefaultMl?: number,
  nowMs: number = Date.now(),
): BacResult {
  const R = gender === 'female' ? 0.55 : 0.68;
  const sessionStart = nowMs - SESSION_WINDOW_MS;
  const recent = checkins.filter(c => c.createdAtMs >= sessionStart);

  let bac = 0;
  for (const c of recent) {
    const ml = resolveServingMl(c.servingType, c.volumeMlOverride, userDefaultMl);
    const alcoholGrams = ml * (c.abv / 100) * 0.789;
    const hoursElapsed = (nowMs - c.createdAtMs) / 3_600_000;
    const contribution =
      (alcoholGrams / (weightKg * R * 1000)) * 100 - ELIMINATION_RATE_PER_HOUR * hoursElapsed;
    bac += Math.max(0, contribution);
  }

  bac = Math.max(0, bac);
  const soberMs = bac > 0 ? (bac / ELIMINATION_RATE_PER_HOUR) * 3_600_000 : 0;

  return {
    bac:         Math.round(bac * 1000) / 1000,
    soberMs:     Math.round(soberMs),
    drinkCount:  recent.length,
    calculatedAt: nowMs,
  };
}

export function bacLabel(bac: number): string {
  if (bac < 0.02)  return 'SOBER';
  if (bac < 0.05)  return 'TRACE';
  if (bac < 0.07)  return 'TIPSY';
  if (bac < 0.12)  return 'CAUTION';
  if (bac < 0.20)  return 'OVER LIMIT';
  return 'DANGER';
}

export function bacColor(bac: number): string {
  if (bac < 0.02)  return '#080604';  // dark/sober
  if (bac < 0.05)  return '#fb923c';  // light orange
  if (bac < 0.07)  return '#f97316';  // orange
  if (bac < 0.12)  return '#ef4444';  // light red
  if (bac < 0.20)  return '#dc2626';  // red
  return '#dc2626';                    // ≥ 0.20: component handles police-lights flash
}

export function formatDuration(ms: number): string {
  const totalMins = Math.floor(ms / 60_000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
