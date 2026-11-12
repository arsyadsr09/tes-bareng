import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Avatar, Bar, Chip, Dialog, Empty, ErrorBox, failToast, Field, fieldAria, ShowAll, Skel, useToast } from '../components/bits'
import { IconExternal, IconPlus, IconSearch } from '../components/icons'
import { errorText, rows, useFetch, type Row } from '../lib/data'
import {
  addCohortMember, approveCohortRequest, closeCohort, REQUEST_REASON_MAX, rejectCohortRequest, usePendingRequestCounts, usePendingRequests, type CohortRequest, CLOSE_DAY, cohortDay, createCohort, fmtWib, LAST_JOIN_DAY, MIN_APPS, pinnedMessage,
  reassignSlot, removeCohortMember, resetCohort, setCohortLink, settleMember, startCohort,
  useAssignmentStatus, useCohort, useCohortLink, useCohorts, useMemberCandidates, useObligations,
  type Candidate, type CohortDetail, type CohortDoc, type CohortMember, type CohortStatus,
} from '../lib/cohorts'
import { supabase } from '../lib/supabase'
import { CohortChip, StandingChip, useFocusAfterClose } from '../components/cohortBits'
import { fmtDate, fmtDateTime } from '../lib/progress'
import './admin-cohorts.css'

/**
 * Admin › Cohort (PRD §5.6, §6.9 FR-29–31/37, §6.12 FR-49–53; ADR-007; ADR-009 §1, §6, §7).
 * Left: the cohorts, those needing the admin first. Right: the selected cohort, then its WhatsApp link and
 * the pinned-message template. The primary action follows the cohort's state: "Mulai cohort" while Forming.
 * Close, reassign and the reminder panel come with B7.
 */

const DAY = 86_400_000
const WA_PREFIX = 'https://chat.whatsapp.com/'
const NAME_MAX = 50
const DONE_PREVIEW = 4

// Status and standing chips are shared with /cohorts so both surfaces use the same words and glyphs.
const StatusChip = CohortChip

/** k per FR-32: full mesh up to 16 apps, then a ring of 14. */
const ringK = (n: number) => (n <= 16 ? n - 1 : 14)

// The list only knows each cohort's app ids, not standings: one extra read finds the closed cohorts with Owing members.
const NO_OWING = new Map<string, number>()
const useOwingCounts = () =>
  useFetch(async () => {
    const r = await rows<Row[]>(supabase.from('cohort_members').select('cohort_id').eq('standing', 'owing'))
    const m = new Map<string, number>()
    for (const x of r) m.set(x.cohort_id as string, (m.get(x.cohort_id as string) ?? 0) + 1)
    return m
  }, NO_OWING, [])

/** Same fallback as the public pages when a profile has no display name. */
const nameOf = (m: { displayName: string }) => m.displayName || 'Anggota'

const STATUS_ORDER: Record<CohortStatus, number> = { forming: 0, active: 1, closed: 2 }

export function Cohorts() {
  const list = useCohorts()
  const owing = useOwingCounts()
  const pending = usePendingRequestCounts()
  const [params, setParams] = useSearchParams()
  const [focusDetail, setFocusDetail] = useState(false)

  const { attention, done } = useMemo(() => {
    const sorted = [...list.data].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
    return {
      attention: sorted.filter((c) => c.status !== 'closed' || (owing.data.get(c.id) ?? 0) > 0),
      done: sorted.filter((c) => c.status === 'closed' && !(owing.data.get(c.id) ?? 0)),
    }
  }, [list.data, owing.data])

  const selectedId = params.get('cohort') ?? attention[0]?.id ?? done[0]?.id ?? null
  const hrefFor = (id: string) => {
    const p = new URLSearchParams(params)
    p.set('cohort', id)
    return `?${p.toString()}`
  }
  const select = (id: string) => {
    setFocusDetail(true)
    setParams((p) => { const n = new URLSearchParams(p); n.set('cohort', id); return n })
  }
  const reloadList = () => { list.refresh(); owing.refresh(); pending.refresh() }

  return (
    <div className="grid ch-layout">
      <section className="panel flush span-4 ch-index" aria-labelledby="ch-list-h">
        <header><h2 id="ch-list-h">Cohort</h2>{!list.loading && list.data.length > 0 && <span className="meta num">{list.data.length} cohort</span>}</header>
        <CreateCohort count={list.data.length} onCreated={(id) => { reloadList(); select(id) }} />
        {list.error ? (
          <div className="empty-pad"><ErrorBox text="Daftar cohort gagal dimuat." onRetry={list.retry} /></div>
        ) : list.loading ? (
          <div className="ch-group" aria-busy="true" aria-label="Memuat cohort">{[0, 1, 2].map((i) => <div className="ch-row" key={i} aria-hidden="true"><Skel w={160} /><Skel w={120} h={12} /></div>)}</div>
        ) : list.data.length === 0 ? (
          <div className="empty-pad">
            <Empty title="Belum ada cohort.">
              <p>Beri nama di atas untuk membuat cohort pertama. Setelah itu tambahkan minimal {MIN_APPS} creator dengan aplikasinya.</p>
            </Empty>
          </div>
        ) : (
          <>
            <CohortGroup id="ch-g-now" title="Perlu tindakan" items={attention} owing={owing.data} pending={pending.data} selectedId={selectedId} hrefFor={hrefFor} onPick={() => setFocusDetail(true)}
              empty="Tidak ada cohort yang berjalan. Buat cohort baru di atas." />
            {done.length > 0 && (
              <CohortGroup id="ch-g-done" title="Selesai" items={done} owing={owing.data} pending={pending.data} selectedId={selectedId} hrefFor={hrefFor} onPick={() => setFocusDetail(true)} limit={DONE_PREVIEW} />
            )}
          </>
        )}
      </section>

      <div className="span-8 ch-detail">
        {selectedId ? (
          <CohortWork key={selectedId} id={selectedId} focus={focusDetail} onFocused={() => setFocusDetail(false)} onChanged={reloadList} />
        ) : !list.loading && !list.error ? (
          <section className="panel" aria-label="Cohort terpilih">
            <Empty title="Pilih atau buat cohort.">
              <p>Anggota, tombol mulai, link grup WhatsApp dan pesan sematan muncul di sini.</p>
            </Empty>
          </section>
        ) : null}
      </div>
    </div>
  )
}

// ---------- list ----------

