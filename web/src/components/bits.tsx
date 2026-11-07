import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { appStatusLabel, fmtDateTime, initial, relDay, relTime, TARGET_DAYS, TARGET_TESTERS, testerStatusLabel } from '../lib/progress'
import { IconClose, IconExternal, IconMore } from './icons'
import { errorText } from '../lib/data'
import { BADGE_LABELS, BADGE_MIN, nextTier } from '../lib/badges'
import type { AppStatus, BadgeTier, TesterDoc } from '../lib/types'

/** Google photo inside an ink circle; otherwise the initial on white (no generated colours, ADR-001 §2.6). */
export function Avatar({ name, photo, size }: { name: string; photo?: string | null; id?: string; size?: 'lg' }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className={`avatar ${size ?? ''}`} aria-hidden="true">
      {photo && !broken ? <img src={photo} alt="" width={size === 'lg' ? 64 : 32} height={size === 'lg' ? 64 : 32} onError={() => setBroken(true)} referrerPolicy="no-referrer" /> : initial(name)}
    </span>
  )
}

// ---------- status chips: square, ink border, one status fill, glyph + uppercase text ----------
type Tone = 'pandan' | 'langit' | 'cabai' | 'soft' | 'putih'

export function Chip({ tone = 'putih', glyph, children, className }: { tone?: Tone; glyph: string; children: ReactNode; className?: string }) {
  return (
    <span className={`chip ${tone} ${className ?? ''}`}>
      <span className="g" aria-hidden="true">{glyph}</span>{children}
    </span>
  )
}

/** App status. Mencari tester = needs attention (white + "!"), Sedang diuji = in progress (langit),
 *  Ajukan produksi / Rilis produksi = done (pandan, ✓ / ✓✓). */
const APP_TONE: Record<AppStatus, [Tone, string]> = {
  recruiting: ['putih', '!'],
  testing: ['langit', '→'],
  applied: ['pandan', '✓'],
  live: ['pandan', '✓✓'],
}
export const StatusPill = ({ status }: { status: AppStatus }) => (
  <Chip tone={APP_TONE[status][0]} glyph={APP_TONE[status][1]}>{appStatusLabel[status]}</Chip>
)

/** Tester status: eligible (14+ days) is pandan, active is langit (opted in), the rest stay white.
 *  A tester's own 14 days (badges, reciprocity) can end before the app's counted 14 days (all seats at once),
 *  so "Lulus" is said only once the app passed too; before that the chip asks them to stay. `appPassed`
 *  undefined (admin list, no app clock at hand) shows the plain day mark. */
export function TesterChip({ t, days, appPassed }: { t: TesterDoc; days: number; appPassed?: boolean }) {
  if (t.status === 'active' && days >= TARGET_DAYS) {
    const label = appPassed === undefined ? '14 hari' : appPassed ? 'Lulus 14 hari' : '14 hari · tetap ikut'
    return <Chip tone="pandan" glyph="✓">{label}</Chip>
  }
  if (t.status === 'active') return <Chip tone="langit" glyph="→">{testerStatusLabel.active}</Chip>
  return <Chip glyph={t.status === 'removed' ? '×' : '—'}>{testerStatusLabel[t.status]}</Chip>
}

/** Feedback state: none / sent / verified (PRD DR-3). */
export function FeedbackChip({ t, className }: { t: Pick<TesterDoc, 'feedbackSent' | 'feedbackVerified'>; className?: string }) {
  if (t.feedbackVerified) return <Chip tone="pandan" glyph="✓✓" className={className}>Terverifikasi</Chip>
  if (t.feedbackSent) return <Chip tone="langit" glyph="✓" className={className}>Terkirim</Chip>
  return <Chip glyph="—" className={className}>Belum</Chip>
}

// ---------- progress: counted cells, not a smooth bar ----------

/** One cell per tester slot (12 by default, ADR-012): eligible (≥14 days) pandan, active langit, empty white. */
export function Seats({ active, eligible = 0, total = TARGET_TESTERS, label, className }: { active: number; eligible?: number; total?: number; label?: string; className?: string }) {
  return (
    <span className={`seats ${className ?? ''}`} style={{ '--n': total } as CSSProperties} role="img" aria-label={label ?? `${active} dari ${total} tester aktif`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < Math.min(eligible, total) ? 'full' : i < Math.min(active, total) ? 'on' : ''} />
      ))}
    </span>
  )
}

/** A ruled track of `max` cells (12 testers, 14 days, a tier threshold). Langit while counting,
 *  pandan once complete; `tone="ubi"` for badge progress only. Optional tabular "X / max" readout. */
