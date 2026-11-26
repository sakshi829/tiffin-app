# Status

_Last updated: 26 Nov 2026 (Phase 8e: Quick add and PDFs in Marathi/Hindi, Google sign-in)_

| Phase | State |
|---|---|
| 0 Setup (code side) | ✅ Done |
| 1 Database + security | ✅ Done |
| 2 Owner app | ✅ Code complete. **Needs trying on your Supabase + phone** (PENDING section E) |
| 3 Customer app | ✅ Code complete. **Needs trying on your Supabase + phone** (PENDING section G) |
| 3b Staff app | ✅ Code complete. **Needs trying on your Supabase + phone** (PENDING section H) |
| 4 Notifications | ✅ Code complete. **Needs your Supabase + Expo/Firebase setup + phones** (Setup step 11, PENDING section I) |
| 5a Billing jobs, announcements, auto-assignment, referrals, chat | ✅ Code complete. **Needs your Supabase** (PENDING section J) |
| 5b Files & camera: UPI QR image, proof photos, voice notes, QR stickers, bill PDF, special menus | ✅ Code complete. **Needs your buckets (Setup step 13), new development builds and phones** (PENDING section K) |
| 6 Expenses, investments, reports, suggestions, loyalty | ✅ Code complete. **Needs your Supabase (receipts bucket, Setup step 14) + a phone** (PENDING section L) |
| 7a Hardening: security review + fixes, performance, accessibility, web security, privacy, account deletion | ✅ Code complete. **Needs your Supabase, Cloudflare and phones** (Setup step 15, PENDING section M) |
| 7b Launch prep: push receipts, new sign-in alert, live chat, customer app lock, owner screen privacy, error reports, clean-up, heatmap, build profiles | ✅ Code complete. **Needs your Supabase, new builds, Sentry (optional) and the Play closed test** (Setup steps 15–16, PENDING sections M–N) |
| 8a iPhone: web app alerts (web push), installable owner/staff web apps, native iPhone builds ready | ✅ Code complete. **Needs your VAPID keys, hosting and an iPhone** (Setup step 17, PENDING section O). Native App Store builds need Apple's $99/year programme (your decision) |
| 8b Customer app in Marathi + Hindi, "request to join", store-review demo login, store listing | ✅ Code complete. **Needs a fluent reader to check the translations, and your Supabase** (Setup step 18, PENDING section P) |
| 8c Staff app + alert texts in Marathi/Hindi, loyalty progress, small fixes (F40, F42), automated attack pass + restore drill, phone-width check | ✅ Code complete. **Needs your Supabase (staging + production) and new builds** (Setup step 19, PENDING section Q) |
| 8d Owner app in Marathi/Hindi, with your alerts and Money › Suggestions in your language; link checking between screens | ✅ Code complete. **Needs a fluent reader and your Supabase** (Setup step 19, PENDING Q12–Q16) |
| 8e Quick add understands Marathi/Hindi, PDFs in Marathi/Hindi, "Continue with Google" | ✅ Code complete. **Google needs a free Google Cloud login + Supabase setting** (Setup step 20, PENDING Q17–Q21) |
| Bigger features (corporate billing, one-off orders, more branches) | ⏸ Parked until you need them (your decision, 26 Nov) |

Tests: **256 passing** (49 shared + 207 database/functions). All 5 workspaces and both Edge Functions typecheck. All three apps bundle for web and start correctly in a browser; app configs are valid.

**Everything that still needs your accounts or a real phone, with test steps:** [PENDING_AND_TESTING.md](PENDING_AND_TESTING.md).

## Done

### Phase 0: Setup (code side)
- Monorepo (npm workspaces): `apps/owner`, `apps/customer`, `apps/staff` (Expo SDK 58, Expo Router, TS strict), `packages/shared`.
- App identities: `com.amrutaskitchen.owner`, `com.amrutaskitchen.app` (customer), `com.amrutaskitchen.staff`.
  **These IDs are permanent once published on Play Store.** Change them before the first upload if you prefer others.
- Android `allowBackup: false` (login tokens are not copied into phone backups).
- `.gitignore` blocks env files, keys, keystores, backups. `.env.example` has placeholders only.
- CI: typecheck, tests, `npm audit` (high+), gitleaks secret scan, Semgrep static analysis.
- Nightly encrypted backup workflow (needs secrets, see setup guide).
- Dependabot (npm + GitHub Actions), gitleaks pre-commit hook.
- Template demo screens replaced by placeholder screens.

### Phase 1: Database + security foundation
Migrations in `supabase/migrations` (applied in order):

| File | Contents |
|---|---|
| 0100 foundation | locked-down default privileges, private `app` schema, server clock, kitchens, settings, staff, immutable audit log, MFA/step-up helpers |
| 0200 people & locations | places → location tree (with staff directions), companies, customers, invites (hashed), devices, rate limits |
| 0300 menu | items, tiffin types built from items, price history (past prices immutable), customer price overrides, daily menu, packing instructions, server-side price resolution |
| 0400 service & orders | meal slots + cutoffs (relative/fixed) + one-day overrides, closures, subscriptions, leave ranges, orders, add-ons, boxes, box movements, order generation |
| 0500 money | append-only ledger, payments (UTR uniqueness, idempotency), immutable bills, expenses/investments, charging logic (delivery, late skip, reversals) |
| 0600 customer functions | location, skip/unskip, leave ranges, extras, box kept, UPI payment submission, invite redemption with lockout, devices |
| 0700 staff functions | role-based task list (no prices; phone only if enabled), delivered / not delivered, box collected |
| 0800 owner functions | invites, staff, prices (+ re-pricing), overrides, subscriptions, closures, order corrections, assignment, payments, waivers, bills, settings, bootstrap |
| 0900 security | RLS on every table, read policies per role, column-limited owner writes, function grants |
| 1000 scheduled jobs | nightly + morning order generation, rate-limit cleanup (pg_cron, only where available) |