function CohortGroup({ id, title, items, owing, pending, selectedId, hrefFor, onPick, limit, empty }: {
  id: string; title: string; items: CohortDoc[]; owing: Map<string, number>; pending: Map<string, number>; selectedId: string | null
  hrefFor: (id: string) => string; onPick: () => void; limit?: number; empty?: string
}) {
  const [all, setAll] = useState(false)
  const shown = limit && !all ? items.slice(0, limit) : items
  return (
    <div className="ch-group">
      <h3 className="ch-group-h" id={`${id}-h`}>{title} <span className="num">({items.length})</span></h3>
      {items.length === 0 ? <p className="meta ch-group-empty">{empty}</p> : (
        <ul id={id} aria-labelledby={`${id}-h`}>
          {shown.map((c) => {
            const owe = owing.get(c.id) ?? 0
            const ask = c.status === 'forming' ? pending.get(c.id) ?? 0 : 0
            return (
              <li key={c.id}>
                <Link to={hrefFor(c.id)} className="ch-row" aria-current={c.id === selectedId ? 'true' : undefined} onClick={onPick}>
                  <span className="ch-row-top"><b>{c.name}</b><StatusChip status={c.status} /></span>
                  <span className="ch-row-meta num">
                    {c.status === 'forming' && <>{c.appCount}/{MIN_APPS} aplikasi · {c.pureTesterCount} tester murni</>}
                    {c.status === 'active' && <>Hari {cohortDay(c)} · {c.appCount} aplikasi</>}
                    {c.status === 'active' && (cohortDay(c) ?? 0) > CLOSE_DAY && <Chip tone="cabai" glyph="!">Lewat Hari {CLOSE_DAY}</Chip>}
                    {c.status === 'closed' && <>Selesai {fmtDate(c.closedAt)}</>}
                    {owe > 0 && <Chip tone="cabai" glyph="!">{owe} berutang</Chip>}
                    {ask > 0 && <Chip tone="langit" glyph="◷">{ask} permintaan</Chip>}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {limit && items.length > limit && <div className="ch-group-more"><ShowAll open={all} total={items.length} onToggle={() => setAll((x) => !x)} controls={id} /></div>}
    </div>
  )
}

function CreateCohort({ count, onCreated }: { count: number; onCreated: (id: string) => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const v = name.trim()
  const fieldErr = !v ? 'Isi nama cohort, misalnya “Cohort #' + (count + 1) + '”.' : v.length > NAME_MAX ? `Nama paling panjang ${NAME_MAX} karakter.` : undefined
  const shownErr = touched ? fieldErr : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setTouched(true)
    if (fieldErr) { input.current?.focus(); return }
    setBusy(true); setErr(null)
    try {
      const id = await createCohort(v)
      toast(`${v} dibuat. Tambahkan creator dan aplikasinya.`)
      setName(''); setTouched(false)
      onCreated(id)
    } catch (x) {
      setErr(errorText(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="ch-create" onSubmit={submit} noValidate>
      <Field id="ch-new" label="Nama cohort baru" hint={`1–${NAME_MAX} karakter. Contoh: Cohort #${count + 1}.`} error={shownErr} count={`${name.length}/${NAME_MAX}`}>
        <input ref={input} className="input" maxLength={NAME_MAX} autoComplete="off" value={name}
          onChange={(e) => { setName(e.target.value); setErr(null) }} onBlur={() => { if (name) setTouched(true) }}
          {...fieldAria('ch-new', { hint: true, error: shownErr })} />
      </Field>
      {err && <ErrorBox text={err} />}
      <button className="btn" aria-busy={busy || undefined}><IconPlus aria-hidden="true" />{busy ? 'Membuat…' : 'Buat cohort'}</button>
    </form>
  )
}

// ---------- the selected cohort ----------

function CohortWork({ id, focus, onFocused, onChanged }: { id: string; focus: boolean; onFocused: () => void; onChanged: () => void }) {
  const d = useCohort(id)
  const heading = useRef<HTMLHeadingElement>(null)
  const c = d.data

  useEffect(() => {
    if (focus && c) { heading.current?.focus(); onFocused() }
  }, [focus, c, onFocused])

  if (d.error) return <section className="panel" aria-label="Cohort terpilih"><ErrorBox text="Cohort ini gagal dimuat." onRetry={d.retry} /></section>
  if (d.loading || c === undefined) return <DetailSkeleton />
  if (c === null) {
    return (
      <section className="panel" aria-label="Cohort terpilih">
        <Empty title="Cohort tidak ditemukan.">
          <p>Mungkin tautannya salah. Pilih cohort dari daftar.</p>
        </Empty>
      </section>
    )
  }
  const changed = () => { d.refresh(); onChanged() }
  return (
    <div className="ch-stack">
      <CohortPanel c={c} heading={heading} onChanged={changed} />
      {c.status === 'active' && <ReassignPanel c={c} />}
      {c.status === 'active' && <ReminderPanel c={c} />}
      <LinkPanel c={c} />
      <PinnedPanel c={c} />
    </div>
  )
}

function CohortPanel({ c, heading, onChanged }: { c: CohortDetail; heading: RefObject<HTMLHeadingElement | null>; onChanged: () => void }) {
  const day = cohortDay(c)
  return (
    <section className="panel ch-main" aria-labelledby="ch-h">
      <div className="ch-head">
        <div className="ch-title">
          <h2 id="ch-h" ref={heading} tabIndex={-1}>{c.name}</h2>
          <p className="ch-meta num">
            <StatusChip status={c.status} />
            {c.status === 'forming' && <span>Dibuat {fmtDate(c.createdAt)}</span>}
            {c.status === 'active' && <span>Hari {day} · dimulai {fmtDateTime(c.day0At)}</span>}
            {c.status === 'active' && (day ?? 0) > CLOSE_DAY && <Chip tone="cabai" glyph="!">Lewat Hari {CLOSE_DAY}</Chip>}
            {c.status === 'closed' && <span>Selesai {fmtDateTime(c.closedAt)}</span>}
          </p>
        </div>
        {c.status === 'forming' && <StartAction c={c} heading={heading} onStarted={onChanged} />}
        {c.status === 'active' && (
          <div className="ch-active-actions">
            <CloseAction c={c} heading={heading} onClosed={onChanged} />
            <ResetAction c={c} heading={heading} onReset={onChanged} />
          </div>
        )}
      </div>

      {c.status === 'forming' && <FormingProgress c={c} />}
      {c.status === 'active' && <ActiveSummary c={c} />}
      {c.status === 'closed' && <Standings c={c} onChanged={onChanged} />}
      {c.status === 'forming' && <RequestsPanel c={c} onChanged={onChanged} />}
      {c.status !== 'closed' && <Members c={c} onChanged={onChanged} />}
    </section>
  )
}

function FormingProgress({ c }: { c: CohortDetail }) {
  const n = c.appCount
  const short = MIN_APPS - n
  return (
    <div className="ch-progress">
      <p className="ch-count num"><b>{n}</b><small> / {MIN_APPS} aplikasi</small><span className="ch-count-sep">·</span><span>{c.pureTesterCount} tester murni</span></p>
      <Bar value={Math.min(n, MIN_APPS)} max={MIN_APPS} label={`${n} aplikasi, minimal ${MIN_APPS} untuk mulai`} />
      <p className="meta">
        {short > 0
          ? `Butuh ${short} aplikasi lagi. Dengan minimal ${MIN_APPS} aplikasi, setiap aplikasi bisa mendapat tester sebanyak yang dibutuhkannya (sampai 12) dari sesama creator.`
          : `Cukup untuk mulai: setiap aplikasi mendapat ${ringK(n)} tester dari sesama creator${c.pureTesterCount > 0 ? ', ditambah tester murni' : ''}.`}
      </p>
    </div>
  )
}

function ActiveSummary({ c }: { c: CohortDetail }) {
  const deadline = (c.day0At ?? 0) + 2 * DAY
  return (
    <div className="ch-progress">
      <dl className="ch-facts num">
        <div><dt>Aplikasi</dt><dd>{c.appCount}</dd></div>
        <div><dt>Tester murni</dt><dd>{c.pureTesterCount}</dd></div>
        <div><dt>Batas opt-in</dt><dd className="ch-fact-text">{fmtDateTime(deadline)}</dd></div>
      </dl>
      <Link className="text-action" to={`/cohorts/${c.id}`}>Buka halaman cohort</Link>
    </div>
  )
}

// ---------- start (ADR-009 §1 primary, §7 confirm) ----------

function StartAction({ c, heading, onStarted }: { c: CohortDetail; heading: RefObject<HTMLHeadingElement | null>; onStarted: () => void }) {
  const [open, setOpen] = useState(false)
  // The start button disappears once the cohort is active: land on the cohort heading instead.
  const focusHeading = useFocusAfterClose(open, heading)
  const deleted = c.members.filter((m) => m.appId && m.appDeleted)
  const why = c.appCount < MIN_APPS
    ? `Bisa dimulai setelah ada ${MIN_APPS} aplikasi (sekarang ${c.appCount}).`
    : deleted.length > 0
      ? `${deleted.map((m) => m.appName ?? 'Aplikasi').join(', ')} sudah dihapus. Keluarkan anggotanya atau pulihkan aplikasinya dulu.`
      : null
  const thin = !why && c.appCount === MIN_APPS && c.pureTesterCount === 0
  return (
    <div className="ch-start">
      <button type="button" className="btn primary" aria-disabled={why ? true : undefined} aria-describedby={why ? 'ch-start-why' : thin ? 'ch-start-thin' : undefined}
        onClick={() => { if (!why) setOpen(true) }}>
        Mulai cohort
      </button>
      {why && <p className="meta ch-why" id="ch-start-why">{why}</p>}
      {thin && <p className="meta ch-why" id="ch-start-thin"><span className="ch-glyph" aria-hidden="true">!</span> Buffer tipis: tanpa tester murni.</p>}
      <Dialog open={open} onClose={() => setOpen(false)} label={`Mulai ${c.name}`}>
        {open && <StartForm c={c} thin={thin} onClose={() => setOpen(false)} onStarted={() => { focusHeading(); onStarted() }} />}
      </Dialog>
    </div>
  )
}

function StartForm({ c, thin, onClose, onStarted }: { c: CohortDetail; thin: boolean; onClose: () => void; onStarted: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const k = ringK(c.appCount)
  const title = useRef<HTMLHeadingElement>(null)
  // showModal() focuses the first button, which scrolls a phone-height dialog to its foot: start at the title instead.
  useEffect(() => { const t = window.setTimeout(() => title.current?.focus(), 0); return () => window.clearTimeout(t) }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try {
      await startCohort(c.id)
      toast(`${c.name} dimulai. Tugas sudah dibagikan; batas opt-in ${fmtDateTime(Date.now() + 2 * DAY)}.`)
      onStarted()
      onClose()
    } catch (x) {
      setErr(errorText(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="sheet-body">
        <h2 ref={title} tabIndex={-1}>Mulai {c.name}?</h2>
        <p className="lede">Saat dimulai, TesBareng langsung:</p>
        <ol className="ch-steps num">
          <li>Mengacak urutan ring {c.appCount} creator. Setiap creator ditugaskan menguji {k} aplikasi lain, jadi setiap aplikasi mendapat {k} tester.</li>
          {c.pureTesterCount > 0 && <li>Membagikan {Math.min(14, c.appCount)} aplikasi ke masing-masing dari {c.pureTesterCount} tester murni, mulai dari aplikasi dengan tester paling sedikit.</li>}
          <li>Menetapkan Hari 0 = sekarang, sekitar {fmtDateTime(now)}. Semua anggota punya 48 jam untuk opt-in, sampai sekitar {fmtDateTime(now + 2 * DAY)}.</li>
          <li>Mengunci daftar anggota: creator tidak bisa ditambah atau dikeluarkan lagi. Tester murni masih bisa gabung sendiri sampai akhir Hari {LAST_JOIN_DAY - 1}, sekitar {fmtWib(now + LAST_JOIN_DAY * DAY)}.</li>
        </ol>
        {thin && (
          <p className="notice admin-notice ch-warn" role="note">
            <Chip tone="cabai" glyph="!">Buffer tipis</Chip>
            <span>Dengan {MIN_APPS} aplikasi dan tanpa tester murni, aplikasi yang butuh 12 tester mendapat tepat 12, tanpa cadangan. Satu creator yang tidak ikut tes membuat aplikasi itu turun di bawah 12. Pertimbangkan menunggu beberapa tester murni dulu.</span>
          </p>
        )}
        <p className="notice admin-notice" role="note">
          <span className="chip"><span className="g" aria-hidden="true">!</span>Tidak bisa dibatalkan</span>
          <span>Tugas yang sudah dibagikan tetap tercatat.</span>
        </p>
        {err && <ErrorBox text={err} />}
      </div>
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={onClose}>Batal</button>
        <button className="btn primary" aria-busy={busy || undefined}>{busy ? 'Memulai…' : 'Mulai cohort sekarang'}</button>
      </div>
    </form>
  )
}

// ---------- members (forming: add and remove; active: read only) ----------

function Members({ c, onChanged }: { c: CohortDetail; onChanged: () => void }) {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const forming = c.status === 'forming'
  const creators = c.members.filter((m) => m.appId)
  const pure = c.members.filter((m) => !m.appId)

  // ADR-009 §7 (owner decision 2026-11-03): removing a member while Forming is reversible, so it acts at once
  // and offers "Urungkan" for 8 s instead of a confirm dialog. Undo re-adds the member with the same app.
  const remove = async (m: CohortMember) => {
    if (busyId) return
    setBusyId(m.userId)
    try {
      await removeCohortMember(c.id, m.userId)
      // The row and its button are gone after the refresh: keep focus in the section.
      heading.current?.focus()
      onChanged()
      const left = m.appId && c.appCount - 1 < MIN_APPS ? ` Tersisa ${c.appCount - 1} dari minimal ${MIN_APPS} aplikasi.` : ''
      toast({
        text: m.appId ? `${nameOf(m)} dan ${m.appName ?? 'aplikasinya'} dikeluarkan dari ${c.name}.${left}` : `${nameOf(m)} dikeluarkan dari ${c.name}.`,
        duration: 8000,
        action: {
          label: 'Urungkan',
          onClick: () => {
            addCohortMember(c.id, m.userId, m.appId).then(
              () => { toast(`${nameOf(m)} dikembalikan ke ${c.name}.`); onChanged() },
              (x) => toast(failToast(x)),
            )
          },
        },
      })
    } catch (x) {
      toast(failToast(x))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="ch-members">
      <div className="ch-members-head">
        <h3 ref={heading} tabIndex={-1}>Anggota <span className="num muted">({c.members.length})</span></h3>
        {forming && <button type="button" className="btn sm" onClick={() => setAdding(true)}><IconPlus aria-hidden="true" />Tambah anggota</button>}
      </div>
      {c.members.length === 0 ? (
        <Empty title="Belum ada anggota.">
          <p>Tambahkan creator beserta aplikasi yang mereka bawa. Tester murni bisa gabung sendiri dari halaman cohort.</p>
        </Empty>
      ) : (
        <>
          <MemberList title="Creator dan aplikasinya" items={creators} forming={forming} busyId={busyId} onRemove={remove}
            empty={`Belum ada creator. Cohort butuh minimal ${MIN_APPS} aplikasi.`} />
          <MemberList title="Tester murni" items={pure} forming={forming} busyId={busyId} onRemove={remove}
            empty={forming ? 'Belum ada. Tester murni gabung sendiri dari halaman cohort, atau tambahkan tanpa aplikasi.' : 'Tidak ada tester murni di cohort ini.'} />
        </>
      )}

      {forming && (
        <Dialog open={adding} onClose={() => setAdding(false)} label={`Tambah anggota ke ${c.name}`}>
          {adding && <AddMemberForm c={c} onClose={() => setAdding(false)} onAdded={onChanged} />}
        </Dialog>
      )}
    </div>
  )
}

function MemberList({ title, items, forming, busyId, onRemove, empty }: {
  title: string; items: CohortMember[]; forming: boolean; busyId: string | null; onRemove: (m: CohortMember) => void; empty: string
}) {
  return (
    <div className="ch-sub">
      <h4 className="ch-sub-h">{title} <span className="num">({items.length})</span></h4>
      {items.length === 0 ? <p className="meta">{empty}</p> : (
        <ul>
          {items.map((m) => (
            <li className="row-line ch-member" key={m.userId}>
              <Avatar name={nameOf(m)} photo={m.photoURL} />
              <span className="grow cell-2">
                <Link className="hit ch-name" to={`/u/${m.userId}`}><b>{nameOf(m)}</b></Link>
                {m.appId ? (
                  <span className="ch-app">
                    <Link className="hit" to={`/apps/${m.appId}`}>{m.appName ?? 'Aplikasi'}</Link>
                    {m.appDeleted && <Chip tone="cabai" glyph="×">Terhapus</Chip>}
                  </span>
                ) : <span>Tanpa aplikasi</span>}
              </span>
              {forming && (
                // Quiet on purpose: a column of red buttons would shout. The toast carries the undo.
                <button type="button" className="btn sm" aria-busy={busyId === m.userId || undefined} onClick={() => onRemove(m)}>
                  {busyId === m.userId ? 'Mengeluarkan…' : 'Keluarkan'}<span className="sr-only"> {nameOf(m)}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- ADR-013: requests to bring an app, oldest first ----------

const reqFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })

function RequestsPanel({ c, onChanged }: { c: CohortDetail; onChanged: () => void }) {
  const toast = useToast()
  const list = usePendingRequests(c.id)
  const heading = useRef<HTMLHeadingElement>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<CohortRequest | null>(null)
  const items = list.data

  const approve = async (r: CohortRequest) => {
    if (busyId) return
    setBusyId(r.id)
    try {
      await approveCohortRequest(r.id)
      // The row and its button are gone after the refresh: keep focus in the section.
      heading.current?.focus()
      toast(`${nameOf(r)} dan ${r.appName} masuk ke ${c.name}.`)
      list.refresh(); onChanged()
    } catch (x) {
      toast(failToast(x))
      list.refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="ch-members ch-requests">
      <div className="ch-members-head">
        <h3 ref={heading} tabIndex={-1}>Permintaan masuk <span className="num muted">({items.length})</span></h3>
      </div>
      {list.error ? <ErrorBox text="Permintaan masuk gagal dimuat." onRetry={list.retry} /> : list.loading ? (
        <div aria-busy="true" aria-label="Memuat permintaan">{[0, 1].map((i) => <div className="row-line" key={i} aria-hidden="true"><Skel w={32} h={32} /><span className="grow"><Skel w={160} /><br /><Skel w={120} h={12} /></span></div>)}</div>
      ) : items.length === 0 ? (
        <p className="meta">Tidak ada permintaan yang menunggu. Creator mengajukan aplikasinya dari halaman cohort.</p>
      ) : (
        <>
          <p className="meta">Terlama di atas. Setujui untuk menambahkan creator dan aplikasinya; tolak dengan alasan opsional yang dilihat anggota.</p>
          <ul>
            {items.map((r) => (
              <li className="row-line ch-member ch-req" key={r.id}>
                <Avatar name={nameOf(r)} photo={r.photoURL} />
                <span className="grow cell-2">
                  <Link className="hit ch-name" to={`/u/${r.userId}`}><b>{nameOf(r)}</b></Link>
                  <span className="num">{r.maskedEmail}</span>
                  <span className="ch-app"><Link className="hit" to={`/apps/${r.appId}`}>{r.appName || 'Aplikasi'}</Link></span>
                  <span className="num">Diajukan {reqFmt.format(r.createdAt)} WIB</span>
                </span>
                <span className="ch-req-acts">
                  <button type="button" className="btn sm primary" aria-busy={busyId === r.id || undefined} onClick={() => { void approve(r) }}>
                    {busyId === r.id ? 'Menyetujui…' : 'Setujui'}<span className="sr-only"> {nameOf(r)}</span>
                  </button>
                  <button type="button" className="btn sm" onClick={() => setRejecting(r)}>Tolak<span className="sr-only"> {nameOf(r)}</span></button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Dialog open={rejecting != null} onClose={() => setRejecting(null)} label="Tolak permintaan">
        {rejecting && (
          <RejectForm r={rejecting} c={c} onClose={() => setRejecting(null)}
            onDone={() => { heading.current?.focus(); list.refresh(); onChanged() }} />
        )}
      </Dialog>
    </div>
  )
}

function RejectForm({ r, c, onClose, onDone }: { r: CohortRequest; c: CohortDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const over = reason.trim().length > REQUEST_REASON_MAX
  const fieldErr = over ? `Alasan paling panjang ${REQUEST_REASON_MAX} karakter.` : undefined
  const area = useRef<HTMLTextAreaElement>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (fieldErr) { area.current?.focus(); return }
    setBusy(true); setErr(null)
    try {
      await rejectCohortRequest(r.id, reason)
      toast(`Permintaan ${nameOf(r)} untuk ${r.appName} ditolak.`)
      onClose(); onDone()
    } catch (x) {
      setErr(errorText(x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate>
      <div className="sheet-body">
        <div>
          <h2>Tolak permintaan?</h2>
          <p className="lede"><b>{nameOf(r)}</b> dengan <b>{r.appName}</b> untuk {c.name}. Anggota melihat penolakan dan alasannya, lalu bisa mengajukan lagi.</p>
        </div>
        <Field id="rj-reason" label="Alasan" optional hint="Singkat dan jelas, misalnya “Cohort ini sudah penuh, coba cohort berikutnya.”" error={fieldErr} count={`${reason.trim().length}/${REQUEST_REASON_MAX}`}>
          <textarea ref={area} className="input" rows={3} autoComplete="off" value={reason}
            onChange={(e) => { setReason(e.target.value); setErr(null) }} {...fieldAria('rj-reason', { hint: true, error: fieldErr })} />
        </Field>
        {err && <ErrorBox text={err} />}
      </div>
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={onClose}>Batal</button>
        <button className="btn danger" aria-busy={busy || undefined}>{busy ? 'Menolak…' : 'Tolak permintaan'}</button>
      </div>
    </form>
  )
}

// ---------- add member: search, pick, choose app or pure tester ----------

type Opt = { value: string; label: string; disabled?: string }

function optionsFor(cand: Candidate): Opt[] {
  return [
    ...cand.apps.map((a) => ({ value: a.id, label: a.name, disabled: a.inCohort != null ? `Sudah di ${a.inCohort || 'cohort lain yang belum ditutup'}.` : undefined })),
    { value: 'pure', label: 'Tanpa aplikasi (tester murni)' },
  ]
}
/** Opinionated default: the only free app, else pure tester when there is no free app; otherwise ask. */
function defaultChoice(cand: Candidate) {
  const free = cand.apps.filter((a) => a.inCohort == null)
  return free.length === 1 ? free[0].id : free.length === 0 ? 'pure' : ''
}

function AddMemberForm({ c, onClose, onAdded }: { c: CohortDetail; onClose: () => void; onAdded: () => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 250)
    return () => window.clearTimeout(t)
  }, [q])
  const res = useMemberCandidates(term, true)
  const [pick, setPick] = useState<Candidate | null>(null)
  const [choice, setChoice] = useState('')
  const [showErr, setShowErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const search = useRef<HTMLInputElement>(null)
  const firstOpt = useRef<HTMLInputElement>(null)
  const members = useMemo(() => new Set([...c.members.map((m) => m.userId), ...added]), [c.members, added])
  const searching = !!q.trim() && (res.loading || term !== q.trim())

  const blockedWhy = (cand: Candidate) =>
    members.has(cand.userId) ? 'Sudah anggota cohort ini.'
      : cand.owing ? 'Masih berutang di cohort sebelumnya. Tandai lunas dulu sebelum bisa ditambah.'
        : null

  const choose = (cand: Candidate) => {
    if (blockedWhy(cand)) return
    setPick(cand); setChoice(defaultChoice(cand)); setShowErr(false); setErr(null)
    window.setTimeout(() => firstOpt.current?.focus(), 0)
  }
  const back = () => {
    setPick(null); setErr(null)
    window.setTimeout(() => search.current?.focus(), 0)
  }

  // Disabled radios cannot take focus: aim at the first one that can.
  const firstEnabled = pick ? optionsFor(pick).find((o) => !o.disabled)?.value : undefined
  const choiceErr = !choice ? 'Pilih aplikasi yang dibawa, atau tester murni.' : undefined
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !pick) return
    if (choiceErr) { setShowErr(true); firstOpt.current?.focus(); return }
    setBusy(true); setErr(null)
    const appId = choice === 'pure' ? null : choice
    try {
      await addCohortMember(c.id, pick.userId, appId)
      const app = pick.apps.find((a) => a.id === appId)
      toast(app ? `${nameOf(pick)} ditambahkan dengan ${app.name}.` : `${nameOf(pick)} ditambahkan sebagai tester murni.`)
      setAdded((xs) => [...xs, pick.userId])
      onAdded()
      // Stay open for the next member: admins add a dozen creators in one go.
      setPick(null); setQ(''); setTerm('')
      window.setTimeout(() => search.current?.focus(), 0)
    } catch (x) {
      setErr(errorText(x))
    } finally {
      setBusy(false)
    }
  }

  const status = !q.trim() ? '' : searching ? 'Mencari…' : res.error ? '' : res.data.length === 0
    ? `Tidak ada anggota yang cocok dengan “${term}”.`
    : `${res.data.length} anggota cocok${res.data.length >= 20 ? '. Hanya 20 pertama yang tampil; persempit pencarian.' : '.'}`

  return (
    <form onSubmit={submit} noValidate>
      <div className="sheet-body">
        <div>
          <h2>Tambah anggota</h2>
          <p className="lede">ke <b>{c.name}</b> · <span className="num">{c.appCount}/{MIN_APPS}</span> aplikasi</p>
        </div>

        {!pick ? (
          <>
            <div className="field">
              <label htmlFor="am-q">Cari anggota</label>
              <span className="search">
                <IconSearch aria-hidden="true" />
                <input id="am-q" ref={search} className="input ch-search" type="search" enterKeyHint="search" autoComplete="off" spellCheck={false} maxLength={50}
                  value={q} onChange={(e) => setQ(e.target.value)} aria-describedby="am-q-hint am-q-status"
                  onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} />
              </span>
              <span className="hint" id="am-q-hint">Nama atau email tersamar, misalnya “bu”. Anggota harus sudah pernah masuk ke TesBareng.</span>
            </div>
            <p className="meta num" id="am-q-status" role="status" aria-live="polite">{status}</p>
            {res.error ? <ErrorBox text="Pencarian gagal." onRetry={res.retry} /> : q.trim() && !searching && res.data.length > 0 && (
              <ul className="ch-cands" aria-label="Hasil pencarian">
                {res.data.map((cand) => {
                  const why = blockedWhy(cand)
                  const free = cand.apps.filter((a) => a.inCohort == null).length
                  return (
                    <li key={cand.userId}>
                      <button type="button" className="ch-cand" aria-disabled={why ? true : undefined} onClick={() => choose(cand)}
                        aria-describedby={`cand-${cand.userId}`}>
                        <Avatar name={nameOf(cand)} photo={cand.photoURL} />
                        <span className="cell-2 grow">
                          <b>{nameOf(cand)}</b>
                          <span>{cand.maskedEmail}</span>
                          <span id={`cand-${cand.userId}`} className="ch-cand-why">
                            {why ? <><span className="ch-glyph" aria-hidden="true">{cand.owing && !members.has(cand.userId) ? '!' : '✓'}</span>{why}</>
                              : cand.apps.length === 0 ? 'Belum punya aplikasi: masuk sebagai tester murni.'
                                : `${cand.apps.length} aplikasi${free < cand.apps.length ? `, ${free} bisa dibawa` : ''}.`}
                          </span>
                        </span>
                        {!why && <span className="ch-cand-go" aria-hidden="true">Pilih</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {q.trim() && !searching && !res.error && res.data.length === 0 && (
              <Empty title={`Tidak ada anggota dengan nama atau email “${term}”.`}>
                <p>Calon anggota perlu masuk ke TesBareng sekali dengan akun Google sebelum bisa ditambahkan.</p>
              </Empty>
            )}
          </>
        ) : (
          <>
            <div className="ch-picked">
              <Avatar name={nameOf(pick)} photo={pick.photoURL} />
              <span className="cell-2 grow"><b>{nameOf(pick)}</b><span>{pick.maskedEmail}</span></span>
              <button type="button" className="text-action" onClick={back}>Ganti anggota</button>
            </div>
            <fieldset className="fieldset ch-opts" aria-describedby={showErr && choiceErr ? 'am-opt-err' : 'am-opt-hint'}>
              <legend>Ikut sebagai</legend>
              <p className="hint ch-opt-hint" id="am-opt-hint">Satu aplikasi per anggota. Aplikasi yang sudah ada di cohort lain yang belum ditutup tidak bisa dibawa.</p>
              {optionsFor(pick).map((o) => (
                <label key={o.value} className={`ch-opt ${o.disabled ? 'off' : ''}`}>
                  <input ref={o.value === firstEnabled ? firstOpt : undefined} type="radio" name="am-app" value={o.value} checked={choice === o.value} disabled={!!o.disabled}
                    onChange={() => { setChoice(o.value); setShowErr(false) }} aria-describedby={o.disabled ? `opt-${o.value}` : undefined} />
                  <span className="cell-2">
                    <b>{o.label}</b>
                    {o.disabled && <span id={`opt-${o.value}`}>{o.disabled}</span>}
                  </span>
                </label>
              ))}
              <span className={showErr && choiceErr ? 'hint err' : 'sr-only'} id="am-opt-err" aria-live="polite">{showErr ? choiceErr : ''}</span>
            </fieldset>
          </>
        )}
        {err && <ErrorBox text={err} />}
      </div>
      <div className="sheet-foot">
        {added.length > 0 && <span className="why num">{added.length} anggota ditambahkan</span>}
        <button type="button" className="btn" onClick={onClose}>{added.length > 0 ? 'Selesai' : 'Tutup'}</button>
        {pick && <button className="btn primary" aria-busy={busy || undefined}>{busy ? 'Menambahkan…' : 'Tambahkan ke cohort'}</button>}
      </div>
    </form>
  )
}

// ---------- closed: standings and settling (FR-37) ----------

function Standings({ c, onChanged }: { c: CohortDetail; onChanged: () => void }) {
  const [settling, setSettling] = useState<CohortMember | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusHeading = useFocusAfterClose(!!settling, heading)
  const owing = c.members.filter((m) => m.standing === 'owing')
  const settled = c.members.filter((m) => m.standing === 'settled')
  const good = c.members.filter((m) => m.standing === 'good').length
  return (
    <div className="ch-members">
      <dl className="ch-facts num">
        <div><dt>Baik</dt><dd>{good}</dd></div>
        <div><dt>Berutang</dt><dd>{owing.length}</dd></div>
        <div><dt>Lunas</dt><dd>{settled.length}</dd></div>
      </dl>
      <div className="ch-members-head"><h3 ref={heading} tabIndex={-1}>Kewajiban belum selesai</h3></div>
      {owing.length === 0 ? (
        <Empty title="Tidak ada anggota yang berutang.">
          <p>{settled.length > 0 ? 'Semua anggota yang berutang sudah ditandai lunas.' : 'Semua anggota menyelesaikan kewajibannya saat cohort ditutup.'} Mereka bisa ikut cohort berikutnya.</p>
        </Empty>
      ) : (
        <>
          <p className="meta">Anggota yang berutang tidak bisa ditambahkan ke cohort baru sampai ditandai lunas. Tandai lunas setelah kewajibannya beres, atau bila Anda memutuskan memaafkannya.</p>
          <ul>
            {owing.map((m) => (
              <li className="row-line ch-member" key={m.userId}>
                <Avatar name={nameOf(m)} photo={m.photoURL} />
                <span className="grow cell-2">
                  <Link className="hit ch-name" to={`/u/${m.userId}`}><b>{nameOf(m)}</b></Link>
                  <span>{m.appId ? (m.appName ?? 'Aplikasi') : 'Tester murni'}</span>
                </span>
                <StandingChip standing="owing" />
                <button type="button" className="btn sm" onClick={() => setSettling(m)}>Tandai lunas<span className="sr-only"> {nameOf(m)}</span></button>
              </li>
            ))}
          </ul>
        </>
      )}
      {settled.length > 0 && (
        <div className="ch-sub">
          <h4 className="ch-sub-h">Sudah dilunasi <span className="num">({settled.length})</span></h4>
          <ul>
            {settled.map((m) => (
              <li className="row-line ch-member" key={m.userId}>
                <Avatar name={nameOf(m)} photo={m.photoURL} />
                <span className="grow cell-2">
                  <Link className="hit ch-name" to={`/u/${m.userId}`}><b>{nameOf(m)}</b></Link>
                  <span className="num">Dilunasi {fmtDateTime(m.settledAt)}</span>
                </span>
                <StandingChip standing="settled" />
              </li>
            ))}
          </ul>
        </div>
      )}
      <Dialog open={!!settling} onClose={() => setSettling(null)} label={settling ? `Tandai ${nameOf(settling)} lunas` : 'Tandai lunas'}>
        {settling && <SettleForm c={c} m={settling} onClose={() => setSettling(null)} onSettled={() => { focusHeading(); setSettling(null); onChanged() }} />}
      </Dialog>
    </div>
  )
}

function SettleForm({ c, m, onClose, onSettled }: { c: CohortDetail; m: CohortMember; onClose: () => void; onSettled: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try {
      await settleMember(c.id, m.userId)
      toast(`${nameOf(m)} ditandai lunas dan bisa ikut cohort berikutnya.`)
      onSettled()
    } catch (x) {
      setErr(errorText(x))
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate>
      <div className="sheet-body">
        <h2>Tandai {nameOf(m)} lunas?</h2>
        <p>Status {nameOf(m)} di {c.name} berubah dari Berutang menjadi Lunas, dan ia bisa ditambahkan ke cohort berikutnya.</p>
        <p className="notice admin-notice" role="note">
          <span className="chip"><span className="g" aria-hidden="true">!</span>Tidak bisa dibatalkan</span>
          <span>Status Lunas tidak bisa dikembalikan ke Berutang.</span>
        </p>
        {err && <ErrorBox text={err} />}
      </div>
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={onClose}>Batal</button>
        <button className="btn primary" aria-busy={busy || undefined}>{busy ? 'Menyimpan…' : 'Tandai lunas'}</button>
      </div>
    </form>
  )
}

// ---------- B7: close cohort (FR-37) ----------

function CloseAction({ c, heading, onClosed }: { c: CohortDetail; heading: RefObject<HTMLHeadingElement | null>; onClosed: () => void }) {
  const [open, setOpen] = useState(false)
  const focusHeading = useFocusAfterClose(open, heading)
  return (
    <div className="ch-start">
      <button type="button" className="btn" onClick={() => setOpen(true)}>Tutup cohort</button>
      <Dialog open={open} onClose={() => setOpen(false)} label={`Tutup ${c.name}`}>
        {open && <CloseForm c={c} onClose={() => setOpen(false)} onClosed={() => { focusHeading(); onClosed() }} />}
      </Dialog>
    </div>
  )
}

function CloseForm({ c, onClose, onClosed }: { c: CohortDetail; onClose: () => void; onClosed: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => { const t = window.setTimeout(() => title.current?.focus(), 0); return () => window.clearTimeout(t) }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try {
      await closeCohort(c.id)
      toast(`${c.name} ditutup. Anggota dengan kewajiban belum selesai ditandai Berutang.`)
      onClosed(); onClose()
    } catch (x) {
      setErr(errorText(x)); setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="sheet-body">
        <h2 ref={title} tabIndex={-1}>Tutup {c.name}?</h2>
        <p className="lede">Saat ditutup, TesBareng langsung menetapkan standing setiap anggota.</p>
        <ol className="ch-steps">
          <li><b>Baik</b> jika semua kewajiban terpenuhi.</li>
          <li><b>Berutang</b> jika belum. Anggota yang berutang tidak bisa ikut cohort berikutnya sampai ditandai Lunas.</li>
        </ol>
        <p className="notice admin-notice" role="note">
          <span className="chip"><span className="g" aria-hidden="true">!</span>Tidak bisa dibatalkan</span>
          <span>Standing yang sudah ditetapkan tidak bisa diubah kembali ke status sebelumnya.</span>
        </p>
        {err && <ErrorBox text={err} />}
      </div>
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={onClose}>Batal</button>
        <button className="btn danger" aria-busy={busy || undefined}>{busy ? 'Menutup…' : 'Tutup cohort'}</button>
      </div>
    </form>
  )
}

// ---------- reset active cohort back to forming ----------

function ResetAction({ c, heading, onReset }: { c: CohortDetail; heading: RefObject<HTMLHeadingElement | null>; onReset: () => void }) {
  const [open, setOpen] = useState(false)
  const focusHeading = useFocusAfterClose(open, heading)
  return (
    <div className="ch-start">
      <button type="button" className="btn" onClick={() => setOpen(true)}>Reset ke Forming</button>
      <Dialog open={open} onClose={() => setOpen(false)} label={`Reset ${c.name}`}>
        {open && <ResetForm c={c} onClose={() => setOpen(false)} onReset={() => { focusHeading(); onReset() }} />}
      </Dialog>
    </div>
  )
}

function ResetForm({ c, onClose, onReset }: { c: CohortDetail; onClose: () => void; onReset: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => { const t = window.setTimeout(() => title.current?.focus(), 0); return () => window.clearTimeout(t) }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try {
      await resetCohort(c.id)
      toast(`${c.name} direset ke Forming. Tambahkan atau keluarkan anggota, lalu mulai ulang kapan saja.`)
      onReset(); onClose()
    } catch (x) {
      setErr(errorText(x)); setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="sheet-body">
        <h2 ref={title} tabIndex={-1}>Reset {c.name} ke Forming?</h2>
        <p className="lede">Saat direset, TesBareng langsung:</p>
        <ol className="ch-steps">
          <li>Menghapus semua penugasan yang sudah dibagikan.</li>
          <li>Menghapus urutan ring dan waktu penugasan dari setiap anggota.</li>
          <li>Mengembalikan status cohort ke <b>Forming</b>; anggota tetap ada.</li>
        </ol>
        <p className="meta">Cohort bisa dimulai ulang kapan saja dari halaman ini. Anggota yang sudah opt-in ke aplikasi tetap tercatat sebagai tester di aplikasi masing-masing.</p>
        <p className="notice admin-notice" role="note">
          <span className="chip"><span className="g" aria-hidden="true">!</span>Penugasan hilang</span>
          <span>Penugasan yang sudah dibagikan tidak bisa dikembalikan. Riwayat opt-in tester di aplikasi tetap ada.</span>
        </p>
        {err && <ErrorBox text={err} />}
      </div>
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={onClose}>Batal</button>
        <button className="btn danger" aria-busy={busy || undefined}>{busy ? 'Mereset…' : 'Reset ke Forming'}</button>
      </div>
    </form>
  )
}

// ---------- B7: reassign behind slot ----------

function ReassignPanel({ c }: { c: CohortDetail }) {
  const status = useAssignmentStatus(c.id)
  const [slot, setSlot] = useState<{ appId: string; testerId: string; appName: string } | null>(null)
  const panelHead = useRef<HTMLHeadingElement>(null)
  const focusHead = useFocusAfterClose(!!slot, panelHead)

  const behindSlots = useMemo(() => status.data.filter((s) => s.isBehind && s.cell === 'not_joined'), [status.data])

  if (status.loading && behindSlots.length === 0) return null
  if (status.error) return (
    <section className="panel" aria-label="Slot belum opt-in">
      <p className="meta cabai">Gagal memuat slot tertinggal. <button type="button" className="link" onClick={status.retry}>Coba lagi</button></p>
    </section>
  )
  if (behindSlots.length === 0) return null

  return (
    <section className="panel" aria-labelledby="reassign-h">
      <header>
        <h2 id="reassign-h" ref={panelHead} tabIndex={-1}>Slot belum opt-in</h2>
        <Chip tone="cabai" glyph="!">{behindSlots.length} slot</Chip>
      </header>
      <p className="meta">Tester tertinggal. Pindahkan slot ke tester yang belum ditugaskan.</p>
      <ul>
        {behindSlots.slice(0, 10).map((s) => {
          const app = c.members.find((m) => m.appId === s.appId)
          const tester = c.members.find((m) => m.userId === s.testerId)
          return (
            <li className="row-line" key={`${s.appId}:${s.testerId}`}>
              <span className="grow cell-2">
                <b>{app?.appName ?? 'Aplikasi'}</b>
                <span>{tester?.displayName || 'Tester'} · belum opt-in</span>
              </span>
              <button type="button" className="btn sm"
                onClick={() => setSlot({ appId: s.appId, testerId: s.testerId, appName: app?.appName ?? 'Aplikasi' })}>
                Pindahkan<span className="sr-only"> slot {app?.appName}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <Dialog open={!!slot} onClose={() => setSlot(null)} label={slot ? `Pindahkan slot ${slot.appName}` : 'Pindahkan slot'}>
        {slot && <ReassignForm c={c} slot={slot} onClose={() => setSlot(null)} onDone={() => { focusHead(); setSlot(null) }} />}
      </Dialog>
    </section>
  )
}

function ReassignForm({ c, slot, onClose, onDone }: {
  c: CohortDetail; slot: { appId: string; testerId: string; appName: string }; onClose: () => void; onDone: () => void
}) {
  const toast = useToast()
  const [newId, setNewId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const candidates = c.members.filter((m) => m.userId !== slot.testerId && m.appId !== slot.appId)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!newId || busy) return
    setBusy(true); setErr(null)
    try {
      await reassignSlot(c.id, slot.appId, slot.testerId, newId)
      const name = c.members.find((m) => m.userId === newId)?.displayName ?? 'Tester baru'
      toast(`Slot ${slot.appName} dipindahkan ke ${name}.`)
      onDone()
    } catch (x) {
      setErr(errorText(x)); setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="sheet-body">
        <h2>Pindahkan slot {slot.appName}?</h2>
        <p className="lede">Pilih tester pengganti dari anggota cohort ini.</p>
        <fieldset className="fieldset ch-opts">
          <legend>Tester pengganti</legend>
          {candidates.length === 0
            ? <p className="meta">Tidak ada kandidat. Tambah tester murni ke cohort ini dulu.</p>
            : candidates.map((m) => (
              <label key={m.userId} className="ch-opt">
                <input type="radio" name="ra-new" value={m.userId} checked={newId === m.userId} onChange={() => setNewId(m.userId)} />
                <span className="cell-2"><b>{nameOf(m)}</b><span>{m.appId ? (m.appName ?? 'Creator') : 'Tester murni'}</span></span>
              </label>
            ))}
        </fieldset>
        {err && <ErrorBox text={err} />}
      </div>
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={onClose}>Batal</button>
        <button className="btn primary" disabled={!newId} aria-busy={busy || undefined}>{busy ? 'Memindahkan…' : 'Pindahkan slot'}</button>
      </div>
    </form>
  )
}

// ---------- B7: WA reminder text for behind members ----------

function ReminderPanel({ c }: { c: CohortDetail }) {
  const oblig = useObligations(c.id)
  const behind = useMemo(() => oblig.data.filter((o) => o.isBehind), [oblig.data])

  if (oblig.loading && behind.length === 0) return null
  if (oblig.error) return (
    <section className="panel" aria-label="Anggota tertinggal">
      <p className="meta cabai">Gagal memuat data kewajiban. <button type="button" className="link" onClick={oblig.retry}>Coba lagi</button></p>
    </section>
  )
  if (behind.length === 0) return null

  const lines = behind.map((o) => {
    const m = c.members.find((mm) => mm.userId === o.userId)
    return `• ${m?.displayName || 'Anggota'}: ${o.behindCount} slot belum opt-in`
  })

  return (
    <section className="panel" aria-labelledby="remind-h">
      <header>
        <h2 id="remind-h">Anggota tertinggal</h2>
        <Chip tone="cabai" glyph="!">{behind.length}</Chip>
      </header>
      <p className="meta">Salin dan kirim ke grup WhatsApp sebagai pengingat opt-in.</p>
      <ul className="ch-behind-list">
        {behind.map((o) => {
          const m = c.members.find((mm) => mm.userId === o.userId)
          return (
            <li className="row-line" key={o.userId}>
              <span className="grow cell-2">
                <b>{m?.displayName || 'Anggota'}</b>
                <span className="num">{o.behindCount} slot belum opt-in</span>
              </span>
            </li>
          )
        })}
      </ul>
      <textarea
        className="input ch-pin" readOnly
        value={`Pengingat opt-in cohort:\n${lines.join('\n')}`}
        rows={behind.length + 2}
        aria-label="Teks pengingat untuk disalin ke WhatsApp"
      />
    </section>
  )
}

// ---------- WhatsApp link (FR-49–51, FR-53) ----------

function waError(v: string): string | undefined {
  const t = v.trim()
  if (!t) return undefined
  if (!t.startsWith(WA_PREFIX)) return `Link harus diawali ${WA_PREFIX}. Salin dari “Undang ke grup lewat link” di WhatsApp.`
  if (t.length <= WA_PREFIX.length || /\s/.test(t)) return 'Link belum lengkap. Salin ulang link undangan grupnya.'
  return undefined
}

function LinkPanel({ c }: { c: CohortDetail }) {
  const link = useCohortLink(c.id, true)
  const toast = useToast()
  // What the server holds after our own save, until the background refresh catches up.
  const [saved, setSaved] = useState<string | null | undefined>(undefined)
  const current = saved !== undefined ? saved : link.data
  const [v, setV] = useState<string | null>(null)
  const value = v ?? current ?? ''
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const fieldErr = waError(value)
  const shownErr = touched ? fieldErr : undefined
  const removing = !value.trim() && !!current
  const unchanged = value.trim() === (current ?? '')

  const save = async (url: string) => {
    await setCohortLink(c.id, url)
    const next = url.trim() || null
    setSaved(next); setV(null); setTouched(false)
    link.refresh()
    return next
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setTouched(true); setNote('')
    if (fieldErr) { input.current?.focus(); return }
    if (unchanged) { setNote(current ? 'Link ini sudah tersimpan.' : 'Belum ada link untuk disimpan.'); return }
    setBusy(true); setErr(null)
    const prev = current ?? null
    try {
      const next = await save(value)
      if (next) toast(`Link grup ${c.name} disimpan. Anggota cohort melihatnya di halaman cohort.`)
      else {
        toast({
          text: `Link grup ${c.name} dihapus.`, duration: 8000,
          action: prev ? { label: 'Urungkan', onClick: () => { save(prev).then(() => toast('Link grup dikembalikan.'), (x) => toast(failToast(x))) } } : undefined,
        })
      }
    } catch (x) {
      setErr(errorText(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="wa-h">
      <header>
        <h2 id="wa-h">Grup WhatsApp</h2>
        {!link.loading && !link.error && (current ? <Chip glyph="✓">Terpasang</Chip> : <Chip glyph="—">Belum ada</Chip>)}
      </header>
      {c.status === 'closed' && current && (
        <p className="notice admin-notice ch-notice" role="note">
          <span className="chip"><span className="g" aria-hidden="true">!</span>Cohort ditutup</span>
          <span>Arsipkan grup WhatsApp-nya di Komunitas supaya tidak dipakai lagi.</span>
        </p>
      )}
      {link.error ? <ErrorBox text="Link grup gagal dimuat." onRetry={link.retry} /> : (
        <form className="ch-link-form" onSubmit={submit} noValidate>
          <Field id="wa-url" label="Link undangan grup" error={shownErr}
            hint={<>Diawali <span className="ch-code">{WA_PREFIX}</span>. Hanya anggota cohort ini dan admin yang melihatnya; bergabung ke grup tetap opsional. Kosongkan lalu simpan untuk menghapus link.</>}>
            <input ref={input} className="input" type="url" inputMode="url" autoComplete="off" spellCheck={false} disabled={link.loading}
              value={link.loading ? '' : value} onChange={(e) => { setV(e.target.value); setErr(null); setNote('') }} onBlur={() => setTouched(true)}
              {...fieldAria('wa-url', { hint: true, error: shownErr })} />
          </Field>
          {err && <ErrorBox text={err} />}
          <div className="ch-link-foot">
            <button className={`btn ${removing ? 'danger' : ''}`} aria-busy={busy || undefined} disabled={link.loading}>
              {busy ? 'Menyimpan…' : removing ? 'Hapus link' : 'Simpan link'}
            </button>
            {current && !link.loading && (
              <a className="text-action ch-ext" href={current} target="_blank" rel="noreferrer">Buka grup<IconExternal aria-hidden="true" /><span className="sr-only"> (tab baru)</span></a>
            )}
            <span className="meta" role="status" aria-live="polite">{note}</span>
          </div>
        </form>
      )}
    </section>
  )
}

// ---------- pinned-message template (FR-52) ----------

function PinnedPanel({ c }: { c: CohortDetail }) {
  const toast = useToast()
  const area = useRef<HTMLTextAreaElement>(null)
  const msg = pinnedMessage(c)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg)
      toast('Pesan disalin. Tempel di grup WhatsApp, lalu sematkan.')
    } catch {
      // Clipboard blocked (permissions, older WebView): select the text so one Ctrl+C / "Salin" finishes the job.
      area.current?.focus()
      area.current?.select()
      toast({ text: 'Browser tidak mengizinkan salin otomatis. Teksnya sudah dipilih: tekan Ctrl+C, atau tahan lalu pilih Salin.', duration: 8000 })
    }
  }
  return (
    <section className="panel" aria-labelledby="pin-h">
      <header>
        <h2 id="pin-h">Pesan sematan grup</h2>
        <button type="button" className="btn sm" onClick={copy}>Salin pesan</button>
      </header>
      <p className="meta ch-pin-note" id="pin-d">
        Jadwal, tautan halaman cohort dan aturan grup.{c.status === 'forming' ? ' Tanggal tiap hari muncul setelah cohort dimulai.' : ''}
      </p>
      <textarea ref={area} className="input ch-pin" readOnly value={msg} rows={msg.split('\n').length} aria-labelledby="pin-h" aria-describedby="pin-d" />
    </section>
  )
}

function DetailSkeleton() {
  return (
    <section className="panel" aria-busy="true" aria-label="Memuat cohort">
      <Skel w={220} h={24} />
      <div style={{ marginTop: 'var(--s-3)' }}><Skel w="100%" h={16} /></div>
      <div style={{ marginTop: 'var(--s-4)' }}>{[0, 1, 2].map((i) => <div className="row-line" key={i}><Skel w={32} h={32} /><span className="grow"><Skel w={160} /><br /><Skel w={120} h={12} /></span></div>)}</div>
    </section>
  )
}

