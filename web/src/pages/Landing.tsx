import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePageMeta } from '../lib/pageMeta'
import { Link } from 'react-router-dom'
import { StoryHeader, StoryFooter, WaIcon, useReducedMotion, useSignIn } from '../components/StoryChrome'
import { COMMUNITY_GROUP, COMMUNITY_GROUP_URL, WHATSAPP_URL } from '../lib/community'
import { supabase } from '../lib/supabase'
import './landing.css'

/* Story surface: the landing page at `/` (ADR-001 §2–§4, ADR-008 option A, ADR-010), rebuilt on the
   landing-page-ui-v2 mockup (docs/design). Owner decisions 3 Nov 2026: dark mode + JetBrains Mono, the mockup's
   sample content (labelled "Data contoh"), and all of the mockup's motion. Every effect is plain CSS or a small
   rAF/IntersectionObserver loop (no animation library), switches off live under prefers-reduced-motion, and the
   markup always carries the final state, so nothing depends on an effect having run. */

const TITLE = 'TesBareng: 12 tester, 14 hari, dikerjakan bareng'
const DESCRIPTION =
  'Komunitas creator Android Indonesia yang saling ngetes app: 12 tester opt-in selama 14 hari untuk closed test Google Play, dibagi rata lewat cohort.'

const nf = new Intl.NumberFormat('id-ID')

/* Header height, shared with the ring's sticky stage (CSS reads --hh, the scrub reads HH). */
let HH = 0

/** Sticky header: --hh, the `scrolled` rule, the page progress line and the back-to-top button. Direct DOM writes, no re-render per frame. */
function usePageChrome(header: React.RefObject<HTMLElement | null>, fill: React.RefObject<HTMLElement | null>, totop: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const bar = header.current
    if (!bar) return
    const root = document.documentElement
    const row = bar.firstElementChild as HTMLElement | null
    const setHH = () => {
      HH = (row?.offsetHeight ?? bar.offsetHeight) + (parseFloat(getComputedStyle(bar).borderBottomWidth) || 0)
      root.style.setProperty('--hh', `${HH}px`)
    }
    setHH()
    const ro = 'ResizeObserver' in window ? new ResizeObserver(setHH) : null
    if (row) ro?.observe(row)
    let raf = 0
    const frame = () => {
      raf = 0
      const y = window.scrollY, max = root.scrollHeight - window.innerHeight
      bar.classList.toggle('scrolled', y > 8)
      fill.current?.style.setProperty('--sp', max > 0 ? Math.min(1, y / max).toFixed(4) : '0')
      totop.current?.classList.toggle('show', y > window.innerHeight * 1.2)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(frame) }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    frame()
    return () => {
      ro?.disconnect()
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      root.style.removeProperty('--hh')
    }
  }, [header, fill, totop])
}

/** Which section sits in the middle of the viewport, for the nav's active state. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null)
  const key = ids.join(',')
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(
      (es) => { for (const e of es) if (e.isIntersecting) setActive(e.target.id || null) },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    for (const id of key.split(',')) { const el = document.getElementById(id); if (el) io.observe(el) }
    return () => io.disconnect()
  }, [key])
  return active
}

/* ---------------------------------------------------------------------------
   Reveal effects (.lp.fx): scan-line wipe on .rv blocks, h2 glitch, segment fill,
   count-up and masked-email scramble. Each effect starts from the final state already
   in the markup, so a missed observer or reduced motion leaves correct content.
   --------------------------------------------------------------------------- */
/** Running effects, so unmount (or reduced motion switching on) can stop them and write the final value. */
type Running = Map<HTMLElement, () => void>
function countUp(el: HTMLElement, running: Running) {
  const n = Number(el.dataset.count)
  if (!Number.isFinite(n) || n <= 0) return
  const final = nf.format(n)
  let t0 = 0, raf = 0
  el.textContent = nf.format(0)
  const stop = () => { cancelAnimationFrame(raf); el.textContent = final; running.delete(el) }
  const st = (ts: number) => {
    if (!t0) t0 = ts
    const p = Math.min(1, (ts - t0) / 700)
    el.textContent = nf.format(Math.round(n * (1 - Math.pow(1 - p, 3))))
    if (p < 1) raf = requestAnimationFrame(st)
    else stop()
  }
  running.set(el, stop)
  raf = requestAnimationFrame(st)
}
const GLYPHS = '█▓▒░<>/#*01'
function scramble(el: HTMLElement, running: Running) {
  const target = el.dataset.scramble ?? el.textContent ?? ''
  let i = 0
  const steps = 18
  const stop = () => { window.clearInterval(id); el.textContent = target; running.delete(el) }
  const id = window.setInterval(() => {
    i++
    let out = ''
    for (let k = 0; k < target.length; k++) out += k < (i / steps) * target.length ? target[k] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
    el.textContent = out
    if (i >= steps) stop()
  }, 45)
  running.set(el, stop)
}

function useReveal(root: React.RefObject<HTMLElement | null>, reduced: boolean) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const html = document.documentElement
    if (reduced || !('IntersectionObserver' in window)) {
      el.classList.remove('fx')
      html.classList.remove('fx')
      return
    }
    html.classList.add('fx')
    el.classList.add('fx')
    const FX = '.seg, [data-count], [data-scramble]'
    const timers: number[] = []
    const running: Running = new Map()
    const play = (n: Element) => {
      if (n.classList.contains('seg')) n.classList.add('go')
      else if (n instanceof HTMLElement && n.dataset.count) countUp(n, running)
      else if (n instanceof HTMLElement && n.dataset.scramble) scramble(n, running)
      else n.classList.add('in')
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const n = e.target
          io.unobserve(n)
          play(n)
          if (n.classList.contains('rv')) timers.push(window.setTimeout(() => n.querySelectorAll(FX).forEach(play), 420))
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    )
    el.querySelectorAll('main .rv, main h2').forEach((n) => io.observe(n))
    el.querySelectorAll(FX).forEach((n) => { if (!n.closest('.rv') && !n.closest('.hero')) io.observe(n) })
    return () => {
      io.disconnect()
      timers.forEach(clearTimeout)
      for (const stop of [...running.values()]) stop()
      el.classList.remove('fx')
      html.classList.remove('fx')
      el.querySelectorAll('.in, .go').forEach((n) => n.classList.remove('in', 'go'))
    }
  }, [root, reduced])
}

/* ---------------------------------------------------------------------------
   Cohort ring geometry: an example cohort of 15 apps (full mesh, PRD FR-32:
   13–16 apps means everyone tests every other app, k = 14) plus 3 pure testers
   assigned 14 apps each, fewest-testers first (FR-33). Every number shown next to
   the ring is computed from this, so it is true by construction.
   --------------------------------------------------------------------------- */
