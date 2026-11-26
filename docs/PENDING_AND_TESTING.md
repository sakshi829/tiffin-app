# Pending work and how to test it

Everything that **could not be done or checked on the job laptop** is listed here, so nothing is forgotten.
Do these on your **personal laptop** with your **personal accounts**. Tick each box when its test passes.

How-to details are in [SETUP_PERSONAL_LAPTOP.md](SETUP_PERSONAL_LAPTOP.md) (the "Setup" steps below).
Each item says **why it wasn't done here**, **what to do**, and **how to test it** (the expected result).

Order matters: do the sections top to bottom.

---

## A. Project and accounts (Setup steps 1–3)

Why not done here: needs your personal accounts and identity. Nothing was logged in or committed on the job laptop.

- [ ] **A1. Tools installed:** Node 24, Git, VS Code, Claude Code (personal account), gitleaks, age.
  **Test:** `node -v` shows v24.x, `gitleaks version` and `age --version` print versions.
  *26 Nov 2026 (Windows laptop):* Node v26.13.1 (project needs >=22; all tests and typecheck pass on it), Git 2.41, gitleaks 8.30.1, age 1.3.2, PostgreSQL 17.12 client tools (psql, pg_dump, pg_restore; for step 19.4) installed. **Still open:** Claude Code here is signed in with a work address; switch it to your personal Claude account, then tick A1.
- [x] **A2. Project copied, dependencies installed** (copy without `node_modules`, then `npm ci`).
  **Test:** `npm test` → all tests pass (49 shared + 207 database/function tests, 0 failing). `npm run typecheck` → no errors.
  *Passed 26 Nov 2026 on Node 26.13.1: 49 + 207 passing, 0 failing; typecheck no errors.*
- [x] **A3. Git with your personal identity + secret blocker:** `git init`, `git config user.email <personal>`, `git config core.hooksPath scripts/git-hooks`.
  **Test:** make a file with a fake AWS key: `node -e "require('fs').writeFileSync('fake.txt', 'aws_key = \"AKIA' + 'ABCDEFGHIJKLMNOP\"')"`, `git add` it, `git commit` → **commit is blocked**. `git reset fake.txt` and delete the file.
  (The key is built from two pieces on purpose: written whole here, it would make the secret scan block this file too.)
  *Passed 26 Nov 2026: gitleaks reported "leaks found: 1", commit blocked, file deleted. Repo identity set to your personal Gmail.*
- [x] **A4. Private GitHub repo + first push.**
  **Test:** GitHub → Actions → `ci` run is green (test, secrets-scan, static-analysis jobs).
  *Passed 26 Nov 2026: private repo `sakshi829/tiffin-app`, run 45857415970 all green (secret scan: 13 commits, no leaks). The first run was red: the old gitleaks action crashed on a first push, and newer Semgrep rules asked for pinned actions + a Dependabot cooldown; fixed in 45433b0, no check weakened.*
- [x] **A5. Accounts with 2FA on:** GitHub, Supabase, Brevo (now); Expo, Cloudflare, Sentry, Google Cloud (when their phase needs them). Play Console only if you ever choose the paid Play listing.
  **Test:** each account's security page shows 2FA enabled.
  *26 Nov 2026: owner confirmed 2FA on GitHub, Supabase, Brevo and Expo. Cloudflare, Sentry, Google Cloud: turn 2FA on when each is created.*
- [ ] **A6. App IDs final?** `com.amrutaskitchen.owner`, `com.amrutaskitchen.app`, `com.amrutaskitchen.staff` can **never change after the first Play Store upload**.
  **Test:** decide; if changing, edit `apps/*/app.json` before any upload.

## B. Database on Supabase (Setup steps 4, 6, 7)

Why not done here: needs your Supabase projects. All SQL was tested on an in-process Postgres (PGlite) with a Supabase stand-in.

- [ ] **B1. Migrations pushed to staging:** `npx supabase link --project-ref <staging>` then `npx supabase db push`.
  **Test:** the command finishes without errors; Table Editor shows the tables (customers, orders, ledger_entries, …).
- [ ] **B2. Security verified on the real project:** run `supabase/tests/verify_live.sql` in the SQL editor.
  **Test:** every check returns **zero rows**, and the last one returns `ok`. **If not: stop and fix before anything else.**
- [ ] **B3. Security Advisor clean:** Dashboard → Advisors → Security.
  **Test:** no "RLS disabled" or "exposed" warnings for our tables.
- [ ] **B4. Scheduled jobs exist:** SQL editor: `select jobname, schedule from cron.job;`
  **Test:** shows `generate-orders-nightly` (`30 15 * * *`), `generate-orders-morning` (`30 23 * * *`) and `cleanup-rate-limits`. If empty: Database → Extensions → enable **pg_cron**, then re-run the last migration's SQL.
- [ ] **B5. Kitchen created:** Authentication → Add user (your email) → SQL: `select app.bootstrap_kitchen('Amruta''s Kitchen', '<user-id>', 'Amruta');`
  **Test:** `select * from public.meal_slots;` shows lunch 13:30 and dinner 20:30. `select count(*) from public.expense_categories;` = 13.
- [ ] **B6. Production:** repeat B1–B5 on the production project **only after staging passes section E**.

## C. Sign-in configuration (Setup step 5)

Why not done here: these are dashboard settings in your Supabase account.

- [ ] **C1. Brevo as custom SMTP** (Authentication → SMTP).
  **Test:** "Send test email" (or sign in on the app) arrives within a minute, **not in spam**.
- [ ] **C2. Email templates send a code:** "Magic Link" and "Confirm signup" contain `{{ .Token }}`.
  **Test:** signing in on the app sends an email with a **6-digit number**, not only a link.
- [ ] **C3. MFA (TOTP) enabled.**
  **Test:** the Owner app's first sign-in shows "Set up your authenticator".
- [ ] **C4. Rate limits** (Authentication → Rate Limits): raise "emails per hour" from the default 30 to fit your customer count (e.g. 100).
  **Test:** setting saved.
- [ ] **C5. Step-up really uses fresh authenticator codes on the real server** (it was proven only on the test database).
  **Test:** Owner app → Menu → change an item price → the "Confirm it's you" box appears → enter the code → saved. Change another price **within 10 minutes** → no box. Wait **11 minutes**, change again → the box appears again.
  If the box appears **every time**, or **never**: stop and report. It means the token's `amr` claim differs from what the database expects (see DECISIONS T22).

## D. Backups (Setup step 8)

Why not done here: needs GitHub secrets, your encryption key and the production database.

- [ ] **D1. Backup key pair made with `age-keygen`; private key stored offline (USB + password manager).**
  **Test:** you can find the private key file in two places, and **neither is on GitHub or in the repo**.
- [ ] **D2. GitHub secrets `BACKUP_AGE_PUBLIC_KEY` and `SUPABASE_DB_URL` (Session pooler URL) added.**
  **Test:** Actions → `nightly-backup` → Run workflow → green, with an artifact `backup-…` containing one `.age` file.
- [ ] **D3. Restore drill into staging** with `scripts/restore-drill.sh` (Setup step 19.4). Do **not** use plain `pg_restore --data-only`: it loses data (STATUS, Phase 8c).
  **Test:** the script ends with "PASS: every table on staging matches the backup row for row." Repeat monthly.
- [ ] **D4. Failure alert works.**
  **Test:** temporarily rename the `SUPABASE_DB_URL` secret, run the workflow, check you get GitHub's "workflow failed" email, then restore the secret.

## E. Owner app on a real phone (Phase 2) (Setup steps 9–10)

Why not done here: needs your Supabase project and an Android phone. Here it was typechecked, bundled for web, and shown starting up in a browser (sign-in screen).

- [ ] **E1. `apps/owner/.env.local` created** with the staging URL + anon key (never the service_role key).
  **Test:** `npx expo start` → the app opens on the sign-in screen (not "Setup needed").
- [ ] **E2. Runs on Android** (Expo Go first; if it reports a missing native module, use a development build).
  **Test:** the app opens on the phone.
