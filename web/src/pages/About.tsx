import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePageMeta } from '../lib/pageMeta'
import { Link } from 'react-router-dom'
import { StoryHeader, StoryFooter, useSignIn } from '../components/StoryChrome'
import { COMMUNITY_GROUP, COMMUNITY_GROUP_URL } from '../lib/community'
import './about.css'

/* /about: the full rules and how it works, PRD v2.2 (§1, §5–§6, §8). Story surface, same system as the landing.
   No photos: the page uses the product's own visual language (ruled sheets, chips, 12/14 counters, the ring). */

const TITLE = 'Cara kerja · TesBareng'
const DESCRIPTION =
  'Cara kerja TesBareng: syarat closed test Google Play, cara ngetes, cohort dan pembagian tugas, tester murni, titik cek, badge, pengingat dan privasi.'

const TOC = [
  { id: 'syarat', label: 'Syarat Google Play' },
  { id: 'ngetes', label: 'Cara ngetes satu app' },
  { id: 'cohort', label: 'Cohort' },
  { id: 'tester-murni', label: 'Tester murni' },
  { id: 'titik-cek', label: 'Titik cek' },
  { id: 'badge', label: 'Badge' },
  { id: 'pengingat', label: 'Pengingat' },
  { id: 'whatsapp', label: 'Grup WhatsApp' },
  { id: 'privasi', label: 'Privasi' },
  { id: 'aturan', label: 'Aturan main' },
]

function Section({ id, n, title, lede, children }: { id: string; n: number; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section className="ab-sec" id={id} aria-labelledby={`${id}-h`}>
      <div className="ab-wrap ab-sec-grid">
        <div className="ab-sec-head">
          <p className="ab-label"><b>{String(n).padStart(2, '0')}</b></p>
          <h2 id={`${id}-h`}>{title}</h2>
          {lede && <p className="ab-lede">{lede}</p>}
        </div>
        <div className="ab-sec-body">{children}</div>
      </div>
    </section>
  )
}

function Segments({ n, label }: { n: number; label: string }) {
  return (
    <div className="ab-seg" style={{ ['--n' as string]: n }} role="img" aria-label={label}>
      {Array.from({ length: n }, (_, i) => <i key={i} />)}
    </div>
  )
}

function CopyEmail() {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const id = setTimeout(() => setState('idle'), 2400)
    return () => clearTimeout(id)
  }, [state])
  const copy = async () => {
    try { await navigator.clipboard.writeText(COMMUNITY_GROUP); setState('ok') } catch { setState('fail') }
  }
  return (
    <span className="ab-copy">
      <button type="button" className={`ab-btn ab-btn--sm ${state === 'ok' ? 'is-ok' : ''}`} onClick={copy}>
        {state === 'ok' ? '✓ Tersalin' : 'Salin email grup'}
      </button>
      <span className="ab-copy-status" role="status" aria-live="polite">
        {state === 'fail' ? 'Tidak bisa menyalin otomatis. Pilih teks emailnya, lalu salin.' : state === 'ok' ? 'Email grup tersalin.' : ''}
      </span>
    </span>
  )
}

/** Ring rule for cohorts above 16 apps: the member at position i tests i+1 … i+14 (PRD FR-32). Static. */
function RingRule() {
  const n = 20, k = 14, c = 160, r = 132
  const pt = (i: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) }
  }
  const me = pt(0)
  return (
    <figure className="ab-ring">
      <svg viewBox="0 0 320 320" width="320" height="320" role="img" aria-labelledby="ab-ring-t">
        <title id="ab-ring-t">Contoh cohort 20 app yang semuanya butuh 12 tester: anggota di posisi pertama ngetes 14 app berikutnya searah jarum jam. 5 app sisanya dites anggota lain.</title>
        {Array.from({ length: k }, (_, j) => {
          const p = pt(j + 1)
          return <line key={j} x1={me.x} y1={me.y} x2={p.x} y2={p.y} className="ab-ring-tie" />
        })}
        {Array.from({ length: n }, (_, i) => {
          const p = pt(i)
          const cls = i === 0 ? 'me' : i <= k ? 'on' : 'off'
          return (
            <g key={i} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} className={`ab-ring-node ${cls}`}>
              <rect x={-9} y={-9} width={18} height={18} />
            </g>
          )
        })}
      </svg>
      <figcaption>
        <span><i className="k me" aria-hidden="true" />Kamu</span>
        <span><i className="k on" aria-hidden="true" />14 app yang kamu tes</span>
        <span><i className="k off" aria-hidden="true" />Dites anggota lain</span>
      </figcaption>
    </figure>
  )
}