**Tests at the end of Phase 1: 93 passing** (5 shared + 88 database); 114 after Phase 2. They cover:
structure (RLS everywhere, no anon access, minimal grants, pinned search_path, private-by-default future objects) ·
access matrix for every role and both kitchens · direct-write, IDOR, privilege-escalation, step-up and tampering attacks ·
cutoffs and late-skip charging · order generation, closures, pause, price changes · ledger/payments/bills ·
invites and brute-force lockout · staff task visibility · audit trail.

### Phase 2: Owner app (code complete, **not yet tried against a real Supabase project**)

**Sign-in and security**
- Email + 6-digit code (no passwords; `shouldCreateUser: false`, so the owner app never creates accounts).
- Mandatory authenticator app (TOTP): first-time setup screen (open-in-app link, copy key, QR on web), code on every sign-in.
- **Step-up prompt:** when the database answers `STEP_UP_REQUIRED` (prices, staff, waivers, settings, unlinking), the app asks for a fresh authenticator code and retries once.
- **App lock:** fingerprint / face / phone PIN after 2 minutes in the background and on launch with a saved session. It covers the app, so you return to the same screen.
- Session stored encrypted on phones (AES key in the device keystore, Supabase's Expo pattern); browser storage on web.
- Separate screens for "not an owner", "can't connect" (retry without a new code) and "not configured".
- All cached data is cleared whenever the app is not in the signed-in state.

**Screens**

| Tab | What you can do |
|---|---|
| **Today** | Yesterday / today / tomorrow, lunch / dinner, timings and cutoffs. **Kitchen:** totals by tiffin type, veg / non-veg, extras, status counts. **Packing:** per customer with extras and food notes. **Delivery:** grouped by place › ward with assign-all-to-staff, and per order: delivered / not delivered (reason) / skip (no charge) / back, call, WhatsApp. Plus "check orders now". |
| **Customers** | Search, filter by status, dues/advance badges, add/edit customer (phone, email, food notes, usual place, billing mode, joined date, free late skips), status (active / paused / stopped / archived), **invite code** (shown once; share / WhatsApp / copy), unlink login (step-up), meal plans (lunch/dinner, tiffin, dates, days, daily extras, place, status), record payment (cash / UPI / bank, idempotent), statement for any dates with running balance, share or WhatsApp it, save as bill, corrections (waive / discount / adjustment; step-up, note required). |
| **Menu** | Items & extras (main/extra, veg, unit, customer can request, max per meal, available) with price history and future-dated prices (step-up); **tiffin type builder** (items + quantities, fixed price or sum of items); today's menu text for customers. |
| **Money** | UPI payments to confirm / reject (with reason), total dues, advance held, dues list. |
| **More** | Business & rules (name, UPI ID, late skips, late-skip %, days ahead, late fee, low-advance warning, who can join; step-up); meal timings (delivery time, cutoff minutes or fixed time, location cutoff, on/off; protected against two people saving at once); one-day timing changes; days off (whole day / one meal) with undo; locations (places › wards / labs / desks with staff directions); staff (invite with role, role / phone access / active; step-up); lock now; sign out. |

**New database pieces (with tests)**
- `1100_owner_reports.sql`: `owner_day_orders`, `owner_customer_balances`, `owner_customer_statement` (owner + MFA only; joins done and tested in SQL).
- Step-up now accepts `totp` and `mfa/totp` AMR names and fails closed on any other shape (6 new attack cases).
- **API contract** (`packages/shared/src/api-contract.ts`): every function, parameter and column the app uses is checked against the schema in CI. The app also refuses to send arguments that don't match.
- Every error code the database can raise has a user-friendly message (checked by a test).

**How it was verified here**
- 114 automated tests pass (19 shared + 95 database), and every workspace typechecks.
- The owner app **bundles for web** (Metro), and the built app was **loaded in headless Chrome**: it starts, finds no session and shows the sign-in screen correctly.

**Not verified yet (needs your Supabase project and an Android phone)**
- Signed-in screens against a real backend, the email code, authenticator setup, fingerprint lock and phone storage.
  Use the acceptance checklist in `docs/SETUP_PERSONAL_LAPTOP.md` step 10.

**Phase 2 limits (by design, later phases)**
- Owner sign-in is email-code only. Google sign-in comes with the customer app (Phase 3).
- No per-customer special price screen yet: the database supports it (`owner_set_price_override`), the UI comes in Phase 5.
- The location cutoff can be set in minutes only (the database also supports a fixed time).
- One kitchen per owner account (multi-kitchen is ready in the database, not in the app).
- Tabs have text labels only (no icons yet).

### Phase 3: Customer app (code complete, **not yet tried against a real Supabase project**)

**Joining (invite only)**
- Email + 6-digit code. A new email gets a login, but it **sees nothing** until an invite code is redeemed (database-enforced).
- Invite code screen. A **staff** code typed here is refused **without being used up** (new `redeem_invite(p_code, p_expected_kind)`).
- The kitchen's rules are shown and accepted once: live meal times and cutoffs, the late-skip rule, the late fee (if on) and privacy.

**Screens**

| Tab / screen | What customers can do |
|---|---|
| **Today** | Greeting; paused banner; next day off; today's and tomorrow's meals with tiffin, extras, today's menu, delivery time, **live countdown to the cutoff**, "where are you today" warning; balance; leave shortcut |
| **Meal card actions** | Where I am · Extras · Skip (**5-second Undo**) · after the cutoff "Can't take it" with a clear charge warning · "I want it back" before the cutoff · Where's the box (after delivery) |
| **Meal details** | Add/remove extras with **server-priced** steppers (their own special price applies), price breakdown, "where I kept the box" |
| **Location picker** | Same as yesterday · recent places · forgiving search of the kitchen's list ("ward5" finds "Ward 5") · own description (keyboard mic tip) · "also for my dinner today" |
| **My meals** | Next 7 days with status and menu, leave list (cancel own leave), kitchen days off |
| **Leave** | Pause lunch / dinner / both for a date range |
| **Bills** | Balance (to pay / advance), payments with status (Checking / Received / Not received + reason), last 60 days of entries |
| **Pay by UPI** | Amount pre-filled with dues, copy UPI ID, **open UPI app** with amount + note, then send the UTR (idempotent) |
| **Me** | Details, edit own food notes, sign out, **sign out on all devices** |

**New database pieces (with tests)**
- `1200_customer_views.sql`: `customer_my_orders` (own meals with **server-computed cutoff times**), `customer_addon_menu` (extras priced for this customer and date), `customer_update_food_notes` (rate-limited, audited), `redeem_invite` v2 (expected kind).
- `12-customer-views.test.mjs` (6 tests): own data only, cutoffs match, priced extras, wrong-app code not consumed, notes validated and audited.

**Shared code**
- New `packages/app-core`: one copy of the encrypted-session Supabase client, the safe API wrapper and the UI kit, used by all apps (the owner app now uses it too).
- `packages/shared/src/customer.ts`: allowed actions per meal (same rules as the database), countdowns, India clock, UPI pay link, forgiving search. All tested.

**Phase 3 limits (see PENDING section F)**
- Google sign-in (F1) and the voice button (F2) are deferred; email code sign-in and the keyboard microphone work now.
- No kitchen phone/WhatsApp button yet (F12), no customer fingerprint lock (F13), iPhone home-screen polish (F14).
- Notifications (delivered, reminders) come with Phase 4.

### Phase 3b: Staff app (code complete, **not yet tried against a real Supabase project**)

**Joining:** email code → **staff** invite code (a customer code here is refused and not used up). Separate screens for "access removed" and "this is the owner account". All staff data is cleared from the phone on sign-out.

**Tabs follow the role the owner gave:** kitchen staff see Work (packing) + Me; delivery staff see Work (route) + Boxes + Me; "both" can switch between packing and delivery.

| Screen | What staff can do |
|---|---|
| **Work › Packing** | Today/tomorrow, lunch/dinner. Totals by tiffin type and extras, **your packing instructions** per tiffin type, per-person list with food notes, **read aloud**. No prices anywhere |
| **Work › Delivery** | Today's deliveries **assigned to them only**, grouped by place with your **directions**, the customer's own location note, food notes, Call (only if you allowed phone numbers), **Delivered** / **Not found (reason)**, "x of y left", read aloud |
| **Works without signal** | Taps are saved on the phone ("1 update waiting for signal") and sent automatically (app resume, every 30 s, "Send now"). Rules are still checked by the database when they arrive; refused ones are shown with the reason |
| **Boxes** | Empty boxes from their last 7 days of deliveries: where the customer said they left it, days out, Collected (optional sticker code) |
| **Me** | Role, phone-access info, **check in / check out**, sign out (warns about unsent updates), sign out on all devices |

**Owner app additions:** packing instructions on each tiffin type; **More › Boxes not back** (with Collected); Staff screen shows who is on shift.

**New database pieces (with tests)**
- `1300_staff_shifts_boxes.sql`: `staff_shifts` table (RLS: own / owner; no deletes; one open shift per person; closed automatically when the owner turns someone off), `staff_check_in` / `staff_check_out` (idempotent), `staff_box_pickups`, `owner_boxes_out`, `owner_box_collected`.
- `13-staff-shifts-boxes.test.mjs` (4 tests). The existing blanket tests automatically cover the new table (no anon access, strangers see nothing).
- `packages/shared/src/offline-queue.ts` + 3 unit tests (latest decision per meal wins, stops when offline, refused actions reported).

**Phase 3b limits:** QR camera scanning (F18), delivery proof photos (F19), attendance report (F20), automatic assignment by place (F21). See PENDING section F.

### Phase 4: Notifications (code complete, **needs your accounts and phones**)

**How it works:** every event writes an **alert to the person's inbox** (in the database, raised by triggers, so it happens no matter which app or job caused the event). A small server program (`send-push` Edge Function), run every minute, sends pending alerts to phones through Expo. If phone delivery isn't set up or fails, the alert is still in the app.

| Who | Alerts |
|---|---|
| **Customer** | Meal delivered · kitchen closed (one message per day off, not per meal) · kitchen open again · "where are you today?" (30 min before the location cutoff, only if no place is set) · payment received / not found (with reason) · bill ready · announcements |
| **Staff** | Route ready (once per meal, not per customer) · customer moved after the route was planned · customer skipped late · announcements (if you include staff) |
| **Owner** | Customer reported a UPI payment · customer skipped after the cutoff · **final count after each cutoff** (tiffins, veg/non-veg, extras) |

- **Alerts screen** in every app (customer and staff: tab with an unread badge; owner: More › Alerts, badge on More): list, mark all read, turn on phone alerts, **choose which alerts go to the phone** (days off, payments, bills and announcements always do).
- **Send announcement** (owner, More): to all customers, optionally staff; rate-limited.
- Phones register on entering an app and **unregister on sign-out**; dead phone tokens are removed automatically.
- Housekeeping: stuck sends retried, unsent pushes given up after a day, inbox kept 60 days.

**New pieces**
- `1400_notifications.sql`: `notifications` + `notification_prefs` (own rows only), event triggers, `run_notification_jobs` (every 5 min), `mark_notifications_read`, `set_notification_prefs`, `owner_send_announcement`, and the sender API `push_claim` / `push_complete` (**service role only**; checked by tests and `verify_live.sql`).
- `supabase/functions/send-push`: the sender (needs the `x-cron-secret` header; counts-only logs) + `_shared/push.ts` (pure logic, unit-tested).
- `packages/app-core`: `push.ts` (permission, Android channel, token, register/unregister, tap → Alerts) and `inbox.tsx` (Alerts screen used by all apps).
- Tests: `14-notifications.test.mjs` (12), `15-push-logic.test.mjs` (4); the structural tests now also ensure the sender API and internal notify functions can't be called by app users.

**Limits (PENDING section F):** no web/iPhone pop-ups yet (F5), push receipts (F22), scheduled announcements (F23), new-login alert (F24), low-balance and late-fee warnings (F25, Phase 5).

### Phase 5a: Billing jobs, announcements, auto-assignment, referrals, chat (code complete, **needs your Supabase**)

| Feature | What it does |
|---|---|
| **Late-payment fee** (decision 11) | Flat ₹ or % of what's still unpaid; per-customer exempt/custom. **Only for bills made after you switch it on** (never retroactive), **at most once per bill**, the day after the due date. Shown as a "Late fee" line; you can waive it (Statement › Correction) |
| **Due reminder** | 2 days before a bill is due, if anything is still unpaid ("A late fee applies after that date" when relevant) |
| **Low advance alert** | Advance customers with an active plan, below your warning amount: once a day |
| **Bills for last month** | Money › one tap: a bill for every customer with activity or a balance; skips bills that exist; each customer is told |
| **Kitchen phone** | Your number in Business & rules → customers get Call / WhatsApp buttons (Me) |
| **Scheduled announcements** | Send now or at a chosen date/time; list and cancel scheduled ones |
| **Auto-assignment by place** | Locations › place › "Delivered by": unassigned meals there are given to that person every 5 min (today and tomorrow). Never overrides your manual choice |
| **Refer a friend** | Customer › Me › Refer a friend → you get an alert → More › Referrals → "Add as customer" (then invite them) → the referrer is thanked |
| **Chat** | Customer › Me › Message the kitchen ↔ More › Chats with customers / customer page › Message. Alerts both ways, unread counts, "Seen". Customer ↔ owner only; messages can't be deleted |

**New pieces:** `1500_billing_jobs.sql` (contact phone, `late_fee_since`, `bill_late_fees`, `run_billing_jobs` daily 10:00 IST, `owner_generate_month_bills`, 6 new alert kinds), `1600_engagement.sql` (`announcements` + `run_engagement_jobs` every 5 min, `place_delivery_staff` + `auto_assign`, `referral_requests`, `chat_messages`), `app-core/chat.tsx`. Tests `16-billing-jobs` (6) and `17-engagement` (4); the blanket tests automatically cover the 5 new tables.

### Phase 5b: Files, voice notes, QR stickers, specials, PDF (code complete, **needs your buckets + phones**)

| Feature | Who | What it does |
|---|---|---|
| **UPI QR picture** | Owner → customers | Upload your business QR (Business & rules); customers see it on Pay by UPI |
| **Payment screenshot** | Customer → owner | Optional, after sending the UTR; you see it in Money › To confirm |
| **Delivery photo** | Staff → customer | Optional, one per meal; the customer sees it on the meal; deleted after 30 days |
| **Voice notes in chat** | Both ways | Up to 30 s; play in the chat; deleted after 30 days |
| **QR box stickers** | Owner, staff | Make numbered codes + print a sticker sheet; kitchen staff scan the box while packing (box → customer); delivery staff scan it when collecting ("Priya's box collected") |
| **Special menus** | Owner → customers | A special tiffin type (fixed price) offered on a date with an order deadline and optional maximum; customers order with one tap; it becomes a normal meal (lists, delivery, skip rules, billing) |
| **Bill / statement PDF** | Owner, customer | Share as PDF (WhatsApp, Drive); on the laptop web version the print dialog opens ("Save as PDF") |

**Security of files (tested):**
- 4 **private** buckets, with every path inside the kitchen (and customer) id.
- Customers see only their own files; staff can upload only for meals assigned to them; other kitchens see nothing.
- **No overwrites**: there is no update rule. Only the owner can delete, and only kitchen media.
- Only images, or only audio, per bucket; strict file names (blocks path tricks and wrong types).
- Files are shown through 5-minute links.
- Retention runs through the Storage API (an Edge Function), because deleting rows in SQL would leave files billed.
- Photos are shrunk to 1280 px JPEG before upload (typically 150–300 KB; this also removes the photo's location data).

**New pieces**
- `1700_media_specials_boxes.sql`:
  - storage access rules and helpers
  - `delivery_proofs` table
  - attach functions: `staff_attach_proof`, `customer_attach_payment_proof`, `customer_send_voice` / `owner_send_voice`
  - `staff_proof_path`
  - `media_expired` (service only)
  - special menus: `tiffin_types.is_special`, `special_menus`, `owner_save_special`, `customer_special_menus`, `customer_order_special`
  - boxes: `owner_create_boxes`, `staff_box_issued`, `staff_box_scan_collect`
  - path constraints on stored photo paths
- `supabase/functions/media-retention` + `_shared/retention.ts`.
- `app-core`: `media.tsx` (pick, shrink, upload, private image), `voice.tsx` (record ≤30 s, play), `pdf.ts`.
- `shared/html.ts`: statement and sticker sheet, with escaped values.
- Staff `ScanBox` (camera).
- Permission messages in each `app.json`.
- Tests: `18-media-specials-boxes` (8), `19-retention-logic` (1), `html.test` (3); the test stand-in now includes Supabase Storage tables.

**Limits:** tidying references after files expire (F32). F30 and F31 were built in Phase 6.

### Phase 6: Expenses, reports, suggestions, loyalty (code complete, **needs your Supabase + a phone**)

| Feature | Where | What it does |
|---|---|---|
| **Expenses & investments** | Money › Add expense / Expenses | Amount, category, date, paid to, cash/UPI/bank/card, note, optional staff member (salary/advance), **receipt photo**. Investments (boxes, mixer) kept apart from running costs. Entries are never deleted: "Remove" hides them and keeps history |
| **Quick add** | Money › Expenses | Type or dictate (keyboard mic) "500 vegetables from Ramesh" → the form opens filled in → you confirm |
| **Regular expenses** | Money › Regular expenses | Rent, gas, salaries: weekly/monthly, an alert on the due day, "Record payment" adds it and moves the due date (rent on the 5th stays on the 5th) |
| **Categories & budgets** | Money › Categories & budgets | Your own categories; a monthly budget each; "Over" when exceeded |
| **Ingredients & shopping list** | Menu › Ingredients; Today › Prep & shopping list | How much atta/oil/eggs goes into one item → total to cook and to buy for today/tomorrow, from meals not skipped (incl. extras); share the list on WhatsApp |
| **Leftovers** | Today › Prep & shopping list | Note extra tiffins per meal |
| **Reports** | Money › Reports | This month / last month / 3 months / any dates: billed, received, running costs, profit, cost and price per meal, waste, spending by category vs budget, by tiffin type, how much of your investments is paid back, meals per day (chart + list), staff attendance (shifts, hours). **PDF report** and **spreadsheet (CSV)** |
| **Suggestions** | Money tab (top 3), Money › All suggestions | 9 rules with the numbers shown: a category growing faster than meals, cost per meal rising, a weekday/meal often skipped, much leftover food, no payment for 30+ days, over budget, boxes out 5+ days, customers ordering much less, investment payback |
| **Loyalty reward** | More › Loyalty reward | Off by default. Every N delivered meals → a discount on the bill + a thank-you alert, once per milestone. Saving needs your authenticator code |
| **Delivery photo for you** (F30) | Today › Delivery › tap a delivered meal | See the photo staff took |
| **Directions & packing photos** (F31) | More › Locations › spot › Photo; Menu › tiffin type | Staff see them on the route / packing list (loaded only when tapped, to save data) |

**Security (tested):**
- All new tables and reports are **owner-only**. Staff, customers and other kitchens see nothing and cannot call the report functions.
- Receipts are in a 5th private bucket that only the owner can read or write. Files must be `<kitchen>/<uuid>.jpg`, and an expense can only point at a receipt in its own kitchen's folder.
- Receipts are **never** removed by the 30-day clean-up (tested).
- Loyalty rewards can't be edited or deleted. Each milestone pays once, even if a meal is re-marked. Rules are changed only through a function that needs a recent authenticator code.
- Spreadsheet exports neutralise formulas (a name like `=HYPERLINK(...)` can't run in Excel). PDF values are escaped.

**New pieces**
- `1800_finance_insights.sql`:
  - receipts bucket rules
  - tables: `recurring_expenses`, `budgets`, `ingredients`, `item_ingredients`, `waste_entries`, `loyalty_rules`, `loyalty_rewards`
  - functions: `owner_record_recurring`, `owner_set_loyalty`, `owner_prep_totals`, `owner_profit_loss`, `owner_daily_series`, `owner_attendance`, `owner_insights`
  - loyalty trigger on delivery
  - `run_finance_jobs` (daily 08:30 IST: due reminders)
  - `staff_my_tasks` now also returns the directions photo
  - 2 new alert kinds
- `shared/finance.ts`: quick-expense parser, safe CSV, report HTML.
- `app-core/csv.ts` (share a CSV); `chartBar` colour, checked for chart contrast in light and dark.
- Owner screens: `money/expenses`, `money/expense`, `money/recurring`, `money/categories`, `money/reports`, `money/insights`, `today/prep`, `menu/ingredients`, `settings/loyalty`. The Today, Money, Menu, tiffin, locations and More screens were updated.
- Staff app: shows the photos.
- Tests: `20-finance` (13), `21-insights` (3), `finance.test` (4).

**Limits:** voice entry still uses the phone keyboard's microphone (F2). Suggestions are rules, not AI. Budgets are monthly only. A receipt photo picked and then not saved stays in storage (owner-only, small; F33). The weekday heatmap from PLAN.md is deferred (F36); the skip-pattern suggestion covers its purpose.

### Phase 7a: Hardening (code complete, **needs your Supabase, Cloudflare and phones**)

**Security review.** Three independent reviewers attacked the code: the first half of the database, the second half, and the apps + Edge Functions + CI. Each finding was reproduced, fixed, and is now a test (`22-hardening`, 18 tests). Nothing critical was found.

| Severity | Finding | Fix |
|---|---|---|
| **High** | The daily late-fee job could charge a bill that was **paid on time** once new meals were charged; charged while a UPI payment made by the due date was still waiting for you; and charged fees on earlier fees | Each bill's fee is now decided **once**, from what was unpaid **on the due date**, only on that bill's own charges, after pending payments are settled; capped at 100 % and never more than the unpaid amount |
| **High** | Owner app: opening it **offline** with an old session skipped the fingerprint lock (it looked "signed out", which cleared the lock) | Offline now shows the "offline, retry" screen; the lock clears **only** after a real sign-in code, authenticator code or the phone's fingerprint/PIN |
| Medium | Money-affecting edits made directly on tables skipped the authenticator step-up: tiffin pricing mode and contents, archiving a customer, late-fee/late-skip overrides, undoing a delivered meal | Database rules now ask for the authenticator code for exactly these; tiffin contents are saved in one all-or-nothing call |
| Medium | A per-customer % late fee had no cap (₹8,00,000 on an ₹80 bill in the test) | Capped at 100 % and at the unpaid amount; setting it needs step-up |
| Medium | One customer could add unlimited rows (saved places, skips, extras, box notes) or files | Per-person limits per hour/day; only the newest 20 saved places kept; max 150 uploads/day (owner 500) |
| Medium | "Sign out" / "Sign out on all my devices" could silently fail offline, and lost phones kept getting alerts | This phone is always signed out; "all devices" also removes the person's other phones from alerts, and says so honestly if the server couldn't be reached |
| Medium | Staff app: an offline restart wiped unsent deliveries | Kept; cleared only on an explicit sign-out or when a **different** person signs in |
| Medium | Phones with only a PIN/pattern got no owner app lock | Any screen lock counts |
| Low | Cancelling a closure brought back meals the customer had skipped | Each meal returns to exactly what it was |
| Low | Staff could mark a meal delivered before the customer's free-skip cutoff (charging it early) | Refused until the extras cutoff ("Too early…") |
| Low | "This UTR is already used" let customers probe UTRs or block a real payer | Repeated UTRs are accepted and **flagged** for you ("Same UTR as 1 other payment"); only one can ever be confirmed |
| Low | Unassigned delivery staff could scan box codes before delivery to learn names | Boxes can be collected only after delivery; scans rate-limited; only packing staff record boxes going out |
| Low | Invite code hashes copied into the permanent audit log; two late skips at once could both be free; odd UUID spellings in file paths; unchecked file-path columns; other customers could see a "home" place | All fixed |
| Low (apps/CI) | Unpinned Supabase library in the Edge Functions; checkout kept the CI token; backups included live login sessions; extra Android permissions | Pinned to 2.119.2; `persist-credentials: false`; sessions/refresh tokens excluded from backups; overlay + write-storage permissions blocked, background audio off |

**Performance** (one busy year simulated: 120 customers, 66,803 meals, 81,496 ledger lines, 120,085 box records, timed on in-process Postgres, which is slower than Supabase):
- Found: a customer reading their own ledger took **4,089 ms**, "my orders" 462 ms, "boxes out" 265 ms: the row-security rules called a function for every row.
- Fixed: the rules now work out "which kitchens do I own / which customer am I" once per request; box movements got two indexes. Now **14 ms**, **9 ms**, **28 ms**. Every screen measured is under 150 ms; nightly jobs under 1 s.
- Database size: about **79 MB per year** at this volume, so the free 500 MB lasts about 6 years.

**Accessibility:** every colour pair the screens use is now checked by a unit test (WCAG: text 4.5:1, field outlines and marks 3:1). Text fields got a visible outline (it was 1.3:1). Small buttons/chips have a 48 px touch area; − / + buttons, the quantity, the veg mark, photos, the loading spinner and voice buttons have spoken names; the lock screen hides the app from screen readers on iPhone too.

**Web security:** `scripts/web-headers.mjs` writes Cloudflare headers for each web build: a strict Content-Security-Policy allowing **only your own Supabase project** (no wildcard), no framing, no referrer, HSTS, nosniff, camera/mic only for this site. Tested: both web apps load and work with it in Chrome with **zero** policy violations.

**Install & stores:** customer web app is installable (manifest, icons, iPhone tags). New original icons for the three apps (tiffin carrier; terracotta = customer, green = owner, blue = staff) replace Expo's placeholders, made by `scripts/make-icons.mjs`.

**Privacy:** `apps/customer/public/privacy.html` (privacy policy + short terms + how to delete your account; fill in the [brackets]). The in-app "Your data" text now lists everything actually stored and for how long. **Account deletion:** customers ask from Me › Delete my account; you archive, then **Erase personal data** (step-up). Bills stay as "Deleted customer"; files are removed by the daily clean-up. The audit log no longer copies customers' contact details at all.

**Also:** `verify_live.sql` had gone stale (it would have flagged Phase 6's delete rights as problems); fixed, extended to check bucket size/type limits, and now **run by the tests** (`23-verify-live`) so it can't drift again.

**New pieces:** migration `1900_hardening.sql`; shared `colors.ts` (+ test); app-core `session.ts`; scripts `web-headers.mjs`, `make-icons.mjs`; customer `public/` (index.html, manifest, icons, privacy.html); tests `22-hardening` (18), `23-verify-live` (2), `colors.test` (3).

**Limits:** the review was a code review plus attack tests, not yet the proxy attack pass against your staging project (needs it running).

### Phase 7b: Launch prep (code complete, **needs your Supabase, new builds and phones**)

| Feature | Where | What it does |
|---|---|---|
| **Push receipts** (F22) | Automatic | About 15 minutes after an alert, Expo's receipt is checked; if the app was uninstalled, that phone is removed so alerts aren't wasted |
| **New sign-in alert** (F24) | All apps | From the second sign-in on: "New sign-in to your account… Signed in on Pixel 8 at 10:32 AM. Not you? Sign out on all your devices." Can't be muted |
| **Live chat** (F29) | Chat screens | New messages appear within a second or two (Supabase Realtime, which applies the same privacy rules); the 15-second refresh stays as a fallback |
| **Customer app lock** (F13) | Customer › Me › App lock | Optional: fingerprint/face/PIN after 2 minutes away. Turning it on or off needs the phone's lock too |
| **Owner screen privacy** (F37) | Automatic; More › Security | Screenshots blocked and the recent-apps preview blank (customer phones and balances aren't left on screen). A switch allows screenshots on that phone |
| **Error reports** (F7) | Automatic, only with your Sentry DSN | Crashes and errors reach you without names, emails, phone numbers, tokens or invite codes (scrubbed on the phone, tested) |
| **Tidier clean-up** (F32, F33) | Automatic | When old photos/voice notes are deleted, the meal and chat screens simply stop showing them; receipt photos never saved with an expense are removed after 2 days |
| **Busy days** (F36) | Money › Reports | Weekday × lunch/dinner grid: meals per day on average and % skipped, darker = busier (colour contrast tested in light and dark) |
| **Build profiles** (F8) | `apps/*/eas.json` | development (your test build), preview (APK for owner/staff phones), production (Play Store bundle); development client installed |

**New pieces:** migration `2000_launch.sql`; Edge Functions updated (`send-push` checks receipts, `media-retention` tidies references); app-core `lock.tsx` (shared lock), `realtime.ts`, `reporting.ts`; shared `scrub.ts`; owner `screen-privacy.tsx`; tests `24-launch` (5), `scrub.test` (4), heatmap colours, push receipts.

**Not done in 7b:** web push for iPhone (F5) moved to Phase 8 (built in 8a). Pinning CI actions (F38) needs GitHub, which the job network blocks. Proxy pass, restore drill and Play closed test are on your laptop (Setup step 15).

### Phase 8a: iPhone (code complete, **needs your VAPID keys, hosting and an iPhone**)

The apps are one codebase for Android, iPhone and the web. Until now only Android and the web were checked; this phase closes the iPhone gaps.

| Feature | Where | What it does |
|---|---|---|
| **Alerts in the web app** (F5) | Alerts screen › "Turn on alerts" (web) | Pop-up alerts on iPhone (after Add to Home Screen, iOS 16.4+) and Android/desktop browsers, even when the app is closed. Same alerts and mute settings as the phone apps |
| **All three web apps installable** | iPhone Share › Add to Home Screen | Owner and staff now have their own icon, name and full-screen mode too (customer had it since 7a) |
| **Voice notes from iPhone Safari** | Chat | Safari records MP4; it's now saved as .m4a (plays everywhere) instead of being mislabelled as WebM |
| **Paying from an iPhone** | Pay screen | "Open UPI app" shows only where it can work; iPhone users get a tip (pay to UPI ID, or pick the QR screenshot in the UPI app); copy UPI ID |
| **Typing on iPhone** | All forms | The focused field scrolls above the keyboard; sign-in codes can be filled from Mail/Messages |
| **Native iPhone apps ready to build** | `app.json` | Bundle ids, every permission text (camera, photos, microphone, Face ID), "standard encryption only" declaration, iPhone-only (no iPad screenshots needed); checked by generating the iPhone settings with Expo |

**How the web alerts are built:** the push sender (`send-push`) now also sends to browsers, using the web standards directly (message encryption RFC 8291, server identity VAPID RFC 8292) with the platform's own crypto, no extra library. Checked independently: the RFC author's reference library (http_ece) decrypted 50 of 50 messages; Node verified the VAPID signatures; a fixed example is now a permanent test. In Chrome, the service worker registered under the app's real security headers and showed a delivered alert correctly. Only Apple/Google/Mozilla/Microsoft push addresses are ever contacted (checked in the database and in the sender, redirects refused).

**New pieces:** migration `2100_web_push.sql`; `_shared/webpush.ts`; app-core `webpush.ts`; `public/sw.js` in each app; owner/staff `public/` (index.html, manifest, icons); `scripts/vapid-keys.mjs`; tests `25-webpush` (6), `26-web-push-db` (4), push combining.

**Limits:** Apple's servers and a real iPhone are not reachable here (PENDING section O). Native App Store / TestFlight builds need the Apple Developer Program ($99/year); until then iPhone users use the web app, which now has alerts (decision 16).

### Phase 8b: Languages, request to join, store review (code complete)

| Feature | Where | What it does |
|---|---|---|
| **Customer app in मराठी and हिन्दी** | Sign-in screen and Me › Language | Every screen, message, error and date (day/month names) in English, Marathi or Hindi. The phone's language is used at first; the choice is saved on the phone |
| **Request to join** (F15) | Customer app (no code) › "No code? Ask to join"; Owner › More › Join requests | When Business settings › Sign-up is "Requests", people without an invite ask to join (name, phone, place); you approve or decline. "Open" approves at once. You get an alert; they get one when you decide |
| **Store-review login** (F43) | First screen › "App store reviewer? Sign in with a password" | A separate **Demo Kitchen** with sample menu and meals, and one reviewer account you create and switch off (Setup step 18). The reviewer can never see your real kitchen |
| **Store listing text** | `docs/STORE_LISTING.md` | Short and full descriptions in English, Marathi and Hindi, plus the other Play fields |

**How the translations work:** the English text is the key (`tr('Send code')`), the Marathi and Hindi files hold the translations, and anything missing falls back to English. A test reads the app's source and fails if any customer-visible text (352 of them, including all error messages) lacks a Marathi or Hindi version with the same placeholders. Checked in Chrome set to Marathi and to Hindi: the app opened in that language and the text fits.

**New pieces:** migration `2200_join_and_review.sql` (join requests, `app.create_review_demo`/`end_review_demo`); shared `i18n.ts`, `i18n-mr.ts`, `i18n-hi.ts` (+ test); app-core `i18n.tsx`; owner `settings/join-requests`; `docs/STORE_LISTING.md`; tests `27-join-review` (4), `i18n.test` (3).

**Limits:** translations are mine and need a fluent reader's check before launch (PENDING F45). The staff app, the owner app and the alert texts sent by the database are still English (8c). Sentences with numbers use a simple form (for example "1 late skip" vs "{free} late skips") rather than full grammar rules.

### Phase 8c: Languages for staff and alerts, loyalty progress, launch checks (code complete)

| Feature | Where | What it does |
|---|---|---|
| **Staff app in मराठी and हिन्दी** (F44) | Staff sign-in screen and Me › Language | Every staff screen, message and date in English, Marathi or Hindi (same approach as the customer app) |
| **Alerts in each person's language** (F44) | Automatic | The language chosen in the customer or staff app is saved with the account; the database writes that person's alerts (meal delivered, closures, bills, payments, route ready, …) in Marathi or Hindi. Your own alerts stay English. Announcements and chat messages are sent exactly as typed |
| **Loyalty progress** (F35) | Customer › Bills; Owner › customer page | "7 more meals to your next reward: free sweet dish" for the customer; "3 of 10 meals toward the next reward" for you. Hidden while loyalty is off |
| **Expense links can't pre-fill the form** (F40) | Owner › Money › Expenses | Quick add hands its values to the form inside the app; a link from outside opens an empty form |
| **No Face ID text in the staff iPhone app** (F42) | Staff build settings | The staff app has no lock, so its iPhone build no longer asks about Face ID and its Android build no longer lists fingerprint permissions (checked by generating the settings) |
| **Automated attack pass** | `scripts/attack-pass/` | 196 attacks (another customer's records, owner and staff actions as a customer, direct table writes, uploads into other people's folders, owner without the authenticator) run against **staging** through the real API; every one must be refused |
| **Restore drill script** | `scripts/restore-drill.sh` | Decrypts a nightly backup, loads it into **staging** in one all-or-nothing step, and proves every table matches the backup row for row |
| **Switches** | Every on/off setting, all apps | The whole row is now the switch (bigger target), read out once by screen readers, and works with the keyboard on the web |

**Checked here:** the attack list runs on every `npm test` against the test database (setup, the 188 attacks that need no file storage, each refused by an access rule rather than by a typo in the attack, and the clean-up); planting an attack that should succeed makes the test fail. The restore drill ran end to end on a throwaway local Postgres: a backup taken with the exact nightly-backup settings was restored over different data, and every table matched. The previously documented command (`pg_restore --data-only`) was tried the same way and **lost data**: the list of items inside each tiffin type was refused by a check, alerts collided, and the history log was nearly doubled, because the database's safety rules ran again while loading. The script avoids this the way Supabase's own restore guide does. All three web apps were opened at phone width (360 and 320 px, English and Marathi, 108 screen loads with sample data): nothing sticks out sideways. This found and fixed English words left inside Marathi/Hindi sentences (meal names on My meals, a meal's title, "set by kitchen", voice-note labels); a new test now fails on that pattern.

**New pieces:** migrations `2300_alert_language.sql` (language per account, 57 alert templates), `2400_loyalty_progress.sql`; tests `28-alert-language` (3), `29-loyalty-progress` (2), `30-attack-pass` (4), one more i18n test; `scripts/attack-pass/` (setup.sql, checks.mjs, run.mjs, teardown.sql); `scripts/restore-drill.sh`; owner `lib/expense-prefill.ts`.

**Limits:** the attack pass and the restore drill need your staging project (Setup step 19). Voice input stays the phone keyboard's microphone (decision T106). The owner app followed in 8d (below). Invite codes keep their current length (T107).

### Phase 8d: Owner app in Marathi and Hindi (code complete)

| Feature | Where | What it does |
|---|---|---|
| **Owner app in मराठी and हिन्दी** | Owner sign-in screen and More › Language | Every owner screen, button, message, list and date. Same approach and tests as the other two apps |
| **Your alerts in your language** | Automatic | Payments to confirm, late skips, chats, join requests, referrals, the daily count and regular expenses arrive in the language you chose. Customers' own chat words and your announcements are never changed |
| **Suggestions in your language** | Money › Suggestions | The advice the database works out ("Friday lunch: 40% skipped", "Vegetables is over budget", …) comes back in your language |
| **Messages you share** | Customer invite, staff code, statement text, shopping list | Written in your app language, so you can send Marathi messages to Marathi customers (switch to English for others) |
| **Link checking (F10)** | Typecheck | Every link between screens is checked against the real screens; a wrong link fails the typecheck |

**Checked here:** a test fails if any owner text (654 new, 1,113 in all) lacks a Marathi or Hindi version, if placeholders differ, or if an English word or plural ending is filled into a translated sentence (it found about a dozen such places in the owner app, now whole sentences). Every alert and suggestion template has a sample that must translate fully; the seven-week history in the suggestions test is read back in Marathi and Hindi line by line. The owner web app was opened at 360 and 320 px in English, Marathi and Hindi (96 screen loads, sample data): no overflow, no blank screens. A planted wrong link failed the typecheck.

**Fixed on the way:** a voice note's alert text ("Open … to listen.") stayed English for Marathi/Hindi customers (chat text was skipped as a whole; now only the person's own words are); two owner texts were out of date ("until the app is on the Play Store", "notifications arrive with Phase 4"); the customer status on the owner's customer page showed the raw database word.

**Stays English on purpose:** spreadsheet (CSV) files and PDF file names. (PDFs and Quick add followed in 8e.)

**New pieces:** migration `2500_owner_language.sql` (43 owner/suggestion templates, `app.localize_insight`, `owner_insights` now translated, voice-note fix); owner screens wrapped with `tr()`; Chips translate their own option labels; tests: one more in `21-insights`, `28-alert-language` extended, i18n tests cover the owner app.

### Phase 8e: Quick add and PDFs in Marathi/Hindi, Google sign-in (code complete)

| Feature | Where | What it does |
|---|---|---|
| **Quick add in Marathi and Hindi** | Money › Expenses › Quick add | "500 भाजी रमेशकडून", "रमेश से 500 की सब्ज़ी", "२ किलो कांदे ८०", typed or said with the keyboard microphone: amount, category and shop are filled in (Devanagari digits too; "2 किलो" is a quantity, never the amount). Category names you renamed into Marathi are recognised too |
| **PDFs in Marathi and Hindi** | Owner: statement, monthly report, box stickers. Customer: My statement | Every label and date in the app's language; names and amounts as they are |
| **Continue with Google** (F1) | Sign-in screen of all three apps | One tap with a Google account instead of an emailed code. Same rules as before: a new person still needs an invite code or a join request; you still need your authenticator code. A Google account with the same email as an existing account is the same person. Hidden until you switch it on (Setup step 20) |

**Checked here:** 10 new Marathi/Hindi Quick add cases (all English cases unchanged); the statement and report rendered as Marathi PDFs in Chrome with correct Devanagari, and a test fails if any English label is left in a Marathi or Hindi document. Google sign-in ran end to end in the customer web app with Google and Supabase simulated in the browser: it uses PKCE (the returned code only works with a secret this app keeps; checked that SHA-256 of the secret matches the challenge), a new person lands on Join, one sign-in alert, the code is removed from the address bar, and "Cancel" on Google's page gives a clear message. All email-code sign-ins are unchanged (the test suites pass).

**Limits:** Google sign-in on Android and iPhone (in-app browser sheet) needs your Google Cloud and Supabase setup and a phone (PENDING Q20). CSV files stay English.

## Not done yet (by design, see PLAN.md section 17)

| Item | Phase |
|---|---|
| On your laptop: restore drill and attack pass (now scripts, Setup step 19), share the APKs and web links (free; the $25 Play closed test only if you ever want a Play listing), pinning CI actions (F38) | 7 (laptop) |
| Optional, only if you want them: corporate billing, one-off orders (cloud kitchen), more branches. Paid or outside approval: Play Store / App Store listings, a payment gateway (fees), Swiggy/Zomato (their partner programmes) | later |

## Known items

- `npm audit` reports 3 **moderate** issues inside Expo build tooling (`@expo/fingerprint`); no high/critical. The only automatic fix is a breaking `--force` downgrade, so it is left for the next Expo update (Dependabot will raise it).
- Database tests run on PGlite + a Supabase stand-in. After the first deploy, run `supabase/tests/verify_live.sql` on the real project (setup guide step 6) to confirm the same guarantees there.
