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

interface SettingsResult {
  bac?: number;
  soberMs?: number;
  drinkCount?: number;
  calculatedAt?: number;
  checkins?: CachedCheckin[];
}

interface SyncResult {
  bac: number;
  soberMs: number;
  drinkCount: number;
  calculatedAt: number;
  checkins?: CachedCheckin[];
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
          {bac !== null ? bac.toFixed(2) : '—'}
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

const SERVING_OPTIONS: { label: string; ml: number | null }[] = [
  { label: 'Auto',                ml: null },
  { label: '150 ml',             ml: 150  },
  { label: '285 ml · middie',    ml: 285  },
  { label: '330 ml · euro',      ml: 330  },
  { label: '375 ml · can',       ml: 375  },
  { label: '450 ml · schooner',  ml: 450  },
  { label: '500 ml',             ml: 500  },
  { label: '570 ml · pint',      ml: 570  },
];

function timeSince(createdAtMs: number, now: number): string {
  const diff = now - createdAtMs;
  const mins = Math.floor(diff / 60_000);
  const hrs  = Math.floor(mins / 60);
  const rem  = mins % 60;
  if (hrs > 0 && rem > 0) return `${hrs}h ${rem}m ago`;
  if (hrs > 0)            return `${hrs}h ago`;
  if (mins > 0)           return `${mins}m ago`;
  return 'just now';
}

function DrinkList({
  checkins,
  pendingIds,
  onServingChange,
  now,
}: {
  checkins: CachedCheckin[];
  pendingIds: Set<number>;
  onServingChange: (checkinId: number, volumeMl: number | null) => Promise<void>;
  now: number;
}) {
  const cutoff = now - 24 * 60 * 60_000;
  const recent = checkins.filter(c => c.createdAtMs >= cutoff);
  if (recent.length === 0) return null;
  return (
    <div className="w-full max-w-sm mt-2">
      <h2 className="text-[#6b7280] text-xs uppercase tracking-widest mb-2 px-1">
        Recent drinks · 24h window
      </h2>
      <div className="flex flex-col gap-2">
        {recent.map((c, i) => {
          const pending = pendingIds.has(c.checkinId ?? -1);
          return (
            <div
              key={c.checkinId ?? i}
              className="flex flex-col bg-white/5 rounded-xl px-4 py-3 gap-2"
            >
              {/* Top row: beer info + ABV + time */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-white truncate">{c.beerName}</span>
                  <span className="text-xs text-[#6b7280] truncate">{c.breweryName}</span>
                </div>
                <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                  <span className="text-xs text-[#ffd166] font-mono">{c.abv.toFixed(1)}%</span>
                  <span className="text-xs text-[#4b5563]">{timeSince(c.createdAtMs, now)}</span>
                </div>
              </div>
              {/* Serving size selector */}
              <select
                disabled={pending}
                value={c.volumeMlOverride ?? ''}
                onChange={e => {
                  const val = e.target.value === '' ? null : Number(e.target.value);
                  onServingChange(c.checkinId!, val);
                }}
                className="w-full text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[#9ca3af] disabled:opacity-40 focus:outline-none focus:border-[#ffd166]/40 cursor-pointer"
                style={{ colorScheme: 'dark' }}
              >
                {SERVING_OPTIONS.map(opt => (
                  <option
                    key={opt.ml ?? 'auto'}
                    value={opt.ml ?? ''}
                    style={{ backgroundColor: '#1a1816' }}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
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

  const [pendingCheckinIds, setPendingCheckinIds] = useState<Set<number>>(new Set());
  const [now, setNow] = useState(Date.now());

  const [weightKg,   setWeightKg]   = useState(initialWeight);
  const [gender,     setGender]     = useState<'male' | 'female'>(initialGender);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState({ weightKg: initialWeight, gender: initialGender as 'male' | 'female' });

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
      if (data.checkins) setCheckins(data.checkins);
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

  // Tick `now` every minute so time-since labels stay current
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const setServing = useCallback(async (checkinId: number, volumeMl: number | null) => {
    setPendingCheckinIds(s => { const n = new Set(s); n.add(checkinId); return n; });
    try {
      const res = await fetch(`/api/checkins/${checkinId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volumeMl }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setBac(data.bac);
      setSoberMs(data.soberMs);
      setDrinkCount(data.drinkCount);
      setCalculatedAt(data.calculatedAt);
      setCheckins(data.checkins);
    } finally {
      setPendingCheckinIds(s => { const n = new Set(s); n.delete(checkinId); return n; });
    }
  }, []);

  const saveSettings = useCallback(async () => {
    setSettingsSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsDraft),
      });
      if (!res.ok) return;
      const data: SettingsResult = await res.json();
      setWeightKg(settingsDraft.weightKg);
      setGender(settingsDraft.gender);
      if (data.bac !== undefined)         setBac(data.bac);
      if (data.soberMs !== undefined)     setSoberMs(data.soberMs);
      if (data.drinkCount !== undefined)  setDrinkCount(data.drinkCount);
      if (data.calculatedAt !== undefined) setCalculatedAt(data.calculatedAt);
      if (data.checkins)                  setCheckins(data.checkins);
      setShowSettings(false);
    } finally {
      setSettingsSaving(false);
    }
  }, [settingsDraft]);

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
            {drinkCount} {drinkCount === 1 ? 'drink' : 'drinks'} in 24h window
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

        <button
          onClick={() => { setSettingsDraft({ weightKg, gender }); setShowSettings(s => !s); }}
          className="bg-white/10 hover:bg-white/15 text-white text-sm font-medium px-3 py-2.5 rounded-xl transition-colors"
          aria-label="Settings"
        >
          ⚙️
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-4">
          <h2 className="text-[#9ca3af] text-xs uppercase tracking-widest">Body settings</h2>

          {/* Gender */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[#6b7280] text-xs">Biological sex (affects BAC calculation)</label>
            <div className="flex gap-2">
              {(['male', 'female'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setSettingsDraft(d => ({ ...d, gender: g }))}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
                    settingsDraft.gender === g
                      ? 'bg-[#ffd166] text-[#080604]'
                      : 'bg-white/5 text-[#9ca3af] hover:bg-white/10'
                  }`}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Weight */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[#6b7280] text-xs">Body weight</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={40}
                max={200}
                step={1}
                value={settingsDraft.weightKg}
                onChange={e => setSettingsDraft(d => ({ ...d, weightKg: Number(e.target.value) }))}
                className="flex-1 accent-[#ffd166]"
              />
              <span className="text-white text-sm font-mono w-14 text-right">
                {settingsDraft.weightKg} kg
              </span>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={saveSettings}
              disabled={settingsSaving}
              className="flex-1 bg-[#ffd166] hover:bg-[#ffd166]/90 disabled:opacity-50 text-[#080604] text-sm font-bold py-2.5 rounded-xl transition-colors"
            >
              {settingsSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setShowSettings(false)}
              className="px-4 bg-white/5 hover:bg-white/10 text-[#9ca3af] text-sm rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* PIN display */}
      {pin && (
        <PinDisplay pin={pin} onClose={() => setPin(null)} />
      )}

      {/* Drink list */}
      <DrinkList
        checkins={checkins}
        pendingIds={pendingCheckinIds}
        onServingChange={setServing}
        now={now}
      />

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
