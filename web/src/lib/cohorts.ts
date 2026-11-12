// Cohort client code (PRD §5.6–5.8, §6.9, §6.12; ADR-007; docs/contract.md "cohorts" sections).
// Kept out of data.ts on purpose (plan-mvp-2-engineers.md: fewer merge conflicts).
// Pages refetch on mount and on window focus; no Realtime for cohorts (contract).

import { useFetch, errorCode, rows, rpc, type Row } from './data'
import { supabase } from './supabase'

export type CohortStatus = 'forming' | 'active' | 'closed'
export type Standing = 'good' | 'owing' | 'settled'

export interface CohortDoc {
  id: string
  name: string
  status: CohortStatus
  /** Day 0 (set by start_cohort); null while forming */
  day0At: number | null
  closedAt: number | null
  createdAt: number
  /** members who bring an app */
  appCount: number
  /** members without an app */
  pureTesterCount: number
}

export interface CohortMember {
  cohortId: string
  userId: string
  displayName: string
  photoURL: string | null
  /** null = pure tester */
  appId: string | null
  appName: string | null
  appDeleted: boolean
  joinedAt: number
  /** base time of this member's assignments (Day 0, or the join time of a late pure tester) */
  assignedAt: number | null
  ringPosition: number | null
  /** null until the cohort closes */
  standing: Standing | null
  settledAt: number | null
}

export interface CohortDetail extends CohortDoc {
  members: CohortMember[]
}

const DAY = 86_400_000
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : null)

// ---------- rules shared by the screens (mirror the contract; the server stays the judge) ----------

/** Minimum apps to start a cohort (FR-31). */
export const MIN_APPS = 13
/** Pure testers may join an active cohort until Day 0 + this many × 24 h, i.e. through the end of Day 6 (FR-33a). */
export const LAST_JOIN_DAY = 7
/** Hard close (FR-37, PRD §17 Q6). */
export const CLOSE_DAY = 21

/** Cohort day for display: floor((now − day0) / 24 h); null while forming (contract). */
export function cohortDay(c: Pick<CohortDoc, 'day0At' | 'closedAt'>, now = Date.now()): number | null {
  if (c.day0At == null) return null
  return Math.floor(((c.closedAt ?? now) - c.day0At) / DAY)
}

/** A late pure tester's own day, counted from their assignment time (FR-33b). */
export function ownDay(assignedAt: number | null, now = Date.now()): number | null {
  return assignedAt == null ? null : Math.floor((now - assignedAt) / DAY)
}

/**
 * When pure-tester joining closes: Day 0 + 7 × 24 h (join_cohort_as_tester), i.e. the end of Day 6.
 * Copy says "sampai akhir Hari 6" plus this exact time (owner decision 2026-11-03), never "sampai Hari 7".
 */
export function joinDeadline(day0At: number | null): number | null {
  return day0At == null ? null : day0At + LAST_JOIN_DAY * DAY
}

const longDate = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
const shortDate = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' })
const clock = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' })
/** "Selasa, 10 November 2026 pukul 14.05 WIB" (or "Sel, 10 Nov, 14.05 WIB" when short). */
export function fmtWib(t: number, short = false): string {
  const time = clock.format(t).replace(':', '.')
  return short ? `${shortDate.format(t)}, ${time} WIB` : `${longDate.format(t)} pukul ${time} WIB`
}

/** Can a member still join as a pure tester? Forming, or Active until joinDeadline (join_cohort_as_tester). */
export function joinOpen(c: Pick<CohortDoc, 'status' | 'day0At'>, now = Date.now()): boolean {
  if (c.status === 'forming') return true
  const end = joinDeadline(c.day0At)
  return c.status === 'active' && end != null && now <= end
}

export interface ScheduleStep {
  day: number
  /** due time (base + day × 24 h); null while forming */
  at: number | null
  title: string
  detail: string
}

