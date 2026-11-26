# Amruta's Kitchen

Tiffin service platform: **Owner app**, **Customer app**, **Staff app** (Expo / React Native, TypeScript) on a **Supabase** backend (Postgres + Row Level Security).

- Full plan and every business decision: [PLAN.md](PLAN.md)
- What is done / what is next: [docs/STATUS.md](docs/STATUS.md)
- Set up on your personal laptop (accounts, keys, deploy): [docs/SETUP_PERSONAL_LAPTOP.md](docs/SETUP_PERSONAL_LAPTOP.md)
- **Everything still to do / verify, with test steps:** [docs/PENDING_AND_TESTING.md](docs/PENDING_AND_TESTING.md)

## Layout

```
apps/owner        Owner app (Android + web)          Phase 2: sign-in + authenticator, Today/Customers/Menu/Money/More
apps/customer     Customer app (Android + PWA)       Phase 3: invite join, today's meals, location, extras, skip/leave, bills, UPI pay
apps/staff        Staff app (Android)                Phase 3b: packing list, delivery route (works offline), boxes, shifts, read aloud
packages/app-core shared React Native code: encrypted-session Supabase client, API wrapper, UI kit (all apps)
packages/shared   money/date/display/customer helpers, error messages, row types, API contract (all apps)
supabase/migrations   database schema, security rules, business functions, notification triggers (the core of the system)
supabase/functions    Edge Functions: send-push (phone alerts), media-retention (deletes old photos/voice) + tested logic in _shared/
supabase/tests        security + business rule tests (run on every push)
.github/workflows     ci.yml (tests, audit, secret scan, static analysis), backup.yml (nightly encrypted backup)
```

## Commands

```bash
npm ci              # install
npm test            # 49 shared unit tests + 207 database/function tests (no Docker needed)
npm run typecheck   # TypeScript, all workspaces + the Edge Functions
cd apps/owner && npx expo start      # owner app (needs apps/owner/.env.local, setup guide step 9)
cd apps/customer && npx expo start   # customer app (needs apps/customer/.env.local, setup guide step 9b)
cd apps/staff && npx expo start      # staff app (needs apps/staff/.env.local, setup guide step 9c)
```

The database tests run real Postgres in-process (PGlite) with a Supabase stand-in
([supabase/tests/helpers/supabase-shim.sql](supabase/tests/helpers/supabase-shim.sql)).
After deploying, also run [supabase/tests/verify_live.sql](supabase/tests/verify_live.sql) against the real project.

## Security rules for contributors

1. Every new table: RLS + policies + tests **in the same change**. CI fails otherwise.
2. Clients never send prices or identities. Customers and staff write **only** through `customer_*` / `staff_*` functions.
   Any function, parameter or column an app uses goes in `packages/shared/src/api-contract.ts` (checked against the schema in CI).
3. No secrets in the repo. Apps only ever contain the public anon key.
4. Money is integer paise. Times are evaluated in the database (Asia/Kolkata).
