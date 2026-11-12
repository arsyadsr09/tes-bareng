# Backend contract (web ⇄ Supabase)

Shared between `web/` (React SPA) and `supabase/migrations/`. PRD §9 is the base (it still describes the old document model; this file is the concrete schema). Change both sides together, and cover the change in `tests/`.

Local stack: `npm run db:start` (Supabase CLI + Docker). API `http://127.0.0.1:54321`, Postgres `54322`, Studio `http://127.0.0.1:54323`. Hosted project (later): region `ap-southeast-1`.

## Tables

Rows are snake_case. The web client maps them to camelCase in one place (`web/src/lib/data.ts`). Timestamps are `timestamptz`; the client turns them into epoch milliseconds. `apps.test_start_date` is a `date`.

```
profiles            select: everyone · write: none (trigger + RPC only)
  id uuid pk → auth.users, display_name (≤ 50), photo_url, masked_email,
  role 'member' | 'admin', email_reminders bool (default true; daily digest opt-out, PRD FR-46), created_at

apps                select: everyone where deleted = false; admin sees all · write: none (RPC only)
  id uuid pk, name (≤ 50), description (≤ 280), opt_in_url, store_url?, package_name?,
  creator_id → profiles, status 'recruiting' | 'testing' | 'applied' | 'live',
  test_start_date?, feedback_guide? (≤ 500), created_at, updated_at, deleted bool,
  tester_method 'google_group' | 'email_list' (default 'google_group'; ADR-011)
    switching to 'email_list' (insert, or update from another method) needs the creator's
    profile_stats.testing_count >= 3, else failed-precondition (trigger apps_email_list_unlock)
  tester_slots smallint 1–12 (default 12; ADR-012): testers the app needs from TesBareng, its
    progress target; Ready to apply = eligible_count >= tester_slots

testers             select: everyone · write: none (RPC only)
  id uuid pk, app_id → apps, user_id? → profiles (null for manual entries),
  display_name, photo_url?, masked_email, opted_in_at, left_at?,
  status 'active' | 'left' | 'removed', added_by 'self' | 'creator', note? (≤ 140),
  feedback_sent bool, feedback_sent_at?, feedback_summary? (≤ 500),
  feedback_verified bool, replied bool, created_at
  unique (app_id, user_id) where user_id is not null

email_listings      select: everyone · write: none (RPC only)                     ADR-011
  app_id → apps, user_id → profiles, requested_at, listed_at? (creator marked it added in Play Console)
  pk (app_id, user_id). No email column: the address is read live by app_email_listings().

builds              select: everyone · write: none (RPC only)
  id uuid pk, app_id → apps, version_name (≤ 40), uploaded_at, changelog (≤ 140), created_at

check_ins           select: everyone · write: none (RPC only)                     PRD §6.10
  id uuid pk, tester_id → testers, kind 'used_app' | 'updated_build' | 'still_opted_in',
  build_id? → builds (required for 'updated_build', null for the other kinds), created_at
  unique (tester_id, kind, coalesce(build_id, nil uuid))

cohorts             select: everyone · write: none (RPC only)                     PRD §6.9
  id uuid pk, name (≤ 50), status 'forming' | 'active' | 'closed',
  day0_at? (set by start_cohort), closed_at? (set by close_cohort), created_at
  check: forming ⇔ day0_at null; closed ⇔ closed_at not null

cohort_members      select: everyone · write: none (RPC only)
  cohort_id → cohorts, user_id → profiles, app_id? → apps (null = pure tester),
  joined_at, assigned_at? (when this member's assignments were generated: day0_at for members
  present at start, the join time for later pure testers, FR-33b),
  ring_position? (members with an app only, 0 … N−1, set at start),
  demand? (members with an app only, set at start; ADR-012): kᵢ, the number of apps this creator
    tests and of creator testers their app receives; later slot edits do not change it
  standing? 'good' | 'owing' | 'settled' (null until close), settled_at?
  pk (cohort_id, user_id)            -- one app per member per cohort (PRD §17 Q7)
  unique (cohort_id, app_id) where app_id is not null

assignments         select: everyone · write: none (RPC only)
  id uuid pk, cohort_id → cohorts, tester_user_id → profiles, app_id → apps,
  assigned_at (base time for this assignment's deadlines), state 'open' | 'reassigned',
  reassigned_to? → assignments (set on the original when the admin moves the slot), created_at
  unique (cohort_id, tester_user_id, app_id)

cohort_links        select: members of that cohort + admin (RLS) · write: none (RPC only)
  cohort_id pk → cohorts, whatsapp_group_url (prefix https://chat.whatsapp.com/), updated_at

cohort_requests     select: own rows + admin (RLS) · write: none (RPC only)   (ADR-013)
  id uuid pk, cohort_id → cohorts, user_id → profiles, app_id → apps,
  status 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'expired', reason? (1–280, rejected only),
  created_at, decided_at? (null iff pending), decided_by? → profiles
  unique (user_id) where status = 'pending'
  Triggers close a pending row: cohort leaves forming → 'expired'; member inserted into that cohort →
  'approved' (with an app) or 'withdrawn' (pure tester); app soft-deleted → 'withdrawn'.

reminder_log        no client access (service role only)
  id uuid pk, user_id, kind, ref_id?, sent_on date, created_at
  unique (user_id, kind, ref_id, sent_on)
```