const C = 300
const N_APPS = 15
const N_PURE = 3
const K = 14
type Pt = { x: number; y: number }
type Tie = { o: number; t: number; d: string; pure: boolean }

const onCircle = (i: number, n: number, r: number): Pt => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) }
}
const CREATORS = Array.from({ length: N_APPS }, (_, i) => onCircle(i, N_APPS, 250))
const PURES = Array.from({ length: N_PURE }, (_, i) => onCircle(i, N_PURE, 74))
const NODES = [...CREATORS, ...PURES]
/** Sample initials (mockup v2). Creators first, then the pure testers. */
const INITIALS = ['AR', 'BN', 'CS', 'DW', 'EK', 'FP', 'GH', 'IS', 'JN', 'KM', 'LT', 'MY', 'NR', 'OP', 'RA', 'SW', 'TY', 'YH']
const f = (n: number) => n.toFixed(1)

function curve(a: Pt, b: Pt, bow: number) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  // Pull toward the centre, and bow sideways so A→B and B→A stay two visible lines.
  const cx = mx + (C - mx) * 0.3 + (-dy / len) * bow * len
  const cy = my + (C - my) * 0.3 + (dx / len) * bow * len
  return `M${f(a.x)} ${f(a.y)}Q${f(cx)} ${f(cy)} ${f(b.x)} ${f(b.y)}`
}

const RING = (() => {
  const ties: Tie[] = []
  const load = new Array<number>(N_APPS).fill(0)
  for (let o = 0; o < N_APPS; o++) {
    for (let d = 1; d < N_APPS; d++) {
      const t = (o + d) % N_APPS
      ties.push({ o, t, d: curve(CREATORS[o], CREATORS[t], 0.07), pure: false })
      load[t]++
    }
  }
  for (let p = 0; p < N_PURE; p++) {
    const order = Array.from({ length: N_APPS }, (_, i) => i).sort(
      (a, b) => load[a] - load[b] || ((a - p * 5 + N_APPS) % N_APPS) - ((b - p * 5 + N_APPS) % N_APPS),
    )
    for (const t of order.slice(0, Math.min(K, N_APPS))) {
      ties.push({ o: N_APPS + p, t, d: curve(PURES[p], CREATORS[t], 0.04), pure: true })
      load[t]++
    }
  }
  const byOwner = NODES.map((_, o) => ties.filter((x) => x.o === o).map((x) => x.t))
  return { ties, byOwner, total: ties.length, min: Math.min(...load), max: Math.max(...load) }
})()

const RING_DESC =
  `Contoh cohort berisi ${N_APPS} app. ${N_APPS} creator, masing-masing membawa satu app, berbaris di lingkar luar sebagai kotak, ` +
  `dan ${N_PURE} tester murni tanpa app ada di tengah sebagai lingkaran. Karena jumlah app antara 13 dan 16, setiap creator ngetes semua app lain, ` +
  `yaitu ${N_APPS - 1} app. Setiap tester murni ngetes ${K} app, dimulai dari app yang testernya paling sedikit. ` +
  `Totalnya ${RING.total} tugas, dan setiap app dites ${RING.min} sampai ${RING.max} orang.`

/** Scrub (pin + draw) only where the pinned ring still gets a usable size: tall enough for the stacked layout on narrow
 *  screens, or side by side on wide ones. Landscape phones and short windows get the completed static ring. */
