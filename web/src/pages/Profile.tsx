import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar, Badge, Empty, ErrorBox, NotFound, Skel, StatusPill, TierProgress } from '../components/bits'
import { CohortChip, StandingChip } from '../components/cohortBits'
import { useApps, useAppsBy, useEntriesOf, usePublicProfile } from '../lib/data'
import { useCohortMembershipsOf } from '../lib/cohorts'
import { usePageMeta } from '../lib/pageMeta'
import { daysActive, fmtDate, TARGET_DAYS } from '../lib/progress'

export function Profile() {
  const { uid } = useParams()
  const profile = usePublicProfile(uid)
  const created = useAppsBy(uid)
  const entries = useEntriesOf(uid)
  const apps = useApps()
  const cohorts = useCohortMembershipsOf(uid)
  const byId = useMemo(() => new Map(apps.data.map((a) => [a.id, a])), [apps.data])

  const testing = useMemo(() => entries.data
    .filter((e) => byId.has(e.appId) && (e.status === 'active' || (e.status === 'left' && daysActive(e) >= TARGET_DAYS)))
    .map((e) => ({ e, app: byId.get(e.appId)!, d: daysActive(e) }))
    .sort((a, b) => Number(b.e.status === 'active') - Number(a.e.status === 'active') || b.d - a.d), [entries.data, byId])

  usePageMeta(profile.data?.displayName ?? 'Profil anggota', profile.data ? `Profil ${profile.data.displayName} di TesBareng: aplikasi yang diuji dan dibuat.` : undefined)

  if (profile.error) return <ErrorBox text="Profil gagal dimuat. Periksa koneksi Anda, lalu coba lagi." onRetry={profile.retry} />
  if (profile.data === null) return <NotFound what="Anggota" />
  const p = profile.data
  const loadingLists = entries.loading || apps.loading

  return (
    <>
      <div className="title-row">
        <div className="profile-head">
          {p ? <Avatar name={p.displayName} photo={p.photoURL} size="lg" /> : <Skel w={64} h={64} />}
          <div style={{ minWidth: 0 }}>
            <div className="name-line">
              <h1>{p ? p.displayName : <Skel w={200} h={32} />}</h1>
              {p && <Badge tier={p.badgeTier} />}
            </div>
            <p className="sub muted num" style={{ marginTop: 'var(--s-1)' }}>{p?.createdAt ? `Anggota sejak ${fmtDate(p.createdAt)}` : ''}</p>
          </div>
        </div>
      </div>

      <section className="kpis" aria-label="Timbal balik" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="kpi">
          <div className="kpi-label">Aplikasi diuji 14+ hari</div>
          <div className="kpi-value num">{p ? p.appsTestedCount : <Skel w={40} h={24} />}</div>
          {p && <TierProgress count={p.appsTestedCount} tier={p.badgeTier} nextAt={p.nextTierAt} />}
        </div>
        <div className="kpi"><div className="kpi-label">Menguji aplikasi lain</div><div className="kpi-value num">{p ? p.testingCount : <Skel w={40} h={24} />}</div><p className="note">aktif, atau selesai 14 hari</p></div>
        <div className="kpi"><div className="kpi-label">Feedback di Play</div><div className="kpi-value num">{p ? p.feedbackSentCount : <Skel w={40} h={24} />}</div><p className="note">{p ? `${p.feedbackVerifiedCount} terverifikasi creator` : ''}</p></div>
        <div className="kpi"><div className="kpi-label">Aplikasi didaftarkan</div><div className="kpi-value num">{p ? p.appsCreatedCount : <Skel w={40} h={24} />}</div><p className="note">sedang atau pernah diuji</p></div>
      </section>

      <section className="panel split-host" aria-label="Aplikasi">
        <div className="split">
        <div>
          <header><h2 id="t-h">Yang sedang dan pernah diuji</h2><span className="meta num">{testing.length} aplikasi</span></header>
          {loadingLists ? <Skel w={200} /> : testing.length === 0 ? <Empty title="Belum menguji aplikasi anggota lain."><Link className="text-action" to="/apps">Lihat daftar aplikasi</Link></Empty> : (
            <ul>
              {testing.map(({ e, app, d }) => (
                <li className="row-line" key={e.appId}>
                  <span className="grow cell-2"><Link to={`/apps/${app.id}`}><b>{app.name}</b></Link></span>
                  <span className="muted small num">{e.status === 'active' ? (d >= TARGET_DAYS ? (app.countedDays >= TARGET_DAYS ? 'Lulus 14 hari, masih aktif' : '14 hari, tetap ikut sampai app lulus') : `Aktif, hari ke-${d}`) : 'Selesai 14 hari'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <header><h2 id="c-h">Aplikasi buatannya</h2><span className="meta num">{created.data.length} aplikasi</span></header>
          {created.loading ? <Skel w={200} /> : created.data.length === 0 ? <Empty title="Belum mendaftarkan aplikasi."><Link className="text-action" to="/apps">Lihat aplikasi anggota lain</Link></Empty> : (
            <ul>
              {created.data.map((a) => (
                <li className="row-line" key={a.id}>
                  <span className="grow cell-2"><Link to={`/apps/${a.id}`}><b>{a.name}</b></Link></span>
                  <span className="num muted small">{a.activeTesterCount} / {a.testerSlots} tester</span>
                  <StatusPill status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
        </div>
      </section>

      {!cohorts.error && cohorts.data.length > 0 && (
        <section className="panel" aria-labelledby="cohorts-h" style={{ marginTop: 'var(--s-4)' }}>
          <header>
            <h2 id="cohorts-h">Riwayat cohort</h2>
            <span className="meta num">{cohorts.data.length} cohort</span>
          </header>
          <ul>
            {cohorts.data.map((m) => (
              <li className="row-line" key={`${m.cohortId}:${uid}`}>
                <span className="grow cell-2">
                  <Link to={`/cohorts/${m.cohortId}`}><b>{m.cohortName}</b></Link>
                  <span>{m.appId ? 'Creator' : 'Tester murni'} · {fmtDate(m.joinedAt)}</span>
                </span>
                <CohortChip status={m.cohortStatus} />
                {m.standing && <StandingChip standing={m.standing} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