/** The cohort schedule (contract milestone table, FR-45, FR-37). `base` = Day 0, or a late pure tester's assignedAt. */
export function schedule(base: number | null): ScheduleStep[] {
  const at = (d: number) => (base == null ? null : base + d * DAY)
  return [
    { day: 0, at: at(0), title: 'Mulai', detail: 'Tugas dibagikan. Gabung sebagai tester di setiap aplikasi yang ditugaskan.' },
    { day: 2, at: at(2), title: 'Batas opt-in', detail: 'Semua aplikasi yang ditugaskan sudah opt-in. Setelah ini label “Belum tes” muncul.' },
    { day: 5, at: at(5), title: 'Check-in “Sudah buka app” dibuka', detail: 'Pakai aplikasinya, lalu kirim feedback di Play.' },
    { day: 7, at: at(7), title: 'Batas buka app dan feedback', detail: 'Check-in “Sudah buka app” dan feedback terkirim. Pendaftaran tester murni sudah ditutup.' },
    { day: 12, at: at(12), title: 'Check-in “Masih opt-in” dibuka', detail: 'Pastikan masih terdaftar sebagai tester.' },
    { day: 13, at: at(13), title: 'Batas “Masih opt-in”', detail: 'Check-in terakhir.' },
    { day: CLOSE_DAY, at: at(CLOSE_DAY), title: 'Cohort ditutup', detail: 'Paling lambat hari ini. Anggota dengan kewajiban belum selesai ditandai Berutang.' },
  ]
}

/** FR-52: the message the admin pins in the cohort's WhatsApp group. */
export function pinnedMessage(c: Pick<CohortDoc, 'id' | 'name' | 'day0At'>, origin = location.origin): string {
  const fmt = (t: number) => new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' }).format(t)
  const day = (d: number) => (c.day0At == null ? `Hari ${d}` : `Hari ${d} (${fmt(c.day0At + d * DAY)})`)
  return [
    `📌 ${c.name}`,
    '',
    'Jadwal:',
    `• ${day(0)}: mulai, tugas dibagikan`,
    `• ${day(2)}: batas opt-in semua aplikasi yang ditugaskan`,
    `• ${day(7)}: batas buka app + kirim feedback di Play`,
    `• ${day(13)}: check-in “Masih opt-in”`,
    '',
    `Halaman cohort dan tugasmu: ${origin}/cohorts/${c.id}`,
    '',
    'Aturan grup:',
    '• Chat untuk koordinasi saja.',
    '• Status dilaporkan di TesBareng, bukan di chat.',
    '• Wajib tetap gabung Google Group untuk opt-in; grup WhatsApp ini opsional.',
  ].join('\n')
}

// ---------- mapping ----------

function toCohort(r: Row): CohortDoc {
  const members = (r.cohort_members ?? []) as Row[]
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    day0At: ms(r.day0_at),
    closedAt: ms(r.closed_at),
    createdAt: ms(r.created_at)!,
    appCount: members.filter((m) => m.app_id != null).length,
    pureTesterCount: members.filter((m) => m.app_id == null).length,
  }
}

function toMember(r: Row): CohortMember {
  return {
    cohortId: r.cohort_id,
    userId: r.user_id,
    displayName: r.profile?.display_name ?? '',
    photoURL: r.profile?.photo_url ?? null,
    appId: r.app_id,
    appName: r.app?.name ?? null,
    appDeleted: !!r.app?.deleted,
    joinedAt: ms(r.joined_at)!,
    assignedAt: ms(r.assigned_at),
    ringPosition: r.ring_position,
    standing: r.standing,
    settledAt: ms(r.settled_at),
  }
}

const MEMBER_COLUMNS = '*, profile:profiles(display_name, photo_url), app:apps(name, deleted)'

// ---------- reads ----------

/** All cohorts, newest first. The page groups them by status. */
export const useCohorts = () =>
  useFetch(
    async () => (await rows<Row[]>(supabase.from('cohorts').select('*, cohort_members(app_id)').order('created_at', { ascending: false }))).map(toCohort),
    [] as CohortDoc[], [],
  )

/** One cohort with its members (creators first by app name, then pure testers by name). undefined while loading, null if missing. */
export const useCohort = (id?: string) =>
  useFetch<CohortDetail | null | undefined>(
    id
      ? async () => {
          const [c, m] = await Promise.all([
            rows<Row | null>(supabase.from('cohorts').select('*, cohort_members(app_id)').eq('id', id).maybeSingle()),
            rows<Row[]>(supabase.from('cohort_members').select(MEMBER_COLUMNS).eq('cohort_id', id)),
          ])
          if (!c) return null
          const members = m.map(toMember).sort((a, b) =>
            (a.appId == null ? 1 : 0) - (b.appId == null ? 1 : 0)
            || (a.appName ?? a.displayName).localeCompare(b.appName ?? b.displayName, 'id'))
          return { ...toCohort(c), members }
        }
      : null,
    undefined, [id],
  )

