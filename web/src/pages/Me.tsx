import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Bar, Chip, Empty, ErrorBox, FeedbackChip, Seats, ShowAll, Skel, StatusPill, TierProgress, useToast } from '../components/bits'
import { IconGoogle, IconPlus } from '../components/icons'
import { useAuth } from '../lib/auth'
import { COMMUNITY_GROUP_URL } from '../lib/community'
import { usePageMeta } from '../lib/pageMeta'
import { clearMyPlayUnreachable, errorText, setEmailReminders, useMyPlayUnreachableApps, usePublicProfile } from '../lib/data'
import { useMyObligations } from '../lib/cohorts'
import { useMyTodos } from '../lib/todos'
import { isLiveApp } from '../lib/joinProgress'
import { daysActive, relDay, openSeats, TARGET_DAYS } from '../lib/progress'
import { useT } from '../lib/i18n'

export function Me() {
  const { user, isAdmin, ready, signIn } = useAuth()
  const toast = useToast()
  const t = useT()
  usePageMeta(t('me_meta_title'), t('me_meta_desc'))
  if (!ready) return <Skel w={200} h={32} />
  if (!user) {
    return (
      <div className="state-page">
        <h1 className="page-title">{t('me_meta_title')}</h1>
        <p>{t('me_sign_in_body')}</p>
        <button type="button" className="btn primary google-signin" onClick={() => signIn().catch((e) => toast(errorText(e, t)))}><IconGoogle />{t('sign_in_google')}</button>
      </div>
    )
  }
  return <MeSignedIn uid={user.uid} isAdmin={isAdmin} />
}

const FEW = 4

