const API_BASE = 'https://api.untappd.com/v4';

export interface UntappdCheckin {
  checkinId: number;
  beerName: string;
  breweryName: string;
  style: string;
  abv: number;
  servingType: string;
  createdAt: string; // ISO-ish string from Untappd, e.g. "Thu, 23 May 2026 10:00:00 +0000"
}

export class RateLimitError extends Error {
  constructor() { super('RATE_LIMITED'); this.name = 'RateLimitError'; }
}

export async function fetchCheckins(accessToken: string, limit = 50): Promise<UntappdCheckin[]> {
  const url = new URL(`${API_BASE}/user/checkins`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString(), { cache: 'no-store' });

  if (res.status === 429) throw new RateLimitError();
  if (!res.ok) throw new Error(`Untappd API ${res.status}`);

  const data = await res.json();
  const items: unknown[] = data?.response?.checkins?.items ?? [];

  return items.map((item: any) => ({
    checkinId:   item.checkin_id ?? 0,
    beerName:    item.beer?.beer_name ?? '',
    breweryName: item.brewery?.brewery_name ?? '',
    style:       item.beer?.beer_style ?? '',
    abv:         item.beer?.beer_abv ?? 5.0,
    servingType: item.serving_type ?? '',
    createdAt:   item.created_at ?? '',
  }));
}

/** Untappd returns dates like "Thu, 23 May 2026 10:00:00 +0000" — parse to ms. */
export function parseUntappdDate(dateStr: string): number {
  if (!dateStr) return 0;
  const ms = Date.parse(dateStr);
  return isNaN(ms) ? 0 : ms;
}