/**
 * The cohort's WhatsApp link for a member of it or the admin (get_cohort_link, FR-50).
 * Anyone else gets null, never an error: the button simply does not show.
 */
export const useCohortLink = (cohortId: string | undefined, enabled: boolean) =>
  useFetch<string | null>(
    cohortId && enabled
      ? async () => {
          try { return await rpc<string | null>('get_cohort_link', { p_cohort_id: cohortId }) }
          catch (e) { if (errorCode(e) === 'permission-denied') return null; throw e }
        }
      : null,
    null, [cohortId, enabled],
  )

/** Cohorts where this member is Owing (FR-37): they cannot join or be added until settled. */
export const useOwingCohorts = (uid?: string | null) =>
  useFetch(
    uid
      ? async () => (await rows<Row[]>(supabase.from('cohort_members').select('cohort_id, cohort:cohorts(name)').eq('user_id', uid).eq('standing', 'owing')))
          .map((r) => ({ cohortId: r.cohort_id as string, name: (r.cohort?.name ?? '') as string }))
      : null,
    [] as { cohortId: string; name: string }[], [uid],
  )

export interface Candidate {
  userId: string
  displayName: string
  photoURL: string | null
  maskedEmail: string
  /** live apps this member owns, with the open cohort each one is already in (an app is in at most one) */
  apps: { id: string; name: string; inCohort: string | null }[]
  /** Owing in some cohort: add_cohort_member refuses */
  owing: boolean
}

/**
 * Admin: members matching a name or masked email, with their apps, for "Tambah anggota" (add_cohort_member).
 * Max 20 rows. The server re-checks every rule.
 */
export const useMemberCandidates = (query: string, enabled: boolean) => {
  // Strip PostgREST filter syntax; keep "." so a domain such as "gmail.com" still matches the masked email.
  const term = query.replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 50)
  return useFetch(
    enabled && term
      ? async () => {
          const profiles = await rows<Row[]>(supabase.from('profiles').select('id, display_name, photo_url, masked_email')
            .or(`display_name.ilike.*${term}*,masked_email.ilike.*${term}*`).order('display_name').limit(20))
          const ids = profiles.map((p) => p.id as string)
          if (ids.length === 0) return [] as Candidate[]
          const [apps, memberships] = await Promise.all([
            rows<Row[]>(supabase.from('apps').select('id, name, creator_id').in('creator_id', ids).eq('deleted', false).order('name')),
            rows<Row[]>(supabase.from('cohort_members').select('user_id, app_id, standing, cohort:cohorts(name, status)').in('user_id', ids)),
          ])
          const openCohortOf = new Map<string, string>()
          const owing = new Set<string>()
          for (const m of memberships) {
            if (m.app_id && m.cohort?.status !== 'closed') openCohortOf.set(m.app_id, m.cohort?.name ?? '')
            if (m.standing === 'owing') owing.add(m.user_id)
          }
          return profiles.map((p): Candidate => ({
            userId: p.id,
            displayName: p.display_name,
            photoURL: p.photo_url,
            maskedEmail: p.masked_email,
            apps: apps.filter((a) => a.creator_id === p.id).map((a) => ({ id: a.id, name: a.name, inCohort: openCohortOf.get(a.id) ?? null })),
            owing: owing.has(p.id),
          }))
        }
      : null,
    [] as Candidate[], [term, enabled],
  )
}

// ---------- writes (RPC only; errors carry the contract code in `hint`, show errorText()) ----------

export const createCohort = (name: string) => rpc<string>('create_cohort', { p_name: name.trim() })
export const addCohortMember = (cohortId: string, userId: string, appId: string | null) =>
  rpc('add_cohort_member', { p_cohort_id: cohortId, p_user_id: userId, p_app_id: appId })
export const removeCohortMember = (cohortId: string, userId: string) =>
  rpc('remove_cohort_member', { p_cohort_id: cohortId, p_user_id: userId })
export const startCohort = (cohortId: string) => rpc('start_cohort', { p_cohort_id: cohortId })
export const settleMember = (cohortId: string, userId: string) => rpc('settle_member', { p_cohort_id: cohortId, p_user_id: userId })
/** Empty string removes the link. */
export const setCohortLink = (cohortId: string, url: string) => rpc('set_cohort_link', { p_cohort_id: cohortId, p_url: url.trim() || null })
export const joinCohortAsTester = (cohortId: string) => rpc('join_cohort_as_tester', { p_cohort_id: cohortId })
export const leaveCohort = (cohortId: string) => rpc('leave_cohort', { p_cohort_id: cohortId })