An app is in at most one non-closed cohort. The constraint spans two tables, so `add_cohort_member` enforces it under a row lock instead of an index. The web client never reads `cohort_links` directly; it calls `get_cohort_link`.

`insert`, `update` and `delete` are revoked from `anon` and `authenticated` on every table. Check constraints repeat the limits and formats (opt-in URL prefix `https://play.google.com/apps/testing/`, store URL prefix `https://play.google.com/store/apps/`, package name `^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$`, masked email `^[^@\s]{1,2}\*{5}@…$`), and a partial unique index allows one live app per package name.

The full email exists only in `auth.users`, which the API does not expose. `security definer` functions read it to mask it. The member sees their own address from their session (`supabase.auth.getUser()`).

Realtime publishes `apps`, `testers`, `builds` and `check_ins`. The web app subscribes only on the app detail page (one channel per app); other pages, the cohort pages and matrix included, refetch on mount and on window focus.

## Computed views (counters)

Both views use `security_invoker = true`, so the RLS of the base tables applies. Nothing stores a counter, so nothing can tamper with one.

`app_stats` (one row per app):

| column | meaning |
|---|---|
| `active_tester_count` | testers with status active |
| `eligible_count` | active and `now() − opted_in_at ≥ 14 days` |
| `feedback_sent_count` / `feedback_verified_count` / `replied_count` | active testers with that flag |
| `build_count`, `last_build_at` | count and max `uploaded_at` of the app's builds |
| `creator_testing_count`, `creator_feedback_sent_count`, `creator_feedback_verified_count` | the creator's `profile_stats` (FR-27b) |
| `creator_badge_tier` | the creator's `profile_stats.badge_tier` (FR-27j) |
| `counted_days` | whole days the `tester_slots`-th most senior active tester has been opted in (0 while fewer active testers than slots): the days Google counts, since it needs all testers active together. The app list shows it; app detail computes the same number from the tester rows. |

`profile_stats` (one row per profile), entries on soft-deleted apps never count:

| column | meaning |
|---|---|
| `apps_created_count` | the member's apps with `deleted = false` |
| `testing_count` | entries that are Active, or Left with `left_at − opted_in_at ≥ 14 days`; Removed never |
| `feedback_sent_count` / `feedback_verified_count` | entries with that flag and status ≠ removed |
| `apps_tested_count` | entries that reached 14+ days active: Active with `now() − opted_in_at ≥ 14 days`, or Left with `left_at − opted_in_at ≥ 14 days`; Removed never (FR-27g) |
| `badge_tier` | `'none'` 0–2, `'bronze'` 3–6, `'silver'` 7–13, `'gold'` 14–24, `'platinum'` 25+ (FR-27h) |
| `next_tier_at` | apps tested needed for the next tier (3, 7, 14, 25); null at platinum (FR-27k) |

