import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { api, cancelEmailListing, errorText, requestEmailListing, updateTesterAsCreator, useMyEmailListing } from '../lib/data'
import { COMMUNITY_GROUP, COMMUNITY_GROUP_URL } from '../lib/community'
import { fmtDate, isoDate, todayIso } from '../lib/progress'
import type { AppDoc, TesterDoc } from '../lib/types'
import { BUILD_LIMITS, MANUAL_LIMITS, validateBuild, validateManual, type BuildInput, type ManualInput } from '../lib/validate'
import { useValidation } from '../lib/useValidation'
import { Dialog, ErrorBox, Field, fieldAria, useToast } from './bits'
import { IconExternal } from './icons'

function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return // already saving: ignore the double tap
    setBusy(true); setErr(null)
    try { await fn(); onDone() } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  return { busy, err, run }
}

export function JoinDialog({ open, onClose, app, rejoin }: { open: boolean; onClose: () => void; app: AppDoc; rejoin?: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} label={`Gabung sebagai tester ${app.name}`}>
      {app.testerMethod === 'email_list'
        ? <EmailJoinForm app={app} rejoin={rejoin} onClose={onClose} />
        : <JoinForm app={app} rejoin={rejoin} onClose={onClose} />}
    </Dialog>
  )
}

function JoinForm({ onClose, app, rejoin }: { onClose: () => void; app: AppDoc; rejoin?: boolean }) {
  const toast = useToast()
  const [c, setC] = useState({ joinedGroup: false, optedIn: false, installed: false })
  const { busy, err, run } = useSubmit(() => { toast(`Anda tercatat sebagai tester ${app.name}. Hari aktif Anda dihitung mulai hari ini.`); onClose() })
  const all = c.joinedGroup && c.optedIn && c.installed
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!all) return
    run(() => api.joinAsTester({ appId: app.id, checklist: { joinedGroup: true, optedIn: true, installed: true } }))
  }
  return (
      <form onSubmit={submit}>
        <div className="sheet-body">
          <h2>Gabung sebagai tester {app.name}</h2>
          {rejoin && <p className="muted">Hari aktif Anda dihitung lagi dari nol mulai hari ini.</p>}
          <p className="lede">Google hanya menghitung tester yang benar-benar opt-in. Selesaikan tiga langkah ini di HP Anda dulu.</p>
          <div>
            <label className="check">
              <input type="checkbox" checked={c.joinedGroup} onChange={(e) => setC({ ...c, joinedGroup: e.target.checked })} />
              <span><span className="t">Saya sudah gabung grup {COMMUNITY_GROUP}</span>
                <span className="d"><a className="link" href={COMMUNITY_GROUP_URL} target="_blank" rel="noreferrer">Buka Google Group</a> dengan akun Google yang sama.</span></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={c.optedIn} onChange={(e) => setC({ ...c, optedIn: e.target.checked })} />
              <span><span className="t">Saya sudah buka link opt-in dan ketuk “Jadi penguji”</span>
                <span className="d"><a className="link" href={app.optInUrl} target="_blank" rel="noreferrer">Buka link opt-in</a> di Google Play.</span></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={c.installed} onChange={(e) => setC({ ...c, installed: e.target.checked })} />
              <span><span className="t">Saya sudah memasang aplikasinya</span>
                <span className="d">Biarkan terpasang sampai app ini lulus 14 hari Google, dihitung sejak semua kursi terisi.</span></span>
            </label>
          </div>
          {app.feedbackGuide && (
            <div className="stack-8">
              <p className="strong">Nanti, saat kirim feedback di Play</p>
              <p className="guide-quote">{app.feedbackGuide}</p>
              <p className="muted small">Tulis dengan kata-kata Anda sendiri. Ulasan yang sama persis dari banyak akun bisa dianggap tidak asli oleh Google.</p>
            </div>
          )}
          {err && <ErrorBox text={err} />}
        </div>
        <div className="sheet-foot">
          {!all && <span className="why" id="join-why">Centang ketiga langkah untuk lanjut.</span>}
          <button type="button" className="btn" onClick={onClose}>Batal</button>
          <button className="btn primary" disabled={!all || busy} aria-describedby={!all ? 'join-why' : undefined}>{busy ? 'Menyimpan…' : 'Gabung sebagai tester'}</button>
        </div>
      </form>
  )
}

/**
 * Email-list apps (ADR-011): Play Console takes this app's testers by email, not through
 * the community group. Three states: ask (with consent) → wait for the creator → opt in.
 */