const SCRUB_QUERY = '(min-height: 640px), (min-width: 981px) and (min-height: 480px)'
function useMedia(q: string) {
  const [m, setM] = useState(() => typeof matchMedia !== 'function' || matchMedia(q).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia(q)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

/** True when the device can afford the scroll-scrubbed ring (reduced motion is checked separately, live). */
function deviceCanScrub() {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  if (nav.connection?.saveData) return false
  if ((navigator.hardwareConcurrency ?? 4) <= 2) return false
  return true
}

const Ring = memo(function Ring({ reduced }: { reduced: boolean }) {
  const secRef = useRef<HTMLElement>(null)
  const figRef = useRef<HTMLElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const countersRef = useRef<HTMLDListElement>(null)
  const drawnRef = useRef<HTMLSpanElement>(null)
  const minRef = useRef<HTMLSpanElement>(null)
  const finalRef = useRef<HTMLParagraphElement>(null)
  const hintRef = useRef<HTMLParagraphElement>(null)
  // Client-only SPA, so the device check can run on first render (no static frame flash).
  const [deviceOk] = useState(deviceCanScrub)
  const roomy = useMedia(SCRUB_QUERY)
  const scrub = deviceOk && roomy && !reduced
  const legRef = useRef<HTMLElement>(null)

  // Strokes are specified in screen pixels: 1 user unit = 600 / rendered width.
  useEffect(() => {
    const fig = figRef.current, svg = svgRef.current, copy = copyRef.current, leg = legRef.current
    if (!fig || !svg || !('ResizeObserver' in window)) return
    // Also hands the copy block's height to CSS, so the pinned ring on narrow screens can take the rest of the viewport.
    const ro = new ResizeObserver(() => {
      const w = svg.getBoundingClientRect().width
      if (w > 0) fig.style.setProperty('--u', (600 / w).toFixed(3))
      if (copy) fig.style.setProperty('--copy-h', `${copy.offsetHeight}px`)
      if (leg) fig.style.setProperty('--leg-h', `${leg.offsetHeight}px`)
    })
    ro.observe(svg)
    if (copy) ro.observe(copy)
    if (leg) ro.observe(leg)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const sec = secRef.current, svg = svgRef.current
    if (!scrub || !sec || !svg) return
    const M = NODES.length
    const tieEls: SVGPathElement[][] = NODES.map(() => [])
    svg.querySelectorAll<SVGPathElement>('.tie').forEach((p) => tieEls[Number(p.dataset.o)].push(p))
    const nodeEls = Array.from(svg.querySelectorAll<SVGGElement>('.node'))
    const prev = new Array<number>(M).fill(-1)
    const drawnEl = drawnRef.current, minEl = minRef.current, finalEl = finalRef.current
    const countersEl = countersRef.current, hintEl = hintRef.current
    let cur = 0, target = 0, raf = 0, last = 0, lastDrawn = -1, lastMin = -1

    const render = (t: number) => {
      const load = new Array<number>(N_APPS).fill(0)
      let drawn = 0
      for (let o = 0; o < M; o++) {
        const w = Math.min(1, Math.max(0, t * M - o))
        const list = tieEls[o]
        drawn += Math.floor(w * list.length + 1e-6)
        if (w >= 1) for (const a of RING.byOwner[o]) load[a]++
        if (w === prev[o]) continue
        prev[o] = w
        const live = w > 0 && w < 1
        for (const p of list) {
          p.style.strokeDashoffset = (1 - w).toFixed(3)
          p.classList.toggle('drawing', live)
        }
        nodeEls[o].classList.toggle('act', live)
        nodeEls[o].classList.toggle('done', w >= 1)
      }
      const min = Math.min(...load)
      if (drawn !== lastDrawn && drawnEl) { drawnEl.textContent = nf.format(drawn); lastDrawn = drawn }
      if (min !== lastMin && minEl) { minEl.textContent = nf.format(min); lastMin = min }
      finalEl?.classList.toggle('show', t >= 0.999)
      countersEl?.style.setProperty('--rp', t.toFixed(3))
    }
    const measure = () => {
      const r = sec.getBoundingClientRect()
      const span = sec.offsetHeight - (window.innerHeight - HH)
      const p = span > 0 ? Math.min(1, Math.max(0, (HH - r.top) / span)) : 1
      hintEl?.classList.toggle('gone', p > 0.04)
      target = Math.min(1, Math.max(0, (p - 0.05) / 0.82))
    }
    // Scrub ≈ 0.5 s: ease the drawn state toward the scroll position (ADR-001 §3).
    const tick = (now: number) => {
      const dt = last ? Math.min(64, now - last) : 16
      last = now
      cur += (target - cur) * (1 - Math.exp(-dt / 140))
      if (Math.abs(target - cur) < 0.0008) cur = target
      render(cur)
      raf = cur === target ? 0 : requestAnimationFrame(tick)
      if (!raf) last = 0
    }
    const onScroll = () => { measure(); if (!raf) raf = requestAnimationFrame(tick) }

    sec.classList.add('is-scrub')
    measure()
    cur = target
    render(cur)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
      sec.classList.remove('is-scrub')
      // Back to the completed static frame (e.g. reduced motion switched on mid-scroll).
      for (const list of tieEls) for (const p of list) { p.style.strokeDashoffset = ''; p.classList.remove('drawing') }
      for (const n of nodeEls) { n.classList.remove('act'); n.classList.add('done') }
      if (drawnEl) drawnEl.textContent = nf.format(RING.total)
      if (minEl) minEl.textContent = nf.format(RING.min)
      finalEl?.classList.remove('show')
      countersEl?.style.removeProperty('--rp')
      hintEl?.classList.remove('gone')
    }
  }, [scrub])

  return (
    <section className="ring-scroll" ref={secRef} id="cohort" aria-labelledby="ring-h">
      <div className="lp-wrap ring-stage">
        <div className="ring-copy" ref={copyRef}>
          <p className="lp-hud"><b aria-hidden="true">01</b>Contoh cohort</p>
          <h2 id="ring-h">Tidak ada yang cuma minta dites.</h2>
          <p className="lp-lede ring-lede">
            Satu contoh cohort berisi {N_APPS} creator. Setiap creator ditugaskan ngetes {N_APPS - 1} app milik yang lain, dan {N_PURE} tester murni
            tanpa app ikut ngetes {K} app masing-masing, dimulai dari app yang testernya paling sedikit. Begitu cohort dimulai, tugasnya terbagi rata.
          </p>
          {/* The scrubbed numbers are visual only; screen readers get the final values, and the closing line is never hidden from them. */}
          <div className="ring-status">
            <dl className="counters" ref={countersRef}>
              <div><dt>Tugas terbagi</dt><dd><span aria-hidden="true"><span ref={drawnRef}>{nf.format(RING.total)}</span><span className="dim"> / {nf.format(RING.total)}</span></span><span className="sr-only">{nf.format(RING.total)} dari {nf.format(RING.total)}</span></dd></div>
              <div><dt>Tester paling sedikit di satu app</dt><dd><span aria-hidden="true"><span ref={minRef}>{nf.format(RING.min)}</span><span className="dim"> orang</span></span><span className="sr-only">{nf.format(RING.min)} orang</span></dd></div>
            </dl>
            <p className="ring-final theme-light" ref={finalRef}>Setiap app dites minimal {RING.min} orang. Setiap orang ikut ngetes.</p>
          </div>
        </div>
        <figure className="ring-fig" ref={figRef}>
          <svg ref={svgRef} viewBox="0 0 600 600" width="600" height="600" role="img" aria-labelledby="ring-t ring-d">
            <title id="ring-t">Cincin cohort</title>
            <desc id="ring-d">{RING_DESC}</desc>
            <g className="ties">
              {RING.ties.map((x, i) => (
                <path key={i} className={x.pure ? 'tie tie--p' : 'tie tie--c'} data-o={x.o} pathLength={1} d={x.d} />
              ))}
            </g>
            <g className="nodes">
              {NODES.map((p, i) => (
                <g key={i} className={`node done ${i < N_APPS ? 'node--c' : 'node--p'}`} transform={`translate(${f(p.x)} ${f(p.y)})`}>
                  <g className="nstamp">
                    {i < N_APPS ? (
                      <><rect className="nshadow" x={-14} y={-14} width={34} height={34} /><rect className="nbody" x={-17} y={-17} width={34} height={34} /></>
                    ) : (
                      <><circle className="nshadow" cx={3} cy={3} r={17} /><circle className="nbody" r={17} /></>
                    )}
                    <text y={4.5}>{INITIALS[i]}</text>
                    <g className="ncheck"><rect x={8} y={-27} width={18} height={18} /><path d="M12 -18.5l3.5 3.5 6.5-7" /></g>
                  </g>
                </g>
              ))}
            </g>
          </svg>
          <figcaption className="ring-legend" ref={legRef}>
            <span><i className="lg-sq" aria-hidden="true" />Creator, membawa app</span>
            <span><i className="lg-ci" aria-hidden="true" />Tester murni</span>
            <span><i className="lg-line" aria-hidden="true" />Tugas tester murni</span>
            <span><i className="lg-ok" aria-hidden="true">✓</i>Semua tugasnya terbagi</span>
          </figcaption>
        </figure>
        <p className="ring-hint" ref={hintRef} aria-hidden="true">Gulir <b>↓</b></p>
      </div>
    </section>
  )
})

/* ---------------------------------------------------------------------------
   Small pieces
   --------------------------------------------------------------------------- */
/** Segment meter. aria-hidden: the label next to it carries the same numbers in text. */
function Seg({ n, on, c }: { n: number; on: number; c: string }) {
  return (
    <div className="seg" style={{ ['--n' as string]: n, ['--c' as string]: `var(--${c})` }} aria-hidden="true">
      {Array.from({ length: n }, (_, k) => <i key={k} className={k < on ? 'on' : undefined} style={{ ['--k' as string]: k }} />)}
    </div>
  )
}

/** A horizontal scroller is a tab stop (keyboard scrolling) only while its content actually overflows. */
function useOverflowTab<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [over, setOver] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !('ResizeObserver' in window)) return
    const ro = new ResizeObserver(() => setOver(el.scrollWidth > el.clientWidth + 1))
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [])
  return [ref, over ? 0 : undefined] as const
}

