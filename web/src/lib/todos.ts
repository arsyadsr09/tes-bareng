// The member's open to-dos (ADR-009 §2). One source for Tugas saya and the nav badge, so both show the same count.
import { useMemo } from 'react'
import { buildTodoOpen, useApps, useAppsBy, useEmailListingTodos, useEntriesOf, useMyUpdatedBuilds } from './data'
import { useAdminRequestTodos, useMyAssignedApps } from './cohorts'
import { daysActive } from './progress'
import type { AppDoc, TesterDoc } from './types'

export interface Todo { entry?: TesterDoc; app: AppDoc; kind: 'join' | 'listed' | 'emails' | 'build' | 'feedback'; count?: number }

const PRIORITY = { join: 0, listed: 0, emails: 1, build: 2, feedback: 3 } as const

export function useMyTodos(uid: string | null | undefined, isAdmin: boolean) {
  const entries = useEntriesOf(uid)
  const apps = useApps()
  const myApps = useAppsBy(uid ?? undefined)
  const assignedApps = useMyAssignedApps(uid ?? undefined)
  const updated = useMyUpdatedBuilds(uid)
  const myEmailAppIds = useMemo(() => myApps.data.filter((a) => a.testerMethod === 'email_list').map((a) => a.id), [myApps.data])
  const listings = useEmailListingTodos(uid ?? undefined, myEmailAppIds)
  // ADR-013: admins decide creators' requests to bring an app into a Forming cohort.
  const requests = useAdminRequestTodos(isAdmin)
  const byId = useMemo(() => new Map(apps.data.map((a) => [a.id, a])), [apps.data])

  const testing = useMemo(
    () => entries.data
      .filter((e) => e.status === 'active' && byId.has(e.appId))
      .map((entry) => ({ entry, app: byId.get(entry.appId)! }))
      .sort((a, b) => daysActive(b.entry) - daysActive(a.entry)),
    [entries.data, byId],
  )

  const todos = useMemo<Todo[]>(() => {
    const out: Todo[] = []
    const testingIds = new Set(entries.data.filter((e) => e.status === 'active').map((e) => e.appId))
    for (const [appId] of assignedApps.data) {
      if (!testingIds.has(appId)) {
        const app = byId.get(appId)
        if (app) out.push({ app, kind: 'join' })
      }
    }
    // ADR-011: the creator added my email, so I can opt in now; and creators' requests still to paste.
    for (const { appId } of listings.data.listed) {
      const app = byId.get(appId)
      if (app && !out.some((t) => t.app.id === appId)) out.push({ app, kind: 'listed' })
    }
    for (const [appId, count] of listings.data.pending) {
      const app = byId.get(appId)
      if (app) out.push({ app, kind: 'emails', count })
    }
    for (const { entry, app } of testing) {
      // A new build stops being a to-do once I checked in "Sudah update" on it.
      if (buildTodoOpen(app.lastBuildAt, entry.feedbackSentAt ?? entry.optedInAt, updated.data.get(app.id))) out.push({ entry, app, kind: 'build' })
      else if (!entry.feedbackSent) out.push({ entry, app, kind: 'feedback' })
    }
    return out.sort((a, b) => {
      const pd = PRIORITY[a.kind] - PRIORITY[b.kind]
      if (pd !== 0) return pd
      if (a.entry && b.entry) return daysActive(b.entry) - daysActive(a.entry)
      return 0
    })
  }, [testing, assignedApps.data, byId, entries.data, listings.data, updated.data])

  return {
    entries, apps, myApps, assignedApps, listings, requests, testing, todos,
    total: todos.length + requests.data.length,
    loading: entries.loading || apps.loading,
  }
}
