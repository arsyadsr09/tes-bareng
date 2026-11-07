# TesBareng

Shared, transparent tracker for a test-for-test community of indie Android developers. Members help each other pass Google Play's closed-test requirement: **12 testers opted in for 14 continuous days**, plus real engagement (feedback on Play, creator replies, 2–3 new builds). Members are grouped into **cohorts** and assigned each other's apps, so nobody gets testers without testing back.

Community Google Group: `google-tester-indonesia@googlegroups.com`

## Sources of truth

- **What to build:** `docs/PRD-TesBareng.md` (v2.2, 2 Nov 2026). Read the relevant PRD section before implementing a feature.
- **How to build it:** `docs/ADR/` (ADR-001 to ADR-010). Read the ADR that covers the area before changing it.
- **Web ↔ database contract:** `docs/contract.md`. Change both sides together, with tests in `tests/`.
- **Design reference:** `docs/design/landing-page-ui-v2.html` (landing page mockup).

Precedence and conflicts:

- If code, PRD, ADR or this file disagree, ask; do not silently pick one.
- For visual style and motion, **ADR-001 wins over PRD §13** (stated in ADR-001).
- PRD §17 holds open questions (Q1–Q12). Do not invent answers to them, ask.
- An ADR with status **Proposed** is not a decision. Do not implement it until the owner confirms.