export function Bar({ value, max, label, tone, readout = false }: { value: number; max: number; label: string; tone?: 'ubi'; readout?: boolean }) {
  const v = Math.max(0, Math.min(value, max))
  const done = v >= max
  const segmented = max <= 30
  return (
    <div className="meter">
      <div
        className={`cells ${segmented ? '' : 'solid'} ${done && tone !== 'ubi' ? 'done' : ''} ${tone ?? ''}`}
        style={{ ['--n' as string]: segmented ? max : 1 }}
        role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={v} aria-valuetext={`${v} dari ${max}`}
      >
        {segmented
          ? Array.from({ length: max }, (_, i) => <i key={i} className={i < v ? 'on' : ''} />)
          : <i style={{ width: `${(v / max) * 100}%` }} />}
      </div>
      {readout && <span className="meter-readout num" aria-hidden="true">{v}<small> / {max}</small></span>}
    </div>
  )
}

/** Typographic rank mark per tier: the order reads without colour (PRD DR-3, no medal icons). */
const BADGE_MARK: Record<Exclude<BadgeTier, 'none'>, string> = { bronze: 'I', silver: 'II', gold: 'III', platinum: 'IV' }

/** Reciprocity badge (PRD FR-27g–l): pill, ink border, tier fill from --tier-*, tier name in text. */
export function Badge({ tier, size }: { tier: BadgeTier | undefined; size?: 'sm' }) {
  if (!tier || tier === 'none') return null
  const label = BADGE_LABELS[tier]
  return (
    <span className={`badge ${tier} ${size ?? ''}`} title={`Badge ${label}: ${BADGE_MIN[tier]}+ aplikasi diuji 14 hari`}>
      <span className="badge-mark" aria-hidden="true">{BADGE_MARK[tier]}</span>
      <span className="sr-only">Badge </span>{label}
    </span>
  )
}

/** Progress from the apps-tested count to the next tier threshold (FR-27k). */
export function TierProgress({ count, tier, nextAt }: { count: number; tier: BadgeTier; nextAt: number | null }) {
  const next = nextTier(tier)
  if (!next || nextAt === null) {
    return <p className="small muted" style={{ marginTop: 'var(--s-2)' }}>{count} aplikasi diuji 14+ hari. Platinum adalah tingkat tertinggi.</p>
  }
  const label = BADGE_LABELS[next]
  return (
    <div className="tier-progress">
      <Bar value={Math.min(count, nextAt)} max={nextAt} label={`Progres menuju badge ${label}`} tone="ubi" />
      <p className="small muted num"><span className="tier-count">{count} / {nextAt}</span> aplikasi menuju {label}</p>
    </div>
  )
}

export function Dialog({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className="sheet" aria-label={label} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose() }}>
      {open && children}
    </dialog>
  )
}

/** Form field (ADR-009 §6): label above, helper text always visible, error text below it (never replacing it).
 *  The error slot is a live region that exists before the error does, so screen readers announce it. */
export function Field({ id, label, optional, hint, error, count, children }: {
  id: string; label: ReactNode; optional?: boolean; hint?: ReactNode; error?: string; count?: ReactNode; children: ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}{optional && <span className="opt"> (opsional)</span>}</label>
      {children}
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      <span className={error ? 'hint err' : 'sr-only'} id={`${id}-err`} aria-live="polite">{error}</span>
      {count && <span className="count num" aria-hidden="true">{count}</span>}
    </div>
  )
}
/** aria wiring for a control inside <Field>. */
export const fieldAria = (id: string, opts: { hint?: boolean; error?: string }) => ({
  id,
  'aria-invalid': opts.error ? true : undefined,
  'aria-describedby': [opts.hint && `${id}-hint`, opts.error && `${id}-err`].filter(Boolean).join(' ') || undefined,
})

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span className="g" aria-hidden="true">!</span>
      <span>{text}</span>
      {onRetry && <button type="button" className="text-action" onClick={onRetry}>Coba lagi</button>}
    </div>
  )
}

/** Designed empty state. ADR-001 §2.6 wants a spot illustration here (empty tester list, empty
 *  Tugas saya, 404); add it once the asset pipeline exists, via the `art` slot. */
export function Empty({ title, children, art }: { title: string; children?: ReactNode; art?: ReactNode }) {
  return (
    <div className="empty">
      {art}
      <p className="t">{title}</p>
      {children}
    </div>
  )
}

export const Skel = ({ w, h = 14 }: { w: number | string; h?: number }) => (
  <span className="skeleton" style={{ width: w, height: h, maxWidth: '100%' }} aria-hidden="true" />
)

export function NotFound({ what }: { what: string }) {
  // ADR-001 §2.6: 404 spot illustration goes above the title when assets exist.
  return (
    <div className="state-page">
      <h1 className="page-title">{what} tidak ditemukan</h1>
      <p>Mungkin sudah dihapus pembuatnya, atau tautannya salah ketik.</p>
      <Link className="btn primary" to="/apps">Kembali ke daftar aplikasi</Link>
    </div>
  )
}

// ---------- toast (ADR-009 §8) ----------
/** A plain string is a success toast that leaves after 4 s. Errors and toasts with an action stay until
 *  closed, unless `duration` is set (e.g. "Urungkan" for 8 s). Hover or focus pauses the timer (WCAG 2.2.1). */
