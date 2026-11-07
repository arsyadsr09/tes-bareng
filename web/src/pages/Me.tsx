import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Bar, Chip, Empty, ErrorBox, FeedbackChip, Seats, Skel, StatusPill, TierProgress, useToast } from '../components/bits'
import { IconPlus } from '../components/icons'
import { useAuth } from '../lib/auth'
import { COMMUNITY_GROUP_URL } from '../lib/community'
import { usePageMeta } from '../lib/pageMeta'
import { errorText, setEmailReminders, usePublicProfile } from '../lib/data'
import { useMyObligations } from '../lib/cohorts'
import { useMyTodos } from '../lib/todos'
import { daysActive, relDay, openSeats, TARGET_DAYS } from '../lib/progress'

export function Me() {
  const { user, isAdmin, ready, signIn } = useAuth()
  const toast = useToast()
  usePageMeta('Tugas saya', 'Aplikasi yang sedang Anda uji, feedback yang belum dikirim, dan build baru yang menunggu diuji ulang.')
  if (!ready) return <Skel w={200} h={32} />
  if (!user) {
    return (
      <div className="state-page">
        <h1 className="page-title">Tugas saya</h1>
        <p>Masuk untuk melihat aplikasi yang sedang Anda uji, feedback yang belum dikirim, dan build baru yang menunggu diuji ulang.</p>
        <button className="btn primary" onClick={() => signIn().catch((e) => toast(errorText(e)))}>Masuk dengan Google</button>
      </div>
    )
  }
  return <MeSignedIn uid={user.uid} isAdmin={isAdmin} />
}