Days active per tester are computed on the client (`web/src/lib/progress.ts`).

### Cohort milestones (shared by the two cohort views and `check_in`)

Every assignment has a **base time** `b` (`cohort_assignment_status.base_at`). Email-list apps (ADR-011): if the tester asked within `assigned_at + 48 h`, `b = greatest(assigned_at, listed_at)`, and null (nothing due) until the creator marks them added; otherwise, and for Google Group apps, `b = assignments.assigned_at`: Day 0 for members present at start, the join time for later pure testers (FR-33b), the move time for a reassigned slot. "Due Day N" means due at `b + N × 24 h` (owner decision 2026-11-03).

| Milestone | Met when | Due | Check-in opens |
|---|---|---|---|
| `opt_in` | the assigned member has a tester entry on the app that is Active, or Left with `left_at − opted_in_at ≥ 14 days` ("fulfilled", FR-34) | `b + 48 h` | — |
| `used_app` | a `used_app` check-in exists | `b + 7 d` | `b + 5 d` |
| `feedback` | `feedback_sent` on the entry | `b + 7 d` | — |
| `still_opted_in` | a `still_opted_in` check-in exists | `b + 13 d` | `b + 12 d` |
| `updated_build` | an `updated_build` check-in exists for every build of the app logged (`builds.created_at`) after `b` | build `created_at + 72 h` | when the build is logged |

The views judge milestones at the **as-of time** `coalesce(cohorts.closed_at, now())`. A milestone counts only when its due time is at or before the as-of time, so a closed cohort never judges a milestone that was due after the close (FR-37). Only `open` assignments count; `reassigned` ones are kept for history.

Outside a cohort, check-in windows use the tester's own `opted_in_at` as `b` (FR-40).

### `cohort_assignment_status` (one row per assignment; drives the matrix)

| column | meaning |
|---|---|
| `assignment_id`, `cohort_id`, `tester_user_id`, `app_id`, `state`, `assigned_at` | from `assignments` |
| `tester_id`, `tester_status` | the assigned member's entry on that app, null if none |
| `fulfilled` | `opt_in` met (table above) |
| `used_app_at`, `still_opted_in_at` | check-in times, null if none |
| `feedback_sent`, `feedback_verified` | from the entry; false if none |
| `builds_due_count`, `builds_updated_count` | builds of the app logged after `b` whose 72 h have passed / of those, builds with an `updated_build` check-in |
| `cell` | the furthest state reached, for the matrix (FR-38): `'not_joined'`, `'left'` (entry Left before 14 days or Removed), `'opted_in'`, `'used'`, `'feedback_sent'`, `'feedback_verified'`; `'reassigned'` when `state = 'reassigned'` |
| `behind_on` | `text[]` of milestones that are due and unmet (`'opt_in'`, `'used_app'`, `'feedback'`, `'still_opted_in'`, `'updated_build'`); empty for reassigned rows |
| `is_behind` | `cardinality(behind_on) > 0` |
| `base_at` | the base time `b` above; null while an email-list tester waits for the creator |

Pairs with no assignment row are "unassigned" and the matrix greys them out.

### `cohort_obligations` (one row per cohort member; PRD §9.2)