/** Sample tester sheet for the hero (mockup v2). Same markup as the static hero in web/index.html: keep both in step. */
const SHEET_ROWS: { who: string; email: string; days: string; chip: string; status: string }[] = [
  { who: 'Budi S.', email: 'bu*****@gmail.com', days: '15', chip: 'c-pandan', status: '✓ Eligible' },
  { who: 'Sari A.', email: 'sa*****@gmail.com', days: '14', chip: 'c-pandan', status: '✓ Eligible' },
  { who: 'Dimas P.', email: 'di*****@studio.co.id', days: '9', chip: 'c-langit', status: '→ Aktif' },
  { who: 'Wulan L.', email: 'wu*****@gmail.com', days: '3', chip: 'c-langit', status: '→ Aktif' },
  { who: 'Rizky H.', email: 'ri*****@gmail.com', days: '—', chip: 'c-cabai', status: '! Belum tes' },
]
function HeroSheet() {
  const [scRef, scTab] = useOverflowTab<HTMLDivElement>()
  return (
    <div className="sheet hero-sheet" role="group" aria-labelledby="sheet-h">
      <div className="sheet-head"><strong id="sheet-h">Kopi Catat</strong><span className="lp-chip c-langit">Cohort #3</span></div>
      <div className="scroller" ref={scRef} role="region" aria-label="Contoh daftar tester Kopi Catat" tabIndex={scTab}>
        <table className="tsheet">
          <caption className="sr-only">Data contoh: daftar tester app Kopi Catat</caption>
          <thead><tr><th scope="col">Tester</th><th scope="col">Email</th><th scope="col">Hari</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {SHEET_ROWS.map((r) => (
              <tr key={r.who}><th scope="row">{r.who}</th><td>{r.email}</td><td className="n">{r.days}</td><td><span className={`lp-chip ${r.chip}`}>{r.status}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sheet-more">+7 tester lain, semuanya eligible</p>
      <div className="sheet-ft">
        <div className="lp-meter">
          <div className="meter-top"><span>Tester eligible</span><span>9 / 12</span></div>
          <Seg n={12} on={9} c="pandan" />
        </div>
        <div className="lp-meter">
          <div className="meter-top"><span>Dimas P., hari ke-9 dari 14</span><span>5 hari lagi</span></div>
          <Seg n={14} on={9} c="kunyit" />
        </div>
      </div>
      <p className="sample"><b>Data contoh.</b> Email selalu tampil disamarkan.</p>
    </div>
  )
}

function CopyEmail({ onCopied }: { onCopied: () => void }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const id = setTimeout(() => setState('idle'), state === 'fail' ? 6000 : 2000)
    return () => clearTimeout(id)
  }, [state])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMUNITY_GROUP)
      setState('ok')
      onCopied()
    } catch {
      setState('fail')
    }
  }
  return (
    <div className="copy-row">
      <button type="button" className={`copy ${state === 'ok' ? 'ok' : ''}`} onClick={copy}>
        {state === 'ok' ? 'Tersalin ✓' : 'Salin email grup'}
      </button>
      <span className="copy-status" role="status" aria-live="polite">
        {state === 'fail' ? 'Tidak bisa menyalin otomatis. Pilih teks email di atas, lalu salin.' : ''}
      </span>
    </div>
  )
}

type Stats = { apps: number; members: number; ready: number }

/** Live counts from the public views (ADR-004). Hidden when the request fails or everything is zero.
 *  Requested once the browser is idle after first paint, so it never competes with the hero. */
function useLiveStats() {
  const [stats, setStats] = useState<Stats | null>(null)
  useEffect(() => {
    let alive = true
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    const start = () => { if (alive) load() }
    const idle = w.requestIdleCallback ? w.requestIdleCallback(start, { timeout: 2000 }) : window.setTimeout(start, 1200)
    return () => {
      alive = false
      if (w.requestIdleCallback && w.cancelIdleCallback) w.cancelIdleCallback(idle)
      else clearTimeout(idle)
    }
    function load() {
      const head = { count: 'exact' as const, head: true }
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
      Promise.race([
        Promise.all([
          supabase.from('apps').select('id', head).eq('deleted', false),
          supabase.from('profiles').select('id', head),
          supabase.from('app_stats').select('app_id', head).gte('eligible_count', 12),
        ]),
        timeout,
      ])
        .then(([a, m, r]) => {
          if (!alive || a.error || m.error || r.error) return
          setStats({ apps: a.count ?? 0, members: m.count ?? 0, ready: r.count ?? 0 })
        })
        .catch(() => {})
    }
  }, [])
  return stats
}

/** Proof (ADR-010 §2.6, §4): real counts only. The whole section is left out when there is nothing real to show. */
function Proof() {
  const s = useLiveStats()
  if (!s) return null
  const items = [
    { n: s.apps, l: 'app terdaftar' },
    { n: s.members, l: 'anggota' },
    { n: s.ready, l: 'app siap ajukan production' },
  ].filter((x) => x.n > 0)
  if (!items.length) return null
  return (
    <section className="lp-sec" id="bukti" aria-labelledby="bukti-h">
      <div className="lp-wrap">
        <p className="lp-hud"><b>Data</b>Langsung dari TesBareng</p>
        <h2 id="bukti-h">Yang sudah tercatat.</h2>
        <dl className="live-row">
          {items.map((x) => (
            <div key={x.l}><dt>{x.l}</dt><dd>{nf.format(x.n)}</dd></div>
          ))}
        </dl>
        <p className="live-note">Dihitung langsung dari data TesBareng saat halaman ini dibuka.</p>
      </div>
    </section>
  )
}

/* Matrix demo. Sample cohort, consistent with the hero: "Kamu" is the creator of Kopi Catat,
   and its column matches the hero sheet (Budi and Sari verified, Dimas active, Rizky late). "Aktif" uses → everywhere, as on the work surface; ✓✓ is verified. */