function EmailJoinForm({ onClose, app, rejoin }: { onClose: () => void; app: AppDoc; rejoin?: boolean }) {
  const toast = useToast()
  const { user } = useAuth()
  const listing = useMyEmailListing(app.id, user?.uid)
  // The full address lives only in the member's own session (ADR-005); profiles hold the masked one.
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null)) }, [])
  const [consent, setConsent] = useState(false)
  const [c, setC] = useState({ optedIn: false, installed: false })
  const asked = useSubmit(() => listing.refresh())
  const joined = useSubmit(() => { toast(`Anda tercatat sebagai tester ${app.name}. Hari aktif Anda dihitung mulai hari ini.`); onClose() })
  const l = listing.data
  const step = !l ? 'ask' : l.listedAt == null ? 'wait' : 'join'
  const all = c.optedIn && c.installed

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (step === 'ask' && consent) asked.run(async () => { await requestEmailListing(app.id); toast('Permintaan terkirim. Creator akan menambahkan email Anda.') })
    if (step === 'join' && all) joined.run(() => api.joinAsTester({ appId: app.id, checklist: { optedIn: true, installed: true } }))
  }
  const withdraw = () => asked.run(async () => { await cancelEmailListing(app.id); toast('Permintaan dibatalkan. Creator tidak lagi melihat email Anda.') })
  const err = asked.err ?? joined.err ?? listing.error
  const busy = asked.busy || joined.busy

  return (
      <form onSubmit={submit}>
        <div className="sheet-body">
          <h2>Gabung sebagai tester {app.name}</h2>
          {rejoin && <p className="muted">Hari aktif Anda dihitung lagi dari nol mulai hari ini.</p>}
          <p className="lede">Aplikasi ini memakai daftar email di Play Console, bukan Google Group. Creator perlu menambahkan email Anda dulu sebelum Anda bisa opt-in.</p>
          <ol className="steps" aria-label="Langkah">
            <li aria-current={step === 'ask' ? 'step' : undefined}><span className="num" aria-hidden="true">{step !== 'ask' ? '✓' : '1'}</span><span>Minta ditambahkan{step !== 'ask' && <span className="muted small"> · selesai</span>}</span></li>
            <li aria-current={step === 'wait' ? 'step' : undefined}><span className="num" aria-hidden="true">{step === 'join' ? '✓' : '2'}</span><span>Creator menambahkan email Anda{step === 'join' && <span className="muted small"> · selesai</span>}</span></li>
            <li aria-current={step === 'join' ? 'step' : undefined}><span className="num" aria-hidden="true">3</span><span>Opt-in dan pasang aplikasinya</span></li>
          </ol>
          {listing.loading ? <p className="muted">Memuat…</p> : step === 'ask' ? (
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span><span className="t">Saya setuju creator {app.name} melihat email lengkap akun Google saya</span>
                {email && <span className="d addr">{email}</span>}
                <span className="d">Hanya creator aplikasi ini yang melihatnya, untuk ditempel di Play Console. Pastikan ini akun yang sama dengan akun Play Store di HP Anda. Anda bisa membatalkan kapan saja.</span></span>
            </label>
          ) : step === 'wait' ? (
            <div className="notice info" role="status">
              <span>Menunggu creator menambahkan email Anda · diminta <span className="num">{fmtDate(l!.requestedAt)}</span>. Anda akan bisa opt-in setelah ditandai “Sudah ditambahkan”.</span>
            </div>
          ) : (
            <div>
              <label className="check">
                <input type="checkbox" checked={c.optedIn} onChange={(e) => setC({ ...c, optedIn: e.target.checked })} />
                <span><span className="t">Saya sudah buka link opt-in dan ketuk “Jadi penguji”</span>
                  <span className="d"><a className="link" href={app.optInUrl} target="_blank" rel="noreferrer">Buka link opt-in</a> di Google Play, dengan akun yang emailnya Anda bagikan.</span></span>
              </label>
              <label className="check">
                <input type="checkbox" checked={c.installed} onChange={(e) => setC({ ...c, installed: e.target.checked })} />
                <span><span className="t">Saya sudah memasang aplikasinya</span>
                  <span className="d">Biarkan terpasang sampai app ini lulus 14 hari Google, dihitung sejak semua kursi terisi.</span></span>
              </label>
            </div>
          )}
          {err && <ErrorBox text={err} />}
        </div>
        <div className="sheet-foot">
          {step !== 'ask' && !listing.loading && (
            <button type="button" className="text-action quiet" style={{ marginRight: 'auto' }} disabled={busy} onClick={withdraw}>Batalkan permintaan</button>
          )}
          {step === 'ask' && !consent && <span className="why" id="join-why">Centang persetujuan untuk lanjut.</span>}
          {step === 'join' && !all && <span className="why" id="join-why">Centang kedua langkah untuk lanjut.</span>}
          <button type="button" className="btn" onClick={onClose}>{step === 'wait' ? 'Tutup' : 'Batal'}</button>
          {step === 'ask' && (
            <button className="btn primary" disabled={!consent || busy || listing.loading} aria-describedby={!consent ? 'join-why' : undefined}>{busy ? 'Mengirim…' : 'Minta ditambahkan'}</button>
          )}
          {step === 'join' && (
            <button className="btn primary" disabled={!all || busy} aria-describedby={!all ? 'join-why' : undefined}>{busy ? 'Menyimpan…' : 'Gabung sebagai tester'}</button>
          )}
        </div>
      </form>
  )
}

