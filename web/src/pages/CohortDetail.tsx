// B3 · Cohort detail (PRD §10, FR-33a/33b, FR-38, FR-49–51; ADR-007; ADR-009 §1 and §7).
// Public read. Primary action: "Gabung sebagai tester" while joinOpen() and the viewer is not a member.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar, Badge, Bar, Chip, Dialog, Empty, ErrorBox, failToast, OverflowMenu, Skel, useToast, type MenuItem } from '../components/bits'
import { CohortGraphs } from '../components/CohortGraphs'
import { CohortChip, StandingChip, useFocusAfterClose } from '../components/cohortBits'
import { IconBack, IconExternal } from '../components/icons'
import { useAuth } from '../lib/auth'
import { COMMUNITY_GROUP, COMMUNITY_GROUP_URL } from '../lib/community'
import { errorText, useBadgesOf } from '../lib/data'
import { useT } from '../lib/i18n'
import { cellLabel } from './cohortDetailI18n'
import { usePageMeta } from '../lib/pageMeta'
import { fmtDate, fmtDateTime } from '../lib/progress'
import {
  CLOSE_DAY, cohortDay, fmtWib, joinCohortAsTester, joinDeadline, joinOpen, LAST_JOIN_DAY, leaveCohort, MIN_APPS, ownDay, schedule,
  requestCohortSlot, useCohort, useCohortLink, useMyCohortRequest, useMyRequestableApps, useOwingCohorts, useAssignmentStatus, withdrawCohortRequest,
  type AssignmentStatus,
  type CohortRequest,
  type CohortDetail as Cohort, type CohortMember, type CellState,
} from '../lib/cohorts'
import type { BadgeTier } from '../lib/types'
import './cohort-detail.css'

const DAY = 86_400_000
/** A pure tester counts as "late" when assigned after Day 0 (FR-33b). One minute of slack for clock noise. */
const isLate = (c: Cohort, m: CohortMember | undefined) =>
  !!m && m.appId == null && m.assignedAt != null && c.day0At != null && m.assignedAt - c.day0At > 60_000

// "Kam, 5 Nov, 19.30" in WIB: due times are base + N × 24 h, so the hour matters for the 48 h opt-in.
const dueFmt = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
const longDay = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' })

type DialogKind = null | 'join' | 'whatsapp' | 'request'

export function CohortDetail() {
  const t = useT()
  const { id } = useParams()
  const cohort = useCohort(id)
  const c = cohort.data
  usePageMeta(c ? c.name : t('coh_crumb'), c ? t('coh_meta_desc', { name: c.name, apps: c.appCount, testers: c.pureTesterCount, days: CLOSE_DAY }) : undefined)

  if (cohort.error && !c) return <ErrorBox text={t('coh_load_error')} onRetry={cohort.retry} />
  if (c === null) return <CohortNotFound />
  if (!c) return <DetailSkeleton />
  return <Detail c={c} refresh={cohort.refresh} />
}