| column | meaning |
|---|---|
| `cohort_id`, `user_id`, `app_id` | from `cohort_members` (`app_id` null = pure tester) |
| `assigned_count` | open assignments |
| `opted_in_count`, `used_app_count`, `feedback_sent_count`, `feedback_verified_count`, `still_opted_in_count` | open assignments with that milestone met |
| `builds_due_count`, `builds_updated_count` | sums over open assignments |
| `all_fulfilled` | every open assignment is fulfilled (the target rule for `reassign_slot`, FR-36) |
| `is_behind` | any open assignment is behind (FR-42) |
| `owes_opt_in` | any open assignment has `opt_in` in `behind_on`; on the member's own app this drives the public "Belum tes" label (FR-35) |

Both views use `security_invoker = true`. **Cohort day** for display is `floor((now − day0_at) / 24 h)`, computed on the client; a late pure tester also sees their own day from `assigned_at`. "Ready to apply" for an app stays `app_stats.eligible_count ≥ 12`.

## RPCs (`supabase.rpc(name, args)`)

All are `security definer` with `set search_path = ''`. Every one except `mask_email` requires a session and raises `unauthenticated` without one. Date arguments are ISO strings: a bare `YYYY-MM-DD` means midnight UTC; the web client sends full timestamps for dates a member picks (local midnight).