const STEPS: { t: string; d: ReactNode }[] = [
  { t: 'Gabung Google Group', d: <>Masuk ke <code className="ab-email">{COMMUNITY_GROUP}</code> dengan akun Google di HP-mu. Hanya anggota grup ini yang bisa opt-in. Untuk app yang memakai daftar email, grup tidak dipakai: tekan Minta ditambahkan di halaman app dan setujui emailmu terlihat oleh creator app itu, lalu tunggu creator menandai Sudah ditambahkan.</> },
  { t: 'Opt-in', d: 'Buka link opt-in di halaman app, lalu ketuk Jadi penguji di Google Play.' },
  { t: 'Install, lalu daftar', d: 'Pasang app-nya dari Play Store dengan akun yang sama, lalu tekan Gabung sebagai tester di halaman app di TesBareng.' },
  { t: 'Pakai', d: 'Baca panduan feedback dari creator, lalu benar-benar pakai app-nya. Biarkan terpasang 14 hari.' },
  { t: 'Kirim feedback di Google Play', d: 'Rating plus komentar yang spesifik, dengan kata-katamu sendiri: apa yang jalan, apa yang rusak, apa yang perlu diperbaiki.' },
  { t: 'Centang di TesBareng', d: 'Tekan Tandai sudah kirim di halaman app. Ringkasan singkat boleh ditambahkan, maksimal 500 karakter.' },
]

const COHORT_FACTS: { t: string; d: ReactNode }[] = [
  { t: 'Minimal 13 app', d: 'Setiap creator membawa satu app. Selama cohort masih Forming, creator mengajukan app-nya, lalu admin menyetujui atau menolak, boleh dengan alasan. Satu permintaan dalam satu waktu; tarik dulu kalau mau mengajukan yang lain. Admin juga bisa langsung menambahkan app. Dengan 13 app, setiap app sudah bisa dapat 12 tester dari sesama creator saja.' },
  { t: 'Opt-in dalam 48 jam', d: <>Hitungan mulai Hari 0. Lewat 48 jam, yang belum opt-in tercatat Behind, dan app miliknya mendapat label <span className="ab-chip c-cabai">! Belum tes</span> sampai tugasnya terpenuhi. Admin bisa memindahkan slot yang kosong ke anggota lain.</> },
  { t: 'Tutup di hari 21', d: 'Cohort ditutup saat semua app siap ajukan production, atau paling lambat hari ke-21.' },
  { t: 'Good, Owing, Settled', d: 'Saat cohort tutup, anggota yang semua tugasnya selesai berstatus Good. Yang belum berstatus Owing dan tidak bisa ikut cohort berikutnya sampai admin menandainya Settled.' },
]

const SCHEDULE = [
  { d: 0, t: 'Mulai', x: 'Tugas dibagi, jendela opt-in 48 jam dibuka' },
  { d: 2, t: 'Batas opt-in', x: 'Label Belum tes mulai tampil' },
  { d: 7, t: 'Sudah buka app', x: 'Feedback di Play. Hari terakhir tester murni bisa gabung' },
  { d: 13, t: 'Masih opt-in', x: 'Centang terakhir sebelum 14 hari' },
  { d: 21, t: 'Tutup', x: 'Paling lambat. Status Good atau Owing' },
]

const CHECKS = [
  { m: 'Opt-in', when: 'Hari 0–2', what: 'Gabung sebagai tester di setiap app tugasmu' },
  { m: 'Sudah buka app', when: 'Mulai hari 5, paling lambat hari 7', what: 'Centang, lalu kirim feedback di Google Play' },
  { m: 'Sudah update', when: 'Dalam 3 hari setelah build baru', what: 'Update app-nya, coba lagi, lalu centang' },
  { m: 'Masih opt-in', when: 'Mulai hari 12, paling lambat hari 13', what: 'Centang sekali lagi' },
]

