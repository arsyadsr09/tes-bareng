import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Avatar, Badge, Bar, Chip, Dialog, Empty, ErrorBox, failToast, FeedbackChip, NotFound, OverflowMenu, RelTime, Seats, ShowAll, Skel,
  StatusPill, TesterChip, useToast, type MenuItem,
} from '../components/bits'
import { IconBack, IconChevron, IconExternal, IconPlus, IconSort, IconSortNone } from '../components/icons'
import { Board, BoardLegend } from '../components/Board'
import { BuildDialog, FeedbackDialog, JoinDialog, ManualTesterDialog, TesterDialog } from '../components/dialogs'
import { AssignedChip } from '../components/cohortBits'
import { useAuth } from '../lib/auth'
import { useMyAssignedApps } from '../lib/cohorts'
import { usePageMeta } from '../lib/pageMeta'
import { api, errorCode, markEmailListed, updateTesterAsCreator, useApp, useBadgesOf, useBuilds, useEmailListings, useMyEmailListing, useTesters } from '../lib/data'
import { checkIn, milestones, useCheckIns, type CheckIn, type Milestone } from '../lib/checkins'
import {
  computeProgress, daysActive, fmtDate, fmtDateTime, fmtDayHeading, inDays, isNewBuild, isoDate, openSeats, relTime, TARGET_BUILDS, TARGET_DAYS, TARGET_TESTERS,
  testerStatusLabel, type Progress,
} from '../lib/progress'
import type { AppDoc, BuildDoc, TesterDoc, TesterStatus } from '../lib/types'

type DialogKind = null | 'join' | 'feedback' | 'build' | 'manual' | 'leave' | { tester: TesterDoc }

/** One action in the header zone: the primary, a secondary, or an overflow item (ADR-009 §1, §7). */
interface Action { label: string; icon?: ReactNode; onClick?: () => void; href?: string; to?: string; busy?: boolean; blocked?: boolean }
interface Actions { primary?: Action; secondary: Action[]; overflow: MenuItem[]; note?: string }

export function AppDetail() {
  const { id } = useParams()
  const app = useApp(id)
  const testers = useTesters(id)
  const builds = useBuilds(id)
  const { user, isAdmin, signIn } = useAuth()
  // "Ditugaskan" in the header (PRD §5.2 step 2). If it fails to load, the label is simply absent.
  const myAssigned = useMyAssignedApps(user?.uid)
  const toast = useToast()
  const [dialog, setDialog] = useState<DialogKind>(null)
  // Placed only once app, testers and builds are in, so the KPI block does not jump after first paint.
  const kpiPlace = useKpiPlacement(!!app.data && !testers.loading && !builds.loading)
  usePageMeta(app.data && !app.data.deleted ? app.data.name : 'Aplikasi', app.data && !app.data.deleted ? app.data.description : undefined)

  const progress = useMemo(
    () => (app.data ? computeProgress(app.data, testers.data, builds.data) : null),
    [app.data, testers.data, builds.data],
  )
  // Called before the early returns (hook order); only loads for the member's own Active entry.
  const ownActive = user ? testers.data.find((t) => t.uid === user.uid && t.status === 'active') : undefined
  // Email-list apps (ADR-011): the header follows the member's own request (ask → wait → opt in).
  const emailFlow = !!app.data && app.data.testerMethod === 'email_list' && !!user && app.data.creatorUid !== user.uid && !isAdmin
  const myListing = useMyEmailListing(emailFlow ? id : undefined, user?.uid)
  const flow = useCheckInFlow(id, user && app.data && !app.data.deleted && app.data.creatorUid !== user.uid && !isAdmin ? ownActive : undefined, builds.data.map((b) => b.id).join(','))

  if (app.error) return <ErrorBox text="Aplikasi gagal dimuat. Periksa koneksi, lalu coba lagi." onRetry={app.retry} />
  if (app.data === null || (app.data && app.data.deleted && !isAdmin)) return <NotFound what="Aplikasi" />
  if (!app.data || !progress) return <DetailSkeleton />

  const a = app.data
  const isCreator = !!user && (user.uid === a.creatorUid || isAdmin)
  const mine = user ? testers.data.find((t) => t.uid === user.uid) : undefined
  const loading = testers.loading || builds.loading
  const playUrl = a.storeUrl ?? a.optInUrl
  const optInUrl = a.optInUrl

  const needLogin = async (then: DialogKind) => {
    try {
      if (!user) await signIn()
      setDialog(then)
    } catch (e) { toast(failToast(e)) }
  }

  // ADR-009 §1: one primary per role, up to two secondary, the rest behind "…".
  const actions: Actions = (() => {
    if (isCreator) {
      const overflow: MenuItem[] = []
      if (a.storeUrl) overflow.push({ label: 'Buka halaman Play', href: a.storeUrl })
      overflow.push({ label: 'Buka link opt-in', href: a.optInUrl })
      overflow.push({ label: 'Bagikan ke WhatsApp', onSelect: () => shareToWhatsApp(a.name, openSeats(a), a.id) })
      return {
        primary: { label: 'Catat build', icon: <IconPlus />, onClick: () => setDialog('build') },
        secondary: [
          { label: 'Tambah tester manual', onClick: () => setDialog('manual') },
          { label: 'Edit aplikasi', to: `/apps/${a.id}/edit` },
        ],
        overflow,
      }
    }
    if (mine?.status === 'active') {
      const since = mine.feedbackSentAt ?? mine.optedInAt
      // A new build stops being "waiting" once this tester has checked in on it.
      const latest = builds.data[0]
      const buildWaiting = isNewBuild(a) && a.lastBuildAt != null && a.lastBuildAt > since && !(latest && flow.isDone('updated_build', latest.id))
      const leave: MenuItem = { label: 'Berhenti menguji', danger: true, onSelect: () => setDialog('leave') }
      const play: Action = { label: 'Buka link opt-in', icon: <IconExternal />, href: optInUrl }
      const editNote: Action = { label: 'Ubah catatan feedback', onClick: () => setDialog('feedback') }
      if (!mine.feedbackSent) return { primary: { label: 'Tandai sudah kirim', onClick: () => setDialog('feedback') }, secondary: [play], overflow: [leave] }
      if (buildWaiting) return { primary: { label: 'Uji build baru di Play', icon: <IconExternal />, href: optInUrl }, secondary: [editNote], overflow: [leave] }
      const next = flow.next
      if (next) {
        const primary: Action = { label: `Check-in: ${next.label}`, onClick: () => flow.run(next), busy: flow.pending === next.key, blocked: !!flow.pending && flow.pending !== next.key }
        return { primary, secondary: [play, editNote], overflow: [leave] }
      }
      return { secondary: [play, editNote], overflow: [leave] }
    }
    const optInAction: Action = { label: 'Buka link opt-in', icon: <IconExternal />, href: a.optInUrl }
    const storeOverflow: MenuItem[] = a.storeUrl ? [{ label: 'Halaman Play Store', href: a.storeUrl }] : []
    storeOverflow.push({ label: 'Bagikan ke WhatsApp', onSelect: () => shareToWhatsApp(a.name, openSeats(a), a.id) })
    if (mine?.status === 'removed') return { secondary: [optInAction], overflow: storeOverflow }
    if (a.testerMethod === 'email_list') {
      // The opt-in link only works once the creator has added this member's email in Play Console.
      const l = myListing.data
      if (user && myListing.loading) return { secondary: [], overflow: storeOverflow }
      if (!l) {
        return {
          primary: { label: 'Minta ditambahkan', onClick: () => needLogin('join') },
          secondary: [],
          overflow: storeOverflow,
          note: user
            ? 'Link opt-in bisa dibuka setelah creator menambahkan email Anda di Play Console.'
            : 'Anda diminta masuk dengan Google dulu. Link opt-in bisa dibuka setelah creator menambahkan email Anda.',
        }
      }
      if (l.listedAt == null) {
        return {
          secondary: [{ label: 'Lihat permintaan', onClick: () => setDialog('join') }],
          overflow: storeOverflow,
          note: `Menunggu creator menambahkan email Anda · diminta ${fmtDate(l.requestedAt)}.`,
        }
      }
      return {
        primary: { label: 'Gabung sebagai tester', onClick: () => setDialog('join') },
        secondary: [optInAction],
        overflow: storeOverflow,
        note: 'Email Anda sudah ditambahkan. Opt-in dengan akun Google yang sama.',
      }
    }
    return {
      primary: { label: 'Gabung sebagai tester', onClick: () => needLogin('join') },
      secondary: [optInAction],
      overflow: storeOverflow,
      note: user ? undefined : 'Anda diminta masuk dengan Google dulu.',
    }
  })()

  return (
    <>
      <Link to="/apps" className="crumb"><IconBack />Aplikasi</Link>
      <RecordHead app={a} p={progress} loading={testers.loading} actions={actions} assigned={myAssigned.data.get(a.id)} />

      <Finding app={a} p={progress} loading={loading} description={a.description} />

      {/* Hidden for a tester who already checked in "Sudah update" on this build (same rule as Tugas saya). */}
      {isNewBuild(a) && builds.data[0] && !(mine?.status === 'active' && flow.isDone('updated_build', builds.data[0].id)) && (
        <div className="notice info" role="status">
          <span><b>Build baru {builds.data[0].versionName}</b> · {relTime(builds.data[0].uploadedAt)}. Perbarui aplikasi dari Play Store, lalu uji lagi.</span>
          <span className="spacer" />
          <a className="link" href={playUrl} target="_blank" rel="noreferrer">Buka di Play</a>
        </div>
      )}

      <div className="grid">
        {/* KPIs move under the board only when the aside is clearly taller (few seats); otherwise full width below both. */}
        <div className="span-8 col-fill">
          <section className="panel" aria-labelledby="board-h" ref={kpiPlace.board}>
            <header>
              <h2 id="board-h" className="num">Menuju {progress.target} tester × 14 hari</h2>
              <BoardLegend />
            </header>
            {testers.error ? <ErrorBox text="Daftar tester gagal dimuat. Coba lagi sebentar lagi." onRetry={testers.retry} /> : <Board seats={progress.seats} loading={testers.loading} total={progress.target} counted={progress.testDay} />}
          </section>
          {kpiPlace.beside && <Kpis p={progress} app={a} loading={loading} />}
        </div>

        <aside className="span-4 col-fill" ref={kpiPlace.aside}>
          <InfoPanel app={a} p={progress} mine={mine} isCreator={isCreator} flow={flow} />
          <CreatorCard app={a} />
        </aside>

        {!kpiPlace.beside && <Kpis p={progress} app={a} loading={loading} wide />}

        <TesterTable
          app={a} testers={testers.data} loading={testers.loading} isCreator={isCreator} myUid={user?.uid}
          onEdit={(t) => setDialog({ tester: t })}
        />

        {a.testerMethod === 'email_list' && user?.uid === a.creatorUid && <EmailListPanel app={a} />}

        <section className="panel split-host span-12" aria-label="Build dan catatan feedback">
          <div className="split">
            <BuildLog builds={builds.data} loading={builds.loading} error={builds.error} retry={builds.retry} p={progress} app={a} isCreator={isCreator} />
            <FeedbackList testers={testers.data} loading={testers.loading} />
          </div>
        </section>
      </div>

      <JoinDialog open={dialog === 'join'} onClose={() => setDialog(null)} app={a} rejoin={mine?.status === 'left'} />
      <FeedbackDialog open={dialog === 'feedback'} onClose={() => setDialog(null)} app={a} entry={mine} />
      <BuildDialog open={dialog === 'build'} onClose={() => setDialog(null)} app={a} />
      <ManualTesterDialog open={dialog === 'manual'} onClose={() => setDialog(null)} app={a} />
      <TesterDialog open={typeof dialog === 'object' && dialog !== null} onClose={() => setDialog(null)} app={a} tester={typeof dialog === 'object' && dialog ? dialog.tester : undefined} />
      {mine?.status === 'active' && <LeaveDialog open={dialog === 'leave'} onClose={() => setDialog(null)} app={a} days={daysActive(mine)} />}
    </>
  )
}

