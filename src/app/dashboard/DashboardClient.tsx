'use client';

import { useState, useEffect, useCallback } from 'react';
import { bacLabel, bacColor, formatDuration } from '@/lib/bac';
import type { CachedCheckin } from '@/lib/kv';

interface Props {
  username: string;
  weightKg: number;
  gender: 'male' | 'female';
  initialBac: number | null;
  initialSoberMs: number | null;
  initialDrinkCount: number | null;
  initialCalculatedAt: number | null;
  initialCheckins: CachedCheckin[];
}

interface SyncResult {
  bac: number;
  soberMs: number;
  drinkCount: number;
  calculatedAt: number;
}

function BacCircle({ bac }: { bac: number | null }) {
  const color = bac !== null ? bacColor(bac) : '#080604';
  const label = bac !== null ? bacLabel(bac) : 'WAITING';
  const isDark = color === '#080604';
  const badgeColor = isDark ? '#9ca3af' : 'rgba(0,0,0,0.2)';
  const badgeText = isDark ? '#080604' : '#ffffff';

  return (
    <div
      className="relative flex items-center justify-center rounded-full shadow-2xl"
      style={{
        width: 220, height: 220,
        backgroundColor: color,
        transition: 'background-color 0.6s ease',
      }}
    >
      {/* BAC number */}
      <div className="flex flex-col items-center gap-2">
        <span
          className="text-5xl font-black tabular-nums"
          style={{ color: isDark ? '#f3f4f6' : '#ffffff' }}
        >
          {bac !== null ? bac.toFixed(3) : '—'}
        </span>

        {/* Status badge */}
        <span
          className="text-xs font-bold px-3 py-1 rounded-full tracking-wider"
          style={{ backgroundColor: badgeColor, color: badgeText }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function SoberLine({ bac, soberMs }: { bac: number | null; soberMs: number | null }) {
  if (bac === null) return null;
  if (bac < 0.001) return null; // badge says SOBER — no line needed
  if (!soberMs || soberMs <= 0) {
    return <p className="text-[#9ca3af] text-sm text-center">Sober now</p>;
  }
  return (
    <p className="text-[#9ca3af] text-sm text-center">
      Sober in {formatDuration(soberMs)}
    </p>
  );
}

function DrinkList({ checkins }: { checkins: CachedCheckin[] }) {
  if (checkins.length === 0) return null;
  return (
    <div className="w-full max-w-sm mt-2">
      <h2 className="text-[#6b7280] text-xs uppercase tracking-widest mb-2 px-1">
        Recent drinks (8h window)
      </h2>
      <div className="flex flex-col gap-1">
        {checkins.slice(0, 10).map((c, i) => (
          <div
            key={c.checkinId ?? i}
            className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3"
          >
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-white truncate">{c.beerName}</span>
              <span className="text-xs text-[#6b7280] truncate">{c.breweryName}</span>
            </div>
            <span className="text-xs text-[#ffd166] font-mono ml-3 flex-shrink-0">
              {c.abv.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PinDisplay({ pin, onClose }: { pin: string; onClose: () => void }) {
  const [secsLeft, setSecsLeft] = useState(600);
  useEffect(() => {
    const t = setInterval(() => setSecsLeft(s => {
      if (s <= 1) { clearInterval(t); onClose(); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [onClose]);

  return (
    <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center gap-3">
      <p className="text-[#9ca3af] text-xs uppercase tracking-widest">Enter on watch</p>
      <p className="text-4xl font-black tracking-[0.3em] text-[#ffd166]">{pin}</p>
      <p className="text-[#6b7280] text-xs">
        Expires in {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, '0')}
      </p>
      <button
        onClick={onClose}
        className="text-[#4b5563] text-xs hover:text-[#9ca3af] transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
}

export default function DashboardClient({
  username,
  weightKg: initialWeight,
  gender: initialGender,
  initialBac,
  initialSoberMs,
  initialDrinkCount,
  initialCalculatedAt,
  initialCheckins,
}: Props) {
  const [bac,          setBac]          = useState<number | null>(initialBac);
  const [soberMs,      setSoberMs]      = useState<number | null>(initialSoberMs);
  const [drinkCount,   setDrinkCount]   = useState<number | null>(initialDrinkCount);
  const [calculatedAt, setCalculatedAt] = useState<number | null>(initialCalculatedAt);
  const [checkins,     setCheckins]     = useState<CachedCheckin[]>(initialCheckins);

  const [syncing,      setSyncing]      = useState(false);
  const [syncError,    setSyncError]    = useState<string | null>(null);
  const [pin,          setPin]          = useState<string | null>(null);
  const [pairLoading,  setPairLoading]  = useState(false);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSyncError((body as any).error ?? 'Sync failed');
        return;
      }
      const data: SyncResult = await res.json();
      setBac(data.bac);
      setSoberMs(data.soberMs);
      setDrinkCount(data.drinkCount);
      setCalculatedAt(data.calculatedAt);
      // Re-fetch checkins from a fresh dashboard render isn't possible in client;
      // we update what we have and let the next full refresh fill the list.
    } finally {
      setSyncing(false);
    }
  }, []);

  // Auto-sync on mount if no cached data or if cache is older than 5 min
  useEffect(() => {
    const stale = !calculatedAt || (Date.now() - calculatedAt > 5 * 60_000);
    if (stale) sync();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 5 min
  useEffect(() => {
    const t = setInterval(sync, 5 * 60_000);
    return () => clearInterval(t);
  }, [sync]);

  const requestPin = async () => {
    setPairLoading(true);
    try {
      const res = await fetch('/api/pair', { method: 'POST' });
      const data = await res.json();
      if (data.pin) setPin(data.pin);
    } finally {
      setPairLoading(false);
    }
  };

  const lastSyncText = calculatedAt
    ? `Last synced ${Math.round((Date.now() - calculatedAt) / 60_000)}m ago`
    : 'Not yet synced';

  return (
    <main className="min-h-screen bg-[#080604] flex flex-col items-center px-4 py-8 gap-6">

      {/* Header */}
      <div className="w-full max-w-sm flex items-center justify-between">
        <h1 className="text-2xl font-black text-[#ffd166] tracking-widest">un'bac'd</h1>
        <span className="text-[#6b7280] text-xs">@{username}</span>
      </div>

      {/* BAC circle */}
      <BacCircle bac={bac} />

      {/* Sober time */}
      <SoberLine bac={bac} soberMs={soberMs} />

      {/* Drink count + last sync */}
      <div className="flex flex-col items-center gap-1">
        {drinkCount !== null && (
          <p className="text-[#9ca3af] text-sm">
            {drinkCount} {drinkCount === 1 ? 'drink' : 'drinks'} in 8h window
          </p>
        )}
        <p className="text-[#4b5563] text-xs">{lastSyncText}</p>
      </div>

      {/* Sync error */}
      {syncError && (
        <p className="text-red-400 text-xs">{syncError}</p>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={sync}
          disabled={syncing}
          className="bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>

        <button
          onClick={requestPin}
          disabled={pairLoading || !!pin}
          className="bg-[#ffd166]/15 hover:bg-[#ffd166]/25 disabled:opacity-50 text-[#ffd166] text-sm font-medium px-5 py-2.5 rounded-xl transition-colors border border-[#ffd166]/30"
        >
          {pairLoading ? 'Generating…' : 'Pair Watch'}
        </button>
      </div>

      {/* PIN display */}
      {pin && (
        <PinDisplay pin={pin} onClose={() => setPin(null)} />
      )}

      {/* Drink list */}
      <DrinkList checkins={checkins} />

      {/* Sign out */}
      <form action="/api/auth/logout" method="POST" className="mt-auto pt-4">
        <button
          type="submit"
          className="text-[#374151] text-xs hover:text-[#6b7280] transition-colors"
        >
          Sign out
        </button>
      </form>

      {/* Powered by Untappd */}
      <p className="text-[#374151] text-xs pb-2">Powered by Untappd</p>
    </main>
  );
}