// ---------- B5/B7/B8: obligation matrix, close/reassign, Belum tes, /me obligations, profile history ----------

export type CellState = 'not_joined' | 'left' | 'opted_in' | 'used' | 'feedback_sent' | 'feedback_verified' | 'reassigned'

export interface AssignmentStatus {
  appId: string
  testerId: string
  cell: CellState
  isBehind: boolean
}

export interface CohortObligation {
  cohortId: string
  userId: string
  owesOptIn: boolean
  allFulfilled: boolean
  isBehind: boolean
  behindCount: number
  remainingCount: number
}

function toAssignmentStatus(r: Row): AssignmentStatus {
  return { appId: r.app_id, testerId: r.tester_user_id, cell: r.cell, isBehind: !!r.is_behind }
}

function toObligation(r: Row): CohortObligation {
  return {
    cohortId: r.cohort_id, userId: r.user_id,
    owesOptIn: !!r.owes_opt_in, allFulfilled: !!r.all_fulfilled, isBehind: !!r.is_behind,
    behindCount: r.behind_count ?? 0, remainingCount: r.remaining_count ?? 0,
  }
}

/** Per-slot state for one cohort (cohort_assignment_status view, A5). Empty until the view exists. */
export const useAssignmentStatus = (cohortId: string | undefined) =>
  useFetch<AssignmentStatus[]>(
    cohortId ? async () => (await rows<Row[]>(supabase.from('cohort_assignment_status').select('*').eq('cohort_id', cohortId))).map(toAssignmentStatus) : null,
    [] as AssignmentStatus[], [cohortId],
  )

/** Member obligations for one cohort (cohort_obligations view, A5). Empty until the view exists. */
export const useObligations = (cohortId: string | undefined) =>
  useFetch<CohortObligation[]>(
    cohortId ? async () => (await rows<Row[]>(supabase.from('cohort_obligations').select('*').eq('cohort_id', cohortId))).map(toObligation) : null,
    [] as CohortObligation[], [cohortId],
  )

/** Signed-in user's obligations across non-closed cohorts. Swallows errors (A5 view may not exist). */
export const useMyObligations = (uid: string | undefined) =>
  useFetch<(CohortObligation & { cohortName: string; cohortStatus: CohortStatus })[]>(
    uid
      ? async () => {
          try {
            const r = await rows<Row[]>(supabase.from('cohort_obligations').select('*, cohort:cohorts(name, status)').eq('user_id', uid))
            return r
              .filter((x) => x.cohort && x.cohort.status !== 'closed')
              .map((x) => ({ ...toObligation(x), cohortName: x.cohort.name as string, cohortStatus: x.cohort.status as CohortStatus }))
          } catch { return [] }
        }
      : null,
    [] as (CohortObligation & { cohortName: string; cohortStatus: CohortStatus })[], [uid],
  )

/**
 * App IDs whose creator owes opt-in in an active cohort (for "Belum tes" chip on /apps).
 * Swallows all errors; returns an empty Set until A5 lands.
 */
export const useBelumTesApps = () =>
  useFetch<Set<string>>(
    async () => {
      try {
        const owing = await rows<Row[]>(supabase.from('cohort_obligations').select('cohort_id, user_id').eq('owes_opt_in', true))
        if (owing.length === 0) return new Set<string>()
        const cohortIds = [...new Set(owing.map((o) => o.cohort_id as string))]
        const mems = await rows<Row[]>(
          supabase.from('cohort_members').select('cohort_id, user_id, app_id, cohort:cohorts(status)').in('cohort_id', cohortIds).not('app_id', 'is', null),
        )
        const owingKey = new Set(owing.map((o) => `${o.cohort_id as string}:${o.user_id as string}`))
        return new Set(
          mems
            .filter((m) => m.app_id && m.cohort?.status === 'active' && owingKey.has(`${m.cohort_id as string}:${m.user_id as string}`))
            .map((m) => m.app_id as string),
        )
      } catch { return new Set<string>() }
    },
    new Set<string>(), [],
  )

