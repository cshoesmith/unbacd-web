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

export function calculateBac(
  checkins: Checkin[],
  weightKg: number,
  gender: 'male' | 'female',
  nowMs: number = Date.now(),
): BacResult {
  const R = gender === 'female' ? 0.55 : 0.68;
  const sessionStart = nowMs - SESSION_WINDOW_MS;
  const recent = checkins.filter(c => c.createdAtMs >= sessionStart);

  let bac = 0;
  for (const c of recent) {
    const ml = servingMl(c.servingType, c.volumeMlOverride);
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
  if (bac < 0.001) return 'SOBER';
  if (bac < 0.05)  return 'TRACE';
  if (bac < 0.10)  return 'TIPSY';
  if (bac < 0.15)  return 'OVER LIMIT';
  return 'DANGER';
}

export function bacColor(bac: number): string {
  if (bac < 0.001) return '#080604'; // dark
  if (bac < 0.10)  return '#16a34a'; // green
  if (bac < 0.15)  return '#dc2626'; // red
  return '#1e40af';                  // blue (danger)
}

export function formatDuration(ms: number): string {
  const totalMins = Math.floor(ms / 60_000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