type CellKind = 'ok2' | 'ok' | 'wait' | 'late' | 'own'
const CELL: Record<CellKind, { glyph: string; short: string; label: string; cls: string }> = {
  ok2: { glyph: '✓✓', short: 'Verified', label: 'Feedback sudah diverifikasi creator', cls: 'c-pandan' },
  ok: { glyph: '→', short: 'Aktif', label: 'Sudah opt-in dan aktif', cls: 'c-langit' },
  wait: { glyph: '—', short: 'Belum', label: 'Belum, masih dalam batas waktu', cls: 'none' },
  late: { glyph: '!', short: 'Belum tes', label: 'Lewat batas opt-in (Belum tes)', cls: 'c-cabai' },
  own: { glyph: '·', short: 'Sendiri', label: 'App sendiri, tidak ditugaskan', cls: 'own' },
}
const MATRIX_APPS = ['Kopi Catat', 'Resep Ibu', 'Angkot Kita', 'Hafalan', 'Jajan']
const MATRIX_ROWS: { who: string; me?: boolean; cells: CellKind[] }[] = [
  { who: 'Budi S.', cells: ['ok2', 'own', 'ok2', 'ok', 'ok'] },
  { who: 'Kamu', me: true, cells: ['own', 'ok', 'ok', 'ok2', 'wait'] },
  { who: 'Sari A.', cells: ['ok2', 'ok2', 'own', 'ok2', 'ok'] },
  { who: 'Rizky H.', cells: ['late', 'late', 'ok', 'own', 'late'] },
  { who: 'Dimas P.', cells: ['ok', 'ok', 'ok2', 'ok', 'own'] },
]
const FILTERS: CellKind[] = ['ok2', 'ok', 'wait', 'late']