/** Cohort memberships of a member (for the cohort history section on /u/:uid), newest first. */
export const useCohortMembershipsOf = (uid: string | undefined) =>
  useFetch<{ cohortId: string; cohortName: string; cohortStatus: CohortStatus; appId: string | null; standing: Standing | null; joinedAt: number }[]>(
    uid
      ? async () => {
          const r = await rows<Row[]>(
            supabase.from('cohort_members').select('cohort_id, app_id, standing, joined_at, cohort:cohorts(name, status)').eq('user_id', uid).order('joined_at', { ascending: false }),
          )
          return r
            .filter((m) => m.cohort)
            .map((m) => ({
              cohortId: m.cohort_id as string, cohortName: m.cohort.name as string,
              cohortStatus: m.cohort.status as CohortStatus, appId: m.app_id as string | null,
              standing: m.standing as Standing | null, joinedAt: ms(m.joined_at)!,
            }))
        }
      : null,
    [] as { cohortId: string; cohortName: string; cohortStatus: CohortStatus; appId: string | null; standing: Standing | null; joinedAt: number }[], [uid],
  )

export const resetCohort = (cohortId: string) => rpc('reset_cohort', { p_cohort_id: cohortId })
export const closeCohort = (cohortId: string) => rpc('close_cohort', { p_cohort_id: cohortId })
export const reassignSlot = (cohortId: string, appId: string, oldTesterId: string, newTesterId: string) =>
  rpc('reassign_slot', { p_cohort_id: cohortId, p_app_id: appId, p_old_tester_id: oldTesterId, p_new_tester_id: newTesterId })

// ---------- app list / app detail (B6: cohort filter, "Ditugaskan" label; PRD FR-25, §5.2) ----------

export interface AppCohort { cohortId: string; name: string; status: CohortStatus; createdAt: number }

/**
 * Every cohort each app has been in, newest first (an app is in at most one non-closed cohort, but may have
 * closed ones behind it). Drives the cohort filter on /apps.
 */
export const useAppCohorts = () =>
  useFetch(
    async () => {
      const r = await rows<Row[]>(supabase.from('cohort_members').select('app_id, cohort:cohorts(id, name, status, created_at)').not('app_id', 'is', null))
      const byApp = new Map<string, AppCohort[]>()
      for (const m of r) {
        if (!m.cohort) continue
        const list = byApp.get(m.app_id) ?? []
        list.push({ cohortId: m.cohort.id, name: m.cohort.name, status: m.cohort.status, createdAt: ms(m.cohort.created_at)! })
        byApp.set(m.app_id, list)
      }
      for (const list of byApp.values()) list.sort((a, b) => b.createdAt - a.createdAt)
      return byApp
    },
    new Map<string, AppCohort[]>(), [],
  )

/**
 * Apps assigned to this member through a cohort that is not closed (open assignments only; reassigned slots
 * moved away). Map appId → cohort name, for the "Ditugaskan" label.
 */
export const useMyAssignedApps = (uid?: string | null) =>
  useFetch(
    uid
      ? async () => {
          const r = await rows<Row[]>(supabase.from('assignments').select('app_id, cohort:cohorts(id, name, status)')
            .eq('tester_user_id', uid).eq('state', 'open'))
          return new Map(r.filter((a) => a.cohort && a.cohort.status !== 'closed')
            .map((a) => [a.app_id as string, { cohortId: a.cohort.id as string, name: a.cohort.name as string }]))
        }
      : null,
    new Map<string, { cohortId: string; name: string }>(), [uid],
  )

// ---------- ADR-013: cohort app requests (creator asks, admin approves) ----------

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'expired'

export interface CohortRequest {
  id: string
  cohortId: string
  cohortName: string
  userId: string
  displayName: string
  photoURL: string | null
  maskedEmail: string
  appId: string
  appName: string
  status: RequestStatus
  /** admin's reason, rejected only (max 280) */
  reason: string | null
  createdAt: number
  decidedAt: number | null
}

export const REQUEST_REASON_MAX = 280

function toRequest(r: Row): CohortRequest {
  return {
    id: r.id, cohortId: r.cohort_id, cohortName: r.cohort?.name ?? '',
    userId: r.user_id, displayName: r.profile?.display_name ?? '', photoURL: r.profile?.photo_url ?? null,
    maskedEmail: r.profile?.masked_email ?? '',
    appId: r.app_id, appName: r.app?.name ?? '',
    status: r.status, reason: r.reason ?? null,
    createdAt: ms(r.created_at)!, decidedAt: ms(r.decided_at),
  }
}

// Two FKs point at profiles (user_id, decided_by): name the one to embed.
const REQUEST_COLUMNS = '*, cohort:cohorts(name), profile:profiles!cohort_requests_user_id_fkey(display_name, photo_url, masked_email), app:apps(name)'