export function FeedbackDialog({ open, onClose, app, entry }: { open: boolean; onClose: () => void; app: AppDoc; entry?: TesterDoc }) {
  return (
    <Dialog open={open} onClose={onClose} label="Tandai sudah kirim feedback">
      <FeedbackForm app={app} entry={entry} onClose={onClose} />
    </Dialog>
  )
}

function parseDeviceSummary(raw = '') {
  const match = raw.match(/^\[([^\]]+)\]\s*(.*)$/s);
  return match ? { device: match[1], summary: match[2] } : { device: '', summary: raw };
}

function FeedbackForm({ onClose, app, entry }: { onClose: () => void; app: AppDoc; entry?: TesterDoc }) {
  const toast = useToast()
  const initial = parseDeviceSummary(entry?.feedbackSummary ?? '')
  const [device, setDevice] = useState(initial.device)
  const [summary, setSummary] = useState(initial.summary)
  const { busy, err, run } = useSubmit(onClose)
  const already = !!entry?.feedbackSent

  const save = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      const cleanDevice = device.trim()
      const cleanSummary = summary.trim()
      const combined = cleanDevice ? ('[' + cleanDevice + '] ' + cleanSummary).trim() : cleanSummary
      await api.markFeedbackSent({ appId: app.id, sent: true, summary: combined || undefined })
      toast(already ? 'Catatan feedback diperbarui.' : 'Feedback ditandai terkirim. Kreator akan memverifikasinya di Play Console.')
    })
  }
  const unmark = () => run(async () => {
    await api.markFeedbackSent({ appId: app.id, sent: false })
    toast('Tanda feedback dibatalkan.')
  })
  return (
      <form onSubmit={save}>
        <div className="sheet-body">
          <h2>{already ? 'Catatan feedback Anda' : 'Tandai sudah kirim feedback'}</h2>
          {!already && (
            <p className="lede">Feedback ditulis di Google Play, bukan di sini: buka halaman aplikasi di Play Store, beri rating dan tulis apa yang berjalan, apa yang rusak, dan apa yang perlu diperbaiki.</p>
          )}
          {!already && (
            <a className="btn" style={{ justifySelf: 'start' }} href={app.storeUrl ?? app.optInUrl} target="_blank" rel="noreferrer"><IconExternal />Buka {app.name} di Play</a>
          )}
          <div className="field">
            <label htmlFor="fb-device">Tipe HP / Versi Android <span className="opt">(opsional)</span></label>
            <input id="fb-device" className="input" maxLength={60} placeholder="Contoh: Samsung A54 / Android 14" value={device} onChange={(e) => setDevice(e.target.value)} aria-describedby="fb-dev-hint" />
            <span className="hint" id="fb-dev-hint">Membantu kreator saat menjawab kuesioner audit Google Play.</span>
          </div>
          <div className="field">
            <label htmlFor="fb-sum">Ringkasan yang Anda tulis <span className="opt">(opsional)</span></label>
            <textarea id="fb-sum" className="input" maxLength={500} value={summary} onChange={(e) => setSummary(e.target.value)} aria-describedby="fb-sum-hint" />
            <span className="hint" id="fb-sum-hint">Terlihat oleh semua anggota. Maksimal 500 karakter.</span>
            <span className="count">{summary.length}/500</span>
          </div>
          {err && <ErrorBox text={err} />}
        </div>
        <div className="sheet-foot">
          {already && <button type="button" className="text-action quiet" style={{ marginRight: 'auto' }} disabled={busy} onClick={unmark}>Batalkan tanda terkirim</button>}
          <button type="button" className="btn" onClick={onClose}>Batal</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : already ? 'Simpan catatan' : 'Tandai sudah kirim'}</button>
        </div>
      </form>
  )
}