| RPC | Args | Returns | Rules |
|---|---|---|---|
| `ensure_profile` | — | `uuid` | Upserts the caller's profile from the Google identity (name, photo, masked email). Never touches `role`. A trigger on `auth.users` insert creates the profile on first sign-in. |
| `create_app` | `p_name, p_description, p_opt_in_url, p_store_url?, p_package_name?, p_test_start_date?, p_feedback_guide?, p_group_confirmed, p_tester_method?, p_tester_slots?` | `uuid` | FR-4 validation; `p_tester_slots` 1–12 (default 12), else `invalid-argument`; `p_tester_method` `'google_group'` (default) or `'email_list'`, else `invalid-argument`; for Google Group apps `p_group_confirmed` must be true (`invalid-argument`); `'email_list'` needs the creator's Testing count ≥ 3 (`failed-precondition`); live duplicate package → `already-exists`; 5 apps per member per rolling 24 h → `resource-exhausted`. Starts `recruiting`. |
| `update_app` | `p_app_id`, same fields as create, `p_status?`, `p_tester_method?`, `p_tester_slots?` | — | Creator or admin. Replaces the editable fields; null `p_status` / `p_tester_method` / `p_tester_slots` keeps the current value; slots outside 1–12 → `invalid-argument`. Slot changes never move cohort assignments. Switching to `'email_list'` needs the creator's Testing count ≥ 3 (`failed-precondition`); an app already on it keeps it. Package uniqueness checked. |
| `delete_app` | `p_app_id` | — | Creator or admin. Soft delete (`deleted = true`, `deleted_at = now()`). |
| `restore_app` | `p_app_id` | — | Admin any time; the creator only within 10 minutes of deleting (the "Urungkan" undo, ADR-009 §7), otherwise `permission-denied`. Refuses if the package name was taken meanwhile (`already-exists`). |
| `request_email_listing` | `p_app_id, p_consent` | — | ADR-011. `p_consent` must be true (`invalid-argument`). App missing/deleted → `not-found`; Google Group app → `failed-precondition`; own app or Removed entry → `permission-denied`. Idempotent. |
| `cancel_email_listing` | `p_app_id` | — | Deletes the caller's own request; none → `not-found`. |
| `app_email_listings` | `p_app_id` | `{user_id, display_name, photo_url, email, requested_at, listed_at}[]` | **Creator of the app only** (admin too gets `permission-denied`). Full emails from `auth.users`; skips members whose entry is Left or Removed. Not-yet-added first. |
| `mark_email_listed` | `p_app_id, p_user_id, p_listed` | — | Creator or admin. `true` sets `listed_at` (keeps the first time), `false` clears it. No request → `not-found`. |
| `join_as_tester` | `p_app_id, p_checklist {joinedGroup, optedIn, installed}` | — | All three must be JSON `true`; on an email-list app `joinedGroup` is not needed but the caller's request must be marked added (else `failed-precondition`). Creator → `permission-denied`. Existing entry: active → `already-exists`; removed → `permission-denied`; left → re-activated with a new `opted_in_at`, `left_at` cleared and the entry's check-ins deleted (owner decision 2026-11-03). Masks the email. |
| `leave_testing` | `p_app_id` | — | Own active entry → left, `left_at = now()`. Not active → `failed-precondition`; no entry → `not-found`. |
| `mark_feedback_sent` | `p_app_id, p_sent, p_summary?` | — | Own **active** entry only. `true`: `feedback_sent_at = now()`, summary trimmed (≤ 500, empty → null). `false`: clears all three. |
| `add_manual_tester` | `p_app_id, p_display_name, p_email, p_opted_in_at?` | `uuid` | Creator or admin. Email is masked and discarded. `added_by = 'creator'`, opt-in not in the future (1 day slack). |
| `update_tester` | `p_tester_id, p_patch` (JSON object, snake_case keys) | — | Creator or admin: `status, opted_in_at, left_at, note, feedback_verified, replied`. Admin also: `feedback_sent, feedback_sent_at, feedback_summary` (moderation). Any other key → `permission-denied`. Status change without `left_at`: active clears it, left/removed keep it or set now. |
| `add_build` | `p_app_id, p_version_name, p_uploaded_at, p_changelog` | `uuid` | Creator or admin. ≤ 40 / ≤ 140, date not in the future. 10 per app per rolling 24 h → `resource-exhausted`. |
| `set_email_reminders` | `p_enabled` | — | Signed-in member, own profile only. Null → `invalid-argument`. |
| `check_in` | `p_app_id, p_kind, p_build_id?` | `uuid` | Own entry on the app: none → `not-found`, not Active → `failed-precondition`. Unknown kind, `build_id` missing for `updated_build`, given for another kind, or from another app → `invalid-argument`. Window not open yet (milestone table; `b` = the open assignment's `assigned_at` when the app is in a non-closed cohort assigned to the caller, else the entry's `opted_in_at`) → `failed-precondition`. Same kind (and build) twice → `already-exists`. |
| `create_cohort` | `p_name` | `uuid` | Admin. Name trimmed, 1–50 → else `invalid-argument`. Starts `forming`. |
| `add_cohort_member` | `p_cohort_id, p_user_id, p_app_id?` | — | Admin. Cohort missing → `not-found`; not `forming` → `failed-precondition`. Profile missing → `not-found`. Already a member → `already-exists`. Member has `standing = 'owing'` in any cohort → `failed-precondition`. App missing or soft-deleted → `not-found`; not owned by `p_user_id` → `invalid-argument`; already in this or another non-closed cohort → `already-exists`. Null `p_app_id` adds a pure tester. |
| `remove_cohort_member` | `p_cohort_id, p_user_id` | — | Admin. Not `forming` → `failed-precondition`; not a member → `not-found`. |
| `join_cohort_as_tester` | `p_cohort_id` | — | Member, as a pure tester (FR-33a). Cohort missing → `not-found`; closed, or Active after `day0_at + 7 d` → `failed-precondition`. Already a member → `already-exists`; Owing → `failed-precondition`. If Active: assigns 14 apps (all if fewer), fewest open assignments first, ties random, never the caller's own app; `assigned_at = now()`. |
| `request_cohort_slot` | `p_cohort_id, p_app_id` | `uuid` | ADR-013. Cohort missing → `not-found`; not `forming` → `failed-precondition`. Already a member → `already-exists`; Owing → `failed-precondition`; another pending request → `already-exists`. App missing/deleted → `not-found`; not the caller's → `permission-denied`; in a non-closed cohort → `already-exists`. |
| `withdraw_cohort_request` | `p_request_id` | — | Own request only, else `not-found`; not pending → `failed-precondition`. |
| `approve_cohort_request` | `p_request_id` | — | Admin. Missing → `not-found`; not pending → `failed-precondition`; then calls `add_cohort_member` with the requested app (its errors apply). |
| `reject_cohort_request` | `p_request_id, p_reason?` | — | Admin. Reason trimmed, empty → null, > 280 → `invalid-argument`. Missing → `not-found`; not pending → `failed-precondition`. |
| `leave_cohort` | `p_cohort_id` | — | The caller, pure testers only, while `forming` (owner decision 2026-11-03). Not a member → `not-found`; has an app in the cohort → `permission-denied` (the admin removes creators); not `forming` → `failed-precondition`. |
| `start_cohort` | `p_cohort_id` | — | Admin. Not `forming` → `failed-precondition`. Fewer than 13 members with an app, or any of their apps soft-deleted → `failed-precondition`. Shuffles members with an app into `ring_position` 0 … N−1. Each gets demand kᵢ = min(`tester_slots` + 2, N − 1) (ADR-012). When every kᵢ is equal (k), the member at position i is assigned the apps at positions i+1 … i+k (mod N). Otherwise a Kleitman–Wang greedy builds the assignment; if no assignment exists for those kᵢ, the smallest kᵢ is raised by one (never above N − 1) until one does. Either way every creator tests exactly kᵢ apps and their app gets exactly kᵢ creator testers, never their own app, never twice; the final kᵢ is stored in `cohort_members.demand`. Then pure testers, one by one in random order, get 14 apps each (all if fewer), lowest open assignments ÷ `demand` first, ties random (FR-33, ADR-012). Sets `status = 'active'`, `day0_at = now()`, and `assigned_at = now()` on members and assignments. |
| `reassign_slot` | `p_assignment_id, p_to_user_id` | `uuid` | Admin (FR-36). Assignment missing → `not-found`; not `open`, already fulfilled, or cohort not `active` → `failed-precondition`. Target not a member of the cohort → `not-found`; the same member, or the app's creator → `invalid-argument`; target not `all_fulfilled` → `failed-precondition`; target already assigned that app → `already-exists`. Inserts the new assignment (`assigned_at = now()`), sets the original to `reassigned` with `reassigned_to`. Returns the new id. |
| `reset_cohort` | `p_cohort_id` | — | Admin. Not `active` → `failed-precondition`. Deletes all `assignments` for the cohort, clears `ring_position` and `assigned_at` on all `cohort_members`, sets `status = 'forming'` and `day0_at = null`. Members remain; the cohort can be restarted with `start_cohort` at any time. |
| `close_cohort` | `p_cohort_id` | — | Admin (FR-37). Not `active` → `failed-precondition`. Before `day0_at + 21 d` it also needs every member's app at `eligible_count ≥ tester_slots`, else `failed-precondition`. Sets `closed_at = now()`, `status = 'closed'`, and each member's `standing` to `'owing'` if any open assignment `is_behind` at that moment, else `'good'`. Slots on an app soft-deleted during the cohort are skipped (nobody can join a deleted app), and the Ready-to-apply check skips deleted apps too. Nothing closes a cohort automatically; past Day 21 the admin panel shows it as overdue (owner decision 2026-11-03). |
| `settle_member` | `p_cohort_id, p_user_id` | — | Admin. Not a member → `not-found`; standing not `owing` → `failed-precondition`. Sets `'settled'` and `settled_at`. |
| `set_cohort_link` | `p_cohort_id, p_url` | — | Admin, any status (FR-49). Cohort missing → `not-found`. Trimmed URL must start with `https://chat.whatsapp.com/` → else `invalid-argument`; null or empty removes the link. |
| `get_cohort_link` | `p_cohort_id` | `text` or null | A member of that cohort (any role) or admin, else `permission-denied` (FR-50). Cohort missing → `not-found`. Null when no link is set. |
| `mask_email` | `email` | `text` | Pure helper, callable by anyone. |