/**
 * The signed-in member's request state for the cohort page: their pending request (any cohort; one at a time,
 * ADR-013 §2) and their latest decided request for this cohort (to show a rejection and its reason).
 */
export const useMyCohortRequest = (cohortId: string | undefined, uid: string | null | undefined) =>
  useFetch<{ pending: CohortRequest | null; latestHere: CohortRequest | null }>(
    cohortId && uid
      ? async () => {
          const r = (await rows<Row[]>(supabase.from('cohort_requests').select(REQUEST_COLUMNS).eq('user_id', uid)
            .order('created_at', { ascending: false }).limit(20))).map(toRequest)
          return {
            pending: r.find((x) => x.status === 'pending') ?? null,
            latestHere: r.find((x) => x.cohortId === cohortId) ?? null,
          }
        }
      : null,
    { pending: null, latestHere: null }, [cohortId, uid],
  )

/**
 * The member's live apps, each with the open cohort it is already in (request_cohort_slot refuses those).
 * For the "Ajukan app" picker. The server re-checks every rule.
 */
export const useMyRequestableApps = (uid: string | null | undefined) =>
  useFetch(
    uid
      ? async () => {
          const [apps, memberships] = await Promise.all([
            rows<Row[]>(supabase.from('apps').select('id, name').eq('creator_id', uid).eq('deleted', false).order('name')),
            rows<Row[]>(supabase.from('cohort_members').select('app_id, cohort:cohorts(name, status)').eq('user_id', uid).not('app_id', 'is', null)),
          ])
          const openCohortOf = new Map<string, string>()
          for (const m of memberships) if (m.cohort?.status !== 'closed') openCohortOf.set(m.app_id, m.cohort?.name ?? '')
          return apps.map((a) => ({ id: a.id as string, name: a.name as string, inCohort: openCohortOf.get(a.id) ?? null }))
        }
      : null,
    [] as { id: string; name: string; inCohort: string | null }[], [uid],
  )

/** Admin: pending requests for one cohort, oldest first. */
export const usePendingRequests = (cohortId: string | undefined) =>
  useFetch<CohortRequest[]>(
    cohortId
      ? async () => (await rows<Row[]>(supabase.from('cohort_requests').select(REQUEST_COLUMNS)
          .eq('cohort_id', cohortId).eq('status', 'pending').order('created_at'))).map(toRequest)
      : null,
    [] as CohortRequest[], [cohortId],
  )

/** Admin: pending request count per cohort, for the cohort list. */
export const usePendingRequestCounts = () =>
  useFetch(async () => {
    const r = await rows<Row[]>(supabase.from('cohort_requests').select('cohort_id').eq('status', 'pending'))
    const m = new Map<string, number>()
    for (const x of r) m.set(x.cohort_id as string, (m.get(x.cohort_id as string) ?? 0) + 1)
    return m
  }, new Map<string, number>(), [])

/** Admin: Forming cohorts with requests still to decide, oldest request first (Tugas saya). Skipped when not admin. */
export interface RequestTodo { cohortId: string; cohortName: string; count: number }
export const useAdminRequestTodos = (isAdmin: boolean) =>
  useFetch<RequestTodo[]>(
    isAdmin
      ? async () => {
          const r = await rows<Row[]>(supabase.from('cohort_requests').select('cohort_id, cohorts!inner(name, status)')
            .eq('status', 'pending').eq('cohorts.status', 'forming').order('created_at'))
          const m = new Map<string, RequestTodo>()
          for (const x of r) {
            const id = x.cohort_id as string
            const c = x.cohorts as { name: string }
            const t = m.get(id) ?? { cohortId: id, cohortName: c.name, count: 0 }
            t.count++
            m.set(id, t)
          }
          return [...m.values()]
        }
      : null,
    [] as RequestTodo[], [isAdmin],
  )

export const requestCohortSlot =(cohortId: string, appId: string) =>
  rpc<string>('request_cohort_slot', { p_cohort_id: cohortId, p_app_id: appId })
export const withdrawCohortRequest = (requestId: string) => rpc('withdraw_cohort_request', { p_request_id: requestId })
export const approveCohortRequest = (requestId: string) => rpc('approve_cohort_request', { p_request_id: requestId })
/** Empty reason → null (the server trims too). */
export const rejectCohortRequest = (requestId: string, reason: string) =>
  rpc('reject_cohort_request', { p_request_id: requestId, p_reason: reason.trim() || null })