export interface ToastInput {
  text: string
  tone?: 'ok' | 'error'
  action?: { label: string; onClick: () => void }
  duration?: number
}
type ToastItem = ToastInput & { id: number }
type ToastFn = (m: string | ToastInput) => void
const ToastCtx = createContext<ToastFn>(() => {})
const SUCCESS_MS = 4000
const MAX_TOASTS = 3

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const show = useCallback<ToastFn>((m) => {
    const t: ToastInput = typeof m === 'string' ? { text: m } : m
    const id = ++seq.current
    setItems((xs) => [...xs, { ...t, id }].slice(-MAX_TOASTS))
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-region" aria-live="polite">
        {items.map((t) => <Toast key={t.id} t={t} onClose={() => dismiss(t.id)} />)}
      </div>
    </ToastCtx.Provider>
  )
}

function Toast({ t, onClose }: { t: ToastItem; onClose: () => void }) {
  const ms = t.duration ?? (t.tone === 'error' || t.action ? null : SUCCESS_MS)
  const [paused, setPaused] = useState(false)
  const left = useRef(ms ?? 0)
  useEffect(() => {
    if (ms == null || paused) return
    const start = Date.now()
    const timer = window.setTimeout(onClose, left.current)
    return () => { window.clearTimeout(timer); left.current -= Date.now() - start }
  }, [ms, paused, onClose])
  return (
    <div
      className={`toast ${t.tone === 'error' ? 'error' : ''}`}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
    >
      {t.tone === 'error' && <span className="g" aria-hidden="true">!</span>}
      <span className="toast-text">{t.text}</span>
      {t.action && (
        <button type="button" className="text-action" onClick={() => { t.action!.onClick(); onClose() }}>{t.action.label}</button>
      )}
      {(ms == null || t.action) && (
        <button type="button" className="toast-close" aria-label="Tutup pemberitahuan" onClick={onClose}><IconClose /></button>
      )}
    </div>
  )
}
export const useToast = () => useContext(ToastCtx)
/** An error toast: the RPC's Indonesian message (it already says what to do), plus an optional next step. */
export const failToast = (e: unknown, next?: string): ToastInput => ({ text: next ? `${errorText(e)} ${next}` : errorText(e), tone: 'error' })

// ---------- relative time: "2 jam yang lalu", exact WIB time on hover (title) and on tap ----------
export function RelTime({ t, day = false }: { t: number; day?: boolean }) {
  const [exact, setExact] = useState(false)
  const full = fmtDateTime(t)
  return (
    <button type="button" className="reltime num" title={full} onClick={() => setExact((x) => !x)}>
      <time dateTime={new Date(t).toISOString()}>{exact ? full : day ? relDay(t) : relTime(t)}</time>
    </button>
  )
}

/** "Lihat semua (N)" / "Tampilkan lebih sedikit" for long related lists (ADR-009 §4). */
export function ShowAll({ open, total, onToggle, controls }: { open: boolean; total: number; onToggle: () => void; controls: string }) {
  return (
    <button type="button" className="text-action show-all num" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {open ? 'Tampilkan lebih sedikit' : `Lihat semua (${total})`}
    </button>
  )
}

// ---------- overflow menu ("…"): button + menu, Escape closes, arrow keys move (ADR-009 §7) ----------
export interface MenuItem { label: string; onSelect?: () => void; href?: string; to?: string; danger?: boolean }

export function OverflowMenu({ items, label = 'Aksi lain' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const [align, setAlign] = useState<'right' | 'left'>('right')
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const close = useCallback((focusBack = true) => { setOpen(false); if (focusBack) btn.current?.focus() }, [])

  // Keep the menu on screen: open leftwards when the button sits too close to the left edge (375 px phones).
  useLayoutEffect(() => {
    if (!open || !btn.current || !menu.current) return
    const w = menu.current.getBoundingClientRect().width
    setAlign(btn.current.getBoundingClientRect().right - w < 8 ? 'left' : 'right')
  }, [open])

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, close])

  const onKey = (e: React.KeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'Tab') close(false)
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus() }
  }

  if (items.length === 0) return null
  return (
    <span className="menu-host">
      <button
        ref={btn} type="button" className="btn icon" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
      >
        <IconMore />
      </button>
      {open && (
        <div ref={menu} id={id} className="menu" data-align={align} role="menu" aria-label={label} onKeyDown={onKey}>
          {items.map((it) => {
            const cls = `menu-item ${it.danger ? 'danger' : ''}`
            const done = () => close(false)
            if (it.href) return <a key={it.label} role="menuitem" tabIndex={-1} className={cls} href={it.href} target="_blank" rel="noreferrer" onClick={done}>{it.label}<IconExternal /></a>
            if (it.to) return <Link key={it.label} role="menuitem" tabIndex={-1} className={cls} to={it.to} onClick={done}>{it.label}</Link>
            return <button key={it.label} type="button" role="menuitem" tabIndex={-1} className={cls} onClick={() => { close(); it.onSelect?.() }}>{it.label}</button>
          })}
        </div>
      )}
    </span>
  )
}