- [ ] **E3. The full Phase 2 checklist** in Setup step 10 (13 points: sign-in, authenticator, lock, menu, locations, timings, customers, delivery, payments, statement, days off, price change, verify_live).
  **Test:** all 13 ticked.
- [ ] **E4. A real day in parallel with paper** (PLAN.md Phase 2 "Done when").
  **Test:** at the end of the day, tiffin counts, extras and who-got-what match your paper notes exactly.
- [ ] **E5. Web version for the laptop:** `npx expo start` then press `w`.
  **Test:** you can sign in and see Today in the browser.

## F. Deferred features (could not be built or checked here)

| # | Item | Why deferred | When / how | How to test |
|---|---|---|---|---|
| F1 | ✅ *Built in Phase 8e (hidden until EXPO_PUBLIC_GOOGLE_SIGNIN=on; setup: step 20; check: Q19–Q21)* **Google sign-in** for customers (and optionally owner). Phase 3 ships **email code sign-in**, which works for everyone | Needs a Google Cloud OAuth client, redirect URLs in Supabase and a real phone to test. Untested sign-in code was not added | Phase 3 follow-up on the personal laptop: create the OAuth client, enable the Google provider, add the app's redirect URL, then ask Claude to add the button | Tap "Continue with Google" → choose account → lands in the app signed in. Signing in with a Google account that has no invite → only the "enter your invite code" screen |
| F2 | *(Decided in 8c: the phone keyboard's microphone is the voice input, T106)* **Voice input for location** (speech-to-text button) | The speech library needs a development build and a real phone; can't be verified here. **Phones' keyboard microphone already works in every text box**; the location screen tells customers so | Phase 4: add `expo-speech-recognition`, make a dev build | Tap mic → say "Ward 5" → the Ward 5 suggestion is highlighted → tap confirm |
| F3 | **Read lists aloud**: ✅ *built in the Staff app (Phase 3b)*; only needs checking on a phone (section H, H8) | Speech needs a real device | Done; check in H8 | Tap "Read aloud" → the phone speaks the route; "Stop reading" stops it |
| F4 | **Phone push notifications (Android)**: ✅ *built in Phase 4*; needs your Expo + Firebase setup and a development build (Setup step 11) | Expo/Firebase accounts, development build, real phone | Setup step 11, then section I | Owner adds a day off → customer's phone shows a pop-up |
| F5 | ✅ *Built in Phase 8a (standards-based, no library; DECISIONS T92); check: section O* **iPhone: web app testing + web push** | Needs an iPhone and HTTPS hosting. **Expo's push module has no web support** (checked Nov 2026), so web push needs its own implementation (VAPID); until then web/iPhone users see alerts **inside the app** | Web app: with F6. Web push: Phase 7 spike | iPhone: open link → Add to Home Screen → sign in → Alerts tab shows new alerts (and, after the spike, a pop-up) |
| F6 | **Web hosting on Cloudflare Pages** | Needs your Cloudflare account | Phase 3 follow-up | Visit `https://<project>.pages.dev` → sign-in screen loads over HTTPS |
| F7 | ✅ *Built in Phase 7b (off until you add a DSN; personal data stripped, tested); check: N7* **Sentry error reporting** | Needs your Sentry account/DSN | Phase 7 (hardening) | Trigger a test error → it appears in Sentry **without** names/phones in it |
| F8 | ✅ *Build profiles + dev client ready in Phase 7b; the store steps need your accounts (Setup 15.7)* **EAS builds / Play Store closed test (12 testers, 14 days)** | Needs Expo + Play Console accounts ($25) | Phase 7 | Testers install from the Play link; after 14 days production access can be requested |
| F9 | **Private file storage**: ✅ *built in Phase 5b* (4 private buckets, access rules tested; you create the buckets: Setup step 13) | Buckets are created in the dashboard | Setup step 13, check K1 | Customer A cannot open customer B's photo link; links expire after 5 minutes |
| F10 | ✅ *Checked in Phase 8d: route types generated with a short `expo start`; every link valid, a planted wrong link failed the typecheck* **Typed route checking** (`experiments.typedRoutes`) | Route types are generated when `expo start` runs; they weren't generated here | Automatic on the personal laptop | `npx tsc --noEmit` in each app after one `expo start`: still no errors |
| F11 | **npm audit: 6 moderate, 0 high** (build-time tooling only: Expo's fingerprint tool and, since Phase 7b, Sentry's bundler plugins via `glob`/`minimatch`; nothing that ships in the apps) | The only fix is a breaking downgrade | Next Expo update (Dependabot PR) | `npm audit --audit-level=moderate` shows 0 after updating |
| F12 | **Kitchen phone / WhatsApp in the customer app**: ✅ *built in Phase 5a* (Owner › More › Business & rules › Kitchen phone; Customer › Me › Call / WhatsApp) | Done | Check in J2 | Customer taps WhatsApp → chat with your number opens |
| F13 | ✅ *Built in Phase 7b (Me › App lock); check: N5* **Optional fingerprint lock in the customer app** | Optional per PLAN; owner app has it already | Phase 7 | Turn on in Me → app asks for fingerprint after 2 min away |
| F14 | ✅ *Built in Phase 7a (manifest, icons, iPhone tags); check on an iPhone, M15* **"Add to Home Screen" polish for iPhone** (web app name, icon, full-screen manifest) | Needs hosting (F6) and an iPhone to check | With F5/F6 | iPhone home-screen icon shows the kitchen's icon and name; opens without Safari bars |
| F15 | ✅ *Built in Phase 8b; check: P3* **"Request to join" screens** (no invite code; you approve) | Only needed when the app is public on the Play Store | Phase 8 | A new person asks to join → you see the request → approve → they get in |
| F16 | **Owner view of "where boxes are kept"**: ✅ *built in Phase 3b* (Owner app › More › Boxes not back; Staff app › Boxes) | Done | Done; check in H9 | Customer saves "kept at Ward 5" → both lists show it |
| F17 | **"Where are you today?" reminder**: ✅ *built in Phase 4* (30 min before the location cutoff, only if no place is set) | Needs the scheduled job on Supabase | Check in I6 | Phone/inbox: "Set your place for lunch before 1:00 PM" |
| F18 | **QR box stickers: print + scan**: ✅ *built in Phase 5b* (Owner › More › Boxes not back › Make & print; Staff: "Box" while packing, "Scan a box sticker" when collecting) | Camera and printing need a phone/printer | Check K7–K8 | Scan a sticker on an empty box → "Priya's box collected" |
| F19 | **Delivery proof photo**: ✅ *built in Phase 5b* (Staff › delivery stop › Add photo; customer sees it on the meal) | Camera needs a phone | Check K3 | Only that customer and the owner can open it; deleted after 30 days |
| F20 | **Attendance report**: ✅ *built in Phase 6* (Money › Reports › Staff attendance; also in the CSV) | Done | Check L8 | Owner sees "Ravi: 26 shifts · 104 h 0 min" for the month |
| F21 | **Automatic delivery assignment by place**: ✅ *built in Phase 5a* (Owner › More › Locations › place › "Delivered by") | Done | Check in J6 | New meals at City Hospital are assigned to Ravi without tapping; your manual choices are kept |
| F22 | ✅ *Built in Phase 7b; check: N2* **Push receipts check** (Expo recommends checking ~15 min after sending, to catch tokens that became invalid later) | Tickets already remove tokens Expo rejects immediately; receipts are an extra clean-up | Phase 7 | Uninstall the app on a test phone → within a day its token disappears from `devices` |
| F23 | **Scheduled announcements**: ✅ *built in Phase 5a* (Send announcement › Send later) | Done | Check in J5 | Schedule for tomorrow 9 AM → arrives then; Cancel stops it |
| F24 | ✅ *Built in Phase 7b (reported by the apps, not an Auth hook: DECISIONS T83); check: N3* **"New login on your account" alert** | Needs an auth hook on Supabase sign-in events | Phase 7 | Sign in on a new phone → the old phone gets an alert |
| F25 | **Low advance alert, due reminder (2 days before) and late fee**: ✅ *built in Phase 5a* | Done | Check in J3–J4 | Advance below your threshold → alert; reminder 2 days before due; one fee the day after |
| F26 | **Special menus / pre-orders**: ✅ *built in Phase 5b* (Owner › Menu › Specials; Customer › Today › Specials) | Done | Check K9 | Customer orders the Diwali thali before the deadline → it appears on Today and in their bill |
| F27 | **Bill as PDF**: ✅ *built in Phase 5b* (Owner › statement › Share PDF; Customer › Bills › Share statement) | PDF layout needs a phone to check | Check K10 | WhatsApp shows a one-page statement with the right total |
| F28 | **Voice notes in chat**: ✅ *built in Phase 5b* (30 s max, both directions) | Microphone needs a phone | Check K5 | Record → the other side plays it; gone after 30 days |
| F29 | ✅ *Built in Phase 7b (Supabase Realtime + 15 s fallback); check: N4* **Chat in real time** (instant) | Chat refreshes every 15 s; live updates via Supabase Realtime need checking on the real project | Phase 7 | Message appears instantly on the other phone |
| F30 | **Owner sees delivery photos**: ✅ *built in Phase 6* (Today › Delivery › tap a delivered meal › See delivery photo) | Camera/storage need a phone | Check L11 | Owner taps a delivered order → sees its photo |
| F31 | **Photos for location directions and packing**: ✅ *built in Phase 6* (More › Locations › spot › Photo; Menu › tiffin type › packing photo; Staff app shows them on tap) | Camera needs a phone | Check L11 | Owner adds a "Ward 5 entrance" photo → delivery staff see it |
| F32 | ✅ *Built in Phase 7b; check: N8* **Tidy references after files expire** (hide "photo no longer available") | Apps already show a gentle message when a file was deleted after 30 days | Phase 7 | After 30 days the meal screen shows no broken photo |
| F33 | ✅ *Built in Phase 7b (after 2 days); check: N8* **Unused receipt photos** (a receipt picked on the expense form, then the form abandoned) | The file stays in the owner-only `receipts` bucket; small, private, harmless | Phase 7: a monthly clean-up of receipt files no expense points to | Storage › receipts has no file that isn't linked to an expense |
| F34 | *(Decided in 8c: keyboard microphone, T106)* **Voice entry for expenses** (say "500 vegetables from Ramesh") | Same as F2: a speech library needs a development build. **The keyboard microphone already works** in the Quick add box, and the parser understands the result | Phase 7 with F2 | Tap mic → speak → the form opens filled in |
| F35 | ✅ *Built in Phase 8c (owner customer page + customer Bills); check: Q5* **Owner page for each customer's loyalty progress** ("12 of 30 meals") | Rewards and alerts work; a progress view is extra | Phase 8 | Customer page shows meals until the next reward |
| F36 | ✅ *Built in Phase 7b (Money › Reports › Busy days); check: N9* **Heatmap of meals by weekday × lunch/dinner** (PLAN.md Phase 6) (now Phase 7b) | Not built: the "Friday lunch: 40% skipped" suggestion already tells you when to cook less; a grid view is extra | Phase 7 (needs a small owner_weekday_counts function + one screen) | Reports shows a 7 × 2 grid, darker = more meals |
| F37 | ✅ *Built in Phase 7b (on by default; More › Security switch); check: N6* **Hide owner screens from the phone's recent-apps view** (Android FLAG_SECURE) | Needs a new native module (`expo-screen-capture`) and a new build; can't be installed or checked here | Phase 7b: `npx expo install expo-screen-capture` in apps/owner, call `usePreventScreenCapture()` in the signed-in layout, new build | Open the owner app, press the recent-apps button: the preview is blank; screenshots are blocked |
| F38 | *(Tried in Phase 7b: GitHub is blocked on the job network, so this stays on your laptop)* **Pin GitHub Actions to commit SHAs** (and the Semgrep image to a digest) | Needs network to look up the exact SHAs; a wrong SHA would break CI | Personal laptop: `npx pinact run` (or replace each `@v4` with its SHA from the action's releases page); Dependabot keeps them updated | CI still green; `uses:` lines show 40-character SHAs |
| F39 | **Backup secret only for the main branch + read-only backup login** | GitHub Environments and a Postgres role need your accounts; Supabase's rights on the `auth` tables can't be checked here | Step 15.2 (optional part) | Another branch's workflow can't read `SUPABASE_DB_URL`; the backup still runs green |
| F40 | ✅ *Fixed in Phase 8c (links open an empty form); check: Q6* **Owner deep links pre-fill the expense form** (`akowner://money/expense?amount=…`) | Low: the owner must still tap Save; documented, not changed | Later, if wanted: ignore prefill parameters unless opened from inside the app | — |
| F41 | *(Reviewed in 8c: kept as is, T107)* **Longer invite codes / secret-salted code hashes** | Low: codes are single-use, expire in 7 days, and the hashes are owner-only (no longer in the audit log) | Later, with Supabase Vault for the secret | — |
| F42 | ✅ *Fixed in Phase 8c; check: Q7* **Staff app's iPhone settings include a generic Face ID text** ("Allow AK Staff to use Face ID") although the staff app has no lock | In this shared-code setup the fingerprint package is probably linked into every app. Harmless, but App Review may ask | If Apple asks: add `"expo": { "autolinking": { "exclude": ["expo-local-authentication"] } }` to apps/staff/package.json and rebuild | The staff iPhone build has no Face ID line |
| F43 | ✅ *Built in Phase 8b (demo kitchen + reviewer password login); check: P4* **A sign-in for store reviewers** (Google Play "App access" and Apple App Review both need working login details) | The apps sign in only with a code emailed to the person; a reviewer can't read that inbox | Phase 8b: a review account limited to a separate **demo kitchen** (sample data only), signed in with a long one-off password that works for that single email only, which you turn off after review | Reviewer signs in with the details from the store form and sees only the demo kitchen; the same login can't reach your real kitchen |
| F44 | ✅ *Staff app and alerts built in Phase 8c (check: Q2–Q4); owner app, owner alerts and suggestions in Phase 8d (check: Q12–Q15)* **Staff app, owner app and alert texts in Marathi/Hindi** | The customer app is done (8b). Alerts are written by the database in English, so a Marathi customer still gets English alert text | Phase 8c: same tr() approach for the staff app; alert texts per person's language (store the language with the account) | Staff app in मराठी; a Marathi customer's "Lunch delivered" alert arrives in Marathi |
| F45 | **A fluent reader checks the Marathi and Hindi texts** | Written by Claude for everyday readers; wording can be improved by a native speaker | Before launch: open `packages/shared/src/i18n-mr.ts` / `i18n-hi.ts`, change only the text on the right of each line (keep {placeholders}); `npm test` confirms nothing is broken | The customer app reads naturally in both languages |

## G. Phase 3 (customer app) on a real phone

Why not done here: needs your Supabase project, a test customer and a phone. Here the customer app was typechecked, bundled for web, and shown starting in a browser (sign-in screen; a signed-out visit to "My meals" redirects to sign-in). Every database function it uses has automated tests, and the API contract test checks its calls.

Prepare: in the **Owner app** create a test customer "Test One" with a lunch plan, and create an invite code. Have a second email address ready.

- [ ] **G1. Run it:** create `apps/customer/.env.local` (same staging URL + anon key as the owner app), then `cd apps/customer && npx expo start`.
  **Test:** "Welcome to Amruta's Kitchen" sign-in screen.
- [ ] **G2. Stranger sees nothing:** sign in with an email that has **no** invite.
  **Test:** only the "Enter your invite code" screen. Wrong code 5 times → "Too many wrong codes" (wait 1 hour or use another email to continue).
- [ ] **G3. Staff code in the customer app:** in the Owner app create a **staff** invite, type it in the customer app.
  **Test:** "This code is for the other app… It is still valid." The code still works later in the Staff app (Phase 3b).
- [ ] **G4. Join:** enter the customer invite code.
  **Test:** the "Before you start" rules show your real meal times, late-skip rule and privacy text → "I agree" → Today screen with "Hi Test".
- [ ] **G5. Today screen:** shows today's and tomorrow's lunch with the tiffin, "Delivery around 1:30 PM", "Extras / skip until 11:00 AM (in …)", and "⚠ Tell us where you are today".
- [ ] **G6. Location:** Where I am → search "ward" → pick Ward 5 → add "bed 12" → Save.
  **Test:** the card shows "To: City Hospital > Ward 5 (bed 12)". **Owner app › Today › Delivery** shows Test One under that place. Next day, "Same as yesterday" appears. After the location cutoff the button disappears.
- [ ] **G7. Extras:** Extras → Egg + 1 → Bhakri + 2.
  **Test:** prices shown match the menu; the card lists them; **Owner app › Packing** shows them. Remove one → it disappears.
- [ ] **G8. Server enforces the cutoff:** keep the Extras screen open across the cutoff time, then tap +.
  **Test:** "Too late: the time for changes has passed." (The phone clock does not matter: also try changing the phone's time.)
- [ ] **G9. Skip + Undo:** before the cutoff tap Skip → "Undo" appears for 5 seconds → tap it.
  **Test:** meal is back to "Coming". Skip again and wait: the "I want it back" button stays until the cutoff.
- [ ] **G10. Late skip:** after the cutoff tap "Can't take it".
  **Test:** a warning explains the rule → "Skip anyway". First late skip of the month: no charge in Bills. Second late skip (another day): charged per the rule.
- [ ] **G11. Leave:** Going on leave → next 3 days → Pause.
  **Test:** "Done: N meals paused"; My meals shows them Skipped; Owner app shows them as skipped; Cancel in "My leave" brings them back.
- [ ] **G12. Box:** after the owner marks a meal Delivered, open it → "Where did you keep the box?" → Save.
  **Test:** the card shows "Box kept at: …" (owner/staff view comes in Phase 3b; meanwhile check Supabase table `box_movements`).
- [ ] **G13. Pay by UPI:** Bills → Pay by UPI → amount pre-filled with what's due → "Open UPI app" (opens your UPI app with amount and note; **don't actually pay if testing**) → enter a test UTR → Send.
  **Test:** Bills shows it as "Checking"; Owner app › Money › To confirm shows it. Confirm → customer balance drops and shows "Received". Try a second payment with a reason-rejection → customer sees "Not received" and the reason. Same UTR twice → "already been used".
- [ ] **G14. Food notes:** Me → "no onion" → Save.
  **Test:** Owner app › Packing shows "Note: no onion".
- [ ] **G15. Two customers stay separate:** create Test Two with another email and invite.
  **Test:** each phone shows only its own meals, bills and places. (Also proven by the automated tests.)
- [ ] **G16. Sign out on all devices:** sign in on phone + laptop browser → on the phone tap "Sign out on all my devices".
  **Test:** the browser asks to sign in again after its next refresh / reload.
- [ ] **G17. Web on a laptop:** `npx expo start`, press `w`.
  **Test:** the same flows work in the browser.

## H. Phase 3b (staff app) on a real phone

Why not done here: needs your Supabase project and a phone. Here the staff app was typechecked, bundled for web, and shown starting in a browser (sign-in; a signed-out visit to "Boxes" redirects to sign-in). Its database functions have automated tests (shifts, box lists, task visibility, delivered / not-found), and the offline queue logic has unit tests.

Prepare: Owner app › More › Staff › create a **Delivery** invite and a **Kitchen** invite. Owner app › Menu › a tiffin type › write **packing instructions**. Have 2 test customers with lunch today, and in Owner app › Today › Delivery tap "assign all to" the delivery person.

- [ ] **H1. Run it:** `apps/staff/.env.local` (same staging URL + anon key), then `cd apps/staff && npx expo start`.
  **Test:** "Amruta's Kitchen · Staff" sign-in screen.
- [ ] **H2. Join with the delivery code** (new email).
  **Test:** tabs **Work, Boxes, Me**. A **customer** code here says "for the other app… still valid" and stays usable.
- [ ] **H3. Join with the kitchen code** (another email / phone).
  **Test:** tabs **Work, Me** only (no Boxes); Work shows **Packing**, never Delivery.
- [ ] **H4. Packing:** totals by tiffin type, extras, **your packing instructions**, per-person list with food notes; Tomorrow works too.
  **Test:** numbers match Owner app › Today › Kitchen. **No prices anywhere.**
- [ ] **H5. Route:** grouped by place with your directions; only orders assigned to this person.
  **Test:** a customer assigned to someone else is not shown. Phone/Call is hidden until you turn on "Can see phone numbers" in Owner › Staff (then shown for **today only**).
- [ ] **H6. Delivered / Not found:** tap a customer → Delivered; another → reason → Mark not found.
  **Test:** Owner app › Today shows Delivered / Not delivered, the customer's Bills show the meal charged only for the delivered one.
- [ ] **H7. No signal:** turn on Airplane mode → tap Delivered for one customer.
  **Test:** card shows "Delivered (sending…)" and "1 update waiting for signal". Turn Airplane mode off → within 30 s (or "Send now") it disappears and Owner app shows Delivered. Close and reopen the app while offline: the update is still waiting.
- [ ] **H8. Read aloud:** on Route and Packing, tap "Read aloud".
  **Test:** the phone speaks the list in an Indian English voice if installed (otherwise the default voice); "Stop reading" stops.
- [ ] **H9. Boxes:** customer app › that meal › "Where did you keep the box?" → "Nurse station".
  **Test:** Staff › Boxes shows it under "Customer told us where"; Owner › More › Boxes not back shows it. Staff taps Collected → it disappears from both.
- [ ] **H10. Shift:** Me → Check in → Check out.
  **Test:** Owner › Staff shows "On shift since …" while checked in. Owner turns the person **off** → their app shows "Access removed" and the shift is closed.
- [ ] **H11. Owner account in the Staff app:** sign in with the owner email.
  **Test:** "This is the owner account: please use the AK Owner app."
- [ ] **H12. Sign out with unsent updates:** offline, mark one delivered, then Me → Sign out.
  **Test:** a warning says the update will be lost; tapping again signs out.

## I. Phase 4 (notifications) on Supabase and phones

Why not done here: needs your Supabase project, Expo + Firebase accounts, development builds and phones. Here: every event, reminder, preference and the push queue have database tests (12); the push sender's decision logic has unit tests (4) and the function typechecks against the real Supabase library; all three apps bundle and start in a browser.

**Inbox (works without phone push; do these first)**
- [ ] **I1. Day off:** Owner › More › Days off → add tomorrow (whole day, reason "Diwali").
  **Test:** each customer with meals tomorrow gets **one** alert "Kitchen closed …" (Customer app › Alerts, unread badge on the tab). Undo → "Kitchen open …" alerts. Staff get nothing.
- [ ] **I2. Delivered:** Staff marks a meal delivered.
  **Test:** that customer gets "Lunch delivered"; nobody else does.
- [ ] **I3. Route ready:** Owner › Today › Delivery → "assign all to Ravi".
  **Test:** Ravi gets **one** "Lunch route ready" per meal, not one per customer.
- [ ] **I4. Customer moved:** after the extras cutoff, customer changes their place.
  **Test:** the assigned delivery person gets "<name> moved … is now at …".
- [ ] **I5. Late skip:** customer skips after the cutoff.
  **Test:** owner and the assigned delivery person both get an alert.
- [ ] **I6. Reminder:** a customer with no usual place and no place set for today.
  **Test:** about 30 minutes before the location cutoff they get "Where are you today?" (the job runs every 5 minutes: check `select jobname from cron.job;` shows `notification-jobs`). Exactly one reminder per meal.
- [ ] **I7. Daily count:** after the extras cutoff, the owner gets "Lunch today: final count" with the tiffin and extras numbers matching Today › Kitchen.
- [ ] **I8. Payments and bills:** customer sends a UTR → owner alert; owner confirms → customer "Payment received"; reject → "Payment not found" with the reason; Save as bill → customer "Your bill is ready".
- [ ] **I9. Announcement:** Owner › More › Send announcement.
  **Test:** "Sent to N people"; customers (and staff if switched on) see it; a customer of another kitchen never does.
- [ ] **I10. Preferences:** Customer › Alerts → switch off "Meal delivered" → deliver a meal.
  **Test:** the alert is still in the list but **no phone pop-up** (once pop-ups are set up, Setup step 11). Days off can't be switched off.
- [ ] **I11. Mark all as read** clears the badge.

**Phone pop-ups (after Setup step 11)**
- [ ] **I12. Registration:** open each app's development build → allow notifications.
  **Test:** Supabase table `devices` has one row per person per phone; Alerts › "Turn on / check phone alerts" says "Phone alerts are on".
- [ ] **I13. Delivery of pushes:** repeat I1–I3.
  **Test:** the phones show pop-ups within about a minute (the sender runs every minute). Tapping one opens the Alerts screen. `select push_status, count(*) from notifications group by 1;` shows mostly `sent`.
- [ ] **I14. Sender is locked:** call the function URL without the secret: `curl -X POST https://<ref>.supabase.co/functions/v1/send-push`.
  **Test:** `401 Unauthorized`.
- [ ] **I15. Sign out stops alerts:** sign out of the customer app on a phone, then trigger an alert for that customer.
  **Test:** no pop-up on that phone (its `devices` row is gone); the alert is still in their inbox on next sign-in.
- [ ] **I16. Uninstalled app:** uninstall the customer app on a test phone and trigger an alert.
  **Test:** within a few minutes the device row is removed (Expo reports the token as not registered) and the alert ends `failed` or `sent` (if another phone of theirs got it).

## J. Phase 5a (billing jobs, announcements, auto-assignment, referrals, chat) on Supabase

Why not done here: needs your Supabase project (scheduled jobs) and phones. Here: 10 database tests cover late fees (never retroactive, once per bill, exemptions), reminders, low-advance alerts, month bills, scheduled announcements, auto-assignment, referrals and chat privacy; all apps typecheck, bundle and start in a browser.

First check the new jobs exist: `select jobname, schedule from cron.job;` → also `billing-jobs` (`30 4 * * *` = 10:00 IST) and `engagement-jobs` (every 5 min).

- [ ] **J1. Month bills:** Money › "Make bills for last month".
  **Test:** "N bills made"; each customer gets "Your bill is ready"; tapping again says they already exist; Customers › statement shows the same closing amount as the bill.
- [ ] **J2. Kitchen phone:** More › Business & rules › Kitchen phone → save (authenticator code).
  **Test:** Customer › Me shows Call and WhatsApp; WhatsApp opens a chat with your number.
- [ ] **J3. Late fee (try on staging with small amounts):** Business & rules → Charge a late fee: ₹50, 1 day → save. Make a bill with "due in 1 day" (Statement › Save as bill uses your grace days).
  **Test:** **2 days before** the due date at 10 AM the customer gets "Payment due … A late fee applies after that date." The day **after** the due date at 10 AM: one "Late fee added" alert and a ₹50 **Late fee** line in Bills. It never repeats. Bills made **before** you switched the fee on never get one. A customer set to exempt never gets one. A customer who paid in time gets none.
- [ ] **J4. Low advance:** set a customer to "Pays in advance", record a small payment below your warning amount, keep an active plan.
  **Test:** next morning at 10 AM they get "Advance running low"; once per day only.
- [ ] **J5. Scheduled announcement:** Send announcement → Send later → in 15 minutes.
  **Test:** it appears under Scheduled; arrives within 5 minutes of the time; Cancel on another one stops it.
- [ ] **J6. Auto-assignment:** More › Locations › City Hospital → Delivered by: Ravi.
  **Test:** within 5 minutes today's and tomorrow's unassigned meals at City Hospital show "By Ravi" on Today › Delivery and Ravi gets "route ready". Meals you assigned to someone else stay as you set them. Meals with only a typed location (no place picked) stay unassigned.
- [ ] **J7. Refer a friend:** Customer › Me › Refer a friend → name + phone.
  **Test:** you get an alert; More › Referrals → "Add as customer" opens the new customer (not linked yet: send them an invite); the referrer gets "Thank you…". Another customer never sees it.
- [ ] **J8. Chat:** Customer › Me › Message the kitchen → send.
  **Test:** you get an alert; More › Chats shows "1 new"; reply → customer gets an alert and sees it within 15 s; "Seen" appears under messages the other side has opened. A different customer's app shows only their own chat.

## K. Phase 5b (files, voice, QR stickers, specials, PDF) on Supabase and phones

Why not done here: needs your storage buckets, development builds with camera/microphone, a printer and phones. Here: 8 database tests cover the storage access rules (who can upload/see each kind of file, path tricks, no overwrite, owner-only delete), the retention list, special menus and box stickers; the retention grouping and HTML/PDF builders (escaping) have unit tests; all apps typecheck, bundle and start in a browser; app configs are valid.

- [ ] **K1. Buckets:** after Setup step 13 A, run `verify_live.sql`.
  **Test:** no "BUCKET MISSING OR PUBLIC" / "STORAGE POLICY MISSING" rows.
- [ ] **K2. UPI QR picture:** Owner › More › Business & rules › Add QR picture (authenticator code).
  **Test:** Customer › Bills › Pay by UPI shows the QR; a customer of another kitchen can't load it.
- [ ] **K3. Delivery photo:** Staff › delivery stop › Add photo (camera).
  **Test:** that customer › meal › "Delivery photo" shows it; another customer has no access; a different delivery person gets "Not found" when trying the same meal. A second photo for the same meal is refused (one per meal).
- [ ] **K4. Payment screenshot:** Customer › Pay by UPI → send UTR → Add screenshot.
  **Test:** Owner › Money › To confirm › View screenshot shows it. After you confirm, the customer can't attach another.
- [ ] **K5. Voice notes:** Customer › Message the kitchen › 🎤 Voice note (speak 5 s) → Stop & send.
  **Test:** owner gets "Voice note from …", plays it in the chat; owner replies with a voice note; customer plays it. Recording stops by itself at 30 s.
- [ ] **K6. Files are private:** copy a signed photo link from the network log (or ask Claude to help) and open it after 6 minutes.
  **Test:** the link no longer works (5-minute links).
- [ ] **K7. Stickers:** Owner › More › Boxes not back › 12 → Make & print stickers.
  **Test:** a PDF/print preview with 12 QR stickers AK-001…; phone camera app reads "AK-001". Print on sticker paper, cover with clear tape.
- [ ] **K8. Scan flow:** Kitchen staff › Packing › person › Box → scan sticker. After delivery: Delivery staff › Boxes › Scan a box sticker.
  **Test:** "AK-001: Priya's box collected"; Owner › Boxes not back no longer lists that meal. A box never scanned at packing says "we don't know whose it is".
- [ ] **K9. Special menu:** Menu › new tiffin type "Diwali Thali" with "Special" on and a fixed price → Menu › Specials → offer for a date, orders close the evening before, max 10.
  **Test:** Customer › Today › Specials shows it with price and "Order by …"; Order → "Ordered", appears in My meals and in Owner › Today on that date; after the close time it can't be ordered; when 10 are ordered others see "Sold out"; skipping before the cutoff frees a place; delivered → charged in Bills.
- [ ] **K10. PDF:** Owner › customer › Statement & bill › Share PDF; Customer › Bills › Share statement.
  **Test:** WhatsApp/Drive receives a readable one-page statement whose closing amount matches the app. On the laptop web version the print dialog opens ("Save as PDF").
- [ ] **K11. Automatic deletion:** in the SQL editor make one test photo "old": `update storage.objects set created_at = now() - interval '31 days' where name = '<a test photo path>';` then call the function once (or wait for 03:30 IST).
  **Test:** the file disappears from Storage and the meal shows "Photo no longer available". Your UPI QR picture is never deleted.

## L. Phase 6 (expenses, reports, suggestions, loyalty) on Supabase and a phone

Why not done here: needs your Supabase project (new tables, functions and the 5th bucket), a phone camera and real data. Here:
- 16 database tests (`20-finance`, `21-insights`) cover:
  - receipt rules, and that receipts are never auto-deleted
  - recurring expenses (alert once, record, keep the due day)
  - budgets, ingredients and the prep list
  - waste
  - exact profit and loss numbers, the daily series and attendance
  - loyalty (off by default, once per milestone, step-up, immutable)
  - directions/packing photo access
  - all 9 suggestions over 7 weeks of simulated history, with no false alarms on a new kitchen
- 4 unit tests cover the quick-add parser, safe CSV and the report HTML.
- All apps typecheck and bundle. Each new screen starts in a browser and redirects to sign-in when signed out.

- [ ] **L1. Database:** `npx supabase db push` (staging first) → run `verify_live.sql`.
  **Test:** no problem rows. `select jobname, schedule from cron.job;` also shows `finance-jobs` (`0 3 * * *` = 08:30 IST). If it is missing, run the last `do $$ … cron.schedule('finance-jobs' …) $$` block of `…1800_finance_insights.sql` again.
- [ ] **L2. Receipts bucket:** Setup step 14.
  **Test:** `verify_live.sql` shows no "BUCKET MISSING OR PUBLIC" for `receipts`.
- [ ] **L3. Add expense with receipt:** Money › Add expense → ₹450, Vegetables, "Ramesh", UPI → Take photo → Save.
  **Test:** it shows under today in Money › Expenses with "Receipt". Open it → the photo loads. Sign in to the Staff app as Ravi: there is no way to see expenses (the menu isn't there; the API answers nothing).
- [ ] **L4. Quick add:** Money › Expenses › Quick add → tap the keyboard mic → say "five hundred vegetables from Ramesh" (or type `500 vegetables from Ramesh`) → Next.
  **Test:** the form opens with ₹500, Vegetables, Ramesh. Change anything, Save. "10 eggs 60" (two numbers) asks you to type it instead.
- [ ] **L5. Remove / restore:** open an expense → Remove → it disappears from totals; "Show removed entries" shows it; Restore brings it back.
  **Test:** totals change back and forth; the audit log keeps both changes.
- [ ] **L6. Regular expense:** Money › Regular expenses → "Kitchen rent", Utilities, ₹5000, every month, due today.
  **Test:** at 08:30 IST you get "Kitchen rent is due" (or run `select app.run_finance_jobs();` in the SQL editor). "Record payment" adds ₹5000 to today's expenses and the next due date becomes the same day next month.
- [ ] **L7. Budgets:** Categories & budgets → Vegetables → budget ₹3000.
  **Test:** once vegetables pass ₹3000 this month, the category shows "Over", Reports shows "Over budget" and Suggestions shows "Vegetables is over budget".
- [ ] **L8. Reports:** Money › Reports → This month.
  **Test:** "Billed" equals the sum of this month's meal/extra lines in customer statements; "Running expenses" equals Money › Expenses total (running); the bar chart has one bar per day (tap a bar → that day's numbers; "Show as a list" gives exact values); Staff attendance matches check-ins.
- [ ] **L9. Exports:** Reports › Report as PDF; Reports › Spreadsheet (CSV); Expenses › Export.
  **Test:** WhatsApp/Drive receives them; the CSV opens in Google Sheets/Excel with ₹ amounts as numbers, and a vendor typed as `=1+1` shows as text (not 2).
- [ ] **L10. Ingredients & shopping list:** Menu › Ingredients → add Atta (kg) → Roti → 0.03 → Save amounts. Today › Prep & shopping list.
  **Test:** for 10 veg tiffins with 4 roti each: Roti 40, Atta 1.2 kg. Skip one meal → numbers drop. "Share list" opens WhatsApp with the list.
- [ ] **L11. Photos (F30, F31):** Today › Delivery › a delivered meal with a photo → See delivery photo. More › Locations › City Hospital › Ward 5 › Photo → Take photo. Menu › Veg Standard → Add photo of a packed tiffin.
  **Test:** the delivery photo shows; Staff app: route shows "Photo of the way in", packing shows "Photo of packed tiffin"; a customer cannot open these files.
- [ ] **L12. Leftovers & suggestions:** Today › Prep › Left over → 3 tiffins. After a few weeks of real use open Money › All suggestions.
  **Test:** each suggestion shows numbers you can check (e.g. "Friday lunch: 40% skipped"). A new kitchen with no history shows "Nothing to point out".
- [ ] **L13. Loyalty:** More › Loyalty reward → on, every 5 meals, ₹20, "free salad" → Save (authenticator code). Deliver 5 meals to a test customer.
  **Test:** the customer gets "Thank you for 5 meals!" and Bills shows "Loyalty reward … -₹20". Re-marking that meal delivered doesn't pay again. Switching it off stops new rewards. A test customer can mute "Loyalty reward" in Alerts.

---

## M. Phase 7a (security fixes, performance, accessibility, web, privacy) on Supabase, Cloudflare and phones

Why not done here: needs your Supabase project, web hosting, phones (Android with fingerprint and one with PIN only, an iPhone for the web app) and real sign-ins. Here: 20 new database tests reproduce every review finding and prove the fix; a simulated year of data was timed; both web apps were loaded under the new security headers in Chrome with zero violations; colour contrast is unit-tested.

Setup: [SETUP_PERSONAL_LAPTOP.md](SETUP_PERSONAL_LAPTOP.md) step **15**. Use **staging** first.

| # | Test | Expected |
|---|---|---|
| M1 | `npx supabase db push`, then run `supabase/tests/verify_live.sql` | No problem rows. If it lists **BUCKET LIMIT MISSING OR TOO LOOSE**, set that bucket's size and types (step 15.1) |
| M2 | **Late fee, paid on time:** switch on a ₹50 flat late fee. Make a bill for a customer, record their full payment before the due date, then deliver one more meal. Wait two mornings | **No** late fee. (Before the fix this added ₹50) |
| M3 | **Late fee, UTR pending:** a customer submits a UTR on the due date evening; don't confirm it until the next afternoon | No fee the next morning; after you **confirm** → still none; if you **reject** it → the fee is added the following morning |
| M4 | **Step-up prompts:** leave the owner app 10+ minutes, then try: change what goes into a tiffin people have ordered; switch a tiffin to "sum of items"; set a customer to **Archived**; change a customer's free late skips; change a **delivered** meal to skipped | Each one asks for your authenticator code first. Renaming a tiffin, pausing a customer or marking a meal delivered do **not** ask |
| M5 | **Same UTR:** two customers (or one, twice) submit the same UTR | Money › To confirm shows "Same UTR as 1 other payment"; confirming the first works, confirming the second says another payment with this UTR is already confirmed |
| M6 | **Too early:** a delivery person marks a lunch delivered before the extras cutoff | "Too early to mark this delivered…"; after the cutoff it works |
| M7 | **Boxes:** packing staff scan a box out; a delivery person scans it back **before** the meal is delivered | "This box's meal hasn't been delivered yet"; after delivery the scan works. A delivery-only person can't record boxes going out |
| M8 | **The offline lock attack** (owner app, Android): sign in; close the app for more than 1 hour; turn on airplane mode; open the app | The **offline** screen (not sign-in). Turn airplane mode off → Retry → the app asks for your **fingerprint/PIN** before showing anything |
| M9 | **PIN-only phone:** on a phone with a screen PIN but no fingerprint, sign in to the owner app, background it 3 minutes | The lock asks for the phone PIN. More shows "Lock app now" (not the "no screen lock" warning) |
| M10 | **Sign out on all my devices:** sign in as the same customer on phones A and B. On A, Me › Sign out on all my devices | A is signed out. B stops getting alerts at once and is signed out within about an hour (when its current access token expires). Try once in airplane mode: A is signed out and a message says other devices are still signed in |
| M11 | **Staff queue survives offline restart:** in airplane mode mark 2 meals delivered, force-close the staff app, reopen (still offline), then go online | Both are sent; nothing lost |
| M12 | **Delete my account:** customer taps Me › Delete my account › tap again | The kitchen gets the chat message. Owner: set the customer to Archived → **Erase personal data** (authenticator) → the name shows "Deleted customer"; bills still add up; the next day their voice notes/screenshots/photos are gone from Storage |
| M13 | **Home places:** add a place of kind "home" and set it as one customer's default | That customer sees it; other customers' location pickers don't |
| M14 | **Web security headers:** deploy both web apps (step 15.3); run `curl -sI https://<site>/` | `content-security-policy` contains **your** `https://<ref>.supabase.co` (no `*`), plus `x-frame-options: DENY`, `referrer-policy: no-referrer`, `strict-transport-security`. In the browser's DevTools console: no "Content Security Policy" errors while you sign in, open a photo and play a voice note |
| M15 | **Install the web app:** iPhone Safari → Share → Add to Home Screen; Android Chrome → Install app | Terracotta tiffin icon, name "Amruta's", opens full screen without browser bars |
| M16 | **Privacy page:** `https://<customer site>/privacy.html` | Loads (light and dark); every [bracket] filled in; the "Full privacy policy" button on the customer's first screen opens it |
| M17 | **Screen reader:** Android TalkBack on, go through an extras screen and a photo | Buttons are read as "Less Egg", "More Egg", "Egg: 2"; photos have descriptions; while locked, nothing behind the lock is read |
| M18 | **Big text + dark mode:** phone font size to maximum, then dark mode | Every screen still usable (text wraps, buttons reachable); field outlines visible in both |
| M19 | **New icons:** install new builds of all 3 apps | Terracotta (customer), green (owner), blue (staff) tiffin icons; Android 13+ themed icons show the outline; splash in the app's colour |
| M20 | **Restore drill** (step 19.4, `scripts/restore-drill.sh`) | "PASS: every table on staging matches the backup row for row"; you can sign in to staging again |
| M21 | **Attack pass** (step 19.3 automated, then step 15.6 by hand) | `run.mjs` prints PASS on every line; by hand, every tampered request is refused; nothing in another customer's or kitchen's name succeeds |
| M22 | **Phone-width layout:** open the customer web app on a small phone (360 px wide) | No sideways scrolling; cards fit the screen (only checked at 600 px here: headless Chrome won't go narrower) |

## N. Phase 7b (launch prep) on Supabase and phones

Why not done here: needs your Supabase project (Realtime, the push sender running), new phone builds (new native modules: app lock in the customer app, screenshot blocking in the owner app, Sentry, development client), a Sentry account and real devices. Here: 6 new database tests (`24-launch`), push-receipt and retention logic tests, the error-report scrubber tests (no names, emails, phones, tokens or invite codes leave the phone), heatmap colour contrast tests; all three web apps load with Sentry running under the security headers with zero violations.

Setup: [SETUP_PERSONAL_LAPTOP.md](SETUP_PERSONAL_LAPTOP.md) step **16**.

| # | Test | Expected |
|---|---|---|
| N1 | `npx supabase db push`, run `verify_live.sql` | No problem rows. `select * from pg_publication_tables where pubname = 'supabase_realtime';` lists `chat_messages` |
| N2 | **Push receipts:** install a build with alerts on, send it an alert, then uninstall the app. Send another alert to that person; wait 20 minutes | That phone's row is gone from Table editor › `devices` (Expo reported it as uninstalled) |
| N3 | **New sign-in alert:** sign in as a customer on phone A, then on phone B (or the web) | Phone A gets "New sign-in to your account … Signed in on <phone model> at <time>". The very first sign-in of a new account gives no alert. Alerts › settings has no switch to mute it |
| N4 | **Live chat:** open the same chat as owner (web) and customer (phone); send a message from each side | It appears on the other side within about 2 seconds (no 15-second wait). Another customer never sees it |
| N5 | **Customer app lock:** Me › App lock › switch on (asks fingerprint/PIN). Leave the app 3 minutes, come back | The app asks for fingerprint/PIN. Switching it off also asks first. On a phone with no screen lock the switch explains what to set up |
| N6 | **Owner screen privacy:** open the owner app, press the recent-apps button; try a screenshot | The preview is blank; the screenshot is blocked. More › Security › "Allow screenshots on this phone" on → both work again |
| N7 | **Error reports:** set `EXPO_PUBLIC_SENTRY_DSN` (step 16.3), build, then in the owner app trigger an error (for example open a customer while offline) | The error appears in Sentry with app, phone model and OS, but **no** name, email, phone number, user id or request data. Without the DSN nothing is sent (Sentry shows nothing) |
| N8 | **Clean-up tidies references:** with `media_retention_days` set to 1 on staging, add a delivery photo and a voice note; also pick a receipt photo on Add expense and leave without saving. Wait 2–3 days of the daily job | The photo/voice note disappear from the meal and chat screens (no "no longer available"); the unsaved receipt file is gone from Storage; saved receipts stay |
| N9 | **Busy days heatmap:** Money › Reports with a month of data | A 7 × 2 grid (Mon–Sun × lunch/dinner): numbers = meals per day on average, small text = % skipped, darker = busier; readable in dark mode; TalkBack reads "Tuesday lunch: 12.4 meals a day on average, 6% skipped" |
| N10 | **Builds:** `npx eas-cli@latest build --profile development --platform android` in each app (step 16.4) | Builds succeed without a Sentry login (upload is switched off in `eas.json`) and the apps open |

## O. Phase 8a (iPhone) on hosting, Supabase and an iPhone

Why not done here: needs your VAPID keys, HTTPS hosting, Apple's push servers and a real iPhone (iOS 16.4 or newer). Here: the encryption and VAPID signing were checked against independent code (http_ece, Node crypto); 10 new tests; the service worker registered and showed an alert in Chrome under the real security headers; the generated iPhone settings were inspected for every permission text.

Setup: [SETUP_PERSONAL_LAPTOP.md](SETUP_PERSONAL_LAPTOP.md) step **17**.

| # | Test | Expected |
|---|---|---|
| O1 | `npx supabase db push`; `verify_live.sql` | No problem rows |
| O2 | **iPhone web app alerts:** Safari → customer site → Share → Add to Home Screen → open from the icon → sign in → Alerts → Turn on alerts → Allow. Close the app. From the owner app, send an announcement | A pop-up on the iPhone lock screen within about a minute; tapping it opens the app. In Safari (not installed) the Alerts screen explains to add it to the Home Screen first |
| O3 | **Android Chrome / desktop:** same, in the browser | Pop-up alert; same text as the phone apps |
| O4 | **Mute + sign-out:** mute "meal delivered" in Alerts, deliver a meal → no pop-up (still listed in Alerts). Sign out in the web app, send an alert | No pop-up after sign-out (this browser was unsubscribed) |
| O5 | **Owner and staff on iPhone:** add the owner and staff sites to the Home Screen | Green "AK Owner" and blue "AK Staff" icons, full screen, alerts can be turned on |
| O6 | **Voice notes across devices:** record a voice note in iPhone Safari (customer web app); play it on the owner's Android phone; send one back from the Android owner app; play it on the iPhone | Both play. (A note recorded in desktop Chrome is WebM; check it plays on the iPhone too. If not, record from the phone apps) |
| O7 | **Paying on iPhone:** customer web app on iPhone › Pay | No "Open UPI app" button (Safari can't open it); the tip and "Copy UPI ID" are shown; paying to the UPI ID in Google Pay/PhonePe works |
| O8 | **Typing on iPhone:** any long form (owner Add customer on iPhone web, or a native build) | The field you tap scrolls above the keyboard |
| O9 | **Code autofill:** sign in on iPhone | The keyboard offers the 6-digit code from Mail |
| O10 | **Staff app in iPhone Safari:** scan a box sticker and take a delivery photo | If the scanner doesn't open in Safari, type the box code; the photo uses the iPhone camera. (Scanning in the browser couldn't be checked here) |
| O11 | **Native iPhone builds (only if you join Apple's programme):** `npx eas-cli@latest build --platform ios --profile production` → TestFlight | Install from TestFlight; each permission prompt shows our text; Face ID unlock (owner; customer if turned on); push alerts arrive |

## P. Phase 8b (languages, join requests, store review) on Supabase and phones

Why not done here: needs your Supabase project, real sign-ins and fluent readers. Here: 7 new tests; a test that fails if any customer text lacks a translation; the app checked in Chrome set to Marathi and Hindi.

Setup: [SETUP_PERSONAL_LAPTOP.md](SETUP_PERSONAL_LAPTOP.md) step **18**.

| # | Test | Expected |
|---|---|---|
| P1 | `npx supabase db push`; `verify_live.sql` | No problem rows |
| P2 | **Languages:** set a phone to Marathi, install the customer app; then switch to Hindi in Me › Language | Opens in Marathi; every screen (Today, My meals, Bills, Alerts, Me, pay, location, chat, errors) in Marathi, then Hindi after switching; dates like "मंगळ, 1 डिसें". Ask a fluent reader to note anything that sounds odd (F45) |
| P3 | **Request to join:** Business settings › Sign-up = Requests; set `EXPO_PUBLIC_KITCHEN_ID`; sign in with a new email in the customer app → "No code? Ask to join" → send | You get "New request to join"; More › Join requests › Approve → they're a customer and can choose meals at once. Decline → they're told politely. Sign-up back to "Invite code only" → the form disappears |
| P4 | **Store review login** (step 18.2): sign in on the customer app's first screen with "App store reviewer? Sign in with a password" | The Demo Kitchen's menu and lunches appear; nothing from your real kitchen. After `end_review_demo` the reviewer sees nothing |
| P5 | *(Only with the optional paid Play listing)* **Store listing** (`docs/STORE_LISTING.md`) pasted into Play Console in all three languages | Listing preview shows the right language per phone setting |

## Q. Phase 8c (languages for staff and alerts, loyalty, launch checks) on Supabase and phones

Why not done here: needs your Supabase projects, phones and new builds. Here: 9 new database tests (alert texts in every language, loyalty, the whole attack pass), the restore drill run end to end on a local Postgres, the phone-width check of all three web apps, and the Face ID settings check.

Setup: [SETUP_PERSONAL_LAPTOP.md](SETUP_PERSONAL_LAPTOP.md) step **19**.

| # | Test | Expected |
|---|---|---|
| Q1 | `npx supabase db push` (staging, then production); `verify_live.sql` | No problem rows |
| Q2 | **Staff app in Marathi:** staff sign-in screen › Language › मराठी; then Me › Language › हिन्दी | Today, Boxes, Alerts and Me in Marathi, then Hindi; dates like "रवि, 22 नोव्हें"; the choice stays after closing the app |
| Q3 | **Alerts in the customer's language:** customer app › Me › Language › मराठी; you mark their lunch delivered | The phone alert arrives in Marathi ("दुपारचे जेवण पोहोचले"). Switch to Hindi → the next alert is Hindi. Your own alerts stay English |
| Q4 | **Alerts for staff and messages:** staff app in Hindi; assign them a route. Send an announcement and a chat message to a Marathi customer | Staff get "route ready" in Hindi. The announcement and chat arrive exactly as you typed them (never translated) |
| Q5 | **Loyalty progress:** More › Loyalty on (e.g. every 10 meals, "free sweet dish") | Customer › Bills shows "N more meals to your next reward: free sweet dish" and "x of 10 meals done"; your customer page shows a Loyalty card. Turn loyalty off → both disappear |
| Q6 | **Expense links (F40):** on the owner phone open `akowner://money/expense?amount=50000&note=test` (e.g. tap it in a note to yourself) | The Add expense form opens **empty**. Money › Expenses › Quick add "500 vegetables" › Next still opens the form filled in |
| Q7 | **Staff build has no Face ID / fingerprint (F42):** new staff APK; on the phone, Settings › Apps › AK Staff › Permissions (and the iPhone build's settings if you build for iPhone) | No biometric/fingerprint permission; no Face ID line. Owner and customer builds still have theirs |
| Q8 | **Attack pass on staging** (step 19.3) | Every line PASS, exit code 0 |
| Q9 | **Restore drill on staging** (step 19.4) | "PASS: every table on staging matches the backup row for row"; verify_live shows no problem rows |
| Q10 | **Switches:** any on/off setting (customer Alerts, owner Business settings) on Android, iPhone and the web | Tapping the label text also flips the switch; TalkBack/VoiceOver reads "label, switch, on/off" once; on a computer, Tab reaches it and Space/Enter flip it |
| Q11 | **Customer app in Marathi, My meals and a meal's page** | "दुपारचे जेवण · <tiffin name>"; leave periods say "दुपारचे जेवण"/"दुपारचे व रात्रीचे जेवण" and "किचनने ठरवले"; no English words inside Marathi sentences |
| Q12 | **Owner app in Marathi:** owner sign-in screen › Language › मराठी (or More › Language) | Today, Customers, Menu, Money, More and every screen inside them in Marathi; dates like "रवि, 22 नोव्हें"; switch to हिन्दी and back to English |
| Q13 | **Your alerts in Marathi:** with the owner app in Marathi, have a customer report a UPI payment and send you a message | "Anil यांनी ₹500 भरले" / "UPI संदर्भ … पैसे मध्ये पक्के करा."; the chat title is Marathi, the customer's words exactly as typed |
| Q14 | **Suggestions in Marathi:** Money › Suggestions (after a few weeks of use) | Each suggestion in Marathi, with your item names and amounts kept |
| Q15 | **Shared messages:** with the owner app in Marathi, create an invite code › Share, and share a shopping list | The WhatsApp text is in Marathi with the code / items in it. Switch the app to English to send an English one |
| Q16 | **Voice note alert:** with the customer app in Marathi, send that customer a voice note | The alert reads "किचनकडून व्हॉइस नोट" / "ऐकण्यासाठी 'किचनला संदेश पाठवा' उघडा." |
| Q17 | **Quick add in Marathi/Hindi:** Money › Expenses › Quick add: type or say (keyboard mic set to मराठी) "500 भाजी रमेशकडून"; then "रमेश से 500 की सब्ज़ी"; then "२ किलो कांदे ८०" | The form opens with ₹500 · Vegetables · shop रमेश; the same for the Hindi line; the third gives ₹80 · Vegetables (the 2 किलो is not the amount) |
| Q18 | **PDFs in Marathi:** owner app in Marathi › a customer › Statement › Share PDF; Money › Reports › Report as PDF; customer app in Marathi › Bills › statement PDF | All labels and dates in Marathi, Devanagari letters clear (no empty boxes) on the phone and when opened on a computer |
| Q19 | **Google sign-in, web:** after step 20, customer web app › Continue with Google | Google's page, then back in the app. A new Gmail lands on "Enter your invite code"; a Gmail that already signed in by email code opens the same account |
| Q20 | **Google sign-in on phones:** Android APK (all three apps) and iPhone web app | The Google sheet opens and closes by itself; signed in. Owner: the authenticator code is still asked |
| Q21 | **Email codes still work** (all three apps, after this build) | Sign in by email code as before |

## Quick "is everything still OK?" routine (after any change)

1. `npm test`: all green.
2. `npm run typecheck`: no errors.
3. Push → GitHub Actions `ci` green.
4. After a database change: `npx supabase db push` to **staging** → run `verify_live.sql` → test the changed screen → then production.