const TIERS = [
  { name: 'Bronze', n: 3, cls: 't-bronze' },
  { name: 'Silver', n: 7, cls: 't-silver' },
  { name: 'Gold', n: 14, cls: 't-gold' },
  { name: 'Platinum', n: 25, cls: 't-platinum' },
]

const RULES: { group: string; items: { t: string; d: string }[] }[] = [
  {
    group: 'Sebagai tester',
    items: [
      { t: 'Biarkan terpasang 14 hari', d: 'Google menghitung tester yang tetap opt-in 14 hari berturut-turut. Keluar di hari ke-10 berarti mulai lagi dari nol.' },
      { t: 'Tulis feedback dengan kata sendiri', d: 'Ulasan yang disalin dari banyak akun terlihat tidak asli bagi Google.' },
      { t: 'Coba lagi setiap build baru', d: 'Saat creator mencatat build, update dari Play Store, coba lagi, lalu centang Sudah update.' },
      { t: 'Berhenti dengan terus terang', d: 'Kalau harus berhenti, tekan Berhenti menguji. Lembarnya tetap jujur dan creator tahu slot mana yang perlu diisi.' },
    ],
  },
  {
    group: 'Sebagai creator',
    items: [
      { t: 'Pasang grup komunitas', d: `Masukkan ${COMMUNITY_GROUP} sebagai daftar tester di closed track. Tanpa itu, opt-in anggota tidak terhitung. Kalau track-mu sudah memakai daftar email, pilih Daftar email di form app (terbuka setelah kamu ngetes 3 app): tempel email tester yang meminta, lalu tandai Sudah ditambahkan.` },
      { t: 'Minta tester sesuai kebutuhan', d: 'Di form app, isi berapa tester yang kamu butuhkan dari TesBareng (1–12). Google tetap butuh 12; sisanya dari grup atau daftarmu sendiri, dilaporkan sendiri. Kursi penuh tidak menolak tester baru, mereka jadi cadangan.' },
      { t: 'Tulis panduan feedback sebagai pertanyaan', d: '“Coba level 3 di layar kecil: tombol lompat mudah ditekan?” Bukan teks ulasan siap salin. Maksimal 500 karakter.' },
      { t: 'Balas setiap feedback', d: 'Baca feedback di Play Console, tandai Terverifikasi, balas di sana, lalu tandai Sudah saya balas di TesBareng.' },
      { t: 'Catat setiap build', d: 'Catat setiap upload ke closed track di log build. Dua sampai tiga build selama tes adalah target komunitas, bukan aturan resmi Google.' },
      { t: 'Ikut ngetes app anggota lain', d: 'Angka ngetes dan feedback-mu tampil di setiap app-mu. Yang membantu, lebih mudah dibantu.' },
    ],
  },
]

const readHh = () => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hh'))
  return Number.isNaN(v) ? 72 : v
}

/** Inside the app shell there is no story header: the strip sticks under the mobile top bar, or at 0 on desktop. */
function useShellHh(on: boolean) {
  useEffect(() => {
    if (!on) return
    const root = document.documentElement
    const bar = document.querySelector<HTMLElement>('.topbar')
    const set = () => root.style.setProperty('--hh', `${bar?.offsetHeight ?? 0}px`)
    set()
    const ro = bar && 'ResizeObserver' in window ? new ResizeObserver(set) : null
    if (bar) ro?.observe(bar)
    window.addEventListener('resize', set)
    return () => { ro?.disconnect(); window.removeEventListener('resize', set); root.style.removeProperty('--hh') }
  }, [on])
}