function Detail({ c, refresh }: { c: Cohort; refresh: () => void }) {
  const t = useT()
  const { user, isAdmin, signIn } = useAuth()
  const toast = useToast()
  const [dialog, setDialog] = useState<DialogKind>(null)
  const me = user ? c.members.find((m) => m.userId === user.uid) : undefined
  const owing = useOwingCohorts(user && !me ? user.uid : null)
  // Only members and the admin may read the link (get_cohort_link): don't ask on behalf of anyone else.
  const link = useCohortLink(c.id, !!me || isAdmin)
  const badges = useBadgesOf(c.members.map((m) => m.userId))
  const assignmentStatus = useCohortAssignmentStatus(c)
  /** Ring / progress / matrix share one selected tester. */
  const [graphFocusUid, setGraphFocusUid] = useState<string | null>(null)
  const [acked, setAcked] = useState(() => readAck(c.id))
  // Join and leave remove their own trigger: land on the page title (after the join dialog has closed).
  const title = useRef<HTMLHeadingElement>(null)
  const focusTitle = useFocusAfterClose(dialog !== null, title)
  // ADR-013: a member who is not in this Forming cohort may ask to bring one of their apps; the admin decides.
  const forming = c.status === 'forming'
  const reqUid = user && !me && forming ? user.uid : null
  const myReq = useMyCohortRequest(c.id, reqUid)
  const myApps = useMyRequestableApps(reqUid)
  const pendingHere = myReq.data.pending?.cohortId === c.id ? myReq.data.pending : null
  const pendingElsewhere = myReq.data.pending && !pendingHere ? myReq.data.pending : null
  const rejected = !pendingHere && myReq.data.latestHere?.status === 'rejected' ? myReq.data.latestHere : null
  const hasFreeApp = myApps.data.some((a) => a.inCohort == null)
  const done = () => { focusTitle(); refresh(); myReq.refresh(); myApps.refresh() }

  // Withdrawing is reversible (a new request is one tap), so like leaving it acts at once with "Urungkan" (ADR-009 §7).
  const withdrawing = useRef(false)
  const withdraw = async (r: CohortRequest) => {
    if (withdrawing.current) return
    withdrawing.current = true
    try {
      await withdrawCohortRequest(r.id)
      title.current?.focus()
      refresh(); myReq.refresh()
      toast({
        text: t('coh_toast_req_cancel', { app: r.appName, name: c.name }), duration: 8000,
        action: {
          label: t('form_undo'),
          onClick: () => { requestCohortSlot(c.id, r.appId).then(() => { toast(t('coh_toast_req_back', { app: r.appName })); refresh(); myReq.refresh() }, (e) => toast(failToast(e))) },
        },
      })
    } catch (e) {
      toast(failToast(e))
    } finally {
      withdrawing.current = false
    }
  }

  // ADR-009 §7 (owner decision 2026-11-03): leaving while Forming is reversible, so it acts at once and offers
  // "Urungkan" for 8 s instead of a confirm dialog. Undo re-joins through join_cohort_as_tester.
  const leaving = useRef(false)
  const leave = async () => {
    if (leaving.current) return
    leaving.current = true
    try {
      await leaveCohort(c.id)
      title.current?.focus()
      refresh()
      toast({
        text: t('coh_toast_left', { name: c.name }), duration: 8000,
        action: {
          label: t('form_undo'),
          onClick: () => { joinCohortAsTester(c.id).then(() => { toast(t('coh_toast_rejoined', { name: c.name })); refresh() }, (e) => toast(failToast(e))) },
        },
      })
    } catch (e) {
      toast(failToast(e))
    } finally {
      leaving.current = false
    }
  }
  const deadline = joinDeadline(c.day0At)

  const late = isLate(c, me)
  const day = cohortDay(c)
  const myDay = late ? ownDay(me!.assignedAt) : null
  const open = joinOpen(c)
  const creators = c.members.filter((m) => m.appId != null)
  const pure = c.members.filter((m) => m.appId == null)
  const owedIn = owing.data.filter((o) => o.cohortId !== c.id)

  const join = async () => {
    try {
      if (!user) await signIn()
      setDialog('join')
    } catch (e) { toast(failToast(e)) }
  }
  const ask = async () => {
    try {
      if (!user) await signIn()
      setDialog('request')
    } catch (e) { toast(failToast(e)) }
  }

  // ---------- actions (ADR-009 §1: one primary, up to two secondary, the rest behind "…") ----------
  const wa = link.data
  const waButton = wa && (acked
    ? <a className="btn" href={wa} target="_blank" rel="noreferrer"><IconExternal />{t('coh_wa_group')}<span className="sr-only">{t('coh_new_tab')}</span></a>
    : <button type="button" className="btn" onClick={() => setDialog('whatsapp')}>{t('coh_wa_group')}</button>)
  const overflow: MenuItem[] = []
  if (me && me.appId == null && c.status === 'forming') overflow.push({ label: t('coh_leave_cohort'), danger: true, onSelect: () => { void leave() } })
  if (isAdmin) overflow.push({ label: t('coh_manage_admin'), to: `/admin?bagian=cohort&cohort=${c.id}` })

  let primary: React.ReactNode = null
  let note: React.ReactNode = null
  if (me) {
    if (c.status === 'active') primary = <Link className="btn primary" to="/me">{t('coh_my_tasks')}</Link>
    note = me.appId
      ? <>{t('coh_join_with_app')} <Link className="link" to={`/apps/${me.appId}`}>{me.appName ?? t('coh_your_app')}</Link>.{c.status === 'forming' && t('coh_leave_contact_admin')}</>
      : <>{t('coh_pure_tester_note')}{c.status === 'forming' && t('coh_tasks_on_start')}</>
  } else if (open) {
    if (user && owedIn.length > 0) {
      // aria-disabled, not disabled: the button stays focusable so the reason below is read with it.
      primary = <button type="button" className="btn primary" aria-disabled="true" aria-describedby="owing-why" onClick={(e) => e.preventDefault()}>{t('coh_join_tester')}</button>
      note = (
        <span id="owing-why" className="err-text">
          <span>{t('coh_owing_block')} {owedIn.map((o, i) => <span key={o.cohortId}>{i > 0 && ', '}<Link className="link" to={`/cohorts/${o.cohortId}`}>{o.name}</Link></span>)}{t('coh_owing_finish')}</span>
        </span>
      )
    } else if (forming && pendingHere) {
      // Joining as a pure tester would close the request (database trigger), so offer the one next step only.
      note = t('coh_pending_admin_note')
    } else {
      // Members with a free app lead with "Ajukan app"; everyone else leads with joining as a tester (ADR-009 §1: one primary).
      const askFirst = forming && hasFreeApp && !pendingElsewhere
      const joinBtn = <button type="button" className={`btn${askFirst ? '' : ' primary'}`} onClick={join}>{t('coh_join_tester')}</button>
      const askBtn = !forming ? null : pendingElsewhere ? (
        <button type="button" className="btn" aria-disabled="true" aria-describedby="ask-why" onClick={(e) => e.preventDefault()}>{t('coh_request_app')}</button>
      ) : <button type="button" className={`btn${askFirst ? ' primary' : ''}`} onClick={ask}>{t('coh_request_app')}</button>
      primary = askFirst ? <>{askBtn}{joinBtn}</> : <>{joinBtn}{askBtn}</>
      const creators = forming
        ? (pendingElsewhere ? null : t('coh_creators_forming_note'))
        : null
      const timing = c.status === 'active' && deadline != null ? t('coh_join_until', { day: LAST_JOIN_DAY - 1, time: fmtWib(deadline) }) : null
      const text = [creators, timing, user ? null : t('coh_sign_in_first')].filter(Boolean).join(' ')
      note = !text && !pendingElsewhere ? null : (
        <>
          {text}
          {pendingElsewhere && (
            <span id="ask-why">{text && <br />}{t('coh_pending_elsewhere')} <Link className="link" to={`/cohorts/${pendingElsewhere.cohortId}`}>{pendingElsewhere.cohortName}</Link>{t('coh_one_request')}</span>
          )}
        </>
      )
    }
  } else if (c.status === 'active') {
    note = <>{t('coh_join_closed')}{deadline != null ? ` ${fmtWib(deadline)}` : ''}{t('coh_join_closed_suffix', { day: LAST_JOIN_DAY - 1 })}</>
  }

  // Request status: glyph + text, never colour alone. A rejection keeps the admin's reason and the way to ask again.
  let reqBlock: React.ReactNode = null
  if (pendingHere) {
    reqBlock = (
      <div className="rq-status" role="status">
        <Chip tone="langit" glyph="◷">{t('coh_pending_admin')}</Chip>
        <p className="rq-line"><b><Link className="link" to={`/apps/${pendingHere.appId}`}>{pendingHere.appName}</Link></b> <span className="num">{t('coh_submitted')} {fmtDateTime(pendingHere.createdAt)}</span></p>
        <button type="button" className="btn" onClick={() => { void withdraw(pendingHere) }}>{t('coh_cancel_request')}<span className="sr-only"> {pendingHere.appName}</span></button>
      </div>
    )
  } else if (rejected && !me && forming) {
    reqBlock = (
      <div className="rq-status" role="status">
        <Chip glyph="×">{t('coh_rejected')}</Chip>
        <p className="rq-line"><b><Link className="link" to={`/apps/${rejected.appId}`}>{rejected.appName}</Link></b> <span className="num">{fmtDateTime(rejected.decidedAt ?? rejected.createdAt)}</span></p>
        <p className="rq-reason">{rejected.reason ? <>{t('coh_reject_reason')} {rejected.reason}</> : t('coh_reject_no_reason')}{t('coh_can_reapply')}</p>
      </div>
    )
  }

  return (
    <>
      <Link to="/cohorts" className="crumb"><IconBack />{t('coh_crumb')}</Link>

      <header className="record-head cohort-head">
        <div className="rh-main">
          <h1 ref={title} tabIndex={-1}>{c.name}</h1>
          <div className="meta-line">
            <CohortChip status={c.status} />
            <span className="num">{t('coh_apps_pure_meta', { apps: c.appCount, testers: c.pureTesterCount })}</span>
          </div>
        </div>

        <div className="rh-progress">
          {c.status === 'active' && day != null && (
            <>
              <p className="rh-count num"><b>{t('coh_day_of', { day })}</b><small>{t('coh_day_of_from', { day, max: CLOSE_DAY }).replace(t('coh_day_of', { day }), '')}</small></p>
              <Bar value={Math.min(day, CLOSE_DAY)} max={CLOSE_DAY} label={t('coh_bar_days', { day, max: CLOSE_DAY })} />
              <p className="rh-sub num">
                {t('coh_started_close_by', { start: fmtDate(c.day0At), end: fmtDate(c.day0At! + CLOSE_DAY * DAY) })}
                {day > CLOSE_DAY && t('coh_past_deadline_wait')}
              </p>
              {late && myDay != null && (
                <p className="own-day num"><b>{t('coh_your_day', { day: myDay })}</b>{t('coh_your_day_from', { date: fmtDate(me!.assignedAt) })}</p>
              )}
            </>
          )}
          {c.status === 'forming' && (
            <>
              <p className="rh-count num"><b>{c.appCount}</b><small> / {MIN_APPS}</small><span className="rh-label">{t('coh_apps_to_start')}</span></p>
              <Bar value={Math.min(c.appCount, MIN_APPS)} max={MIN_APPS} label={t('coh_bar_forming', { n: c.appCount, min: MIN_APPS })} />
              <p className="rh-sub num">
                {c.appCount >= MIN_APPS ? t('coh_enough_apps') : t('coh_need_more_apps', { n: MIN_APPS - c.appCount })} {t('coh_created', { date: fmtDate(c.createdAt) })}
              </p>
            </>
          )}
          {c.status === 'closed' && <ClosedSummary c={c} day={day} />}
        </div>

        {(primary || note || reqBlock || waButton || overflow.length > 0) && (
          <div className="rh-actions">
            {reqBlock}
            {primary}
            {(waButton || overflow.length > 0) && (
              <div className="rh-more">
                {waButton}
                <OverflowMenu items={overflow} label={t('coh_more_actions')} />
              </div>
            )}
            {note && <p className="small muted rh-note">{note}</p>}
          </div>
        )}
      </header>

      <div className="grid">
        <Schedule c={c} me={me} late={late} />
        <Members c={c} creators={creators} pure={pure} badges={badges.data} myUid={user?.uid} />

        <CohortGraphs
          c={c}
          status={assignmentStatus.data}
          loading={assignmentStatus.loading}
          error={assignmentStatus.error}
          onRetry={assignmentStatus.retry}
          myUid={user?.uid}
          focusUid={graphFocusUid}
          onFocusChange={setGraphFocusUid}
        />
        <ObligationMatrix c={c} status={assignmentStatus} focusUid={graphFocusUid} />
      </div>

      <JoinDialog open={dialog === 'join'} onClose={() => setDialog(null)} c={c} onDone={done} />
      <RequestDialog open={dialog === 'request'} onClose={() => setDialog(null)} c={c} apps={myApps.data} loading={myApps.loading} onDone={done} />
      {wa && (
        <WhatsAppNotice
          open={dialog === 'whatsapp'} onClose={() => setDialog(null)} url={wa}
          onAck={() => { writeAck(c.id); setAcked(true); setDialog(null) }}
        />
      )}
    </>
  )
}

