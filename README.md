# TesBareng

A shared, transparent tracker for a test-for-test community of indie Android
developers. Members help each other pass Google Play's closed-test requirement
(12 testers opted in for 14 continuous days, plus real feedback and new builds).
Members are grouped into cohorts and assigned each other's apps, so nobody gets
testers without testing back.

- Frontend: React + Vite (TypeScript), Tailwind CSS, React Router, in `web/`
- Backend: Supabase (Postgres, Row Level Security, RPC functions, Google sign-in)
- Hosting: Vercel

During development the app runs against a local Supabase stack in Docker, so no
hosted project or credentials are needed.

## Requirements

- Node.js 22 or newer and npm
- Docker Desktop installed and running (or use the cloud dev project, below)

## Start locally

From the repository root:

```sh
npm install
npm --prefix web install
npm run db:start
npm run seed
```

In another terminal, start the web app:

```sh
npm --prefix web run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). To sign in as the
seeded admin without Google OAuth, open:

```text
http://localhost:5173/apps?devLogin=yusuf.hidayat.dev@gmail.com
```

`?devLogin=` works with any seeded email, and only when the Supabase URL is
local. The seed command clears and recreates the local sample data and refuses
to run against a non-local Supabase URL. Local Supabase Studio is at
`http://127.0.0.1:54323`.

## Useful commands

From the repository root:

```sh
npm run db:reset  # Reapply migrations to an empty local database; deletes its data
npm test          # Run integration tests; local Supabase must be running
npm run db:stop   # Stop the local Supabase stack
```

In `web/`:

```sh
npm run build     # Type-check and build for production
npm run lint      # Lint with oxlint
npx vite preview  # Serve the production build (after a build)
```

Tests create and remove their own members; the seed data stays.

## Without Docker: cloud Supabase dev project

Use a Supabase project that is meant for development, never the production
project. If you were invited to the maintainers' shared dev project, use that
one and ask its owner before pushing migrations or changing its settings.
Otherwise, create your own free project (steps below).

1. Create `web/.env.local` (gitignored) from `web/.env.example` with the
   project URL and anon key (Supabase dashboard, Project Settings, API).
2. Sign in with Google. `?devLogin=` does not work against a cloud project, and
   email sign-in stays disabled there.

Setting up your own dev project:

1. Log in and link it: `npx supabase login`, then `npx supabase link --project-ref <ref>`.
2. Apply the schema: `npx supabase db push`.
3. Optional sample data. It clears the target database, so it needs explicit opt-in:

   ```sh
   SEED_REMOTE_URL=https://<ref>.supabase.co \
   SEED_REMOTE_CONFIRM=https://<ref>.supabase.co \
   SEED_REMOTE_SERVICE_ROLE_KEY=<service role key> npm run seed
   ```

4. In the Supabase dashboard, enable the Google provider with an OAuth client
   whose redirect URI is `https://<ref>.supabase.co/auth/v1/callback`, and add
   `http://127.0.0.1:5173/**` and `http://localhost:5173/**` as redirect URLs.
5. After your first sign-in, make yourself admin in the SQL editor:
   `update profiles set role = 'admin' where id = (select id from auth.users where email = '<your email>');`

Never commit keys, and never use the service role key in the web app.

## Local defaults

The web app defaults to the local Supabase URL and public anon key. Do not copy
`web/.env.example` for local development; it is a template for a hosted project.
For local Google OAuth, configure credentials in `supabase/.env` using
`supabase/.env.example`. The `?devLogin=` shortcut does not need OAuth credentials.

## Deploy

The site is hosted on Vercel from `web/`. Set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` in the Vercel project settings. `web/vercel.json`
rewrites every route to `index.html` for client-side routing.

## Repository layout

```text
web/                 React SPA (pages, components, tokens in src/tokens.css)
supabase/migrations/ Schema, RLS policies, views and RPC functions
supabase/functions/  send-reminders Edge Function (daily email digest)
scripts/             Seed script and local helpers
tests/               Integration tests against the local stack (Vitest)
docs/                PRD, ADRs, web-database contract, design mockups
DESIGN.md            Design tokens and visual rules
```

## Documentation

- [Product requirements](docs/PRD-TesBareng.md): what to build
- [Architecture decisions](docs/ADR/): how it is built (ADR-001 to ADR-010)
- [Web ↔ database contract](docs/contract.md): RPCs and views the web app uses
- [DESIGN.md](DESIGN.md): design tokens (neubrutalism, "bumbu" palette)
- [CLAUDE.md](CLAUDE.md): project rules for contributors and coding agents,
  including the security rules (masked emails, RPC-only writes, computed counters)