function MatrixDemo() {
  const [filter, setFilter] = useState<CellKind | null>(null)
  const tblRef = useRef<HTMLTableElement>(null)
  const [scRef, scTab] = useOverflowTab<HTMLDivElement>()
  // Crosshair: highlight the hovered cell's row and column. Direct class toggles, no re-render per pointer move.
  const clearX = () => tblRef.current?.querySelectorAll('.x-col, .x-row, .x-hit').forEach((n) => n.classList.remove('x-col', 'x-row', 'x-hit'))
  const onOver = (e: React.PointerEvent<HTMLTableElement>) => {
    if (e.pointerType !== 'mouse') return
    const tbl = tblRef.current
    const cell = (e.target as Element).closest('td, th') as HTMLTableCellElement | null
    if (!tbl || !cell) return
    clearX()
    const idx = cell.cellIndex, tr = cell.parentElement as HTMLTableRowElement
    if (idx > 0) for (const r of Array.from(tbl.rows)) r.cells[idx]?.classList.add('x-col')
    if (tr.parentElement?.tagName === 'TBODY') tr.classList.add('x-row')
    if (cell.tagName === 'TD') cell.classList.add('x-hit')
  }
  return (
    <div className="matrix-wrap rv">
      <div className={`matrix ${filter ? 'filtering' : ''}`}>
        <div className="scroller" ref={scRef} role="region" aria-label="Contoh matriks kewajiban cohort" tabIndex={scTab}>
          <table ref={tblRef} onPointerOver={onOver} onPointerLeave={clearX}>
            <caption className="sr-only">Data contoh: baris adalah anggota, kolom adalah app yang ditugaskan</caption>
            <thead>
              <tr><th scope="col">Anggota</th>{MATRIX_APPS.map((a) => <th key={a} scope="col">{a}</th>)}</tr>
            </thead>
            <tbody>
              {MATRIX_ROWS.map((r) => (
                <tr key={r.who} className={r.me ? 'me' : undefined}>
                  <th scope="row">{r.who}</th>
                  {r.cells.map((c, i) => (
                    <td key={i}>
                      <span className={`cell ${CELL[c].cls} ${filter === c ? 'match' : ''}`}>
                        <span aria-hidden="true">{CELL[c].glyph}</span>
                        <span className="cell-t" aria-hidden="true">{CELL[c].short}</span>
                        <span className="sr-only">{CELL[c].label}</span>
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="matrix-note"><b>Data contoh.</b><span className="matrix-hint" aria-hidden="true"> Geser tabel ke samping untuk melihat semua app.</span> Nama anggota dan app di cohort sungguhan tampil di halaman cohort.</p>
      </div>
      <div className="lp-legend">
        <p className="lp-hud"><b>Filter</b>Ketuk status untuk menyorot</p>
        {FILTERS.map((k) => (
          <button key={k} type="button" className="lg-btn" aria-pressed={filter === k} onClick={() => setFilter(filter === k ? null : k)}>
            <span className={`cell ${CELL[k].cls}`} aria-hidden="true">{CELL[k].glyph}</span>
            <span>{CELL[k].label}</span>
          </button>
        ))}
        <p className="lg-row">
          <span className="cell own" aria-hidden="true">{CELL.own.glyph}</span>
          <span>{CELL.own.label}</span>
        </p>
        <div className="privacy">
          <strong>Emailmu tetap rahasia</strong>
          <span className="masked" aria-hidden="true" data-scramble="bu*****@gmail.com">bu*****@gmail.com</span>
          <span className="sr-only">Contoh: bu*****@gmail.com</span>
          <p>Di halaman mana pun, email tampil disamarkan seperti ini. Alamat lengkapmu dipakai untuk pengingat, dan hanya dibagikan ke creator kalau kamu setuju (app dengan daftar email).</p>
        </div>
      </div>
    </div>
  )
}

const DAYS = [
  { d: 0, title: 'Opt-in dan install', text: 'Daftar app tugasmu muncul di Tugas saya. Gabung Google Group, buka link opt-in tiap app, lalu install. Batasnya 48 jam.', chip: 'c-putih', chipText: '✓ Opt-in' },
  { d: 2, title: 'Batas opt-in', text: 'Lewat 48 jam, yang belum opt-in tercatat Behind, dan app miliknya sendiri mendapat label Belum tes yang terlihat semua anggota.', chip: 'c-cabai', chipText: '! Belum tes' },
  { d: 7, title: 'Pakai, lalu kirim feedback', text: 'Buka app-nya dan centang Sudah buka app. Tulis feedback di Google Play dengan kata-katamu sendiri; creator menandai Verified setelah membacanya.', chip: 'c-pandan', chipText: '✓✓ Verified' },
  { d: 13, title: 'Masih opt-in?', text: 'Centang sekali lagi. Besoknya, app yang tester eligible-nya sudah memenuhi target siap diajukan ke production.', chip: 'c-langit', chipText: '✓ Masih opt-in' },
]
const RAIL: Record<number, string> = { 0: 'c-kunyit', 2: 'c-cabai', 7: 'c-pandan', 13: 'c-langit' }

function Schedule() {
  const [hot, setHot] = useState<number | null>(null)
  return (
    <>
      <p className="sr-only">Jadwal cohort: hari 0 sampai 14. Cohort ditutup saat semua app siap diajukan, paling lambat hari ke-21.</p>
      <div className="rail rv" aria-hidden="true">
        <div className="rail-head"><span>Hari 0 → 14</span><span>Tutup <span className="long">paling lambat </span>hari 21</span></div>
        <div className="rail-cells">
          {Array.from({ length: 15 }, (_, d) => (
            <i key={d} className={`${d === 14 ? 'fin' : RAIL[d] ? `cp ${RAIL[d]}` : 'plain'}${hot === d ? ' hot' : ''}`}>{d}</i>
          ))}
          <i className="close">21</i>
        </div>
      </div>
      <ol className="days rv">
        {DAYS.map((x) => (
          <li className={`day${x.d === 0 ? ' now theme-light' : ''}`} key={x.d} onPointerEnter={() => setHot(x.d)} onPointerLeave={() => setHot(null)}>
            <p className="day-n"><small>Hari ke</small>{x.d}</p>
            <h3>{x.title}</h3>
            <p className="day-t">{x.text}</p>
            <span className={`lp-chip ${x.chip}`}>{x.chipText}</span>
          </li>
        ))}
      </ol>
      <p className="build-strip rv"><span className="lp-chip c-kunyit">Build baru</span><span>Setiap kali creator mencatat build baru: update app-nya, coba lagi, lalu centang Sudah update dalam 3 hari.</span></p>
    </>
  )
}

const TIERS = [
  { name: 'Bronze', n: 3, cls: 't-bronze', note: 'app dites 14 hari' },
  { name: 'Silver', n: 7, cls: 't-silver', note: 'app dites 14 hari' },
  { name: 'Gold', n: 14, cls: 't-gold', note: 'satu cohort penuh' },
  { name: 'Platinum', n: 25, cls: 't-platinum', note: 'app dites 14 hari' },
]

const FAQ = [
  { q: 'Harus punya app dulu untuk ikut?', a: 'Tidak. Kamu bisa ikut sebagai tester murni: gabung Google Group, masuk dengan Google, lalu pilih app di daftar app dan tekan Gabung sebagai tester. Mau tugas yang sudah dibagi? Gabung cohort sebagai tester, selama cohort masih Forming atau sampai akhir hari ke-6 setelah dimulai. Setiap app yang kamu tes sampai 14 hari dihitung untuk badge.' },
  { q: 'Wajib ikut cohort?', a: 'Tidak. Tanpa cohort kamu tetap bisa mendaftarkan app dan ngetes app mana saja, dan app yang kamu tes sampai 14 hari tetap dihitung untuk badge. Bedanya, tanpa cohort tidak ada jaminan app‑mu dites balik. Di cohort, tugas dibagi rata: kamu ngetes sebanyak tester yang diterima app‑mu.' },
  { q: 'App atau game saya sudah rilis di Play Store. Perlu ikut?', a: 'Kalau sudah rilis ke production, syarat 12 tester selama 14 hari sudah kamu lewati, jadi app itu tidak perlu didaftarkan. Kamu tetap boleh ikut sebagai tester untuk membantu creator lain. Kalau app-nya baru ada di closed testing, daftarkan dan ajukan ke cohort.' },
  { q: 'Sudah daftar jadi tester. Lalu apa?', a: 'Tetap opt-in dan biarkan app terpasang selama 14 hari. Buka app-nya sesekali, kirim feedback di Google Play dengan kata-katamu sendiri, lalu tekan Tandai sudah kirim di TesBareng. Kalau ada build baru, update app-nya. Semua yang masih harus kamu kerjakan ada di Tugas saya.' },
  { q: 'Apakah TesBareng layanan resmi Google?', a: 'Bukan. TesBareng dibuat oleh komunitas creator Android Indonesia untuk saling membantu memenuhi syarat closed test Google Play.' },
  { q: 'Apakah TesBareng tersambung ke Play Console?', a: 'Tidak. Google tidak menyediakan data opt-in untuk aplikasi lain, jadi semua dicatat sendiri oleh anggota. Feedback yang ditandai Verified adalah bukti terkuat, karena creator mengeceknya langsung di Play Console.' },
  { q: 'Kenapa feedback harus dikirim di Google Play?', a: 'Feedback di Play masuk langsung ke Play Console milik creator, lengkap dengan nama pengirimnya. TesBareng hanya mencatat bahwa kamu sudah mengirimnya, lalu creator menandainya Verified. Tulis dengan kata-katamu sendiri: ulasan yang disalin dari banyak akun terlihat tidak asli.' },
  { q: 'Bagaimana kalau ada anggota yang tidak ikut ngetes?', a: 'Lewat 48 jam, app miliknya mendapat label Belum tes, dan admin bisa memindahkan slotnya ke anggota lain. Saat cohort ditutup, kewajiban yang belum selesai tercatat Owing. Dia tidak bisa ikut cohort berikutnya sampai admin menandainya Settled.' },
  { q: 'Wajib gabung grup WhatsApp cohort?', a: 'Tidak. Grup WhatsApp cohort opsional, dan anggota grup bisa melihat nomor HP satu sama lain. Status tetap dilaporkan di TesBareng, bukan di chat. Yang dibutuhkan hanya Google Group, karena Play Console memakainya sebagai daftar tester, atau persetujuan berbagi email untuk app yang memakai daftar email.' },
  { q: 'Siapa yang bisa melihat emailku?', a: 'Di semua halaman, email tampil disamarkan, misalnya bu*****@gmail.com. Alamat lengkap dipakai sistem untuk mengirim pengingat. Satu-satunya pengecualian: kalau app memakai daftar email dan kamu menekan Minta ditambahkan, creator app itu saja yang melihat alamat lengkapmu. Persetujuan itu bisa kamu tarik kapan saja.' },
  { q: 'Closed track saya sudah memakai daftar email, bukan Google Group. Bisa ikut?', a: 'Di Play Console, satu track memakai Google Group atau daftar email, tidak bisa keduanya. Pilih Daftar email di form app; pilihan ini terbuka setelah kamu ngetes 3 app. Tester menekan Minta ditambahkan, kamu menempel email mereka di Play Console, lalu menandai Sudah ditambahkan. Setelah itu mereka bisa opt-in.' },
  { q: 'Sudah punya sebagian tester sendiri. Tetap harus minta 12?', a: 'Isi berapa tester yang kamu butuhkan dari TesBareng (1–12) di form app. Sisanya dari luar komunitas, dilaporkan sendiri. Di cohort, app-mu dapat jumlah itu ditambah 2 cadangan, dan kamu ngetes sebanyak itu juga: butuh 3, biasanya kamu ngetes 5 app.' },
]

/** FAQ: animate the details height open and closed (owner decision; off under reduced motion). */
function Faq({ reduced }: { reduced: boolean }) {
  const onSummary = (e: React.MouseEvent<HTMLElement>) => {
    const d = e.currentTarget.parentElement as HTMLDetailsElement | null
    if (!d || reduced || !('animate' in Element.prototype)) return
    e.preventDefault()
    if (d.dataset.busy) return
    d.dataset.busy = '1'
    const s = e.currentTarget
    const closing = d.open
    const bw = d.offsetHeight - d.clientHeight
    const from = d.offsetHeight
    let to: number
    d.style.overflow = 'hidden'
    if (closing) to = s.offsetHeight + bw
    else { d.open = true; to = d.offsetHeight }
    const a = d.animate({ height: [`${from}px`, `${to}px`] }, { duration: closing ? 200 : 280, easing: 'cubic-bezier(.2,.8,.2,1)' })
    const end = () => { if (closing) d.open = false; d.style.overflow = ''; delete d.dataset.busy }
    a.onfinish = end
    a.oncancel = end
  }
  return (
    <div className="faq rv">
      {FAQ.map((x, i) => (
        <details key={x.q}>
          <summary onClick={onSummary}><span className="q-n" aria-hidden="true">Q.{String(i + 1).padStart(2, '0')}</span><span className="q-t">{x.q}</span></summary>
          <p className="ans">{x.a}</p>
        </details>
      ))}
    </div>
  )
}

const OBSERVED = ['cohort', 'cara-kerja', 'transparansi', 'badge', 'bukti', 'gabung', 'faq']

/* ---------------------------------------------------------------------------
   Page
   --------------------------------------------------------------------------- */
export function Landing() {
  usePageMeta(TITLE, DESCRIPTION)
  const root = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const fillRef = useRef<HTMLElement>(null)
  const totopRef = useRef<HTMLButtonElement>(null)
  const brandRef = useRef<HTMLAnchorElement>(null)
  const reduced = useReducedMotion()
  useReveal(root, reduced)
  usePageChrome(headerRef, fillRef, totopRef)
  const active = useActiveSection(OBSERVED)
  const signIn = useSignIn()
  const { user, startSignIn } = signIn
  const [toast, setToast] = useState('')
  const [toastOn, setToastOn] = useState(false)

  // The static header and hero in index.html cover first paint; this copy is identical, so drop that one now (before paint).
  // If the static hero's CSS entrance is already running, continue from the same point instead of replaying it.
  useLayoutEffect(() => {
    const boot = document.getElementById('boot')
    const t0 = (window as unknown as { __tbT0?: number }).__tbT0
    if (boot && root.current && typeof t0 === 'number') root.current.style.setProperty('--hero-off', `${-Math.round(performance.now() - t0)}ms`)
    boot?.remove()
  }, [])

  // CSS smooth scroll for in-page links, only while the landing is mounted and only without reduced motion.
  useEffect(() => {
    const html = document.documentElement
    html.classList.toggle('lp-smooth', !reduced)
    return () => html.classList.remove('lp-smooth')
  }, [reduced])

  const say = useCallback((msg: string) => { setToast(msg); setToastOn(true) }, [])
  useEffect(() => {
    if (!toastOn) return
    const id = setTimeout(() => setToastOn(false), 2200)
    return () => clearTimeout(id)
  }, [toastOn, toast])
  useEffect(() => {
    if (toastOn || !toast) return
    const id = setTimeout(() => setToast(''), 240) // after the 180 ms fade-out
    return () => clearTimeout(id)
  }, [toastOn, toast])

  /** Scroll to a section and move focus to its heading, so keyboard users are not left on a link that just disappeared. */
  const goTo = useCallback((id: string, smooth: boolean) => {
    const sec = document.getElementById(id)
    if (!sec) return false
    const target = (sec.querySelector('h2') as HTMLElement | null) ?? sec
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    sec.scrollIntoView({ behavior: smooth && !reduced ? 'smooth' : 'auto', block: 'start' })
    target.focus({ preventScroll: true })
    return true
  }, [reduced])

  // Deep links such as /#faq: the page is built after load, so scroll there once after mount.
  const goToRef = useRef(goTo)
  goToRef.current = goTo
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id) return
    const raf = requestAnimationFrame(() => { goToRef.current(id, false) })
    return () => cancelAnimationFrame(raf)
  }, [])

  const toTop = () => {
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
    brandRef.current?.focus({ preventScroll: true })
  }

  const signInBtn = (cls: string, long: boolean) =>
    user ? (
      <Link className={cls} to="/me">Tugas saya</Link>
    ) : (
      <button type="button" className={cls} onClick={startSignIn}><span>Masuk{long ? ' dengan Google' : <span className="hide-xs"> dengan Google</span>}</span></button>
    )

  return (
    <div className="lp surface-story dark-ready" ref={root}>
      <a className="lp-skip" href="#isi">Langsung ke isi</a>

      {/* Header: shared with /about (components/StoryChrome). Keep it in step with the static copy in web/index.html (same classes and text). */}
      <StoryHeader page="home" signIn={signIn} active={active ?? undefined} headerRef={headerRef} fillRef={fillRef} brandRef={brandRef} onAnchor={(id) => goTo(id, true)} />

      <main id="isi">
        <section className="lp-wrap hero" aria-labelledby="hero-h">
          <div className="hero-copy">
            <p className="lp-hud"><b aria-hidden="true">00</b>Komunitas creator Android Indonesia</p>
            <h1 id="hero-h"><span>12 tester.</span><span>14 hari.</span><span>Bareng.<i className="caret" aria-hidden="true" /></span></h1>
            <p className="lp-lede">Syarat closed test Google Play untuk akun developer pribadi baru. Creator Android Indonesia saling ngetes lewat cohort: kamu tes app mereka, mereka tes app kamu. Belum punya app? Kamu tetap bisa ikut sebagai tester.</p>
            <div className="cta-row">
              <a className="lp-btn lp-btn--primary" href="#gabung">Gabung komunitas</a>
              <a className="lp-btn lp-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer"><WaIcon />Grup WhatsApp<span className="sr-only"> (tab baru)</span></a>
              <a className="lp-btn" href="#cara-kerja">Lihat cara kerjanya</a>
            </div>
          </div>
          <HeroSheet />
        </section>

        <Ring reduced={reduced} />

        <section className="lp-sec" id="cara-kerja" aria-labelledby="cara-h">
          <div className="lp-wrap">
            <div className="sec-head">
              <div><p className="lp-hud"><b aria-hidden="true">02</b>Cara kerja</p><h2 id="cara-h">Satu cohort, empat titik cek.</h2></div>
              <p className="lp-lede dim">Tidak ada absen harian. Cukup centang di empat titik ini. Kalau ada yang terlewat, satu email ringkasan datang jam 19.00 WIB.</p>
            </div>
            <Schedule />
          </div>
        </section>

        <section className="lp-sec" id="transparansi" aria-labelledby="lembar-h">
          <div className="lp-wrap">
            <div className="sec-head">
              <div><p className="lp-hud"><b aria-hidden="true">03</b>Transparansi</p><h2 id="lembar-h">Semua lihat lembar yang sama.</h2></div>
              <p className="lp-lede dim">Siapa sudah ngetes siapa terlihat di matriks cohort. Tidak perlu menagih satu per satu di grup.</p>
            </div>
            <MatrixDemo />
          </div>
        </section>

        <section className="lp-sec" id="badge" aria-labelledby="badge-h">
          <div className="lp-wrap">
            <div className="sec-head">
              <div><p className="lp-hud"><b aria-hidden="true">04</b>Badge</p><h2 id="badge-h">Belum punya app? Ikut sebagai tester murni.</h2></div>
              <p className="lp-lede dim">Gabung cohort sampai akhir hari ke-6. Setiap app yang kamu temani sampai 14 hari menambah badge di profilmu.</p>
            </div>
            <div className="badge-grid">
              <div className="badge-side">
                <ul className="tiers rv">
                  {TIERS.map((t) => (
                    <li className="tier" key={t.name}>
                      <span className={`pill ${t.cls}`}>{t.name}</span>
                      <b data-count={t.n}>{nf.format(t.n)}</b>
                      <small>{t.note}</small>
                    </li>
                  ))}
                </ul>
                <p className="tier-note">Badge dihitung dari data, tidak bisa diklaim. Keluar sebelum 14 hari, dikeluarkan creator, atau app yang dihapus tidak dihitung.</p>
              </div>
              <article className="profile rv" aria-labelledby="wl-h">
                <div className="who">
                  <span className="lp-avatar" aria-hidden="true">WL</span>
                  <div><strong id="wl-h">Wulan L.</strong><span className="dim">Tester murni sejak Cohort #2</span></div>
                  <span className="pill t-silver">Silver</span>
                </div>
                <div className="lp-meter">
                  <div className="meter-top"><span>Menuju Gold</span><span>9 / 14 app</span></div>
                  <Seg n={14} on={9} c="ubi" />
                </div>
                <dl className="stats">
                  <div><dt>Sedang ngetes</dt><dd data-count={12}>12</dd></div>
                  <div><dt>Tuntas 14 hari</dt><dd data-count={9}>9</dd></div>
                  <div><dt>Feedback verified</dt><dd data-count={8}>8</dd></div>
                </dl>
                <p className="sample-tag"><b>Data contoh.</b> Profil sungguhan tampil di halaman anggota.</p>
              </article>
            </div>
          </div>
        </section>

        <Proof />

        <section className="lp-sec join theme-light" id="gabung" aria-labelledby="gabung-h">
          <div className="lp-wrap">
            <p className="lp-hud"><b aria-hidden="true">05</b>Gabung</p>
            <h2 id="gabung-h">Mulai dari tiga langkah.</h2>
            <ol className="steps rv">
              <li>
                <span className="n" aria-hidden="true">1</span>
                <h3>Gabung Google Group</h3>
                <p>Masuk ke <code className="email">{COMMUNITY_GROUP}</code> dengan akun Google yang ada di HP-mu. Creator memasang grup ini sebagai daftar tester di Play Console, jadi cukup sekali untuk semua app. Untuk app yang memakai daftar email, tekan Minta ditambahkan di halaman app-nya.</p>
                <CopyEmail onCopied={() => say('Email grup tersalin')} />
              </li>
              <li>
                <span className="n" aria-hidden="true">2</span>
                <h3>Masuk dengan Google</h3>
                <p>Daftarkan app-mu, atau langsung pilih app yang ingin kamu bantu tes. Melihat-lihat tidak perlu daftar.</p>
              </li>
              <li>
                <span className="n" aria-hidden="true">3</span>
                <h3>Ikut cohort (opsional)</h3>
                <p>Di cohort, tugas dibagi rata sehingga app‑mu pasti dites balik. Ajukan app‑mu lalu tunggu persetujuan admin, atau ikut sebagai tester murni. Tanpa cohort pun kamu tetap bisa mendaftarkan app dan ngetes app mana saja. Link grup WhatsApp cohort dibagikan setelah kamu masuk.</p>
              </li>
            </ol>
            <div className="cta-row join-cta">
              <a className="lp-btn lp-btn--ink" href={COMMUNITY_GROUP_URL} target="_blank" rel="noopener noreferrer">Gabung Google Group<span className="sr-only"> (tab baru)</span></a>
              {signInBtn('lp-btn', true)}
              <a className="lp-btn lp-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer"><WaIcon />Grup WhatsApp komunitas<span className="sr-only"> (tab baru)</span></a>
            </div>
            <p className="wa-note">Grup WhatsApp komunitas adalah tempat diskusi utama. Opsional, dan nomor HP hanya terlihat sesama anggota grup.</p>
            <div className="duty rv">
              <h3>Yang kamu janjikan saat ikut cohort</h3>
              <ul>
                <li><b>Opt-in dalam 48 jam</b><span>Ke semua app yang ditugaskan padamu, dihitung dari Hari 0.</span></li>
                <li><b>Centang di titik cek</b><span>Sudah buka app di hari 7, Masih opt-in di hari 13, dan Sudah update dalam 3 hari setiap ada build baru.</span></li>
                <li><b>Kirim feedback di Google Play</b><span>Dengan kata-katamu sendiri, lalu tekan Tandai sudah kirim di TesBareng.</span></li>
                <li><b>Tetap opt-in 14 hari</b><span>Keluar lebih awal berarti hitungan app itu mulai lagi dari nol.</span></li>
              </ul>
            </div>
            <div className="join-notes">
              <p>Email selalu tampil disamarkan, misalnya bu*****@gmail.com. Nomor HP tidak pernah diminta di TesBareng.</p>
              <p>Cuma mau lihat-lihat dulu? <Link to="/apps">Lihat daftar app</Link></p>
            </div>
          </div>
        </section>

        <section className="lp-sec lp-sec--faq" id="faq" aria-labelledby="faq-h">
          <div className="lp-wrap">
            <p className="lp-hud"><b aria-hidden="true">06</b>FAQ</p>
            <h2 id="faq-h">Pertanyaan yang sering muncul.</h2>
            <Faq reduced={reduced} />
            <p className="faq-more">Aturan lengkapnya ada di <Link to="/about">halaman aturan main</Link>.</p>
          </div>
        </section>
      </main>

      <StoryFooter page="home" />

      <button type="button" className="totop" ref={totopRef} aria-label="Kembali ke atas" onClick={toTop}><span aria-hidden="true">↑</span></button>
      <div className="lp-toast-region theme-light" role="status" aria-live="polite">
        <p className={`lp-toast${toastOn ? ' show' : ''}`}>{toast}</p>
      </div>
    </div>
  )
}