function ClosedSummary({ c, day }: { c: Cohort; day: number | null }) {
  const t = useT()
  const n = { good: 0, owing: 0, settled: 0 }
  for (const m of c.members) if (m.standing) n[m.standing]++
  return (
    <>
      <p className="rh-count num"><b>{t('coh_finished')}</b>{day != null && <small>{t('coh_on_day', { day })}</small>}</p>
      <p className="rh-sub num">{fmtDate(c.day0At)} – {fmtDate(c.closedAt)}</p>
      <p className="standing-sum num">
        <span>{t('coh_standing_good', { n: n.good })}</span>
        <span>{t('coh_standing_owing', { n: n.owing })}</span>
        {n.settled > 0 && <span>{t('coh_standing_settled', { n: n.settled })}</span>}
      </p>
    </>
  )
}

// ---------- schedule: the cohort's milestones, today's position marked by glyph + text ----------

type StepState = 'past' | 'today' | 'next' | 'later'
interface Row { key: string; day: number; at: number | null; title: string; detail: string; state: StepState }

function Schedule({ c, me, late }: { c: Cohort; me: CohortMember | undefined; late: boolean }) {
  const t = useT()
  const now = Date.now()
  const base = late ? me!.assignedAt : c.day0At
  const current = c.status === 'active' ? (late ? ownDay(me!.assignedAt, now) : cohortDay(c, now)) : null

  const rows = useMemo<Row[]>(() => {
    let steps = schedule(base)
    if (late) {
      // A late pure tester's own milestones; the close stays on the cohort's clock (in the note below).
      steps = steps.filter((s) => s.day !== CLOSE_DAY).map((s) => s.day === LAST_JOIN_DAY ? { ...s, detail: t('coh_sched_late_d7_detail') } : s)
    }
    if (c.status === 'closed' && c.closedAt != null) {
      // Show the real close, which may be before Day 21.
      const d = cohortDay(c) ?? CLOSE_DAY
      steps = steps.filter((s) => s.day !== CLOSE_DAY && s.day <= d).concat({ day: d, at: c.closedAt, title: t('coh_sched_d21_title'), detail: t('coh_sched_closed_detail') })
    }
    let nextSet = false
    return steps.map((s) => {
      let state: StepState = 'later'
      if (c.status === 'closed') state = 'past'
      else if (current != null) {
        if (s.day < current) state = 'past'
        else if (s.day === current) state = 'today'
        else if (!nextSet) { state = 'next'; nextSet = true }
      } else if (!nextSet) { state = 'next'; nextSet = true }
      return { key: `${s.day}-${s.title}`, ...s, state }
    })
  }, [base, late, c, current, t])

  // "Hari ini" marker between milestones when today has none of its own.
  const markerAt = current != null && !rows.some((r) => r.state === 'today')
    ? (() => { const i = rows.findIndex((r) => r.day > current); return i === -1 ? rows.length : i })()
    : -1

  return (
    <section className="panel span-5 sched-panel" aria-labelledby="sched-h">
      <header>
        <h2 id="sched-h">{late ? t('coh_schedule_yours') : t('coh_schedule')}</h2>
        {current != null && <span className="meta num">{t('coh_today_day', { day: current })}</span>}
      </header>
      {c.status === 'forming' && <p className="small muted sched-note">{t('coh_sched_forming_note')}</p>}
      {late && (
        <p className="small muted sched-note num">
          {t('coh_sched_late_note', { date: fmtDateTime(me!.assignedAt), maxDay: CLOSE_DAY, closeDate: fmtDate(c.day0At! + CLOSE_DAY * DAY) })}
        </p>
      )}
      <ol className="sched">
        {rows.map((r, i) => (
          <ScheduleItem key={r.key} r={r} marker={i === markerAt ? current : null} />
        ))}
        {markerAt === rows.length && current != null && <TodayMarker day={current} />}
      </ol>
    </section>
  )
}