const BUILD_ORDER = ['versionName', 'uploadedAt', 'changelog'] as const
const blankBuild = (): BuildInput => ({ versionName: '', uploadedAt: todayIso(), changelog: '' })

export function BuildDialog({ open, onClose, app }: { open: boolean; onClose: () => void; app: AppDoc }) {
  const toast = useToast()
  const [f, setF] = useState<BuildInput>(blankBuild)
  const v = useValidation(validateBuild(f, todayIso()), BUILD_ORDER)
  const close = () => { v.reset(); onClose() }
  const { busy, err, run } = useSubmit(() => {
    toast(`Build ${f.versionName.trim()} dicatat. Tester melihat pengumuman build baru selama 3 hari.`)
    setF(blankBuild()); close()
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    e.stopPropagation() // never let this submit reach a form the dialog is rendered beside
    const bad = v.check()
    if (bad.length) { document.getElementById(`b-${bad[0]}`)?.focus(); return }
    run(() => api.addBuild({ appId: app.id, versionName: f.versionName.trim(), uploadedAt: f.uploadedAt, changelog: f.changelog.trim() }))
  }
  return (
    <Dialog open={open} onClose={close} label="Catat build baru">
      <form onSubmit={submit} noValidate>
        <div className="sheet-body">
          <h2>Catat build baru</h2>
          <p className="lede">Satu catatan untuk setiap unggahan ke jalur uji tertutup. Tester diminta memperbarui dan menguji lagi.</p>
          <Field id="b-versionName" label="Nama versi" hint="Seperti di Play Console, misalnya 1.2.0 (14)." error={v.errors.versionName}>
            <input className="input" maxLength={BUILD_LIMITS.versionName} autoComplete="off" spellCheck={false} value={f.versionName}
              onChange={(e) => setF({ ...f, versionName: e.target.value })} onBlur={v.blur('versionName')}
              {...fieldAria('b-versionName', { hint: true, error: v.errors.versionName })} />
          </Field>
          <Field id="b-uploadedAt" label="Tanggal unggah" hint="Hari ini tercatat dengan jam sekarang (WIB)." error={v.errors.uploadedAt}>
            <input type="date" className="input" max={todayIso()} value={f.uploadedAt}
              onChange={(e) => setF({ ...f, uploadedAt: e.target.value })} onBlur={v.blur('uploadedAt')}
              {...fieldAria('b-uploadedAt', { hint: true, error: v.errors.uploadedAt })} />
          </Field>
          <Field id="b-changelog" label="Perubahan, satu kalimat" hint="Yang perlu dicoba ulang oleh tester." error={v.errors.changelog}
            count={`${f.changelog.length}/${BUILD_LIMITS.changelog}`}>
            <input className="input" maxLength={BUILD_LIMITS.changelog} autoComplete="off" value={f.changelog}
              onChange={(e) => setF({ ...f, changelog: e.target.value })} onBlur={v.blur('changelog')}
              {...fieldAria('b-changelog', { hint: true, error: v.errors.changelog })} />
          </Field>
          {err && <ErrorBox text={err} />}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn" onClick={close}>Batal</button>
          <button className="btn primary" aria-busy={busy || undefined}>{busy ? 'Menyimpan…' : 'Catat build'}</button>
        </div>
      </form>
    </Dialog>
  )
}

const MANUAL_ORDER = ['displayName', 'email', 'optedInAt'] as const
const blankManual = (): ManualInput => ({ displayName: '', email: '', optedInAt: todayIso() })

export function ManualTesterDialog({ open, onClose, app }: { open: boolean; onClose: () => void; app: AppDoc }) {
  const toast = useToast()
  const [f, setF] = useState<ManualInput>(blankManual)
  const v = useValidation(validateManual(f, todayIso()), MANUAL_ORDER)
  const close = () => { v.reset(); onClose() }
  const { busy, err, run } = useSubmit(() => { toast(`${f.displayName.trim()} ditambahkan ke daftar tester.`); setF(blankManual()); close() })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const bad = v.check()
    if (bad.length) { document.getElementById(`m-${bad[0]}`)?.focus(); return }
    run(() => api.addManualTester({ appId: app.id, displayName: f.displayName.trim(), email: f.email.trim(), optedInAt: f.optedInAt }))
  }
  return (
    <Dialog open={open} onClose={close} label="Tambah tester manual">
      <form onSubmit={submit} noValidate>
        <div className="sheet-body">
          <h2>Tambah tester manual</h2>
          <p className="lede">Untuk tester yang opt-in tanpa lewat TesBareng. Pastikan namanya ada di Play Console.</p>
          <Field id="m-displayName" label="Nama" hint="Nama yang dikenali anggota lain." error={v.errors.displayName}>
            <input className="input" maxLength={MANUAL_LIMITS.displayName} autoComplete="off" value={f.displayName}
              onChange={(e) => setF({ ...f, displayName: e.target.value })} onBlur={v.blur('displayName')}
              {...fieldAria('m-displayName', { hint: true, error: v.errors.displayName })} />
          </Field>
          <Field id="m-email" label="Email Google" error={v.errors.email}
            hint="Disamarkan di server sebelum disimpan, misalnya bu*****@gmail.com. Email lengkap tidak disimpan.">
            <input type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} className="input" value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })} onBlur={v.blur('email')}
              {...fieldAria('m-email', { hint: true, error: v.errors.email })} />
          </Field>
          <Field id="m-optedInAt" label="Opt-in sejak" hint="Hari aktif tester ini dihitung dari tanggal ini." error={v.errors.optedInAt}>
            <input type="date" className="input" max={todayIso()} value={f.optedInAt}
              onChange={(e) => setF({ ...f, optedInAt: e.target.value })} onBlur={v.blur('optedInAt')}
              {...fieldAria('m-optedInAt', { hint: true, error: v.errors.optedInAt })} />
          </Field>
          {err && <ErrorBox text={err} />}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn" onClick={close}>Batal</button>
          <button className="btn primary" aria-busy={busy || undefined}>{busy ? 'Menyimpan…' : 'Tambahkan tester'}</button>
        </div>
      </form>
    </Dialog>
  )
}