/** Floating section strip: one scrollable row, shown once the 5x2 grid has scrolled away. Scroll-spy sets the current item. */
function TocStrip({ gridRef }: { gridRef: React.RefObject<HTMLElement | null> }) {
  const [shown, setShown] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  // Header height (--hh) changes when the header wraps or the viewport rotates; re-create the observers when it does.
  const [hh, setHh] = useState(readHh)
  useEffect(() => {
    let frame = 0
    const onResize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setHh(readHh())) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(frame) }
  }, [])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(
      ([e]) => setShown(!e.isIntersecting && e.boundingClientRect.bottom < hh + 1),
      { rootMargin: `-${hh}px 0px 0px 0px` },
    )
    io.observe(grid)
    return () => io.disconnect()
  }, [gridRef, hh])

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    const seen = new Set<string>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id)
        const cur = TOC.find((x) => seen.has(x.id))
        if (cur) setActive(cur.id)
      },
      { rootMargin: `-${hh + 48 + 8}px 0px -60% 0px` },
    )
    TOC.forEach((x) => { const el = document.getElementById(x.id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [hh])

  // Keep the current item visible inside the strip by moving the strip only, never the page.
  // Setting scrollLeft is instant, so it needs no reduced-motion branch.
  useEffect(() => {
    const list = listRef.current
    const el = active ? list?.querySelector<HTMLElement>(`[aria-current]`) : null
    if (!list || !el) return
    const l = el.offsetLeft, r = l + el.offsetWidth
    if (l < list.scrollLeft) list.scrollLeft = l - 8
    else if (r > list.scrollLeft + list.clientWidth) list.scrollLeft = r - list.clientWidth + 8
  }, [active, shown])

  return (
    <nav className="ab-strip" aria-label="Bagian halaman" hidden={!shown ? true : undefined}>
      <ol ref={listRef}>
        {TOC.map((x, i) => (
          <li key={x.id}>
            <a href={`#${x.id}`} aria-current={active === x.id ? 'location' : undefined}>
              <span className="ab-toc-n num">{String(i + 1).padStart(2, '0')}</span>{x.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** `embedded`: rendered inside the app shell for signed-in members, so the shell supplies the nav, skip link and <main>. */
export function About({ embedded = false }: { embedded?: boolean }) {
  usePageMeta(TITLE, DESCRIPTION)
  const signIn = useSignIn()
  const gridRef = useRef<HTMLElement>(null)
  useShellHh(embedded)
  const Main = embedded ? 'div' : 'main'

  return (
    <div className={`ab surface-story dark-ready${embedded ? ' ab--embedded' : ''}`}>
      {!embedded && <a className="ab-skip" href="#isi">Langsung ke isi</a>}

      {!embedded && <StoryHeader page="about" signIn={signIn} />}

      <Main id="isi">
        <TocStrip gridRef={gridRef} />
        <div className="ab-wrap ab-hero">
          <p className="ab-label"><b>Aturan main</b>TesBareng</p>
          <h1>Cara kerja, tanpa basa‑basi.</h1>
          <p className="ab-lede">
            Semua aturan komunitas di satu halaman: syarat dari Google, cara ngetes, cohort, titik cek, badge dan privasi.
            Melihat-lihat tidak perlu masuk; ikut ngetes perlu akun Google.
          </p>
          <nav className="ab-toc" aria-label="Di halaman ini" ref={gridRef}>
            <ol>
              {TOC.map((x, i) => (
                <li key={x.id}><a href={`#${x.id}`}><span className="ab-toc-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>{x.label}</a></li>
              ))}
            </ol>
          </nav>
        </div>

        <Section id="syarat" n={1} title="Syarat dari Google Play"
          lede="Akun developer pribadi baru wajib menjalankan closed test sebelum boleh mengajukan akses production. Kalau app‑mu sudah rilis ke production, syarat ini sudah lewat; kamu tetap bisa ikut sebagai tester.">
          <div className="ab-sheet">
            <div className="ab-meter">
              <div className="ab-meter-top"><span>Tester tetap opt-in</span><span className="num">minimal 12</span></div>
              <Segments n={12} label="12 tester" />
            </div>
            <div className="ab-meter">
              <div className="ab-meter-top"><span>Hari berturut-turut</span><span className="num">14 hari</span></div>
              <Segments n={14} label="14 hari" />
            </div>
            <p className="ab-sheet-sub">Google juga melihat keterlibatan, bukan hanya jumlah tester:</p>
            <ul className="ab-checks">
              <li><span className="ab-tick" aria-hidden="true">✓</span>Tester mengirim feedback lewat Google Play</li>
              <li><span className="ab-tick" aria-hidden="true">✓</span>Creator membalas feedback itu di Play Console</li>
              <li><span className="ab-tick" aria-hidden="true">✓</span><span>Creator merilis build baru selama tes <small>biasanya 2–3 kali; target komunitas, bukan angka resmi Google</small></span></li>
            </ul>
            <p className="ab-sheet-foot">Tester yang keluar lalu masuk lagi mulai menghitung 14 hari dari awal.</p>
          </div>
        </Section>

        <Section id="ngetes" n={2} title="Cara ngetes satu app" lede="Enam langkah. Langkah pertama cukup sekali untuk semua app yang memakai Google Group; app dengan daftar email memintanya per app. Yang masih harus kamu kerjakan selalu ada di Tugas saya.">
          <ol className="ab-steps">
            {STEPS.map((s, i) => (
              <li key={s.t}>
                <span className="ab-step-n num" aria-hidden="true">{i + 1}</span>
                <div>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                  {i === 0 && <CopyEmail />}
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="cohort" n={3} title="Cohort: tugas dibagi rata"
          lede="Cohort mengelompokkan creator supaya tidak ada yang cuma minta dites. Siapa ngetes app siapa ditentukan sistem, bukan dipilih sendiri. Cohort tidak wajib: tanpa cohort kamu tetap bisa mendaftarkan app dan ngetes app mana saja, hanya tanpa jaminan dites balik.">
          <div className="ab-split">
            <div className="ab-card-flat">
              <h3>Pembagian tugas</h3>
              <ul className="ab-rule-list">
                <li><b>Butuh + 2</b><span>Setiap app dapat tester sebanyak yang creator butuhkan dari TesBareng, ditambah 2 cadangan (paling banyak semua app lain di cohort).</span></li>
                <li><b>Memberi = menerima</b><span>Kamu ngetes sebanyak tester yang diterima app‑mu. Butuh 12, kamu ngetes 14 app; butuh 3, biasanya 5.</span></li>
                <li><b>Diacak</b><span>Urutan anggota diacak, lalu tugas dibagi sistem. Kalau semua app butuh 12, hasilnya lingkaran seperti pada gambar.</span></li>
              </ul>
            </div>
            <RingRule />
          </div>
          <dl className="ab-facts">
            {COHORT_FACTS.map((x) => (
              <div key={x.t}><dt>{x.t}</dt><dd>{x.d}</dd></div>
            ))}
          </dl>
          <ol className="ab-schedule" aria-label="Jadwal cohort">
            {SCHEDULE.map((x) => (
              <li key={x.d} className={x.d === 21 ? 'end' : undefined}>
                <p className="ab-day num"><small>Hari</small>{x.d}</p>
                <p className="ab-day-t">{x.t}</p>
                <p className="ab-day-x">{x.x}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="tester-murni" n={4} title="Tester murni" lede="Belum punya app, atau sedang di antara dua app? Ikut cohort tanpa membawa app. Tanpa cohort pun bisa: pilih app di daftar app dan gabung sebagai tester.">
          <ul className="ab-rule-list ab-rule-list--boxed">
            <li><b>Gabung sampai akhir hari 6</b><span>Selama cohort masih Forming, atau sudah berjalan sampai akhir hari ke-6 (tepat 7 × 24 jam setelah Hari 0). Batas ini menyisakan 14 hari sebelum cohort tutup di hari 21.</span></li>
            <li><b>14 app untukmu</b><span>Kamu ditugaskan 14 app (atau semua app kalau kurang dari itu), dimulai dari app yang paling kurang tester dibanding kebutuhannya.</span></li>
            <li><b>48 jam milikmu sendiri</b><span>Batas opt-in dihitung dari saat kamu ditugaskan, bukan dari Hari 0. Titik cek berikutnya ikut bergeser.</span></li>
          </ul>
        </Section>

        <Section id="titik-cek" n={5} title="Titik cek, bukan absen harian"
          lede="Absen harian di 14 app berarti 14 ketukan sehari. Cukup centang di titik-titik ini.">
          <div className="ab-table" role="region" aria-label="Tabel titik cek" tabIndex={0}>
            <table>
              <thead><tr><th scope="col">Titik cek</th><th scope="col">Kapan</th><th scope="col">Yang kamu lakukan</th></tr></thead>
              <tbody>
                {CHECKS.map((x) => (
                  <tr key={x.m}><th scope="row">{x.m}</th><td>{x.when}</td><td>{x.what}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ab-note">
            <span className="ab-chip c-pandan">✓✓ Terverifikasi</span>
            <p>Centang opt-in, buka app, update dan masih opt-in berdasarkan kejujuran. Bukti terkuat adalah feedback yang ditandai Terverifikasi, karena creator mengeceknya sendiri di Play Console.</p>
          </div>
        </Section>

        <Section id="badge" n={6} title="Badge" lede="Dihitung dari app yang kamu tes sampai 14 hari atau lebih. Untuk creator dan tester murni sama.">
          <ul className="ab-tiers">
            {TIERS.map((t) => (
              <li key={t.name}><span className={`ab-pill ${t.cls}`}>{t.name}</span><b className="num">{t.n}</b><small>app dites 14 hari</small></li>
            ))}
          </ul>
          <ul className="ab-bullets">
            <li>Yang dihitung: masih aktif dengan 14 hari atau lebih, atau keluar setelah 14 hari.</li>
            <li>Tidak dihitung: dikeluarkan creator, keluar sebelum 14 hari, atau app yang sudah dihapus.</li>
            <li>Satu cohort penuh sebagai tester murni berarti 14 app, langsung Gold.</li>
            <li>Badge dihitung sistem dari data, tidak bisa diubah siapa pun.</li>
          </ul>
        </Section>

        <Section id="pengingat" n={7} title="Pengingat" lede="Tidak ada yang perlu menagih di grup.">
          <ul className="ab-rule-list ab-rule-list--boxed">
            <li><b className="num">19.00 WIB</b><span>Satu email ringkasan sehari, hanya kalau ada tugas tertunda: app yang belum kamu ikuti, titik cek yang jatuh tempo, feedback yang belum dikirim, build baru.</span></li>
            <li><b>Bisa dimatikan</b><span>Atur di <Link to="/me">Tugas saya</Link>. Setiap email juga punya tautan ke pengaturan itu.</span></li>
            <li><b>Simpan pengirimnya</b><span>Tambahkan alamat pengirim email pengingat ke kontakmu supaya tidak masuk folder spam.</span></li>
          </ul>
        </Section>

        <Section id="whatsapp" n={8} title="Grup WhatsApp cohort" lede="Opsional. Yang dibutuhkan hanya Google Group, atau persetujuan berbagi email untuk app dengan daftar email.">
          <ul className="ab-bullets">
            <li>Link grup hanya tampil untuk anggota cohort itu, setelah masuk.</li>
            <li>Anggota grup bisa melihat nomor HP satu sama lain. Gabung hanya kalau kamu nyaman.</li>
            <li>Chat untuk koordinasi. Status tetap dilaporkan di TesBareng, bukan di chat.</li>
          </ul>
        </Section>

        <Section id="privasi" n={9} title="Privasi">
          <div className="ab-privacy">
            <span className="ab-masked">bu*****@gmail.com</span>
            <ul className="ab-bullets">
              <li>Email tampil disamarkan seperti ini di semua halaman, termasuk tabel tester.</li>
              <li>Profil publik tidak menampilkan email sama sekali.</li>
              <li>Alamat lengkap dipakai untuk mengirim pengingat. Creator hanya melihatnya kalau app-nya pakai daftar email dan kamu setuju dibagikan. Persetujuan ini berlaku untuk app itu saja dan bisa kamu tarik kapan saja (alamat yang sudah dimasukkan ke Play Console tidak ikut terhapus).</li>
            </ul>
          </div>
        </Section>

        <Section id="aturan" n={10} title="Aturan main">
          <div className="ab-rules">
            {RULES.map((g) => (
              <div key={g.group} className="ab-rule-group">
                <h3>{g.group}</h3>
                <ul>
                  {g.items.map((x) => (
                    <li key={x.t}><b>{x.t}</b><span>{x.d}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <section className="ab-cta" aria-labelledby="ab-cta-h">
          <div className="ab-wrap">
            <h2 id="ab-cta-h">Siap ikut ngetes?</h2>
            <p className="ab-lede">Mulai dari Google Group, lalu pilih app yang butuh tester atau tunggu cohort berikutnya.</p>
            <div className="ab-cta-row">
              <a className="ab-btn ab-btn--ink" href={COMMUNITY_GROUP_URL} target="_blank" rel="noopener noreferrer">
                Gabung komunitas<span className="sr-only"> (Google Group, tab baru)</span><span aria-hidden="true"> ↗</span>
              </a>
              <Link className="ab-btn" to="/apps">Lihat daftar app</Link>
            </div>
          </div>
        </section>
      </Main>

      {!embedded && <StoryFooter page="about" />}
    </div>
  )
}