function ScheduleItem({ r, marker }: { r: Row; marker: number | null }) {
  const t = useT()
  return (
    <>
      {marker != null && <TodayMarker day={marker} />}
      <li className={`sched-row ${r.state}`} aria-current={r.state === 'today' ? 'date' : undefined}>
        <span className="sched-day num">{t('coh_day_label', { day: r.day })}</span>
        <span className="sched-body">
          <span className="sched-head">
            <span className="sched-title">{r.title}</span>
            <StepState state={r.state} />
          </span>
          <span className="sched-detail">{r.detail}</span>
          {r.at != null && <time className="sched-at num" dateTime={new Date(r.at).toISOString()} title={fmtDateTime(r.at)}>{dueFmt.format(r.at)} WIB</time>}
        </span>
      </li>
    </>
  )
}

/** Position in the schedule, in glyph + text (never the row colour alone). */
function StepState({ state }: { state: StepState }) {
  const t = useT()
  if (state === 'today') return <Chip glyph="●">{t('coh_sched_today')}</Chip>
  if (state === 'next') return <Chip glyph="→">{t('coh_sched_next')}</Chip>
  if (state === 'past') return <span className="sched-done"><span aria-hidden="true">· </span>{t('coh_sched_past')}</span>
  return null
}

function TodayMarker({ day }: { day: number }) {
  const t = useT()
  return (
    <li className="sched-row today marker" aria-current="date">
      <span className="sched-day num">{t('coh_day_label', { day })}</span>
      <span className="sched-body">
        <span className="sched-head"><span className="sched-title">{longDay.format(Date.now())}</span><StepState state="today" /></span>
        <span className="sched-detail">{t('coh_no_deadline_today')}</span>
      </span>
    </li>
  )
}