Only the admin may act on a soft-deleted app (edit, manage testers, add builds, restore); for everyone else, its creator included, it is `not-found`.

## Service-role functions (reminders, ADR-006)

Never callable by `anon` or `authenticated`: they return full email addresses (ADR-005). The `send-reminders` Edge Function calls all four and sends one digest per member.

| Function | Kinds |
|---|---|
| `due_reminders()` | `new_build` (build logged in the last 24 h, to the app's active testers), `unreplied_feedback` (verified, unreplied > 3 days, to the creator), `app_eligible` (`eligible_count ≥ tester_slots`, once per app) |
| `due_cohort_reminders()` | One row per member, kind and cohort (`ref_id` = cohort id, `extra.apps` = the app names, `extra.day`, `extra.due_at`), counted from each assignment's `assigned_at`: `cohort_opt_in` (Day 1 and 2, not opted in), `cohort_feedback` (Day 5, feedback not sent), `cohort_used_app` (Day 7, used-app check-in or feedback missing), `cohort_still_opted_in` (Day 13). Active cohorts, open assignments, live apps only. |
| `due_admin_reminders()` | `cohort_requests`: one row per admin and Forming cohort with pending requests (`ref_id` = cohort id, `extra.count`, `extra.apps` oldest first). Daily until decided. |
| `due_listing_reminders()` | ADR-011, `ref_id` = app id. `email_listing_pending`: to the creator, members whose listing has no `listed_at` (Left/Removed entries skipped; `extra.count`, `extra.names` oldest first), daily until marked. `email_listing_added`: to the member, `listed_at` in the last 24 h and no tester entry yet. |

All skip members with `email_reminders = false` and anything already in `reminder_log` for that member, kind and ref today (`app_eligible`: ever).

## Errors

RPCs raise SQLSTATE `P0001` with an Indonesian `message` the UI shows as-is (addressing the member as "Anda", owner decision 2026-11-03) and the contract code in `hint`:

`unauthenticated` (no session), `invalid-argument` (validation, checklist, `group_confirmed`, wrong check-in build, app not owned by the member being added, bad reassign target), `not-found` (app, cohort, member or assignment missing; app soft-deleted; no own entry), `permission-denied` (creator joins own app, removed tester re-joins, non-creator manages testers/builds, forbidden patch key, non-admin calls an admin cohort RPC, non-member asks for the WhatsApp link, creator tries `leave_cohort`), `already-exists` (double join, duplicate package, double check-in, already a cohort member, app already in an open cohort, duplicate assignment), `failed-precondition` (leave/feedback/check-in when the entry is not active, check-in window not open, cohort in the wrong status, join after Day 7, Owing member, fewer than 13 apps, slot already fulfilled, target not all fulfilled, early close with apps not ready, settle when not Owing), `resource-exhausted` (rate limits).

`errorCode()` / `errorText()` in `web/src/lib/data.ts` map other errors without showing raw Postgres text: `42501` → permission-denied, `22P02` (malformed uuid) and constraint violations → invalid-argument, `23505` → already-exists, network failures → "Server tidak bisa dihubungi…", anything else → a generic server error sentence.

## Masking

`mask_email(email)`: lower-cased, trimmed; the local part's first 2 characters (fewer only if shorter) + `*****` + `@` + domain. `budi.santoso@gmail.com` → `bu*****@gmail.com`; `ab@gmail.com` → `ab*****@gmail.com`. Masked for everyone, including the creator.

## Auth

Google is the only sign-in for real users (any Google account, Workspace included): `supabase.auth.signInWithOAuth({ provider: 'google' })`, redirect flow. Admin = `profiles.role = 'admin'`, checked in SQL by `is_admin()`; the role is set only with SQL by the project owner.

Local only: email/password is enabled in `supabase/config.toml` so `?devLogin=<seeded email>` can sign in seeded members (password in `scripts/local.ts`). The client refuses the shortcut unless the Supabase URL is `127.0.0.1`/`localhost`. **Production must have the Email provider disabled.**