/** Note and opt-in date only. Verified, Replied and status are edited inline in the tester table (ADR-009 §3). */
export function TesterDialog({ open, onClose, app, tester }: { open: boolean; onClose: () => void; app: AppDoc; tester?: TesterDoc }) {
  return (
    <Dialog open={open} onClose={onClose} label={tester ? `Ubah catatan ${tester.displayName}` : 'Ubah catatan tester'}>
      {tester && <TesterForm key={tester.id} app={app} tester={tester} onClose={onClose} />}
    </Dialog>
  )
}

function TesterForm({ app, tester, onClose }: { app: AppDoc; tester: TesterDoc; onClose: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ optedInAt: isoDate(tester.optedInAt), note: tester.note ?? '' })
  const dateErr = !f.optedInAt ? 'Pilih tanggal tester opt-in.' : f.optedInAt > todayIso() ? 'Tanggal opt-in tidak boleh di masa depan.' : undefined
  const [showErr, setShowErr] = useState(false)
  const { busy, err, run } = useSubmit(() => { toast(`Data ${tester.displayName} disimpan.`); onClose() })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (dateErr) { setShowErr(true); document.getElementById('t-d')?.focus(); return }
    run(() => updateTesterAsCreator(app.id, tester, {
      optedInAt: f.optedInAt !== isoDate(tester.optedInAt) ? f.optedInAt : undefined,
      note: f.note !== (tester.note ?? '') ? f.note : undefined,
    }))
  }
  return (
    <form onSubmit={submit} noValidate>
      <div className="sheet-body">
        <div>
          <h2>{tester.displayName}</h2>
          <p className="muted">{tester.maskedEmail}</p>
        </div>
        <Field id="t-d" label="Opt-in sejak" hint="Mengubah tanggal ini mengubah hitungan hari aktif." error={showErr ? dateErr : undefined}>
          <input type="date" className="input" max={todayIso()} value={f.optedInAt}
            onChange={(e) => setF({ ...f, optedInAt: e.target.value })} onBlur={() => setShowErr(true)}
            {...fieldAria('t-d', { hint: true, error: showErr ? dateErr : undefined })} />
        </Field>
        <Field id="t-n" label="Catatan" optional hint="Terlihat oleh semua anggota, misalnya “sudah dicek di Play Console”." count={`${f.note.length}/140`}>
          <input className="input" maxLength={140} autoComplete="off" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })}
            {...fieldAria('t-n', { hint: true })} />
        </Field>
        {err && <ErrorBox text={err} />}
      </div>
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={onClose}>Batal</button>
        <button className="btn primary" aria-busy={busy || undefined}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
      </div>
    </form>
  )
}