// ---------- members: creators with their app, pure testers separately ----------

function Members({ c, creators, pure, badges, myUid }: {
  c: Cohort; creators: CohortMember[]; pure: CohortMember[]; badges: Map<string, BadgeTier>; myUid?: string
}) {
  const t = useT()
  return (
    <section className="panel span-7" aria-labelledby="members-h">
      <header>
        <h2 id="members-h">{t('coh_members')}</h2>
        <span className="meta num">{t('coh_people', { n: c.members.length })}</span>
      </header>

      <h3 className="member-group num">{t('coh_creators_apps')} · {creators.length}</h3>
      {creators.length === 0 ? (
        <Empty title={t('coh_no_creators_title')}>
          <p>{t('coh_no_creators_body', { min: MIN_APPS })}</p>
        </Empty>
      ) : (
        <ul className="member-list">{creators.map((m) => <MemberRow key={m.userId} m={m} c={c} tier={badges.get(m.userId)} mine={m.userId === myUid} />)}</ul>
      )}

      <h3 className="member-group num">{t('coh_pure_testers')} · {pure.length}</h3>
      {pure.length === 0 ? (
        <p className="small muted member-none">
          {joinOpen(c) ? t('coh_no_pure_open') : t('coh_no_pure')}
        </p>
      ) : (
        <ul className="member-list">{pure.map((m) => <MemberRow key={m.userId} m={m} c={c} tier={badges.get(m.userId)} mine={m.userId === myUid} />)}</ul>
      )}
    </section>
  )
}

