'use client';

import { useState, useEffect, useCallback } from 'react';
import { bacLabel, bacColor, formatDuration, resolveServingMl } from '@/lib/bac';
import type { CachedCheckin } from '@/lib/kv';

interface Props {
  username: string;
  weightKg: number;
  gender: 'male' | 'female';
  defaultServingMl: number | null;
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
  const [flashPhase, setFlashPhase] = useState(false);
  const flashing = bac !== null && bac >= 0.20;

  useEffect(() => {
    if (!flashing) { setFlashPhase(false); return; }
    const t = setInterval(() => setFlashPhase(p => !p), 500);
    return () => clearInterval(t);
  }, [flashing]);

  const baseColor = bac !== null ? bacColor(bac) : '#080604';
  const color = flashing ? (flashPhase ? '#1e40af' : '#dc2626') : baseColor;
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
        transition: flashing ? 'none' : 'background-color 0.6s ease',
      }}
    >
      {/* BAC number + unit labels */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className="text-5xl font-black tabular-nums"
            style={{ color: isDark ? '#f3f4f6' : '#ffffff' }}
          >
            {bac !== null ? bac.toFixed(2) : '—'}
          </span>
          {bac !== null && (
            <div className="flex flex-col justify-center pb-0.5">
              <span className="text-sm font-bold leading-tight" style={{ color: isDark ? '#f3f4f6' : '#ffffff' }}>%BAC</span>
              <span className="text-xs leading-tight text-[#9ca3af]">(est)</span>
            </div>
          )}
        </div>

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
  if (bac < 0.02) return null; // SOBER — no line needed
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

function toDatetimeLocal(ms: number): string {
  const d   = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function BacWarning({ bac }: { bac: number | null }) {
  if (bac === null || bac < 0.05) return null;
  const isDontWalk = bac >= 0.20;
  return (
    <span
      className="font-black text-sm tracking-[0.2em] px-4 py-2 rounded-xl text-white"
      style={{ backgroundColor: isDontWalk ? '#1e40af' : '#dc2626' }}
    >
      {isDontWalk ? '⚠️ DO NOT WALK' : 'DO NOT DRIVE'}
    </span>
  );
}

const PHANTOM_DEFAULT = { beerName: '', abv: '5.0', volumeMl: '375', createdAtMs: '' };

function RepeatIcon() {
  return (
    <svg viewBox="0 0 24 16" width="29" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="22" height="14" rx="7" stroke="#ffd166" strokeWidth="1.8"/>
      <path d="M9 8 Q9 5 12 5 Q15 5 15 8 Q15 11 12 11 L9.5 11" stroke="#9ca3af" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
      <path d="M11 9.6 L9.5 11 L11 12.4" stroke="#9ca3af" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function DrinkList({
  checkins,
  pendingIds,
  onServingChange,
  onPhantomAdd,
  onPhantomRemove,
  defaultServingMl,
  now,
}: {
  checkins: CachedCheckin[];
  pendingIds: Set<number>;
  onServingChange: (checkinId: number, volumeMl: number | null) => Promise<void>;
  onPhantomAdd: (data: { beerName: string; abv: number; volumeMl: number; createdAtMs: number; repeat?: boolean }) => Promise<void>;
  onPhantomRemove: (checkinId: number) => Promise<void>;
  defaultServingMl: number | null;
  now: number;
}) {
  const [showForm, setShowForm]   = useState(false);
  const [draft, setDraft]         = useState(PHANTOM_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [isRepeat, setIsRepeat]   = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const cutoff = now - 24 * 60 * 60_000;
  const recent = checkins.filter(c => c.createdAtMs >= cutoff).sort((a, b) => b.createdAtMs - a.createdAtMs);

  const openForm = () => {
    setDraft({ ...PHANTOM_DEFAULT, createdAtMs: toDatetimeLocal(Date.now()) });
    setIsRepeat(false);
    setShowForm(true);
  };

  const submit = async () => {
    if (!draft.beerName.trim()) return;
    const abv         = parseFloat(draft.abv);
    const volumeMl    = parseInt(draft.volumeMl, 10);
    const createdAtMs = new Date(draft.createdAtMs).getTime();
    if (isNaN(abv) || isNaN(volumeMl) || isNaN(createdAtMs)) return;
    setSubmitting(true);
    try {
      await onPhantomAdd({ beerName: draft.beerName.trim(), abv, volumeMl, createdAtMs, repeat: isRepeat });
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-sm mt-2">
      {/* Header row with + button */}
      <div className="flex items-center justify-between px-1 mb-2">
        <h2 className="text-[#6b7280] text-xs uppercase tracking-widest">
          Recent drinks · 24h window
        </h2>
        <button
          onClick={openForm}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-[#ffd166]/10 hover:bg-[#ffd166]/20 text-[#ffd166] text-lg leading-none transition-colors"
          aria-label="Add phantom beer"
        >
          +
        </button>
      </div>

      {/* Phantom add form */}
      {showForm && (
        <div className="flex flex-col bg-[#ffd166]/5 border border-[#ffd166]/20 rounded-xl px-4 py-3 gap-3 mb-2">
          <p className="text-[#ffd166] text-xs font-bold uppercase tracking-wider">Add phantom beer</p>

          <input
            type="text"
            placeholder="Beer name"
            value={draft.beerName}
            onChange={e => setDraft(d => ({ ...d, beerName: e.target.value }))}
            className="w-full text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white placeholder-[#4b5563] focus:outline-none focus:border-[#ffd166]/40"
          />

          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[#6b7280] text-xs">ABV %</label>
              <input
                type="number"
                min="0" max="25" step="0.1"
                value={draft.abv}
                onChange={e => setDraft(d => ({ ...d, abv: e.target.value }))}
                className="w-full text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-[#ffd166]/40"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[#6b7280] text-xs">Volume (ml)</label>
              <input
                type="number"
                min="50" max="2000" step="5"
                value={draft.volumeMl}
                onChange={e => setDraft(d => ({ ...d, volumeMl: e.target.value }))}
                className="w-full text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-[#ffd166]/40"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[#6b7280] text-xs">Date &amp; time</label>
            <input
              type="datetime-local"
              value={draft.createdAtMs}
              onChange={e => setDraft(d => ({ ...d, createdAtMs: e.target.value }))}
              className="w-full text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-[#ffd166]/40"
              style={{ colorScheme: 'dark' }}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={submitting || !draft.beerName.trim()}
              className="flex-1 bg-[#ffd166] hover:bg-[#ffd166]/90 disabled:opacity-50 text-[#080604] text-sm font-bold py-2 rounded-xl transition-colors"
            >
              {submitting ? 'Adding…' : 'Add Beer'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 bg-white/5 hover:bg-white/10 text-[#9ca3af] text-sm rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Drink list */}
      {recent.length > 0 && (
        <div className="flex flex-col gap-2">
          {recent.map((c, i) => {
            const pending = pendingIds.has(c.checkinId ?? -1);

            if (c.phantom) {
              return (
                <div
                  key={c.checkinId ?? i}
                  className="flex flex-col bg-[#ffd166]/5 border border-[#ffd166]/15 rounded-xl px-4 py-3 gap-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-white truncate">{c.beerName}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#ffd166]/15 text-[#ffd166] uppercase tracking-wide flex-shrink-0">Manual</span>
                        {c.repeat && <span className="text-xs font-bold text-[#ffd166]">Ⓡ</span>}
                      </div>
                      <span className="text-xs text-[#6b7280]">{c.volumeMlOverride} ml</span>
                    </div>
                    <div className="flex items-start gap-2 flex-shrink-0">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-xs text-[#ffd166] font-mono">{c.abv.toFixed(1)}%</span>
                        <span className="text-xs text-[#4b5563]">{timeSince(c.createdAtMs, now)}</span>
                      </div>
                      <button
                        onClick={() => {
                          setDraft({
                            beerName: c.beerName,
                            abv: c.abv.toString(),
                            volumeMl: String(c.volumeMlOverride ?? resolveServingMl(c.servingType, undefined, defaultServingMl ?? undefined)),
                            createdAtMs: toDatetimeLocal(Date.now()),
                          });
                          setIsRepeat(true);
                          setShowForm(true);
                        }}
                        disabled={pending}
                        className="opacity-70 hover:opacity-100 disabled:opacity-30 transition-opacity mt-0.5"
                        aria-label="Re-add as manual"
                      >
                        <RepeatIcon />
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(c.checkinId)}
                        disabled={pending}
                        className="text-[#4b5563] hover:text-red-400 disabled:opacity-40 transition-colors text-xl leading-none mt-0.5"
                        aria-label="Delete manual beer"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={c.checkinId ?? i}
                className="flex flex-col bg-white/5 rounded-xl px-4 py-3 gap-2"
              >
                {/* Top row: beer info + ABV + time + repeat */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium text-white truncate">{c.beerName}</span>
                    <span className="text-xs text-[#6b7280] truncate">{c.breweryName}</span>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#ffd166] font-mono">{c.abv.toFixed(1)}%</span>
                      <button
                        onClick={() => {
                          setDraft({
                            beerName: c.beerName,
                            abv: c.abv.toString(),
                            volumeMl: String(resolveServingMl(c.servingType, c.volumeMlOverride, defaultServingMl ?? undefined)),
                            createdAtMs: toDatetimeLocal(Date.now()),
                          });
                          setShowForm(true);
                        }}
                        disabled={pending}
                        className="opacity-70 hover:opacity-100 disabled:opacity-30 transition-opacity"
                        aria-label="Re-add as phantom"
                      >
                        <RepeatIcon />
                      </button>
                    </div>
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
                      {opt.ml === null
                        ? `${resolveServingMl(c.servingType, undefined, defaultServingMl ?? undefined)} ml`
                        : opt.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="w-full bg-[#1a1816] rounded-t-2xl px-4 py-4 gap-3 flex flex-col">
            <p className="text-white font-semibold">Delete this beer?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onPhantomRemove(deleteConfirmId);
                  setDeleteConfirmId(null);
                }}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
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
  defaultServingMl: initialDefaultServingMl,
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

  const [weightKg,        setWeightKg]        = useState(initialWeight);
  const [gender,          setGender]          = useState<'male' | 'female'>(initialGender);
  const [defaultServingMl, setDefaultServingMl] = useState<number | null>(initialDefaultServingMl);
  const [showSettings,    setShowSettings]    = useState(false);
  const [settingsSaving,  setSettingsSaving]  = useState(false);
  const [settingsDraft,   setSettingsDraft]   = useState({
    weightKg:        initialWeight,
    gender:          initialGender as 'male' | 'female',
    defaultServingMl: initialDefaultServingMl as number | null,
  });

  const [syncing,      setSyncing]      = useState(false);
  const [syncError,    setSyncError]    = useState<string | null>(null);
  const [pin,          setPin]          = useState<string | null>(null);
  const [pairLoading,  setPairLoading]  = useState(false);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST', credentials: 'include' });
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
        credentials: 'include',
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

  const addPhantom = useCallback(async (data: {
    beerName: string; abv: number; volumeMl: number; createdAtMs: number; repeat?: boolean;
  }) => {
    const res = await fetch('/api/phantom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include',
    });
    if (!res.ok) return;
    const result = await res.json();
    setBac(result.bac);
    setSoberMs(result.soberMs);
    setDrinkCount(result.drinkCount);
    setCalculatedAt(result.calculatedAt);
    setCheckins(result.checkins);
  }, []);

  const removePhantom = useCallback(async (checkinId: number) => {
    setPendingCheckinIds(s => { const n = new Set(s); n.add(checkinId); return n; });
    try {
      const res = await fetch(`/api/checkins/${checkinId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) return;
      const result = await res.json();
      setBac(result.bac);
      setSoberMs(result.soberMs);
      setDrinkCount(result.drinkCount);
      setCalculatedAt(result.calculatedAt);
      setCheckins(result.checkins);
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
        body: JSON.stringify({
          weightKg:        settingsDraft.weightKg,
          gender:          settingsDraft.gender,
          defaultServingMl: settingsDraft.defaultServingMl,
        }),
        credentials: 'include',
      });
      if (!res.ok) return;
      const data: SettingsResult = await res.json();
      setWeightKg(settingsDraft.weightKg);
      setGender(settingsDraft.gender);
      setDefaultServingMl(settingsDraft.defaultServingMl);
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
      const res = await fetch('/api/pair', { method: 'POST', credentials: 'include' });
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
    <main className="min-h-screen bg-[#080604] flex flex-col items-center px-4 py-4 gap-4">

      {/* Header */}
      <div className="w-full max-w-sm flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/unbacd.png" alt="un'bac'd" width={36} height={36} className="rounded-lg" />
          <h1 className="text-2xl font-black text-[#ffd166] tracking-widest">un'bac'd</h1>
        </div>
        <span className="text-[#6b7280] text-xs">@{username}</span>
      </div>

      {/* BAC circle + all status messages grouped tightly */}
      <div className="flex flex-col items-center gap-2">
        <BacCircle bac={bac} />

        {/* Sober time */}
        <SoberLine bac={bac} soberMs={soberMs} />

        {/* DO NOT DRIVE / DO NOT WALK warning */}
        <BacWarning bac={bac} />

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
      </div>

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
          onClick={() => { setSettingsDraft({ weightKg, gender, defaultServingMl }); setShowSettings(s => !s); }}
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

          {/* Default serving size */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[#6b7280] text-xs">Default serving size</label>
            <select
              value={settingsDraft.defaultServingMl ?? ''}
              onChange={e => setSettingsDraft(d => ({ ...d, defaultServingMl: e.target.value === '' ? null : Number(e.target.value) }))}
              className="w-full text-sm bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#ffd166]/40 cursor-pointer"
              style={{ colorScheme: 'dark' }}
            >
              <option value="" style={{ backgroundColor: '#1a1816' }}>Beer style (auto)</option>
              {SERVING_OPTIONS.filter(o => o.ml !== null).map(opt => (
                <option key={opt.ml} value={opt.ml!} style={{ backgroundColor: '#1a1816' }}>
                  {opt.label}
                </option>
              ))}
            </select>
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
        onPhantomAdd={addPhantom}
        onPhantomRemove={removePhantom}
        defaultServingMl={defaultServingMl}
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