| ADR | Topic | Status |
| --- | --- | --- |
| 001 | Design system: Neubrutalism ("bumbu" palette), both surfaces | Accepted (r2) |
| 002 | Backend: Supabase free plan instead of Firebase | Accepted, implemented |
| 003 | Hosting: Vercel | Accepted (2026-11-02) |
| 004 | Data access: RLS reads, RPC-only writes, computed counters | Accepted, implemented |
| 005 | Privacy: masked emails, full email never in a public table | Accepted, implemented |
| 006 | Reminders: daily digest via Gmail SMTP from one Edge Function | Accepted, implemented (cron job set up at first deploy) |
| 007 | Cohorts: ring assignment of testers | Accepted, implemented |
| 008 | Routing: story page at `/`, app list at `/apps` (PRD §17 Q9) | Accepted (option A, 2026-11-02) |
| 009 | Work surface UX: the "B2B" rules | Accepted (2026-11-02) |
| 010 | Story surface UX: the "B2C" rules | Accepted (2026-11-02) |
| 011 | Email-list testing: tester shares email with the creator by consent | Accepted, implemented (merged in #6, 2026-11-05) |
| 012 | Tester slots: creator chooses how many testers an app needs (amends 007, builds on 011) | Accepted, implemented (`feat/tester-slots`, PR #8, 2026-11-05) |
| 013 | Cohort app requests: creator asks, admin approves (amends PRD FR-30) | Accepted (2026-11-05); implemented (`feat/cohort-app-requests`) |

## UI work

Two surfaces (ADR-001):

- **Story surface:** landing and `/about`. Read and scrolled; must earn Design and Creativity.
- **Work surface:** app list, app detail, tester table, build log, cohort list and obligation matrix, member profile, Tugas saya (`/me`), add/edit app, admin. Must earn Usability.

**Design tooling = the project agents in `.claude/agents/`** (user decision 2026-11-02). This replaces the taste-skill and mengto/skills libraries named in ADR-001 §0–§1 and PRD §13.1; do not install or use them. ADR-001 still sets the visual direction (neubrutalism, "bumbu" palette, shadows, type, motion, accessibility, performance).

Before writing or changing any UI (page, screen, component, styling):

1. Read ADR-001 §2–§4 and PRD §13.
2. Build or redesign with the **`human-centered-design`** agent.
3. Review with the **`design-qa-review`** agent before calling a screen done (Critical / Should Fix / Nice to Have). It only lists findings; fix what is confirmed.
4. Tokens: **`DESIGN.md` at the repo root** (approved by the owner 2026-11-02), which both agents read; in code they live in `web/src/tokens.css`. Both surfaces share this one token file; token changes need the owner's approval.

These agents are written for CRM products. Where their advice conflicts with ADR-001, PRD §13 or the rules below, those win. `.claude` is gitignored, so the agents exist only on this machine.

Rules:

- The switch to the ADR-001 tokens was pulled forward by the owner on 2026-11-02 and happens once, now (before the cohort slices); afterwards the style is not re-done. New screens are built directly in the approved style.
- Colour carries meaning only (one job per colour, PRD DR-3): progress bars (X/12, Y/12, Z/14), tester status, feedback state (none / sent / verified), cohort obligations.
- Status never by colour alone: glyph plus text on chips, matrix cells and badges.
- Tabular numerals for counts and days. `id-ID` dates, WIB times. Only masked emails are ever rendered.
- Tester table and cohort matrix stay readable on mobile (sticky first column).
- Only touchable or elevated elements carry hard shadows (ADR-001 §2.2). Native scrolling only, no smooth-scroll library.
- No slop: centred hero over icon cards, soft gradients/glows, icons in tinted squares, rainbow charts, invented vanity numbers, placeholder or fake content.
- Done = screenshots at 375, 768 and 1280 px reviewed and fixed once + `design-qa-review` pass with no Critical findings open. Accessibility baseline: WCAG 2.2 AA (ADR-001).
- When delegating UI work, use the `human-centered-design` / `design-qa-review` agents and tell them to read ADR-001, PRD §13 and `DESIGN.md`.

Requires Node 22+. Screenshots need Chrome/Edge/Chromium (Playwright's Chromium works).

## Stack

- Frontend: React + Vite (TypeScript) SPA + Tailwind CSS + React Router, in `web/`.
- Backend: Supabase free plan. Postgres + Row Level Security + Postgres functions (RPC) in `supabase/migrations/`. Auth: Supabase Auth, Google provider only; any Google account may sign in, not only `@gmail.com` (PRD §6.1).
- Edge Functions: only one, `send-reminders`, for the daily email digest via Gmail SMTP (ADR-006, PRD §11.1), because Postgres cannot speak SMTP. Everything else stays in SQL.
- Hosting: **Vercel** (ADR-003, accepted 2026-11-02; the site is on Vercel). `web/vercel.json` rewrites all routes to `index.html`. No `web/public/_redirects`.
- Stack moved from Firebase on 2026-10-31 (ADR-002): Firebase needs the Blaze plan (credit card) to deploy Cloud Functions; Supabase's free plan does not.
- Development runs against the local Supabase stack (Docker), or against a cloud Supabase dev project when Docker is unavailable (never the production project). The web app points at it through `web/.env.local` (gitignored); read the project URL from there, never from this file. Never create other remote projects, set secrets, push migrations or deploy without asking.

## Run it (local Supabase only)

- Install: `npm install && npm --prefix web install`. Needs the Supabase CLI and Docker Desktop running.
- Database: `npm run db:start` (API 54321, Postgres 54322, Studio 54323). `npm run db:reset` re-applies all migrations to an empty database. `npm run db:stop` stops it.
- Seed sample data (stack running, clears and re-seeds; refuses non-local URLs unless `SEED_REMOTE_URL`, `SEED_REMOTE_SERVICE_ROLE_KEY` and `SEED_REMOTE_CONFIRM` (the same URL) are all set, for the cloud dev project only): `npm run seed`
- Web dev server: `npm --prefix web run dev`. With no env vars it talks to the local stack.
- Production-like preview against the local stack: `cd web && npx vite build && npx vite preview`. A deployed build needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (template: `web/.env.example`).
- Tests (stack running; they create and remove their own members, seed data stays): `npm test`
- Local-only sign-in shortcut for checking screens: append `?devLogin=<seeded email>` to any URL (e.g. `?devLogin=yusuf.hidayat.dev@gmail.com`, the seeded admin). It only works when the Supabase URL is 127.0.0.1/localhost; production has the email provider disabled. Against the cloud dev project, sign in with Google (email sign-in stays off there).
- Local Google sign-in needs a real OAuth client in `supabase/.env` (see `supabase/.env.example`); otherwise use `?devLogin`.
- New schema changes go in new migration files; never edit a migration that has already been applied.

## Commits

Every commit uses [Conventional Commits](https://www.conventionalcommits.org): `<type>(<optional scope>)!: <description>`, subject ≤ 100 chars. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Scopes are optional, e.g. `web`, `db`, `cohort`, `auth`. Use `!` (and a `BREAKING CHANGE:` footer) for breaking changes. The `.githooks/commit-msg` hook rejects anything else; `npm install` enables it (`core.hooksPath`). Do not bypass it with `--no-verify`.

Nothing tied to one person or one machine goes into git: Supabase project refs or URLs of a dev project, keys, personal emails, local paths (`/Users/...`, `/Volumes/...`), generated reports. Such values live in gitignored files (`web/.env.local`, `supabase/.env`); docs use placeholders like `<ref>`. Shared project values (the production site URL, the community Google Group, seeded sample members) are fine.

## Hard rules (security and data integrity)

1. **Never store a full email in a public table** (ADR-005). RLS cannot hide columns. Full emails live only in `auth.users`, which the API does not expose; only `security definer` functions read them, to mask them, plus the `send-reminders` Edge Function (service role) to send the digest. No public table or view has an email column, and check constraints reject anything that is not a masked address.
2. **Masking format:** first 2 chars of the local part (fewer only if the local part is shorter) + `*****` (always 5) + `@domain`. `budi.santoso@gmail.com` → `bu*****@gmail.com`, `ab@gmail.com` → `ab*****@gmail.com` (PRD §8.1). Masked for everyone, including the creator. Done in SQL by `mask_email()`. Only exception (ADR-011): on an email-list app, the creator sees full emails of members who consented, through `app_email_listings()`; never stored in a table.
3. **Counters are computed, never stored** (ADR-004). Tester, feedback, build, reciprocity, badge and cohort-obligation numbers come from views with `security_invoker = true` (`app_stats`, `profile_stats`, `cohort_obligations`). Nobody can write them.
4. **Testers may change only their own feedback fields (`mark_feedback_sent`) and leave (`leave_testing`).** Only creator/admin set `feedback_verified`, `replied`, status, opt-in date, note (`update_tester`). Admin may also moderate feedback fields.
5. Enforce the permissions matrix (PRD §7) in the database: RLS for reads, `insert/update/delete` revoked from `anon` and `authenticated` on every table, all writes through `security definer` RPCs with `set search_path = ''` (RPC list: PRD §9.3). Test every rule against the local stack (`tests/permissions.test.ts`, `tests/rpc.test.ts`, `tests/sql.test.ts`).
6. App delete = soft delete (`deleted = true`, `deleted_at`). The creator may undo within 10 minutes (`restore_app`, ADR-009 §7, owner decision 2026-11-02); after that only an admin restores.

## Domain logic

- **Days active** = days from `opted_in_at` to today, or to `left_at` if Left. Computed on the client.
- **Eligible** = status Active AND days active ≥ 14.
- **Ready to apply** badge: eligible ≥ the app's `tester_slots` (1–12, default 12; ADR-012). **Low engagement** hint: fewer than half of eligible testers sent feedback, or no build logged.
- **Reciprocity Testing count:** Active entries + entries Left after 14+ days. Removed, Left before 14 days, and entries on deleted apps do not count.
- **Badges** (PRD §6.7): based on apps tested to 14+ days active (Active with 14+ days, or Left after 14+ days; never Removed or deleted apps). Bronze ≥ 3, Silver ≥ 7, Gold ≥ 14, Platinum ≥ 25. Computed by a view, never stored. Badge names in Indonesian or English: PRD §17 Q11, open.
- **Cohorts** (PRD §5.6–5.8, §6.9, ADR-007): members are Creators (bring one app) or Pure testers (no app; join themselves from Forming until Day 7). Testers are assigned by ring. Opt-in deadline 48 h after Day 0, then Behind / "Belum tes". Close when every app is Ready to apply or at Day 21; unmet obligations → Owing, blocked from the next cohort until admin settles.
- **Milestone check-ins** (PRD §6.10) instead of daily attendance. **Reminders** (PRD §6.11): one email digest per member per day at 19:00 WIB, plus a WhatsApp reminder text the admin copies. WhatsApp sub-group link per cohort, members only (§6.12).
- A member cannot register twice on one app; re-joining after Left re-activates with a new `opted_in_at` and clears its check-ins; Removed testers cannot re-join. A creator cannot test their own app.
- Opt-in URL must match `https://play.google.com/apps/testing/...`.
- Limits: name 50, description 280, feedback guide 500, feedback summary 500, build version name 40, changelog 140 chars. Rate limits: 5 apps per user per rolling 24 h, 10 builds per app per rolling 24 h.
- "New build" banner shows for 3 days after a build entry.
- Feedback guide is prompts/questions, never ready-made review text (copy-pasted reviews look inauthentic to Google).
- No Play Console / Google Groups sync exists; all tracking is self-reported.

Data model: PRD §9. Routes: PRD §10 (ADR-008 option A: `/` landing, `/apps` app list).

## Product constraints

- Mobile-first. Most members open opt-in links on their phones.
- App detail page loads under 2 s on 4G. Performance budget: ADR-001 (LCP < 2.5 s, CLS < 0.1, INP < 200 ms, work-screen JS < 150 KB gzip).
- UI copy: Bahasa Indonesia primary, English optional. Write user-facing strings in Indonesian.
- Scope = PRD §16. **MVP** now includes cohorts with assignment and obligation matrix, pure testers, badges, public profile, Tugas saya, milestone check-ins, daily email digest, admin panel and WhatsApp link per cohort. The **Design pass** comes after the Supabase migration. Out of scope unless the user asks: Phase 2 (optional daily check-in, web push, CSV export, badges v2) and Phase 3 (iOS / TestFlight, cohort retrospective, public stats page).