// ---------- header zone: name, status, slot progress (ADR-012), the role's actions (ADR-009 §4) ----------

function ActionButton({ a, primary, small }: { a: Action; primary?: boolean; small?: boolean }) {
  const cls = `btn ${primary ? 'primary' : ''} ${small ? 'sm' : ''}`
  if (a.href) return <a className={cls} href={a.href} target="_blank" rel="noreferrer">{a.icon}{a.label}</a>
  if (a.to) return <Link className={cls} to={a.to}>{a.icon}{a.label}</Link>
  return (
    <button type="button" className={cls} onClick={a.blocked ? undefined : a.onClick} aria-busy={a.busy || undefined} aria-disabled={a.blocked || undefined}>
      {a.icon}{a.busy ? 'Menyimpan…' : a.label}
    </button>
  )
}

function RecordHead({ app, p, loading, actions, assigned }: {
  app: AppDoc; p: Progress; loading: boolean; actions: Actions; assigned?: { cohortId: string; name: string }
}) {
  const head = useRef<HTMLElement>(null)
  const [stuck, setStuck] = useState(false)
  // Once the header scrolls away, a slim bar keeps name, progress and the primary action in view.
  useEffect(() => {
    const el = head.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  // Google counts a day only while all slots are active together: the same clock as the board's pandan columns.
  const counted = Math.min(p.testDay, TARGET_DAYS)
  const count = loading ? <Skel w={56} h={24} /> : <><b>{counted}</b><small> / {TARGET_DAYS}</small></>
  const daysLabel = `${counted} dari ${TARGET_DAYS} hari terhitung, ${p.active} tester aktif dari ${p.target} kursi`
  return (
    <>
      <header ref={head} className="record-head">
        <div className="rh-main">
          <h1>{app.name}</h1>
          <div className="meta-line">
            <StatusPill status={app.status} />
            <Link to={`/u/${app.creatorUid}`} className="creator-link">
              <Avatar name={app.creatorName} photo={app.creatorPhotoURL} /><span>{app.creatorName}</span>
            </Link>
            {assigned && (
              // Reuses .creator-link (inline-flex, 44 px target, bold); the cohort name says where the assignment came from.
              <Link to={`/cohorts/${assigned.cohortId}`} className="creator-link">
                <AssignedChip /><span className="assigned-via">lewat {assigned.name}</span>
              </Link>
            )}
            {app.packageName && <span className="pkg">{app.packageName}</span>}
          </div>
        </div>
        <div className="rh-progress">
          <p className="rh-count num">{count}<span className="rh-label">hari terhitung</span></p>
          <Seats active={counted} eligible={counted} total={TARGET_DAYS} className="wide" label={daysLabel} />
          <p className="rh-sub num">{p.active >= p.target ? `${p.active} aktif · kursi penuh (${p.target})` : `${p.active} aktif dari ${p.target} kursi · hari mulai dihitung saat kursi penuh`}</p>
        </div>
        <div className="rh-actions">
          {actions.primary && <ActionButton a={actions.primary} primary />}
          {(actions.secondary.length > 0 || actions.overflow.length > 0) && (
            <div className="rh-more">
              {actions.secondary.slice(0, 2).map((a) => <ActionButton key={a.label} a={a} />)}
              <OverflowMenu items={actions.overflow} label="Aksi lain" />
            </div>
          )}
          {actions.note && <p className="muted small">{actions.note}</p>}
        </div>
      </header>
      <div className={`record-bar ${stuck ? 'show' : ''}`} inert={!stuck} aria-hidden={!stuck}>
        <span className="rb-name">{app.name}</span>
        <span className="rb-count num"><b>{Math.min(p.testDay, TARGET_DAYS)}</b> / {TARGET_DAYS}<span className="sr-only"> hari terhitung</span></span>
        {actions.primary && <ActionButton a={actions.primary} primary small />}
      </div>
    </>
  )
}

function Finding({ app, p, loading, description }: { app: AppDoc; p: Progress; loading: boolean; description: string }) {
  if (loading) return <div className="finding"><Skel w={420} h={20} /></div>
  // ADR-012 §4: what Google's 12 still needs from outside; community testers beyond the slots count too.
  const outside = p.target < TARGET_TESTERS ? TARGET_TESTERS - Math.max(p.active, p.target) : 0
  let text: string
  if (app.status === 'live') text = `Sudah rilis produksi. ${p.active} tester masih tercatat aktif.`
  else if (p.ready) text = `Siap ajukan akses produksi: ${p.eligible} tester sudah 14 hari berturut-turut.`
  else if (p.active < p.target) {
    const need = p.target - p.active
    // Not ready until the target-th seat is filled and then runs 14 days; the soonest tester's date unlocks nothing.
    text = `Butuh ${need} tester aktif lagi.` + (p.active > 0 ? ` Paling cepat siap 14 hari setelah kursi ke-${p.target} terisi.` : ' Belum ada yang mendaftar.')
  } else {
    // Ready only when the target-th most senior tester reaches 14 days, not the next one to pass.
    text = `Kursi sudah terisi; ${p.testDay} dari ${TARGET_DAYS} hari sudah terhitung.` +
      ` Siap ajukan paling cepat ${inDays(TARGET_DAYS - p.testDay)}, jika ${p.target} tester teratas tetap aktif.`
  }
  return (
    <div className="finding">
      <p className="verdict num">{text}</p>
      {outside > 0 && (
        <p className="muted small num">
          Target TesBareng: {p.target} tester{p.active > p.target && `, sudah ${p.active} aktif`}. Sisanya ({outside}) dari luar komunitas, dilaporkan sendiri oleh creator.
        </p>
      )}
      <p className="desc">{description}</p>
      {p.lowEngagement && app.status !== 'live' && (
        <p className="flag">
          <Chip glyph="!">Keterlibatan rendah</Chip>
          <span>{p.builds === 0 ? 'Belum ada build baru selama uji.' : 'Kurang dari separuh tester yang lulus 14 hari sudah kirim feedback.'} Google juga menilai feedback dan pembaruan, bukan hanya jumlah tester.</span>
        </p>
      )}
    </div>
  )
}

/** Context for the role; the actions themselves live in the header zone. */
function InfoPanel({ app, p, mine, isCreator, flow }: { app: AppDoc; p: Progress; mine?: TesterDoc; isCreator: boolean; flow: CheckInFlow }) {
  // Stamp the feedback chip only when "sent" flips on while this panel is open, not on every visit.
  const sentBefore = useRef(mine?.feedbackSent)
  const [stamp, setStamp] = useState(false)
  useEffect(() => {
    if (mine?.feedbackSent && sentBefore.current === false) setStamp(true)
    sentBefore.current = mine?.feedbackSent
  }, [mine?.feedbackSent])
  const guide = app.feedbackGuide ? (
    <div className="stack-8">
      <h3>Yang ingin diuji kreator</h3>
      <TestingMissions guide={app.feedbackGuide} appId={app.id} uid={mine?.uid ?? undefined} />
    </div>
  ) : (
    <p className="muted">Creator belum menulis panduan feedback. Ceritakan apa yang berjalan, apa yang rusak, dan apa yang perlu diperbaiki.</p>
  )

  if (isCreator) {
    return (
      <section className="panel stack-16" aria-label="Aplikasi Anda">
        <h2>Aplikasi Anda</h2>
        <dl className="kv">
          <dt>Feedback belum diverifikasi</dt><dd className="num">{p.feedbackSent - p.feedbackVerified}</dd>
          <dt>Feedback belum dibalas</dt><dd className="num">{p.feedbackSent - p.replied}</dd>
        </dl>
        <p className="muted small">Cek di Play Console → Testing feedback, lalu centang kolom Feedback di tabel tester.</p>
        {guide}
      </section>
    )
  }

  if (mine?.status === 'active') {
    const d = daysActive(mine)
    return (
      <section className="panel stack-16" aria-label="Status Anda sebagai tester">
        <div>
          <h2>Anda tester di sini</h2>
          <p className="lead-num num" style={{ marginTop: 'var(--s-2)' }}>{Math.min(d, 999)}<small> / {TARGET_DAYS} hari</small></p>
          <div style={{ marginTop: 'var(--s-2)' }}><Bar value={Math.min(d, TARGET_DAYS)} max={TARGET_DAYS} label="Hari aktif Anda" /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--s-2)' }}>
            <p className="muted small num" style={{ margin: 0 }}>Sejak {fmtDate(mine.optedInAt)}. Jangan uninstall sebelum 14 hari.</p>
            {mine.optedInAt && (
              <button
                type="button"
                className="text-action"
                style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                onClick={() => {
                  const targetDay = d < 5 ? 5 : TARGET_DAYS;
                  const targetTime = new Date(mine.optedInAt + targetDay * 24 * 60 * 60 * 1000);
                  const title = targetDay === 5 ? 'Kirim feedback Play Store: ' + app.name : 'Selesai 14 hari uji: ' + app.name;
                  const desc = 'Buka TesBareng untuk check-in pengujian aplikasi ' + app.name + ': ' + window.location.href;
                  window.open(createCalendarUrl(title, desc, targetTime), '_blank');
                }}
                title="Pasang pengingat jadwal di Google Calendar"
              >
                + Pengingat Kalender
              </button>
            )}
          </div>
        </div>
        <CheckIns flow={flow} />
        {mine.feedbackSent ? (
          <div className="stack-8">
            <p className="creator-nums">
              <span className="strong">Feedback</span>
              <FeedbackChip t={mine} className={stamp ? 'stamp' : undefined} />
              {mine.feedbackSentAt && <RelTime t={mine.feedbackSentAt} />}
              {mine.replied && <span className="muted small">sudah dibalas</span>}
            </p>
            {mine.feedbackSummary && <p className="guide-quote">{mine.feedbackSummary}</p>}
          </div>
        ) : guide}
      </section>
    )
  }

  if (mine?.status === 'removed') {
    return (
      <section className="panel stack-8" aria-label="Status Anda">
        <h2>Anda dikeluarkan</h2>
        <p className="muted">Creator mengeluarkan Anda dari daftar tester aplikasi ini{mine.note ? `: “${mine.note}”` : '.'} Hubungi creator lewat grup jika ini keliru.</p>
      </section>
    )
  }

  return (
    <section className="panel stack-16" aria-label="Ikut menguji">
      <h2>{mine?.status === 'left' ? 'Uji lagi aplikasi ini' : 'Ikut menguji'}</h2>
      {mine?.status === 'left' && <p className="muted">Anda berhenti pada {fmtDate(mine.leftAt)}. Gabung lagi memulai hitungan 14 hari dari awal.</p>}
      {guide}
      {app.testerMethod === 'email_list'
        ? <p className="muted small">Aplikasi ini memakai daftar email: minta ditambahkan, tunggu creator menambahkan email Anda, lalu opt-in dan pasang aplikasinya. Mulai dari tombol di atas.</p>
        : <p className="muted small">Butuh 3 langkah: gabung grup, buka link opt-in, pasang aplikasinya. Mulai dari tombol Gabung sebagai tester di atas.</p>}
    </section>
  )
}

// ---------- milestone check-ins (PRD §6.10, FR-39–41): own Active entry only ----------

/** Done build rows shown before "Lihat semua" (builds still owed are always shown). */
const FEW_BUILDS = 3
const TICK_MS = 60_000

/** One fetch shared by the header primary and the panel. `entry` is the member's own Active entry, else undefined. */
function useCheckInFlow(appId: string | undefined, entry: TesterDoc | undefined, buildsKey: string) {
  const toast = useToast()
  const state = useCheckIns(appId, entry?.id, entry?.uid, buildsKey)
  // A recorded check-in shows as done at once and stays done until the refetch contains it,
  // so the button never comes back for a moment between the RPC and the refetch.
  const [optimistic, setOptimistic] = useState<CheckIn[]>([])
  const [pending, setPending] = useState<string | null>(null)
  // Stamp (and move focus to) a row only when its check-in was just recorded here, not on every visit.
  const [justDone, setJustDone] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const serverIds = new Set(state.data.checkIns.map((c) => c.id))
  const extra = optimistic.filter((c) => !serverIds.has(c.id))
  const data = extra.length ? { ...state.data, checkIns: [...state.data.checkIns, ...extra] } : state.data
  const result = entry ? milestones(data, entry.optedInAt, now) : null

  useEffect(() => {
    if (optimistic.length && optimistic.every((c) => serverIds.has(c.id))) setOptimistic([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data])

  // Windows open and due times pass while the tab stays focused: re-render every minute, or at the next boundary.
  const nextBoundary = result?.items.flatMap((m) => [m.opensAt, m.dueAt ?? Infinity]).filter((t) => t > now).reduce((a, b) => Math.min(a, b), Infinity) ?? Infinity
  useEffect(() => {
    if (!entry) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(1000, Math.min(TICK_MS, nextBoundary - now + 50)))
    return () => window.clearTimeout(timer)
  }, [entry, now, nextBoundary])

  const run = async (m: Milestone) => {
    if (pending || !appId) return
    setPending(m.key)
    try {
      const id = await checkIn(appId, m.kind, m.buildId)
      setOptimistic((xs) => [...xs, { id, kind: m.kind, buildId: m.buildId ?? null, createdAt: Date.now() }])
      setJustDone(m.key)
      setPending(null)
      toast(`Check-in “${m.label}” tercatat.`)
      state.retry()
    } catch (e) {
      setPending(null)
      toast(failToast(e))
      // Already recorded elsewhere, or the window/status changed: show the server's truth.
      if (errorCode(e) === 'already-exists' || errorCode(e) === 'failed-precondition') state.retry()
    }
  }

  // ADR-009 §1: the tester's next step is the next open check-in: overdue first, then the earliest due, else the earliest opened.
  const next = result?.items
    .filter((m) => m.open && !m.done)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.opensAt - b.opensAt)[0]

  const isDone = (kind: CheckIn['kind'], buildId: string | null = null) => data.checkIns.some((c) => c.kind === kind && c.buildId === buildId)

  return { state, result, pending, justDone, run, next, isDone, loading: state.loading, error: state.error }
}
type CheckInFlow = ReturnType<typeof useCheckInFlow>

function CheckIns({ flow }: { flow: CheckInFlow }) {
  const { state, result, pending, justDone } = flow
  const listRef = useRef<HTMLUListElement>(null)
  const [allBuilds, setAllBuilds] = useState(false)
  const items = result?.items ?? []
  const done = items.filter((m) => m.done).length
  const justDoneShown = !!justDone && items.some((m) => m.key === justDone && m.done)

  useEffect(() => {
    // The button the user pressed is gone; put focus on the row's new status so keyboard users stay in place.
    // (A check-in started from the header keeps focus there: the header's next primary takes its place.)
    const el = listRef.current?.querySelector<HTMLElement>(`[data-ci="${justDone}"]`)
    const lost = document.activeElement === document.body || !!listRef.current?.contains(document.activeElement)
    if (justDoneShown && el && lost) el.focus()
  }, [justDoneShown, justDone])

  // Builds still owed are always visible; only done ones collapse behind "Lihat semua".
  const buildRows = items.filter((m) => m.kind === 'updated_build')
  const hasBuilds = buildRows.length > 0
  const doneBuilds = buildRows.filter((m) => m.done)
  const doneShown = Math.max(0, FEW_BUILDS - (buildRows.length - doneBuilds.length))
  const hiddenBuilds = new Set(allBuilds ? [] : doneBuilds.slice(doneShown).map((m) => m.key))

  return (
    <section className="stack-8 ci" aria-labelledby="ci-h">
      <div className="ci-head">
        <h3 id="ci-h">Check-in</h3>
        {!state.loading && !state.error && <span className="meta num">{done} / {items.length} tercatat</span>}
      </div>
      <p className="muted small">Check-in berdasarkan kejujuran. Bukti terkuat tetap feedback yang diverifikasi creator di Play Console.</p>
      {state.error ? <ErrorBox text="Check-in gagal dimuat. Coba lagi sebentar lagi." onRetry={state.retry} /> : state.loading || !result ? (
        <div aria-busy="true">
          <span className="sr-only">Memuat check-in…</span>
          {[0, 1, 2].map((i) => <div className="row-line" key={i}><span className="grow"><Skel w={140} /></span><Skel w={80} h={28} /></div>)}
        </div>
      ) : (
        <ul className="ci-list" id="ci-list" ref={listRef}>
          {items.filter((m) => !hiddenBuilds.has(m.key)).map((m) => {
            const row = (
              <CheckInRow key={m.key} m={m} busy={pending === m.key} blocked={!!pending && pending !== m.key} stamp={justDone === m.key} onCheckIn={() => flow.run(m)} />
            )
            // "Sudah update" sits between the two fixed milestones; before the first build it explains itself.
            if (m.kind === 'still_opted_in' && !hasBuilds) {
              return (
                <Fragment key="no-build">
                  <li className="row-line top">
                    <span className="grow cell-2">
                      <b>Sudah update</b>
                      <span>Terbuka setiap kali creator mencatat build baru.</span>
                    </span>
                    <Chip glyph="—">Belum ada build</Chip>
                  </li>
                  {row}
                </Fragment>
              )
            }
            return row
          })}
        </ul>
      )}
      {doneBuilds.length > doneShown && (
        <ShowAll open={allBuilds} total={buildRows.length} onToggle={() => setAllBuilds((x) => !x)} controls="ci-list" />
      )}
      {result?.inCohort && !state.loading && !state.error && (
        <p className="muted small num">Hari dihitung dari penugasan cohort Anda, <span className="nw">{fmtDate(result.base)}</span>.</p>
      )}
    </section>
  )
}

function CheckInRow({ m, busy, blocked, stamp, onCheckIn }: { m: Milestone; busy: boolean; blocked: boolean; stamp: boolean; onCheckIn: () => void }) {
  // Cohort due line (PRD §6.10 due times). Overdue reads in text and with the cabai "!" chip, never colour alone.
  // Day numbers and dates never break mid-token in the narrow aside ("ke-/5", "6/Nov").
  // Times are plain text with the exact WIB time, so there is nothing small to tap.
  const nw = (x: ReactNode) => <span className="nw">{x}</span>
  // "30 Okt 2026, 13.53 WIB": the date and the time each stay whole, but may sit on two lines in the narrow aside.
  const at = (t: number) => { const [d, ...rest] = fmtDateTime(t).split(', '); return <>{nw(d)}{rest.length > 0 && <>, {nw(rest.join(', '))}</>}</> }
  const dueText = m.dueAt == null ? null : <>{m.dueDay != null && <>{nw(`hari ke-${m.dueDay}`)}: </>}{at(m.dueAt)}</>
  const dueLine = dueText && !m.done && (
    <span className="num">{m.overdue ? <><Chip tone="cabai" glyph="!">Lewat tenggat</Chip> {dueText}</> : <>Tenggat {dueText}</>}</span>
  )
  let when: ReactNode
  let side: ReactNode
  if (m.done) {
    when = <>Dicatat {at(m.done.createdAt)}</>
    side = (
      <span tabIndex={-1} data-ci={m.key} className="ci-status">
        <span className="sr-only">{m.label}: </span>
        <Chip tone="pandan" glyph="✓" className={stamp ? 'stamp' : undefined}>Tercatat</Chip>
      </span>
    )
  } else if (!m.open) {
    // Not open yet: no button and no chip; the sentence says when it opens (the server would refuse earlier).
    when = <>Dibuka mulai {nw(`hari ke-${m.opensDay}`)}: {at(m.opensAt)}</>
    side = null
  } else {
    when = m.kind === 'updated_build' ? <>Build dicatat {at(m.opensAt)}</> : <>Terbuka sejak {nw(`hari ke-${m.opensDay}`)}</>
    side = (
      <button
        type="button" className="btn sm" onClick={() => { if (!blocked) onCheckIn() }}
        aria-busy={busy || undefined} aria-disabled={blocked || undefined} aria-label={busy ? undefined : `Check-in: ${m.label}`}
      >
        {busy ? 'Menyimpan…' : 'Check-in'}
      </button>
    )
  }
  return (
    <li className="row-line top">
      <span className="grow cell-2">
        <b>{m.label}</b>
        <span className="num">{when}</span>
        {dueLine}
      </span>
      {side}
    </li>
  )
}

function LeaveDialog({ open, onClose, app, days }: { open: boolean; onClose: () => void; app: AppDoc; days: number }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const leave = async () => {
    if (busy) return
    setBusy(true)
    try { await api.leaveTesting({ appId: app.id }); toast('Anda berhenti menguji aplikasi ini.'); onClose() } catch (e) { toast(failToast(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} label={`Berhenti menguji ${app.name}?`}>
      <div className="sheet-body">
        <h2>Berhenti menguji {app.name}?</h2>
        <p className="lede">Hari aktif Anda ({days} hari) berhenti dihitung. Jika gabung lagi, hitungan 14 hari mulai dari awal.</p>
      </div>
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={onClose}>Tetap menguji</button>
        <button type="button" className="btn danger" onClick={leave} aria-busy={busy || undefined}>{busy ? 'Menyimpan…' : 'Berhenti menguji'}</button>
      </div>
    </Dialog>
  )
}

// Where the KPI block goes on wide screens: under the board (2 × 2) when the aside outgrows the board by more than
// about half that block, so either placement leaves the smaller hole. Board and aside heights do not depend on it.
const KPI_BESIDE_MIN = 130
function useKpiPlacement(ready: boolean) {
  const board = useRef<HTMLElement>(null)
  const aside = useRef<HTMLElement>(null)
  const [beside, setBeside] = useState(false)
  useEffect(() => {
    const b = board.current
    const s = aside.current
    if (!ready || !b || !s || typeof ResizeObserver === 'undefined') return
    const wide = window.matchMedia('(min-width: 1024px)')
    const check = () => setBeside(wide.matches && s.offsetHeight - b.offsetHeight > KPI_BESIDE_MIN)
    const ro = new ResizeObserver(check)
    ro.observe(b)
    ro.observe(s)
    wide.addEventListener('change', check)
    check()
    return () => { ro.disconnect(); wide.removeEventListener('change', check) }
  }, [ready])
  return { board, aside, beside }
}

function Kpis({ p, app, loading, wide }: { p: Progress; app: AppDoc; loading: boolean; wide?: boolean }) {
  const v = (x: ReactNode) => (loading ? <Skel w={64} h={24} /> : x)
  return (
    <section className={wide ? 'kpis span-12' : 'kpis'} aria-label="Ringkasan keterlibatan">
      <div className="kpi">
        <div className="kpi-label">Tester aktif</div>
        <div className="kpi-value num">{v(<>{p.active}<small> / {p.target}</small></>)}</div>
        <div style={{ marginTop: 'var(--s-2)' }}><Bar value={p.active} max={p.target} label="Tester aktif" /></div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Feedback di Play</div>
        <div className="kpi-value num">{v(<>{p.feedbackSent}<small> terkirim</small></>)}</div>
        <p className="note num">{p.feedbackVerified} terverifikasi creator</p>
      </div>
      <div className="kpi">
        <div className="kpi-label">Dibalas creator</div>
        <div className="kpi-value num">{v(p.feedbackSent === 0 ? <span className="dash">—</span> : <>{p.replied}<small> / {p.feedbackSent}</small></>)}</div>
        <p className="note">{p.feedbackSent === 0 ? 'Belum ada feedback untuk dibalas' : 'dari tester yang kirim feedback'}</p>
      </div>
      <div className="kpi">
        <div className="kpi-label">Build selama uji</div>
        <div className="kpi-value num">{v(<>{p.builds}<small> / {TARGET_BUILDS}</small></>)}</div>
        <p className="note">{app.lastBuildAt ? `Terakhir ${relTime(app.lastBuildAt)}` : 'Target komunitas, bukan aturan Google'}</p>
      </div>
    </section>
  )
}

// ---------- helper functions: share to WhatsApp, Google Calendar reminder, Testing Missions ----------

function shareToWhatsApp(appName: string, openCount: number, appId: string) {
  const url = window.location.origin + '/apps/' + appId;
  const needed = openCount > 0 ? openCount + ' ' : '';
  const text = 'Halo teman-teman! Saya butuh ' + needed + 'tester untuk aplikasi "' + appName + '" di TesBareng agar lolos 14 hari Google Play.\n\n📲 Bantu uji di sini: ' + url + '\n✨ Ada sistem timbal balik (reciprocity), saya siap tes balik aplikasi kalian! 🙌';
  window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
}

function createCalendarUrl(title: string, details: string, targetDate: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = targetDate.getFullYear();
  const m = pad(targetDate.getMonth() + 1);
  const d = pad(targetDate.getDate());
  const dates = y + m + d + '/' + y + m + d;
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&details=' + encodeURIComponent(details) + '&dates=' + dates;
}

function TestingMissions({ guide, appId, uid }: { guide: string; appId: string; uid?: string | null }) {
  const key = 'tb_missions_' + appId + '_' + (uid ?? 'anon');
  const lines = useMemo(() => {
    return guide
      .split('\n')
      .map((l) => l.trim().replace(/^[-*•\d.]+\s*/, ''))
      .filter((l) => l.length > 0);
  }, [guide]);

  const [done, setDone] = useState<Record<number, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}');
    } catch {
      return {};
    }
  });

  const toggle = (idx: number) => {
    setDone((prev) => {
      const next = { ...prev, [idx]: !prev[idx] };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  if (lines.length <= 1) {
    return <p className="guide-quote">{guide}</p>;
  }

  const completed = lines.filter((_, i) => done[i]).length;

  return (
    <div className="stack-8" style={{ marginTop: 'var(--s-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="small muted">Misi pengujian fitur:</span>
        <span className="small num muted">{completed} / {lines.length} dicoba</span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
        {lines.map((line, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s-2)', fontSize: '0.9rem' }}>
            <input
              type="checkbox"
              id={'mission-' + i}
              checked={!!done[i]}
              onChange={() => toggle(i)}
              style={{ marginTop: '0.2rem', cursor: 'pointer' }}
            />
            <label htmlFor={'mission-' + i} style={{ cursor: 'pointer', textDecoration: done[i] ? 'line-through' : 'none', opacity: done[i] ? 0.7 : 1 }}>
              {line}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- tester table: 4 fields per row, details behind a tap, inline edits (ADR-009 §3) ----------

function downloadTestersCsv(appName: string, testers: TesterDoc[]) {
  const headers = ['Nama', 'Email', 'Hari Aktif', 'Status', 'Feedback Terkirim', 'Feedback Terverifikasi', 'Dibalas Kreator', 'Tanggal Gabung'];
  const now = Date.now();
  const rows = testers.map((t) => [
    '"' + t.displayName.replace(/"/g, '""') + '"',
    '"' + (t.maskedEmail ?? '') + '"',
    daysActive(t, now),
    '"' + testerStatusLabel[t.status] + '"',
    t.feedbackSent ? 'Ya' : 'Tidak',
    t.feedbackVerified ? 'Ya' : 'Tidak',
    t.replied ? 'Ya' : 'Tidak',
    t.optedInAt ? new Date(t.optedInAt).toISOString().split('T')[0] : '',
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const cleanName = appName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  link.href = url;
  link.setAttribute('download', 'testers-' + cleanName + '-' + new Date().toISOString().split('T')[0] + '.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

type SortKey = 'name' | 'days'
type Quick = Partial<Pick<TesterDoc, 'feedbackVerified' | 'replied' | 'status'>>

function TesterTable({ app, testers, loading, isCreator, myUid, onEdit }: {
  app: AppDoc; testers: TesterDoc[]; loading: boolean; isCreator: boolean; myUid?: string; onEdit: (t: TesterDoc) => void
}) {
  const toast = useToast()
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'days', dir: 'desc' })
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set())
  const [historyOpen, setHistoryOpen] = useState(false)
  // Optimistic inline edits: shown at once, dropped when the server row agrees (or rolled back on error).
  const [over, setOver] = useState<Record<string, Quick>>({})
  useEffect(() => {
    setOver((o) => {
      let changed = false
      const n = { ...o }
      for (const id of Object.keys(n)) {
        const t = testers.find((x) => x.id === id)
        if (!t || Object.entries(n[id]).every(([k, v]) => t[k as keyof Quick] === v)) { delete n[id]; changed = true }
      }
      return changed ? n : o
    })
  }, [testers])

  const now = Date.now()
  const rows = useMemo(() => testers.map((t) => (over[t.id] ? { ...t, ...over[t.id] } : t)), [testers, over])
  const active = useMemo(() => {
    const m = sort.dir === 'asc' ? 1 : -1
    return rows.filter((t) => t.status === 'active').sort((a, b) => sort.key === 'name'
      ? m * a.displayName.localeCompare(b.displayName, 'id')
      : m * (daysActive(a, now) - daysActive(b, now)) || a.displayName.localeCompare(b.displayName, 'id'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort])
  const history = useMemo(() => rows.filter((t) => t.status !== 'active').sort((a, b) => (b.leftAt ?? 0) - (a.leftAt ?? 0)), [rows])
  // FR-27j: badge beside each member's name; manual entries (no uid) have none
  const badges = useBadgesOf(testers.filter((t) => t.uid).map((t) => t.uid!)).data

  const save = async (server: TesterDoc, change: Quick, msg: string, undo?: Quick) => {
    setOver((o) => ({ ...o, [server.id]: { ...o[server.id], ...change } }))
    try {
      await updateTesterAsCreator(app.id, server, change)
      if (undo) {
        const after = { ...server, ...change }
        toast({ text: msg, duration: 8000, action: { label: 'Urungkan', onClick: () => { void save(after, undo, `Status ${server.displayName} dikembalikan.`) } } })
      } else toast(msg)
    } catch (e) {
      setOver((o) => {
        const n = { ...o }
        const rest = { ...n[server.id] }
        for (const k of Object.keys(change)) delete rest[k as keyof Quick]
        if (Object.keys(rest).length) n[server.id] = rest
        else delete n[server.id]
        return n
      })
      toast(failToast(e))
    }
  }
  const serverOf = (id: string) => testers.find((t) => t.id === id)!
  const setVerified = (t: TesterDoc, v: boolean) =>
    save(serverOf(t.id), { feedbackVerified: v }, v ? `Feedback ${t.displayName} ditandai terverifikasi.` : `Tanda terverifikasi ${t.displayName} dicabut.`)
  const setReplied = (t: TesterDoc, v: boolean) =>
    save(serverOf(t.id), { replied: v }, v ? `${t.displayName} ditandai sudah dibalas.` : `Tanda dibalas ${t.displayName} dicabut.`)
  const setStatus = (t: TesterDoc, s: TesterStatus) => {
    const server = serverOf(t.id)
    return save(server, { status: s }, `${t.displayName} sekarang ${testerStatusLabel[s].toLowerCase()}.`, { status: server.status })
  }

  const toggle = (id: string) => setOpenRows((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const th = (key: SortKey, label: string, num = false, extra = '') => {
    const on = sort.key === key
    return (
      <th className={`${num ? 'num' : ''} ${extra}`} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={`sort ${on ? 'on' : ''}`} onClick={() => setSort({ key, dir: on && sort.dir === 'desc' ? 'asc' : 'desc' })}>
          {label}{on ? <IconSort dir={sort.dir} /> : <IconSortNone className="idle" />}
        </button>
      </th>
    )
  }
  const COLS = 4

  const row = (t: TesterDoc) => {
    const d = daysActive(t, now)
    const me = !!t.uid && t.uid === myUid
    const isOpen = openRows.has(t.id)
    const detailId = `tester-${t.id}`
    return (
      <Fragment key={t.id}>
        <tr className={`${t.status !== 'active' ? 'muted' : ''} ${me ? 'mine' : ''} ${isOpen ? 'open' : ''}`}>
          <td className="sticky">
            <span className="who">
              <button type="button" className="disclose" aria-expanded={isOpen} aria-controls={isOpen ? detailId : undefined} onClick={() => toggle(t.id)}>
                <IconChevron /><span className="sr-only">Detail {t.displayName}</span>
              </button>
              <Avatar name={t.displayName} photo={t.photoURL} />
              <span className="name-with-badge">
                {t.uid ? <Link className="name-link" to={`/u/${t.uid}`}><b>{t.displayName}</b></Link> : <b>{t.displayName}</b>}
                <Badge tier={t.uid ? badges.get(t.uid) : undefined} size="sm" />
                {me && <span className="you">Anda</span>}
              </span>
            </span>
          </td>
          <td className="num"><b>{d}</b><span className="of"> / {TARGET_DAYS}</span></td>
          <td><TesterChip t={t} days={d} /></td>
          <td>
            <span className="fb-cell">
              <FeedbackChip t={t} />
              {isCreator && (
                <label className="tick" title="Saya melihat feedback-nya di Play Console">
                  <input type="checkbox" checked={t.feedbackVerified} onChange={(e) => setVerified(t, e.target.checked)}
                    aria-label={`Feedback ${t.displayName} terverifikasi di Play Console`} />
                </label>
              )}
            </span>
          </td>
        </tr>
        {isOpen && (
          <tr className="detail" id={detailId}>
            <td colSpan={COLS}>
              <div className="detail-body">
                <dl className="facts">
                  <div><dt>Opt-in sejak</dt><dd className="num">{fmtDate(t.optedInAt)}</dd></div>
                  {t.status !== 'active' && t.leftAt && <div><dt>{t.status === 'removed' ? 'Dikeluarkan' : 'Berhenti'}</dt><dd className="num">{fmtDate(t.leftAt)}</dd></div>}
                  <div><dt>Email</dt><dd>{t.maskedEmail}</dd></div>
                  {!isCreator && <div><dt>Dibalas creator</dt><dd>{t.replied ? 'Sudah' : 'Belum'}</dd></div>}
                  <div><dt>Catatan</dt><dd>{t.note || (t.addedBy === 'creator' ? 'Ditambahkan creator' : '—')}</dd></div>
                </dl>
                {t.feedbackSummary && t.status !== 'removed' && <p className="guide-quote">{t.feedbackSummary}</p>}
                {isCreator && (
                  <div className="detail-edit">
                    <label className="check">
                      <input type="checkbox" checked={t.replied} onChange={(e) => setReplied(t, e.target.checked)} />
                      <span><span className="t">Sudah saya balas</span><span className="d">Balasan dikirim dari Play Console.</span></span>
                    </label>
                    <div className="field">
                      <label htmlFor={`st-${t.id}`}>Status</label>
                      <select id={`st-${t.id}`} className="input" value={t.status} onChange={(e) => setStatus(t, e.target.value as TesterStatus)} aria-describedby={`st-${t.id}-hint`}>
                        {(['active', 'left', 'removed'] as TesterStatus[]).map((s) => <option key={s} value={s}>{testerStatusLabel[s]}</option>)}
                      </select>
                      <span className="hint" id={`st-${t.id}-hint`}>Tester yang dikeluarkan tidak bisa gabung lagi ke aplikasi ini.</span>
                    </div>
                    <button type="button" className="btn sm" onClick={() => onEdit(serverOf(t.id))}>Ubah catatan atau tanggal opt-in</button>
                  </div>
                )}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <section className="panel flush span-12" aria-labelledby="testers-h">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 id="testers-h">Daftar tester</h2>
          <span className="meta num">{active.length} aktif{history.length > 0 ? ` · ${history.length} riwayat` : ''}</span>
        </div>
        {testers.length > 0 && (
          <button
            type="button"
            className="btn sm"
            onClick={() => downloadTestersCsv(app.name, testers)}
            title="Unduh daftar tester dalam format CSV"
          >
            Ekspor CSV
          </button>
        )}
      </header>
      {/* One sheet on every width (CLAUDE.md, DR-14): it scrolls inside its own box, so the header row
          and the name column both stay put. */}
      <div className="table-wrap sheet-scroll" style={{ marginTop: 'var(--s-3)' }} tabIndex={0} role="region" aria-labelledby="testers-h">
        <table className="data sheet-table">
          <thead>
            <tr>
              {th('name', 'Nama', false, 'sticky')}
              {th('days', 'Hari aktif', true)}
              <th>Status</th>
              <th>{isCreator ? 'Feedback · verifikasi' : 'Feedback di Play'}</th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 4 }, (_, i) => (
              <tr key={i}><td className="sticky"><Skel w={140} /></td><td className="num"><Skel w={40} /></td><td><Skel w={90} h={24} /></td><td><Skel w={110} h={24} /></td></tr>
            ))}
            {!loading && active.map(row)}
            {!loading && active.length === 0 && history.length > 0 && (
              <tr><td colSpan={COLS} className="muted">Belum ada tester aktif. Bagikan halaman ini di grup WhatsApp cohort.</td></tr>
            )}
          </tbody>
          {!loading && history.length > 0 && (
            <tbody className="history">
              <tr className="group-row">
                <th colSpan={COLS} scope="rowgroup">
                  <button type="button" className="group-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen((o) => !o)}>
                    <IconChevron />Riwayat <span className="num">({history.length})</span>
                    <span className="muted small">berhenti atau dikeluarkan</span>
                  </button>
                </th>
              </tr>
              {historyOpen && history.map(row)}
            </tbody>
          )}
        </table>
      </div>
      {!loading && testers.length > 0 && <p className="meta small scroll-hint" style={{ padding: '0 var(--s-3) var(--s-3)' }}>Geser tabel ke samping untuk melihat status dan feedback.</p>}
      {!loading && testers.length === 0 && (
        <div className="empty-pad">
          {/* ADR-001 §2.6: spot illustration for the empty tester list goes in Empty's `art` slot. */}
          <Empty title="Belum ada tester. Kursi pertama masih kosong.">
            <p>{isCreator ? 'Bagikan halaman ini di grup WhatsApp cohort, atau tambahkan tester yang sudah opt-in lewat Tambah tester manual.' : 'Jadilah tester pertama lewat tombol Gabung sebagai tester.'}</p>
          </Empty>
        </div>
      )}
    </section>
  )
}

// ---------- build log: an activity timeline, newest first, grouped by WIB day (ADR-009 §4) ----------

const FEW = 4

function groupByDay<T>(items: T[], at: (x: T) => number) {
  const out: { key: string; t: number; items: T[] }[] = []
  for (const x of items) {
    const key = isoDate(at(x))
    const last = out[out.length - 1]
    if (last && last.key === key) last.items.push(x)
    else out.push({ key, t: at(x), items: [x] })
  }
  return out
}

function BuildLog({ builds, loading, error, retry, p, app, isCreator }: {
  builds: BuildDoc[]; loading: boolean; error: string | null; retry: () => void; p: Progress; app: AppDoc; isCreator: boolean
}) {
  const [all, setAll] = useState(false)
  const sorted = useMemo(() => [...builds].sort((a, b) => b.uploadedAt - a.uploadedAt), [builds])
  const groups = groupByDay(all ? sorted : sorted.slice(0, FEW), (b) => b.uploadedAt)
  return (
    <section aria-labelledby="builds-h">
      <header>
        <h2 id="builds-h">Log build</h2>
        <span className="meta num">{p.builds} selama uji{app.testStartDate ? ` sejak ${fmtDate(app.testStartDate)}` : ''}</span>
      </header>
      {error ? <ErrorBox text="Log build gagal dimuat. Coba lagi sebentar lagi." onRetry={retry} /> : loading ? (
        <div>{[0, 1, 2].map((i) => <div className="row-line" key={i}><span className="grow"><Skel w={120} /></span><Skel w={60} /></div>)}</div>
      ) : sorted.length === 0 ? (
        <Empty title="Belum ada build yang dicatat.">
          <p>{isCreator ? 'Catat setiap unggahan ke jalur uji tertutup lewat tombol Catat build di atas. Target komunitas: 2–3 build selama uji.' : 'Tester menunggu pembaruan untuk diuji ulang. Target komunitas: 2–3 build selama uji.'}</p>
        </Empty>
      ) : (
        <div className="timeline" id="build-list">
          {groups.map((g) => (
            <div className="tl-day" key={g.key}>
              <h3 className="tl-date num">{fmtDayHeading(g.t)}</h3>
              <ol>
                {g.items.map((b) => (
                  <li className="row-line" key={b.id}>
                    <span className="grow cell-2"><b>{b.versionName}</b><span>{b.changelog}</span></span>
                    <RelTime t={b.uploadedAt} />
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      {sorted.length > FEW && <ShowAll open={all} total={sorted.length} onToggle={() => setAll((x) => !x)} controls="build-list" />}
    </section>
  )
}

function FeedbackList({ testers, loading }: { testers: TesterDoc[]; loading: boolean }) {
  const [all, setAll] = useState(false)
  const withSummary = testers
    .filter((t) => t.feedbackSent && t.feedbackSummary && t.status !== 'removed')
    .sort((a, b) => (b.feedbackSentAt ?? 0) - (a.feedbackSentAt ?? 0))
  const shown = all ? withSummary : withSummary.slice(0, FEW)
  return (
    <section aria-labelledby="fb-h">
      <header>
        <h2 id="fb-h">Catatan feedback tester</h2>
        <span className="meta num">{withSummary.length} catatan</span>
      </header>
      {loading ? (
        <div>{[0, 1, 2].map((i) => <div className="row-line" key={i}><span className="grow"><Skel w={200} /></span></div>)}</div>
      ) : shown.length === 0 ? (
        <Empty title="Belum ada catatan feedback.">
          <p>Tester bisa menulis ringkasan saat menekan Tandai sudah kirim.</p>
        </Empty>
      ) : (
        <ul id="fb-list">
          {shown.map((t) => (
            <li className="row-line top" key={t.id}>
              <Avatar name={t.displayName} photo={t.photoURL} />
              <span className="grow">
                <span className="fb-head">
                  <b>{t.displayName}</b>
                  <span className="creator-nums">{t.feedbackSentAt && <RelTime t={t.feedbackSentAt} />}{t.feedbackVerified && <FeedbackChip t={t} />}</span>
                </span>
                {(() => {
                  const m = t.feedbackSummary?.match(/^\[([^\]]+)\]\s*(.*)$/s);
                  if (m) {
                    return (
                      <span className="fb-text">
                        <span className="chip sm" style={{ marginRight: 'var(--s-2)', display: 'inline-block' }}>{m[1]}</span>
                        {m[2]}
                      </span>
                    );
                  }
                  return <span className="fb-text">{t.feedbackSummary}</span>;
                })()}
              </span>
            </li>
          ))}
        </ul>
      )}
      {withSummary.length > FEW && <ShowAll open={all} total={withSummary.length} onToggle={() => setAll((x) => !x)} controls="fb-list" />}
    </section>
  )
}

// ---------- email-list testing (ADR-011): the creator's own view only ----------

function EmailListPanel({ app }: { app: AppDoc }) {
  const toast = useToast()
  const list = useEmailListings(app.id)
  const [busy, setBusy] = useState<string | null>(null)
  const pending = list.data.filter((r) => r.listedAt == null)
  // ADR-012 "Building on ADR-011": full stays joinable, so the creator decides whether to list more; show the seats to decide by.
  const open = openSeats(app)
  const copy = async (emails: string[]) => {
    try {
      await navigator.clipboard.writeText(emails.join(', '))
      toast(`${emails.length} email disalin. Tempel di Play Console → Uji tertutup → Penguji → daftar email.`)
    } catch { toast('Gagal menyalin. Pilih dan salin emailnya manual.') }
  }
  const mark = async (uid: string, listed: boolean) => {
    if (busy) return
    setBusy(uid)
    try { await markEmailListed(app.id, uid, listed); list.refresh() } catch (e) { toast(failToast(e)) } finally { setBusy(null) }
  }
  return (
    <section className="panel stack-12 span-12" aria-labelledby="emails-h">
      <header className="creator-nums">
        <h2 id="emails-h">Email untuk Play Console</h2>
        <span className="muted small num">{pending.length} belum ditambahkan · {list.data.length - pending.length} sudah</span>
        <span className="spacer" />
        {pending.length > 0 && <button type="button" className="btn" onClick={() => copy(pending.map((r) => r.email))}>Salin {pending.length} email</button>}
      </header>
      <p className="muted small">Hanya Anda yang melihat email ini, karena tester menyetujuinya. Tempel di daftar email jalur uji tertutup, lalu tandai “Sudah ditambahkan” agar tester bisa opt-in.</p>
      <p className="small num">
        {open > 0
          ? <>Kurang {open} tester aktif dari {app.testerSlots} kursi. Yang baru meminta belum dihitung sampai mereka opt-in.</>
          : <>Kursi penuh: {app.activeTesterCount} aktif dari {app.testerSlots}. Menambahkan lagi tetap boleh, sebagai cadangan kalau ada yang berhenti.</>}
      </p>
      {list.error ? <ErrorBox text="Daftar email gagal dimuat." onRetry={list.retry} />
        : list.loading ? <Skel w="60%" />
        : list.data.length === 0 ? <p className="muted">Belum ada yang meminta ditambahkan.</p>
        : (
          <ul className="email-list">
            {list.data.map((r) => (
              <li key={r.uid}>
                <span className="cell-2">
                  <b>{r.displayName}</b>
                  <span className="addr">{r.email}</span>
                  <span className="muted small num">{r.listedAt ? `✓ Ditambahkan ${fmtDate(r.listedAt)}` : `○ Menunggu · diminta ${fmtDate(r.requestedAt)}`}</span>
                </span>
                {r.listedAt
                  ? <button type="button" className="text-action quiet" disabled={busy === r.uid} onClick={() => mark(r.uid, false)}>Batalkan tanda</button>
                  : <button type="button" className="btn primary" disabled={busy === r.uid} onClick={() => mark(r.uid, true)}>{busy === r.uid ? 'Menyimpan…' : 'Sudah ditambahkan'}</button>}
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

function CreatorCard({ app }: { app: AppDoc }) {
  const t = app.creatorTestingCount ?? 0
  const f = app.creatorFeedbackSentCount ?? 0
  const v = app.creatorFeedbackVerifiedCount ?? 0
  return (
    <section className="panel stack-12" aria-labelledby="creator-h">
      <h2 id="creator-h">Creator-nya juga membantu?</h2>
      <Link to={`/u/${app.creatorUid}`} className="creator-link">
        <Avatar name={app.creatorName} photo={app.creatorPhotoURL} />
        <span>{app.creatorName}</span>
      </Link>
      <p className="num">{t === 0 ? <span>Belum menguji aplikasi anggota lain.</span> : <>Menguji <b>{t} aplikasi</b> · feedback di {f}{f > 0 ? ` (${v} terverifikasi)` : ''}</>}</p>
    </section>
  )
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Memuat aplikasi">
      <Skel w={80} />
      <div className="record-head skel-head">
        <div className="rh-main"><Skel w={260} h={32} /><Skel w={180} h={24} /></div>
        <div className="rh-progress"><Skel w={120} h={24} /><Skel w="100%" h={16} /></div>
        <div className="rh-actions"><Skel w={200} h={44} /></div>
      </div>
      <div className="grid">
        <div className="panel span-8" style={{ height: 380 }} />
        <div className="panel span-4" style={{ height: 380 }} />
      </div>
    </div>
  )
}