function MemberRow({ m, c, tier, mine }: { m: CohortMember; c: Cohort; tier?: BadgeTier; mine: boolean }) {
  const t = useT()
  const name = m.displayName || t('coh_members')
  const lateDay = isLate(c, m) ? Math.floor((m.assignedAt! - c.day0At!) / DAY) : null
  return (
    <li className={`member-row ${mine ? 'mine' : ''}`}>
      <Avatar name={name} photo={m.photoURL} />
      <span className="member-main">
        <span className="name-with-badge">
          <Link className="member-name" to={`/u/${m.userId}`}>{name}</Link>
          {mine && <span className="you">{t('coh_you')}</span>}
          <Badge tier={tier} size="sm" />
        </span>
        <span className="member-sub">
          {m.appId
            ? m.appDeleted
              ? <span>{t('coh_app_deleted')}</span>
              : <Link className="member-app" to={`/apps/${m.appId}`}>{m.appName}</Link>
            : lateDay != null ? <span className="num">{t('coh_joined_day', { day: lateDay })}</span> : <span>{t('coh_no_app')}</span>}
        </span>
      </span>
      {m.standing && <StandingChip standing={m.standing} />}
    </li>
  )
}

// ---------- graphs + matrix share one assignment-status fetch ----------

function useCohortAssignmentStatus(c: Cohort) {
  const apps = c.members.some((m) => m.appId != null)
  const shouldLoad = c.status !== 'forming' && apps
  return useAssignmentStatus(shouldLoad ? c.id : undefined)
}

// ---------- B5: obligation matrix (FR-38, cohort_assignment_status view) ----------