function MeSignedIn({ uid, isAdmin }: { uid: string; isAdmin: boolean }) {
  const t = useT()
  const toast = useToast()
  const { profile: authProfile } = useAuth()
  const joinedGroup = !!authProfile?.joinedCommunityGroup
  const { entries, apps, myApps, requests, testing, todos, total, loading } = useMyTodos(uid, isAdmin)
  const myPlayBlocked = useMyPlayUnreachableApps(uid)
  const profile = usePublicProfile(uid)
  const obligations = useMyObligations(uid)
  const [allTodos, setAllTodos] = useState(false)
  const [allTesting, setAllTesting] = useState(false)

  const suggestions = useMemo(() => {
    const mineIds = new Set(entries.data.map((e) => e.appId))
    return apps.data
      .filter((a) => (a.status === 'recruiting' || a.status === 'testing' || a.status === 'live') && a.creatorUid !== uid && !mineIds.has(a.id) && openSeats(a) > 0)
      .sort((a, b) => openSeats(b) - openSeats(a))
      .slice(0, 3)
  }, [apps.data, entries.data, uid])

  const suggestList = (
    <>
            <h3 className="subhead">{t('me_need_testers_h')}</h3>
              {apps.loading ? <RowsSkeleton /> : suggestions.length === 0 ? <p className="muted" style={{ marginTop: 'var(--s-2)' }}>{t('me_need_testers_all')}</p> : (
                <ul>
                  {suggestions.map((a) => (
                    <li className="row-line" key={a.id}>
                      <span className="grow cell-2"><Link to={`/apps/${a.id}`}><b>{a.name}</b></Link><span>{a.creatorName}</span></span>
                      <Seats active={a.activeTesterCount} total={a.testerSlots} className="hide-sm" />
                      <span className="num w-num">{a.activeTesterCount}<span className="of"> / {a.testerSlots}</span></span>
                    </li>
                  ))}
                </ul>
              )}

    </>
  )
  const unjoined = todos.filter((t0) => t0.kind === 'join' || t0.kind === 'listed').length
  const emailWait = todos.filter((t0) => t0.kind === 'emails').reduce((n, t0) => n + (t0.count ?? 0), 0)
  const owe = todos.filter((t0) => t0.kind === 'feedback').length
  const builds = todos.filter((t0) => t0.kind === 'build').length
  const asks = requests.data.reduce((n, r) => n + r.count, 0)
  const p = profile.data
  const listed = myApps.data.length
  const nudge = p && listed > 0 && p.testingCount < listed

  const summaryParts = [
    unjoined > 0 && t('me_summary_unjoined', { n: unjoined }),
    owe > 0 && t('me_summary_feedback', { n: owe }),
    builds > 0 && t('me_summary_builds', { n: builds }),
    emailWait > 0 && t('me_summary_emails', { n: emailWait }),
    asks > 0 && t('me_summary_requests', { n: asks }),
  ].filter(Boolean)

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{t('me_meta_title')}</h1>
          <p className="sub">
            {loading ? <Skel w={340} h={16} /> : total === 0
              ? testing.length === 0 ? t('me_sub_none_never') : t('me_sub_none_caught_up')
              : <><b>{summaryParts.join(', ')}</b>.</>}
          </p>
        </div>
        <div className="actions"><Link className="btn" to="/apps">{t('me_find_apps')}</Link></div>
      </div>

      {(entries.error || apps.error) && <ErrorBox text={t('me_load_error')} onRetry={() => { entries.retry(); apps.retry() }} />}

      {!obligations.error && obligations.data.filter((o) => o.isBehind).length > 0 && (
        <section className="panel" aria-labelledby="cohort-oblig-h" style={{ marginBottom: 'var(--s-4)' }}>
          <header>
            <h2 id="cohort-oblig-h">{t('me_oblig_h')}</h2>
            <Chip tone="cabai" glyph="!">{obligations.data.filter((o) => o.isBehind).length}</Chip>
          </header>
          <ul>
            {obligations.data.filter((o) => o.isBehind).map((o) => (
              <li className="row-line" key={`${o.cohortId}:${o.userId}`}>
                <span className="grow cell-2">
                  <Link to={`/cohorts/${o.cohortId}`}><b>{o.cohortName}</b></Link>
                  <span className="num">{o.owesOptIn ? t('me_oblig_slots', { n: o.optInMissing }) : t('me_oblig_milestones')}</span>
                </span>
                <Chip tone="cabai" glyph="!">{t('me_oblig_behind')}</Chip>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid">
        <div className="span-7 col-fill stretch">
          <section className="panel" aria-labelledby="todo-h">
            <header><h2 id="todo-h">{t('me_todo_h')}</h2><span className="meta num">{loading ? '' : t('me_todo_count', { n: total })}</span></header>
            {loading ? <RowsSkeleton /> : total === 0 ? (
              testing.length === 0
                ? (
                  <Empty title={t(joinedGroup ? 'me_empty_start_title_grouped' : 'me_empty_start_title')}>
                    <ol className="first-run">
                      <li>{joinedGroup
                        ? t('me_empty_start_1_grouped')
                        : <><a href={COMMUNITY_GROUP_URL} target="_blank" rel="noreferrer">{t('me_empty_start_1')}<span className="sr-only">{t('me_empty_start_1_sr')}</span></a>{t('me_empty_start_1_rest')}</>}</li>
                      <li>{t('me_empty_start_2_pre')}<Link to="/apps">{t('me_empty_start_2_link')}</Link>{t(joinedGroup ? 'me_empty_start_2_post_grouped' : 'me_empty_start_2_post')}</li>
                    </ol>
                  </Empty>
                )
                : <Empty title={t('me_empty_done_title')}><p>{t('me_empty_done_body')}</p></Empty>
            ) : (
              <>
                <ul id="todo-list">
                  {requests.data.map((r, i) => {
                    if (!allTodos && i >= FEW) return null
                    return (
                      <li className="row-line" key={`requests:${r.cohortId}`}>
                        <span className="grow cell-2">
                          <Link to={`/cohorts/${r.cohortId}`}><b>{r.cohortName}</b></Link>
                          <span className="num">{t('me_request_waiting', { n: r.count })}</span>
                        </span>
                        <Link className={`btn sm${i === 0 ? ' primary' : ''}`} to={`/admin?bagian=cohort&cohort=${r.cohortId}`}>{t('me_review_requests')}</Link>
                      </li>
                    )
                  })}
                  {todos.map(({ entry, app, kind, count }, i) => {
                    const row = requests.data.length + i
                    if (!allTodos && row >= FEW) return null
                    const playBlocked = (kind === 'join' || kind === 'listed') && myPlayBlocked.data.has(app.id)
                    return (
                    <li className="row-line" key={`${kind}:${app.id}`}>
                      <span className="grow cell-2">
                        <Link to={`/apps/${app.id}`}><b>{app.name}</b></Link>
                        <span>
                          {kind === 'join'
                            ? (playBlocked ? t('me_todo_join_blocked') : (isLiveApp(app) ? t('me_todo_join_live') : t(joinedGroup ? 'me_todo_join_grouped' : 'me_todo_join_group')))
                            : kind === 'listed'
                              ? (playBlocked ? t('me_todo_join_blocked') : t('me_todo_listed'))
                            : kind === 'emails'
                              ? t('me_todo_emails', { n: count ?? 0 })
                            : kind === 'build'
                              ? t('me_todo_build', { when: relDay(app.lastBuildAt) })
                              : t('me_todo_feedback_day', {
                                  d: daysActive(entry!),
                                  what: isLiveApp(app) ? t('me_todo_feedback_review') : t('me_todo_feedback_play'),
                                })}
                        </span>
                      </span>
                      {playBlocked ? (
                        <span style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button type="button" className="btn sm" onClick={() => {
                            clearMyPlayUnreachable(app.id).catch((e) => toast(errorText(e, t)))
                          }}>{t('me_cta_play_clear')}</button>
                          <Link className={`btn sm${row === 0 ? ' primary' : ''}`} to={`/apps/${app.id}`}>{t('me_cta_play_retry')}</Link>
                        </span>
                      ) : (
                        <Link className={`btn sm${row === 0 ? ' primary' : ''}`} to={`/apps/${app.id}`}>
                          {kind === 'join' || kind === 'listed' ? t('me_cta_continue') : kind === 'emails' ? t('me_cta_add_email') : kind === 'build' ? t('me_cta_new_build') : (isLiveApp(app) ? t('me_cta_send_review') : t('me_cta_send_feedback'))}
                        </Link>
                      )}
                    </li>
                    )
                  })}
                </ul>
                {total > FEW && <ShowAll open={allTodos} total={total} onToggle={() => setAllTodos((x) => !x)} controls="todo-list" />}
              </>
            )}
          </section>

          <section className="panel fill" aria-labelledby="testing-h">
            <header><h2 id="testing-h">{t('me_testing_h')}</h2><span className="meta num">{t('me_testing_count', { n: testing.length })}</span></header>
            <div className="grow-body">
              {loading ? <RowsSkeleton /> : testing.length === 0 ? <><p className="muted">{t('me_testing_empty')}</p>{suggestList}</> : (
                <ul id="testing-list">
                  {(allTesting ? testing : testing.slice(0, FEW)).map(({ entry, app }) => {
                    const d = daysActive(entry)
                    return (
                      <li className="row-line" key={entry.appId}>
                        <span className="grow cell-2"><Link to={`/apps/${app.id}`}><b>{app.name}</b></Link>
                          <span className="creator-nums" style={{ marginTop: 'var(--s-1)' }}><FeedbackChip t={entry} />{entry.replied && <span>{t('me_replied_creator')}</span>}</span></span>
                        <span className="w-meter hide-sm">
                          <Bar value={Math.min(d, TARGET_DAYS)} max={TARGET_DAYS} label={t('me_days_active_label', { name: app.name })} />
                        </span>
                        <span className="num w-num">{d}<span className="of"> / {TARGET_DAYS}</span></span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            {testing.length > FEW && <ShowAll open={allTesting} total={testing.length} onToggle={() => setAllTesting((x) => !x)} controls="testing-list" />}
          </section>
        </div>

        <div className="span-5 col-fill stretch">
          <section className="panel" aria-labelledby="recip-h">
            <header><h2 id="recip-h">{t('me_recip_h')}</h2><Link className="text-action small" to={`/u/${uid}`}>{t('me_public_profile')}</Link></header>
            <div className="recip-grid">
              <div><div className="kpi-label">{t('me_kpi_testing')}</div><div className="kpi-value num">{p ? <>{p.testingCount}<small>{t('me_kpi_apps_unit')}</small></> : <Skel w={60} h={24} />}</div><p className="small muted" style={{ marginTop: 'var(--s-1)' }}>{t('me_kpi_testing_note')}</p></div>
              <div><div className="kpi-label">{t('me_kpi_feedback')}</div><div className="kpi-value num">{p ? <>{p.feedbackSentCount}<small>{t('me_kpi_feedback_verified', { n: p.feedbackVerifiedCount })}</small></> : <Skel w={60} h={24} />}</div></div>
            </div>
            <div className="recip-tier">
              <div className="creator-nums">
                <span className="kpi-label">{t('me_kpi_tested_14')}</span>
                {p && <Badge tier={p.badgeTier} />}
              </div>
              {p ? <TierProgress count={p.appsTestedCount} tier={p.badgeTier} nextAt={p.nextTierAt} /> : <Skel w={200} />}
            </div>
            {nudge && <p className="notice" style={{ margin: 'var(--s-3) 0 0' }}><span className="chip"><span className="g" aria-hidden="true">!</span>{t('me_nudge_chip')}</span>{t('me_nudge_body', { listed, testing: p!.testingCount })}</p>}
            {testing.length > 0 && suggestList}
          </section>

          <section className="panel" id="pengingat" aria-labelledby="notif-h">
            <header><h2 id="notif-h">{t('me_reminders_h')}</h2></header>
            {p ? <DigestToggle initial={p.emailReminders} onSaved={profile.retry} /> : <Skel w={240} />}
          </section>

          <section className="panel fill" aria-labelledby="mine-h">
            <header><h2 id="mine-h">{t('me_mine_h')}</h2><span className="meta num">{t('me_mine_count', { n: myApps.data.length })}</span></header>
            <div className="grow-body">
              {myApps.loading ? <RowsSkeleton /> : myApps.data.length === 0 ? <Empty title={t('me_mine_empty_title')}><p>{t('me_mine_empty_body')}</p></Empty> : (
                <ul>
                  {myApps.data.map((a) => (
                    <li className="row-line" key={a.id}>
                      <span className="grow cell-2"><Link to={`/apps/${a.id}`}><b>{a.name}</b></Link><span style={{ marginTop: 'var(--s-1)' }}><StatusPill status={a.status} /></span></span>
                      <Seats active={a.activeTesterCount} total={a.testerSlots} className="hide-sm" />
                      <span className="num w-num">{a.activeTesterCount}<span className="of"> / {a.testerSlots}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Link className="btn" style={{ alignSelf: 'flex-start', marginTop: 'var(--s-3)' }} to="/apps/new"><IconPlus />{t('me_add_app')}</Link>
          </section>
        </div>
      </div>
    </>
  )
}

/** FR-46: daily digest on/off. Optimistic, rolled back with a toast if the RPC fails. */
function DigestToggle({ initial, onSaved }: { initial: boolean; onSaved: () => void }) {
  const toast = useToast()
  const t = useT()
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  useEffect(() => { if (!inFlight.current) setOn(initial) }, [initial])

  const change = async (next: boolean) => {
    setOn(next)
    setSaving(true)
    inFlight.current = true
    try {
      await setEmailReminders(next)
      toast(next ? t('me_digest_on') : t('me_digest_off'))
      onSaved()
    } catch (e) {
      setOn(!next)
      toast(errorText(e, t))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <label className="switch-row">
      <span>
        <span className="t">{t('me_digest_label')}</span>
        <span className="d" id="digest-d">{saving ? t('saving') : t('me_digest_hint')}</span>
      </span>
      <span className="switch">
        <input type="checkbox" role="switch" checked={on} disabled={saving} aria-describedby="digest-d" onChange={(e) => change(e.target.checked)} />
        <span className="track" aria-hidden="true" />
      </span>
    </label>
  )
}

function RowsSkeleton() {
  return <div>{[0, 1, 2].map((i) => <div className="row-line" key={i}><span className="grow"><Skel w={180} /></span><Skel w={60} /></div>)}</div>
}
