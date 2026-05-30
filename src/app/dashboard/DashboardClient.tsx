'use client';

import { useState, useEffect, useCallback } from 'react';
import { bacLabel, bacColor, formatDuration, resolveServingMl, calculateBac } from '@/lib/bac';
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

function BacCircle({
  bac,
  soberText,
  drinkCount,
  lastSyncText,
}: {
  bac: number | null;
  soberText: string | null;
  drinkCount: number | null;
  lastSyncText: string;
}) {
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
      {/* Subtle embossed watermark below last sync */}
      <div className="absolute top-[41px] left-1/2 pointer-events-none select-none z-0" style={{ transform: 'translateX(-50%)' }}>
        <span
          className="text-[11px] font-semibold tracking-[0.18em] uppercase whitespace-nowrap"
          style={{
            color: 'rgba(255,255,255,0.10)',
            textShadow: '0 1px 1px rgba(255,255,255,0.12), 0 -1px 1px rgba(0,0,0,0.35)',
          }}
        >
          Powered by Untappd
        </span>
      </div>

      {/* BAC number + unit labels */}
      <div className="flex flex-col items-center gap-1 relative z-10">
        <div className="flex items-center gap-1.5">
          <span
            className="font-black tabular-nums"
            style={{ fontSize: '50px', color: isDark ? '#f3f4f6' : '#ffffff' }}
          >
            {bac !== null ? bac.toFixed(2) : '—'}
          </span>
          {bac !== null && (
            <div className="flex flex-col justify-center pb-0.5">
              <span className="text-sm font-bold leading-tight" style={{ color: isDark ? '#f3f4f6' : '#ffffff' }}>%BAC</span>
              <span className="text-xs leading-tight text-white">(est)</span>
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

      {/* Last sync at top of circle, lowered ~2mm */}
      <div className="absolute top-3 left-1/2 z-10" style={{ transform: 'translate(-50%, 8px)' }}>
        <p className="text-[12px] font-semibold whitespace-nowrap" style={{ color: isDark ? '#9ca3af' : '#f3f4f6' }}>
          {lastSyncText}
        </p>
      </div>

      {/* Compact status block inside circle */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 leading-tight z-10">
        {soberText && (
          <p className="text-[12px] font-semibold whitespace-nowrap" style={{ color: isDark ? '#9ca3af' : '#f3f4f6' }}>
            {soberText}
          </p>
        )}
        {drinkCount !== null && (
          <p className="text-[12px] font-semibold whitespace-nowrap" style={{ color: isDark ? '#9ca3af' : '#f3f4f6' }}>
            {drinkCount} {drinkCount === 1 ? 'drink' : 'drinks'} · 24h
          </p>
        )}
      </div>
    </div>
  );
}

function getSoberText(bac: number | null, soberMs: number | null): string | null {
  if (bac === null) return null;
  if (bac < 0.02) return null; // SOBER — no line needed
  if (!soberMs || soberMs <= 0) {
    return 'Sober now';
  }
  return `Sober in ${formatDuration(soberMs)}`;
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

// Map BAC to border color gradient: green -> yellow -> red
function bacToBorderColor(bac: number): string {
  if (bac < 0.02)  return '#22c55e';  // green - sober
  if (bac < 0.04)  return '#84cc16';  // lime - trace
  if (bac < 0.06)  return '#eab308';  // yellow - tipsy start
  if (bac < 0.10)  return '#f59e0b';  // amber - caution
  if (bac < 0.15)  return '#ff6b35';  // orange - over limit
  return '#ef4444';                   // red - danger
}

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
  weightKg,
  gender,
  now,
}: {
  checkins: CachedCheckin[];
  pendingIds: Set<number>;
  onServingChange: (checkinId: number, volumeMl: number | null) => Promise<void>;
  onPhantomAdd: (data: { beerName: string; abv: number; volumeMl: number; createdAtMs: number; repeat?: boolean }) => Promise<void>;
  onPhantomRemove: (checkinId: number) => Promise<void>;
  defaultServingMl: number | null;
  weightKg: number;
  gender: 'male' | 'female';
  now: number;
}) {
  const [showForm, setShowForm]   = useState(false);
  const [draft, setDraft]         = useState(PHANTOM_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [isRepeat, setIsRepeat]   = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const cutoff = now - 24 * 60 * 60_000;
  const recent = checkins.filter(c => c.createdAtMs >= cutoff).sort((a, b) => b.createdAtMs - a.createdAtMs);

  // Helper to get BAC at the time a specific beer was consumed
  const getBacAtTime = useCallback((targetCheckin: CachedCheckin) => {
    const beersUpToTarget = checkins.filter(c => c.createdAtMs <= targetCheckin.createdAtMs);
    const result = calculateBac(beersUpToTarget, weightKg, gender, defaultServingMl ?? undefined, targetCheckin.createdAtMs);
    return result.bac;
  }, [checkins, weightKg, gender, defaultServingMl]);

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
    <div className="w-full max-w-sm mt-1 flex flex-col flex-1 min-h-0">
      {/* Header row with + button */}
      <div className="flex items-center justify-between px-1 mb-2">
        <h2 className="text-[#9ca3af] text-xs uppercase tracking-widest">
          Recent drinks · 24h window
        </h2>
        <button
          onClick={openForm}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-[#ffd166]/10 hover:bg-[#ffd166]/20 text-[#ffd166] text-[20px] leading-none transition-colors"
          aria-label="Add manual beer"
        >
          +
        </button>
      </div>

      {/* Manual beer add form */}
      {showForm && (
        <div className="flex flex-col bg-[#ffd166]/5 border border-[#ffd166]/20 rounded-xl px-4 py-3 gap-3 mb-2">
          <p className="text-[#ffd166] text-xs font-bold uppercase tracking-wider">Add manual beer</p>

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
      <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto pr-2">
        {recent.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[#6b7280] text-xs">
            No drinks in the last 24h.
          </div>
        ) : (
          recent.map((c, i) => {
            const pending = pendingIds.has(c.checkinId ?? -1);
            const next = recent[i + 1];
            const gapHours = next ? (c.createdAtMs - next.createdAtMs) / 3_600_000 : 0;
            const hasGapTile = gapHours > 4;
            const gapHoursRounded = Math.round(gapHours * 10) / 10;
            const gapHoursLabel = Number.isInteger(gapHoursRounded)
              ? gapHoursRounded.toFixed(0)
              : gapHoursRounded.toFixed(1);

            if (c.phantom) {
              const bacAtTime = getBacAtTime(c);
              const borderColor = bacToBorderColor(bacAtTime);
              return (
                <div key={c.checkinId ?? i} className="flex flex-col gap-2">
                  <div
                    className="flex flex-col bg-white/5 rounded-xl px-4 py-3 gap-2"
                    style={{ border: `2px solid ${borderColor}` }}
                  >
                    {/* Top row: beer info + ABV + time + repeat */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium text-white truncate">{c.beerName}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#ffd166]/15 text-[#ffd166] uppercase tracking-wide flex-shrink-0">Manual</span>
                          {c.repeat && <span className="text-xs font-bold text-[#ffd166]">Ⓡ</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                        <div className="flex items-center gap-2">
                            <span className="text-[#ffd166] font-mono text-[13.5px] inline-flex items-center h-5 leading-none">{c.abv.toFixed(1)}%</span>
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
                            className="opacity-70 hover:opacity-100 disabled:opacity-30 transition-opacity"
                            aria-label="Re-add as manual"
                          >
                            <RepeatIcon />
                          </button>
                        </div>
                        <span className="text-xs text-[#9ca3af]">{timeSince(c.createdAtMs, now)}</span>
                      </div>
                    </div>
                    {/* Serving size selector + delete button */}
                    <div className="flex items-center gap-2">
                      <select
                        disabled={pending}
                        value={c.volumeMlOverride ?? ''}
                        onChange={e => {
                          const val = e.target.value === '' ? null : Number(e.target.value);
                          onServingChange(c.checkinId!, val);
                        }}
                        className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[#9ca3af] disabled:opacity-40 focus:outline-none focus:border-[#ffd166]/40 cursor-pointer flex-shrink-0"
                        style={{ colorScheme: 'dark', width: '140px' }}
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
                      <button
                        onClick={() => setDeleteConfirmId(c.checkinId)}
                        disabled={pending}
                        className="text-[#9ca3af] hover:text-red-400 disabled:opacity-40 transition-colors text-sm font-medium ml-auto flex-shrink-0"
                        aria-label="Delete manual beer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {hasGapTile && (
                    <div className="border border-white/35 rounded-lg px-3 py-1 text-center text-xs text-[#e5e7eb] bg-white/[0.03]">
                      {gapHoursLabel} hours between beers
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={c.checkinId ?? i} className="flex flex-col gap-2">
                <div
                  className="flex flex-col bg-white/5 rounded-xl px-4 py-3 gap-2"
                  style={{ border: `2px solid ${bacToBorderColor(getBacAtTime(c))}` }}
                >
                  {/* Top row: beer info + ABV + time + repeat */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-white truncate">{c.beerName}</span>
                      <span className="text-xs text-[#6b7280] truncate">{c.breweryName}</span>
                    </div>
                    <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[#ffd166] font-mono text-[13.5px] inline-flex items-center h-5 leading-none">{c.abv.toFixed(1)}%</span>
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
                          aria-label="Re-add as manual"
                        >
                          <RepeatIcon />
                        </button>
                      </div>
                      <span className="text-xs text-[#9ca3af]">{timeSince(c.createdAtMs, now)}</span>
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
                    className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[#9ca3af] disabled:opacity-40 focus:outline-none focus:border-[#ffd166]/40 cursor-pointer flex-shrink-0"
                    style={{ colorScheme: 'dark', width: '140px' }}
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
                {hasGapTile && (
                  <div className="border border-white/35 rounded-lg px-3 py-1 text-center text-xs text-[#e5e7eb] bg-white/[0.03]">
                    {gapHoursLabel} hours between beers
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

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
  const [showLogoutModal, setShowLogoutModal] = useState(false);

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
  const soberText = getSoberText(bac, soberMs);

  return (
    <main
      className="flex flex-col items-center px-4 py-3 gap-3 overflow-hidden"
      style={{
        height: '100dvh',
        backgroundColor: '#080604',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
      }}
    >

      {/* Header */}
      <div className="w-full max-w-sm flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/unbacd.png" alt="un'bac'd" width={36} height={36} className="rounded-lg" />
          <h1 className="text-2xl font-black text-[#ffd166] tracking-widest">un'bac'd</h1>
        </div>
        <button
          onClick={() => setShowLogoutModal(true)}
          className="text-[#6b7280] text-xs hover:text-[#9ca3af] transition-colors cursor-pointer"
        >
          @{username}
        </button>
      </div>

      {/* BAC circle */}
      <div className="flex flex-col items-center gap-2">
        <BacCircle
          bac={bac}
          soberText={soberText}
          drinkCount={drinkCount}
          lastSyncText={lastSyncText}
        />

        {/* DO NOT DRIVE / DO NOT WALK warning */}
        <BacWarning bac={bac} />

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
      {/* Logout modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="bg-[#1a1816] rounded-t-2xl w-full px-4 py-4 flex flex-col gap-3">
            <h2 className="text-white text-sm font-bold">Sign out</h2>
            <p className="text-[#9ca3af] text-xs">Are you sure you want to sign out?</p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 bg-white/10 hover:bg-white/15 text-[#9ca3af] text-sm font-medium py-2.5 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <form action="/api/auth/logout" method="POST" className="flex-1">
                <button
                  type="submit"
                  className="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
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
        weightKg={weightKg}
        gender={gender}
        now={now}
      />

      {/* Footer attribution */}
      <p className="text-[#6b7280] text-xs pb-1">Created by craftbeers.app</p>
    </main>
  );
}