function MeSignedIn({ uid, isAdmin }: { uid: string; isAdmin: boolean }) {
  const { entries, apps, myApps, requests, testing, todos, total, loading } = useMyTodos(uid, isAdmin)
  const profile = usePublicProfile(uid)
  const obligations = useMyObligations(uid)

  const suggestions = useMemo(() => {
    const mineIds = new Set(entries.data.map((e) => e.appId))
    return apps.data
      .filter((a) => (a.status === 'recruiting' || a.status === 'testing') && a.creatorUid !== uid && !mineIds.has(a.id) && openSeats(a) > 0)
      .sort((a, b) => openSeats(b) - openSeats(a))
      .slice(0, 3)
  }, [apps.data, entries.data, uid])

  const suggestList = (
    <>
            <h3 className="subhead">Butuh tester sekarang</h3>
              {apps.loading ? <RowsSkeleton /> : suggestions.length === 0 ? <p className="muted" style={{ marginTop: 'var(--s-2)' }}>Semua aplikasi yang mencari tester sudah Anda uji.</p> : (
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
  const unjoined = todos.filter((t) => t.kind === 'join' || t.kind === 'listed').length
  const emailWait = todos.filter((t) => t.kind === 'emails').reduce((n, t) => n + (t.count ?? 0), 0)
  const owe = todos.filter((t) => t.kind === 'feedback').length
  const builds = todos.filter((t) => t.kind === 'build').length
  const asks = requests.data.reduce((n, r) => n + r.count, 0)
  const p = profile.data
  const listed = myApps.data.length
  const nudge = p && listed > 0 && p.testingCount < listed

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Tugas saya</h1>
          <p className="sub">
            {loading ? <Skel w={340} h={16} /> : total === 0
              ? testing.length === 0 ? 'Anda belum menguji aplikasi apa pun.' : 'Tidak ada tugas tertunda. Semua aplikasi yang Anda uji sudah dapat feedback.'
              : <><b>{[unjoined > 0 && `${unjoined} belum opt-in`, owe > 0 && `${owe} feedback belum dikirim`, builds > 0 && `${builds} build baru menunggu diuji ulang`, emailWait > 0 && `${emailWait} email tester menunggu ditambahkan`, asks > 0 && `${asks} permintaan cohort menunggu keputusan`].filter(Boolean).join(', ')}</b>.</>}
          </p>
        </div>
        <div className="actions"><Link className="btn" to="/apps">Cari aplikasi yang butuh tester</Link></div>
      </div>

      {(entries.error || apps.error) && <ErrorBox text="Data Anda gagal dimuat." onRetry={() => { entries.retry(); apps.retry() }} />}

      {!obligations.error && obligations.data.filter((o) => o.isBehind).length > 0 && (
        <section className="panel" aria-labelledby="cohort-oblig-h" style={{ marginBottom: 'var(--s-4)' }}>
          <header>
            <h2 id="cohort-oblig-h">Kewajiban cohort tertinggal</h2>
            <Chip tone="cabai" glyph="!">{obligations.data.filter((o) => o.isBehind).length}</Chip>
          </header>
          <ul>
            {obligations.data.filter((o) => o.isBehind).map((o) => (
              <li className="row-line" key={`${o.cohortId}:${o.userId}`}>
                <span className="grow cell-2">
                  <Link to={`/cohorts/${o.cohortId}`}><b>{o.cohortName}</b></Link>
                  <span className="num">{o.behindCount} slot belum opt-in dalam batas waktu</span>
                </span>
                <Chip tone="cabai" glyph="!">Tertinggal</Chip>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid">
        <div className="span-7 col-fill stretch">
          <section className="panel" aria-labelledby="todo-h">
            <header><h2 id="todo-h">Perlu dikerjakan</h2><span className="meta num">{loading ? '' : `${total} tugas`}</span></header>
            {loading ? <RowsSkeleton /> : total === 0 ? (
              // ADR-001 §2.6: spot illustration for the empty Tugas saya state goes in Empty's `art` slot.
              testing.length === 0
                ? (
                  <Empty title="Mulai dari dua langkah.">
                    <ol className="first-run">
                      <li><a href={COMMUNITY_GROUP_URL} target="_blank" rel="noreferrer">Gabung Google Group komunitas<span className="sr-only"> (tab baru)</span></a>. Tanpa ini opt-in Anda tidak terhitung di Play Console.</li>
                      <li>Pilih aplikasi di <Link to="/apps">daftar aplikasi</Link>, lalu tekan Gabung sebagai tester. Tugasnya muncul di sini.</li>
                    </ol>
                  </Empty>
                )
                : <Empty title="Beres, tidak ada tugas tertunda."><p>Cek lagi besok, atau bantu aplikasi lain yang masih butuh tester.</p></Empty>
            ) : (
              <ul>
                {requests.data.map((r, i) => (
                  <li className="row-line" key={`requests:${r.cohortId}`}>
                    <span className="grow cell-2">
                      <Link to={`/cohorts/${r.cohortId}`}><b>{r.cohortName}</b></Link>
                      <span className="num">{r.count} permintaan masuk menunggu disetujui atau ditolak.</span>
                    </span>
                    <Link className={`btn sm${i === 0 ? ' primary' : ''}`} to={`/admin?bagian=cohort&cohort=${r.cohortId}`}>Tinjau permintaan</Link>
                  </li>
                ))}
                {todos.slice(0, 4).map(({ entry, app, kind, count }, i) => (
                  <li className="row-line" key={`${kind}:${app.id}`}>
                    <span className="grow cell-2">
                      <Link to={`/apps/${app.id}`}><b>{app.name}</b></Link>
                      <span>
                        {kind === 'join'
                          ? 'Ditugaskan melalui cohort. Opt-in dalam batas 48 jam.'
                          : kind === 'listed'
                            ? 'Creator sudah menambahkan email Anda di Play Console. Sekarang opt-in, lalu daftar sebagai tester.'
                          : kind === 'emails'
                            ? `${count} tester menunggu emailnya Anda tambahkan di Play Console.`
                          : kind === 'build'
                            ? `Build baru dirilis ${relDay(app.lastBuildAt)}. Perbarui dari Play Store lalu uji lagi.`
                            : `Hari ke-${daysActive(entry!)}. Feedback di Play belum Anda tandai terkirim.`}
                      </span>
                    </span>
                    <Link className={`btn sm${i === 0 && requests.data.length === 0 ? ' primary' : ''}`} to={`/apps/${app.id}`}>
                      {kind === 'join' || kind === 'listed' ? 'Daftar sebagai tester' : kind === 'emails' ? 'Tambahkan email' : kind === 'build' ? 'Uji build baru' : 'Kirim feedback'}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {todos.length > 4 && <p className="muted small num" style={{ marginTop: 'var(--s-2)' }}>{todos.length - 4} tugas lain: buka aplikasi di daftar “Sedang saya uji”.</p>}
          </section>

          <section className="panel fill" aria-labelledby="testing-h">
            <header><h2 id="testing-h">Sedang saya uji</h2><span className="meta num">{testing.length} aplikasi aktif</span></header>
            <div className="grow-body">
              {loading ? <RowsSkeleton /> : testing.length === 0 ? <><p className="muted">Belum ada. Mulai dari aplikasi dengan kursi paling kosong:</p>{suggestList}</> : (
                <ul>
                  {testing.slice(0, 4).map(({ entry, app }) => {
                    const d = daysActive(entry)
                    return (
                      <li className="row-line" key={entry.appId}>
                        <span className="grow cell-2"><Link to={`/apps/${app.id}`}><b>{app.name}</b></Link>
                          <span className="creator-nums" style={{ marginTop: 'var(--s-1)' }}><FeedbackChip t={entry} />{entry.replied && <span>dibalas creator</span>}</span></span>
                        <span className="w-meter hide-sm">
                          <Bar value={Math.min(d, TARGET_DAYS)} max={TARGET_DAYS} label={`Hari aktif di ${app.name}`} />
                        </span>
                        <span className="num w-num">{d}<span className="of"> / {TARGET_DAYS}</span></span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            {testing.length > 4 && <Link className="text-action" style={{ marginTop: 'var(--s-2)', alignSelf: 'flex-start' }} to={`/u/${uid}`}>Lihat semua {testing.length} aplikasi di profil</Link>}
          </section>
        </div>

        <div className="span-5 col-fill stretch">
          <section className="panel" aria-labelledby="recip-h">
            <header><h2 id="recip-h">Timbal balik Anda</h2><Link className="text-action small" to={`/u/${uid}`}>Profil publik</Link></header>
            <div className="recip-grid">
              <div><div className="kpi-label">Menguji</div><div className="kpi-value num">{p ? <>{p.testingCount}<small> aplikasi</small></> : <Skel w={60} h={24} />}</div><p className="small muted" style={{ marginTop: 'var(--s-1)' }}>aktif, atau selesai 14 hari</p></div>
              <div><div className="kpi-label">Feedback terkirim</div><div className="kpi-value num">{p ? <>{p.feedbackSentCount}<small> · {p.feedbackVerifiedCount} terverifikasi</small></> : <Skel w={60} h={24} />}</div></div>
            </div>
            <div className="recip-tier">
              <div className="creator-nums">
                <span className="kpi-label">Aplikasi diuji 14+ hari</span>
                {p && <Badge tier={p.badgeTier} />}
              </div>
              {p ? <TierProgress count={p.appsTestedCount} tier={p.badgeTier} nextAt={p.nextTierAt} /> : <Skel w={200} />}
            </div>
            {nudge && <p className="notice" style={{ margin: 'var(--s-3) 0 0' }}><span className="chip"><span className="g" aria-hidden="true">!</span>Timbal balik</span>Anda punya {listed} aplikasi terdaftar tapi baru menguji {p!.testingCount}. Bantu yang lain supaya dibantu balik.</p>}
            {testing.length > 0 && suggestList}
          </section>

          <section className="panel" id="pengingat" aria-labelledby="notif-h">
            <header><h2 id="notif-h">Pengingat</h2></header>
            {p ? <DigestToggle initial={p.emailReminders} onSaved={profile.retry} /> : <Skel w={240} />}
          </section>

          <section className="panel fill" aria-labelledby="mine-h">
            <header><h2 id="mine-h">Aplikasi saya</h2><span className="meta num">{myApps.data.length} aplikasi</span></header>
            <div className="grow-body">
              {myApps.loading ? <RowsSkeleton /> : myApps.data.length === 0 ? <Empty title="Belum ada aplikasi terdaftar."><p>Daftarkan aplikasi Anda agar komunitas bisa ikut menguji.</p></Empty> : (
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
            <Link className="btn" style={{ alignSelf: 'flex-start', marginTop: 'var(--s-3)' }} to="/apps/new"><IconPlus />Tambah aplikasi</Link>
          </section>
        </div>
      </div>
    </>
  )
}

/** FR-46: daily digest on/off. Optimistic, rolled back with a toast if the RPC fails. */
function DigestToggle({ initial, onSaved }: { initial: boolean; onSaved: () => void }) {
  const toast = useToast()
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  // follow the server value when the refetched profile changes it, but never mid-save
  useEffect(() => { if (!inFlight.current) setOn(initial) }, [initial])

  const change = async (next: boolean) => {
    setOn(next)
    setSaving(true)
    inFlight.current = true
    try {
      await setEmailReminders(next)
      toast(next ? 'Ringkasan harian diaktifkan.' : 'Ringkasan harian dimatikan.')
      onSaved()
    } catch (e) {
      setOn(!next)
      toast(errorText(e))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <label className="switch-row">
      <span>
        <span className="t">Kirim ringkasan tugas harian lewat email (19.00 WIB)</span>
        <span className="d" id="digest-d">{saving ? 'Menyimpan…' : 'Satu email per hari, hanya jika ada tugas. Bisa dimatikan kapan saja.'}</span>
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
