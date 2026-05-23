import { Redis } from '@upstash/redis';

const kv = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserRecord {
  untappdToken: string;
  username: string;
  weightKg: number;
  gender: 'male' | 'female';
}

export interface BacCache {
  bac: number;
  soberMs: number;
  drinkCount: number;
  calculatedAt: number; // epoch ms
  checkins: CachedCheckin[];
}

export interface CachedCheckin {
  checkinId: number;
  beerName: string;
  breweryName: string;
  style: string;
  abv: number;
  servingType: string;
  createdAtMs: number;
  volumeMlOverride?: number;
}

export interface DeviceRecord {
  userId: string;
  createdAt: number;
  label?: string; // optional human-readable label set by user
}

// ── User ──────────────────────────────────────────────────────────────────────

export async function getUser(userId: string): Promise<UserRecord | null> {
  return kv.get<UserRecord>(`user:${userId}`);
}

export async function setUser(userId: string, data: UserRecord): Promise<void> {
  await kv.set(`user:${userId}`, data);
}

// ── BAC cache ─────────────────────────────────────────────────────────────────

export async function getBacCache(userId: string): Promise<BacCache | null> {
  return kv.get<BacCache>(`bac:${userId}`);
}

export async function setBacCache(userId: string, data: BacCache): Promise<void> {
  await kv.set(`bac:${userId}`, data, { ex: 600 }); // 10-min TTL
}

// ── Device tokens ─────────────────────────────────────────────────────────────

export async function getDevice(token: string): Promise<DeviceRecord | null> {
  return kv.get<DeviceRecord>(`device:${token}`);
}

export async function setDevice(token: string, data: DeviceRecord): Promise<void> {
  await kv.set(`device:${token}`, data);
}

export async function deleteDevice(token: string): Promise<void> {
  await kv.del(`device:${token}`);
}

// ── Pairing PINs (short-lived) ────────────────────────────────────────────────

export async function setPin(pin: string, userId: string): Promise<void> {
  await kv.set(`pin:${pin}`, userId, { ex: 600 }); // 10-min TTL
}

/** Reads and atomically deletes the PIN (one-time use). */
export async function consumePin(pin: string): Promise<string | null> {
  const userId = await kv.get<string>(`pin:${pin}`);
  if (userId) await kv.del(`pin:${pin}`);
  return userId ?? null;
}