const CELL_GLYPH: Record<CellState, string> = {
  not_joined: '○', left: '✕', opted_in: '◑', used: '●',
  feedback_sent: '✓', feedback_verified: '✓✓', reassigned: '→',
}
function ObligationMatrix({ c, status, focusUid }: {
  c: Cohort
  status: { data: AssignmentStatus[]; loading: boolean; error: string | null; retry: () => void }
  focusUid: string | null
}) {
  const t = useT()
  const apps = c.members.filter((m) => m.appId != null)
  const focusRowRef = useRef<HTMLTableRowElement>(null)

  const cells = useMemo<Map<string, Map<string, CellState>>>(() => {
    const m = new Map<string, Map<string, CellState>>()
    for (const s of status.data) {
      const inner = m.get(s.appId) ?? new Map<string, CellState>()
      inner.set(s.testerId, s.cell)
      m.set(s.appId, inner)
    }
    return m
  }, [status.data])

  const behind = useMemo(() => new Set(status.data.filter((s) => s.isBehind).map((s) => s.testerId)), [status.data])

  useEffect(() => {
    if (!focusUid || !focusRowRef.current) return
    focusRowRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [focusUid])

  if (c.status === 'forming' || apps.length === 0) return null
  if (status.loading && status.data.length === 0) return null
  if (status.error) return (
    <section className="panel span-12" aria-label={t('coh_matrix_sr')}>
      <p className="meta cabai">{t('coh_matrix_load_error')} <button type="button" className="link" onClick={status.retry}>{t('retry')}</button></p>
    </section>
  )

  const focusName = focusUid
    ? (c.members.find((m) => m.userId === focusUid)?.displayName || t('coh_members'))
    : null

  return (
    <section className={`panel span-12 matrix-panel${focusUid ? ' has-focus' : ''}`} aria-labelledby="matrix-h">
      <header>
        <h2 id="matrix-h">{t('coh_matrix_sr')}</h2>
        {status.loading && <span className="meta">{t('loading')}</span>}
        {!status.loading && focusName && (
          <span className="meta num">{t('coh_matrix_focus', { name: focusName })}</span>
        )}
      </header>
      <div className="matrix-wrap" tabIndex={0} role="region" aria-label={t('coh_matrix_scroll')}>
        <table className="matrix-table num">
          <thead>
            <tr>
              <th className="matrix-th-name" scope="col">{t('coh_col_tester')}</th>
              {apps.map((app) => (
                <th key={app.appId} scope="col">
                  <span className="matrix-app-name" title={app.appName ?? ''}>{app.appName ?? t('coh_app_fallback')}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.members.map((m) => {
              const focused = focusUid === m.userId
              const dimmed = focusUid != null && !focused
              return (
              <tr
                key={m.userId}
                ref={focused ? focusRowRef : undefined}
                className={[
                  behind.has(m.userId) ? 'behind-row' : '',
                  focused ? 'matrix-focus-row' : '',
                  dimmed ? 'matrix-dim-row' : '',
                ].filter(Boolean).join(' ')}
              >
                <td className="matrix-td-name">
                  <Link to={`/u/${m.userId}`}>{m.displayName || t('coh_members')}</Link>
                  {behind.has(m.userId) && <span className="sr-only">{t('coh_behind_sr')}</span>}
                  {focused && <span className="sr-only">{t('coh_matrix_focus_sr')}</span>}
                </td>
                {apps.map((app) => {
                  if (app.userId === m.userId) {
                    return <td key={app.appId} className="matrix-cell own"><span aria-label={t('coh_own_app')}>—</span></td>
                  }
                  const cell = cells.get(app.appId!)?.get(m.userId)
                  if (!cell) {
                    return <td key={app.appId} className="matrix-cell unassigned" title={t('coh_unassigned')}><span aria-hidden="true">∅</span><span className="sr-only">{t('coh_unassigned')}</span></td>
                  }
                  const lbl = cellLabel(t, cell)
                  return <td key={app.appId} className={`matrix-cell ${cell}`} title={lbl}><span aria-label={lbl}>{CELL_GLYPH[cell]}</span></td>
                })}
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul className="matrix-legend small muted">
        {[...t('coh_matrix_legend').split(' · '), `∅ ${t('coh_unassigned')}`].map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  )
}

// ---------- dialogs ----------

function useBusy() {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>, done: () => void) => {
    if (busy) return
    setBusy(true); setErr(null)
    try { await fn(); done() } catch (e) { setErr(errorText(e, t)) } finally { setBusy(false) }
  }
  return { busy, err, run, reset: () => setErr(null) }
}

/** PRD §5.8 step 2: say what joining commits you to before you confirm. */
function JoinDialog({ open, onClose, c, onDone }: { open: boolean; onClose: () => void; c: Cohort; onDone: () => void }) {
  const t = useT()
  const toast = useToast()
  const { busy, err, run, reset } = useBusy()
  const active = c.status === 'active'
  const close = () => { reset(); onClose() }
  // showModal() focuses the community link first, which scrolls a phone-height dialog: start at the title instead.
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => title.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])
  const confirm = () => run(() => joinCohortAsTester(c.id), () => {
    toast(active ? t('coh_toast_join_active', { name: c.name }) : t('coh_toast_join_forming', { name: c.name }))
    onClose(); onDone()
  })
  return (
    <Dialog open={open} onClose={close} label={t('coh_join_dialog_label', { name: c.name })}>
      <div className="sheet-body">
        <h2 ref={title} tabIndex={-1}>{t('coh_join_confirm', { name: c.name })}</h2>
        <p className="lede">
          {active
            ? t('coh_join_active_lede')
            : t('coh_join_forming_lede')}
        </p>
        <ol className="duties">
          <li><b>{t('coh_join_duty1')}</b>{t('coh_join_duty1_rest')}</li>
          <li><b>{t('coh_join_duty2')}</b>{t('coh_join_duty2_rest')}</li>
          <li><b>{t('coh_join_duty3')}</b>{t('coh_join_duty3_rest')}</li>
        </ol>
        <p className="small muted">
          {t('coh_join_foot1')} <a className="link" href={COMMUNITY_GROUP_URL} target="_blank" rel="noreferrer">{COMMUNITY_GROUP}<span className="sr-only">{t('coh_new_tab')}</span></a>{t('coh_join_foot2')}
          {' '}{t('coh_join_foot3')}
          {!active && t('coh_join_foot4')}
        </p>
        {err && <ErrorBox text={err} />}
      </div>
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={close}>{t('cancel')}</button>
        <button type="button" className="btn primary" onClick={confirm} aria-busy={busy || undefined}>{busy ? t('saving') : t('coh_join_tester')}</button>
      </div>
    </Dialog>
  )
}

/** ADR-013: pick one live app, then ask. The server re-checks every rule; its error shows in the dialog. */
function RequestDialog({ open, onClose, c, apps, loading, onDone }: {
  open: boolean; onClose: () => void; c: Cohort; apps: { id: string; name: string; inCohort: string | null }[]; loading: boolean; onDone: () => void
}) {
  const t = useT()
  const toast = useToast()
  const { busy, err, run, reset } = useBusy()
  const free = apps.filter((a) => a.inCohort == null)
  const [picked, setPicked] = useState('')
  const [showErr, setShowErr] = useState(false)
  const choice = picked || (free.length === 1 ? free[0].id : '')
  const title = useRef<HTMLHeadingElement>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => title.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])
  const close = () => { reset(); setShowErr(false); onClose() }
  const choiceErr = !choice ? t('coh_pick_app') : undefined
  const firstFree = free[0]?.id
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (choiceErr) { setShowErr(true); first.current?.focus(); return }
    const app = apps.find((a) => a.id === choice)
    run(() => requestCohortSlot(c.id, choice), () => {
      toast(t('coh_toast_requested', { app: app?.name ?? t('coh_app_fallback'), name: c.name }))
      setPicked(''); onClose(); onDone()
    })
  }
  return (
    <Dialog open={open} onClose={close} label={t('coh_request_dialog_label', { name: c.name })}>
      <form onSubmit={submit} noValidate>
        <div className="sheet-body">
          <h2 ref={title} tabIndex={-1}>{t('coh_request_title', { name: c.name })}</h2>
          <p className="lede">{t('coh_request_lede')}</p>
          {loading ? <Skel w={220} h={44} /> : apps.length === 0 ? (
            <Empty title={t('coh_no_apps_title')}>
              <p>{t('coh_no_apps_body')}</p>
              <Link className="btn" to="/apps/new">{t('coh_add_app')}</Link>
            </Empty>
          ) : (
            <fieldset className="fieldset rq-opts" aria-describedby={showErr && choiceErr ? 'rq-err' : undefined}>
              <legend>{t('coh_bring_app_legend')}</legend>
              {apps.map((a) => (
                <label key={a.id} className={`rq-opt${a.inCohort != null ? ' off' : ''}`}>
                  <input ref={a.id === firstFree ? first : undefined} type="radio" name="rq-app" value={a.id} checked={choice === a.id} disabled={a.inCohort != null}
                    onChange={() => { setPicked(a.id); setShowErr(false) }} aria-describedby={a.inCohort != null ? `rq-${a.id}` : undefined} />
                  <span className="cell-2">
                    <b>{a.name}</b>
                    {a.inCohort != null && <span id={`rq-${a.id}`}>{t('coh_already_in', { cohort: a.inCohort || t('in_unnamed_cohort') })}</span>}
                  </span>
                </label>
              ))}
              <span className={showErr && choiceErr ? 'hint err' : 'sr-only'} id="rq-err" aria-live="polite">{showErr ? choiceErr : ''}</span>
              {free.length === 0 && <p className="small muted">{t('coh_all_apps_in_cohort')} <Link className="link" to="/apps/new">{t('coh_add_another_app')}</Link>.</p>}
            </fieldset>
          )}
          {err && <ErrorBox text={err} />}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn" onClick={close}>{t('cancel')}</button>
          {free.length > 0 && <button className="btn primary" aria-busy={busy || undefined}>{busy ? t('coh_submitting') : t('coh_submit_admin')}</button>}
        </div>
      </form>
    </Dialog>
  )
}

/** FR-51: before the link is shown the first time. Acknowledged once per cohort, per browser. */
function WhatsAppNotice({ open, onClose, url, onAck }: { open: boolean; onClose: () => void; url: string; onAck: () => void }) {
  const t = useT()
  return (
    <Dialog open={open} onClose={onClose} label={t('coh_wa_notice_label')}>
      <div className="sheet-body">
        <h2>{t('coh_wa_notice_label')}</h2>
        <ul className="duties plain">
          <li><b>{t('coh_wa_li1_b')}</b>{t('coh_wa_li1')}</li>
          <li><b>{t('coh_wa_li2_b')}</b>{t('coh_wa_li2')}</li>
          <li><b>{t('coh_wa_li3_b')}</b>{t('coh_wa_li3', { group: COMMUNITY_GROUP })}</li>
        </ul>
      </div>
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={onClose}>{t('coh_wa_later')}</button>
        <a className="btn primary" href={url} target="_blank" rel="noreferrer" onClick={onAck}><IconExternal />{t('coh_wa_open')}<span className="sr-only">{t('coh_new_tab')}</span></a>
      </div>
    </Dialog>
  )
}

// ---------- WhatsApp acknowledgement (localStorage may be blocked: private mode, cleared data) ----------
const ackKey = (id: string) => `tb:wa-ack:${id}`
function readAck(id: string) {
  try { return localStorage.getItem(ackKey(id)) === '1' } catch { return false }
}
function writeAck(id: string) {
  try { localStorage.setItem(ackKey(id), '1') } catch { /* the notice simply shows again next time */ }
}

// ---------- states ----------

function CohortNotFound() {
  const t = useT()
  return (
    <div className="state-page">
      <h1 className="page-title">{t('coh_not_found_title')}</h1>
      <p>{t('coh_not_found_body')}</p>
      <Link className="btn primary" to="/cohorts">{t('coh_see_all')}</Link>
    </div>
  )
}

function DetailSkeleton() {
  const t = useT()
  return (
    <div aria-busy="true" aria-label={t('coh_loading_sr')}>
      <Skel w={90} h={20} />
      <div className="record-head skel-head" style={{ marginTop: 'var(--s-2)' }}>
        <div className="rh-main"><Skel w={240} h={32} /><Skel w={200} h={22} /></div>
        <div className="rh-progress"><Skel w={140} h={28} /><Skel w="100%" h={16} /></div>
        <div className="rh-actions"><Skel w={220} h={44} /></div>
      </div>
      <div className="grid">
        <div className="panel span-5">{[0, 1, 2, 3].map((i) => <div className="row-line" key={i}><Skel w={56} /><span className="grow"><Skel w={180} /></span></div>)}</div>
        <div className="panel span-7">{[0, 1, 2, 3, 4].map((i) => <div className="row-line" key={i}><Skel w={32} h={32} /><span className="grow"><Skel w={200} /></span></div>)}</div>
      </div>
    </div>
  )
}
