import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useAppsBy, errorText } from '../lib/data'
import { useMyTodos } from '../lib/todos'
import { COMMUNITY_GROUP, COMMUNITY_GROUP_URL } from '../lib/community'
import { Avatar, useToast } from './bits'
import { useReducedMotion, useTheme } from '../lib/theme'
import { IconAdmin, IconApps, IconBook, IconClose, IconCohort, IconMenu, IconSignOut, IconSun, IconMoon, IconTodo, IconUser, Mark } from './icons'

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const { user, isAdmin, ready, signIn, signOut } = useAuth()
  const toast = useToast()
  const mine = useAppsBy(user?.uid)
  // Same list as Tugas saya, so the badge and the page always agree.
  const owed = useMyTodos(user?.uid, isAdmin).total
  const menuBtn = useRef<HTMLButtonElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const { dark, toggle: toggleTheme } = useTheme(useReducedMotion())

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    // Drawer focus (WCAG 2.4.3): into the drawer on open, back to the menu button on close.
    if (open) closeBtn.current?.focus()
    else if (wasOpen.current) menuBtn.current?.focus()
    wasOpen.current = open
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const login = async () => {
    try { await signIn() } catch (e) { toast(errorText(e)) }
  }

  return (
    <div className="app dark-ready">
      <a className="btn skip-link" href="#main" inert={open}>Langsung ke isi</a>
      {/* While the drawer is open, everything behind it is inert, so focus cannot slip under it (WCAG 2.4.11). */}
      <header className="topbar" inert={open}>
        <Link to="/" className="brand"><Mark />TesBareng</Link>
        <span className="spacer" />
        <button ref={menuBtn} className="menu-toggle" aria-label="Buka menu" aria-expanded={open} aria-controls="nav" onClick={() => setOpen(true)}>
          <IconMenu />
        </button>
      </header>

      <aside id="nav" className={`sidebar ${open ? 'open' : ''}`} aria-label="Navigasi">
        <div className="sidebar-head">
          <Link to="/" className="brand"><Mark />TesBareng</Link>
          <span className="spacer" />
          <button ref={closeBtn} className="menu-toggle close" aria-label="Tutup menu" onClick={() => setOpen(false)}><IconClose /></button>
        </div>
        <p className="scope">Komunitas <a href={COMMUNITY_GROUP_URL} target="_blank" rel="noreferrer">{COMMUNITY_GROUP.replace('@googlegroups.com', '')}</a></p>

        <nav className="nav-list primary" aria-label="Menu utama">
          <NavLink to="/apps" end className="nav-item"><IconApps /><span className="label">Aplikasi</span></NavLink>
          <NavLink to="/cohorts" className="nav-item"><IconCohort /><span className="label">Cohort</span></NavLink>
          <NavLink to="/me" className="nav-item"><IconTodo /><span className="label">Tugas saya</span>{owed > 0 && <span className="count num">{owed > 99 ? '99+' : owed}<span className="sr-only"> tugas tertunda</span></span>}</NavLink>
          {user && <NavLink to={`/u/${user.uid}`} className="nav-item"><IconUser /><span className="label">Profil saya</span></NavLink>}
          <NavLink to="/about" className="nav-item"><IconBook /><span className="label">Aturan main</span></NavLink>
          {isAdmin && <NavLink to="/admin" className="nav-item"><IconAdmin /><span className="label">Admin</span></NavLink>}
        </nav>

        {mine.data.length > 0 && (
          <>
            <p className="group-label">Aplikasi saya</p>
            <nav className="nav-list" aria-label="Aplikasi saya">
              {mine.data.map((a) => (
                <NavLink key={a.id} to={`/apps/${a.id}`} className="nav-item">
                  <span className="label">{a.name}</span>
                </NavLink>
              ))}
            </nav>
          </>
        )}

        <div className="bottom">
          <button type="button" className="btn theme-toggle" onClick={toggleTheme} aria-pressed={dark}>
            {dark ? <IconMoon /> : <IconSun />}<span>{dark ? 'Mode gelap: nyala' : 'Mode gelap: mati'}</span>
          </button>
          {!ready ? null : user ? (
            <div className="user-row">
              <Link to={`/u/${user.uid}`} className="user-info">
                <Avatar name={user.displayName ?? '?'} photo={user.photoURL} />
                <span className="who"><b>{user.displayName ?? 'Anggota'}</b><span>Lihat profil</span></span>
              </Link>
              <button className="btn-icon" onClick={() => signOut()} aria-label="Keluar" title="Keluar">
                <IconSignOut />
              </button>
            </div>
          ) : (
            <button className="btn block" onClick={login}>Masuk dengan Google</button>
          )}
        </div>
      </aside>

      <main className="canvas" id="main" inert={open}>{children}</main>
    </div>
  )
}
