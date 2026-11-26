# Amruta's Kitchen: Complete Plan

Tiffin service platform: **Owner app + Customer app + Staff app**.
Plan date: 20 Nov 2026. Status: **planning complete, no code written yet.**

---

## 0. Instructions for Claude (read first)

You are continuing a project that was fully planned in an earlier session. This file is the single source of truth.

1. **Accounts, credentials, deployment and real customer data: personal laptop and personal accounts only.** Never use an employer account or repository, and never put keys in the repo.
2. **Progress:** Phase 0 (code side), Phase 1, Phase 2 (owner app), Phase 3 (customer app), Phase 3b (staff app), Phase 4 (notifications), Phase 5a (billing jobs, announcements, auto-assignment, referrals, chat), Phase 5b (files, voice notes, QR stickers, specials, PDF) Phase 6 (expenses, receipts, budgets, ingredients/shopping list, reports, suggestions, loyalty) and Phase 7a (security review + fixes, performance, accessibility, web security headers, privacy policy, account deletion, icons) Phase 7b (push receipts, sign-in alerts, live chat, customer app lock, owner screen privacy, Sentry, clean-up, heatmap, build profiles) Phase 8a (iPhone: web push, installable web apps, native iPhone build settings) Phase 8b (customer app in Marathi/Hindi, request to join, store-review demo login, store listing) Phase 8c (staff app + alerts in Marathi/Hindi, loyalty progress, automated attack pass, restore-drill script) Phase 8d (owner app, owner alerts and suggestions in Marathi/Hindi, route checking) and Phase 8e (Quick add and PDFs in Marathi/Hindi, Google sign-in) are code complete; 256 passing tests. Next: the owner's laptop steps (Setup steps 15–20). Bigger features are parked until needed. Launch is free: web apps + direct APKs; the Play Store is optional and paid. Their "Done when" criteria need the owner's Supabase project and phones: **every pending item with its test steps is in `docs/PENDING_AND_TESTING.md`**. See `docs/STATUS.md` (done / next) and `docs/DECISIONS.md` (technical choices, including where the implementation differs from section 4, e.g. own UI kit instead of React Native Paper). Continue with the next phase in section 17; each phase ends only when its "Done when" criteria pass.
3. **Security is built in Phase 1, before any screens.** Never weaken a rule in section 13 to make a feature easier. If a feature seems to need that, stop and ask.
4. Every decision in section 2 is final. If something is unclear or missing, **ask the owner. Do not assume.**
5. Free-tier limits in section 16 were checked on 20 Nov 2026 and can change. Re-check them at signup and tell the owner if anything changed.
6. Never commit secrets (`.env`, keys, service-role key). Never put the Supabase service-role key in any app.
7. Before changing any rule, check every caller and every stored value. If unsure, keep the existing behaviour and ask.

---

## 1. What the business does (as described by the owner)

- Home tiffin service. Customers can **join on any date of the month** and **stop at any time**. Some come only for some days.
- Customers take **lunch only, dinner only, or both**.
- The kitchen takes **days off** (whole day or one meal), and informs everyone.
- **Veg and non-veg tiffins** have different prices.
- **Customisation:** extra items (salad, egg, bhakri…) at extra prices. The owner must be able to **add any item and set its price**, and **build tiffin types from items**.
- Customers work at **many different places** (hospitals, offices, others, and corporates in future). Their exact spot (ward, lab, desk) **changes daily**, so they must be able to tell the kitchen where they are today.
- Customers tell the kitchen **where they left the empty tiffin box**.
- Customers can **request extra items before a cutoff time** that the owner controls.
- The owner wants to track **every customer's dues and payments at any time**.
- The owner wants to track **all business spending and investments**, see profit, and get **suggestions** on what to handle more carefully.
- **Staff** (kitchen and delivery workers) need their own app showing what to do, where and how.
- **Cost goal:** ₹0/month where possible. **No compromise on security.**
- **Future growth:** Play Store public listing, cloud kitchen/restaurant (one-off orders), Swiggy/Zomato, corporate customers, more branches.

---

## 2. Final decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Location | Own folder on the personal laptop, e.g. `tiffin-app/` |
| 2 | Code | Private repo on the owner's **personal** GitHub account |
| 3 | Business name | **Amruta's Kitchen** |
| 4 | Delivery times | Set by the owner in the Owner app, per meal slot, with one-day overrides. Changes show up live in the Customer and Staff apps. |
| 5 | Add-on/skip cutoff | Default **150 minutes before delivery**. Owner can change it (relative minutes or fixed clock time). |
| 6 | Location-update cutoff | Default **30 minutes before delivery**. Owner can change it. |
| 7 | Add-on requests | **Auto-accept before the cutoff.** Owner can still reject. |
| 8 | Skip after the cutoff | **Charged in full, with N free late skips per customer per month (default N = 1).** Owner sets N, the cutoff, and per-customer overrides, and can waive any single charge. |
| 9 | Billing model | **Per meal delivered** (plus add-ons). Handles mid-month joins and part-time customers automatically. |
| 10 | Payment timing | **End of month by default.** **Advance/prepaid** optional per customer. |
| 11 | Payment method | Owner's **UPI business QR** + cash. Customer submits the UTR, the owner confirms. **Optional late-payment fee**: global on/off, grace days, flat or % amount, and per customer (follow global / exempt / custom). |
| 12 | Customer signup | **Invite only** at launch. `signup_mode` setting: `invite_only` → `request_to_join` (for the public Play Store listing) → `open` (cloud-kitchen stage). |
| 13 | Staff | **Separate Staff app** (third app, same codebase) with roles kitchen / delivery / both |
| 14 | Staff seeing phone numbers | **Off by default. The owner enables it per staff member.** |
| 15 | Locations | **Several places, not only hospitals.** General hierarchy: Place → Building → Floor/Department/Ward/Lab/Desk → free text. **Corporate accounts** are planned (company-paid combined bill or employee-paid). |
| 16 | iPhone users | Use the **PWA** (web app added to the Home Screen) at launch. Native iOS app later from the same code ($99/year Apple fee) when worthwhile. |
| 17 | App language | English first; Marathi + Hindi in Phase 8 (built i18n-ready from day one) |
| 18 | Voice languages | English, Marathi, Hindi (quality depends on the phone's speech engine; test on real phones) |
| 19 | QR stickers on boxes | **Yes** (optional per box) |
| 20 | Voice note / photo retention | **30 days**, then deleted automatically (setting) |
| 21 | Loyalty rewards | Yes, Phase 6, **off by default** |
| 22 | Referrals | Yes. A customer's referral creates a **request the owner must approve** before any invite exists. |

---

## 3. Architecture

```
 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
 │ OWNER APP    │   │ CUSTOMER APP │   │ STAFF APP    │
 │ Android+Web  │   │ Android+PWA  │   │ Android      │
 └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
        │ HTTPS; user's login token only (no secret keys in any app)
        ▼                  ▼                  ▼
 ┌────────────────────────────────────────────────────────┐
 │ SUPABASE                                               │
 │  Auth: Google sign-in, email OTP (custom SMTP),        │
 │        TOTP MFA (owner mandatory)                      │
 │  Postgres: all data; RLS deny-by-default on every      │
 │        table; business rules in SQL functions          │
 │  Storage: private buckets (receipts, proofs, voice)    │
 │  Realtime: live updates                                │
 │  pg_cron + pg_net: scheduled jobs → Edge Functions     │
 │  Edge Functions: push sending, secret-holding tasks    │
 └──────┬─────────────────────────┬───────────────────────┘
        ▼                         ▼
 Expo Push Service → FCM     Brevo SMTP (login emails)
 Web Push (VAPID) for PWA
        │
 GitHub Actions: CI (tests, lint, security scans)
             + nightly ENCRYPTED pg_dump → off-site storage
```

**Principle: the apps are never trusted. The database decides everything.**

---

## 4. Tech stack

| Part | Choice | Notes |
|---|---|---|
| Apps | **Expo (React Native) + TypeScript (strict)**, Expo Router | Latest stable Expo SDK at setup time. **Development builds** (not Expo Go), needed for speech recognition. |
| Monorepo | npm workspaces | `apps/owner`, `apps/customer`, `apps/staff`, `packages/shared` |
| UI | React Native Paper | Simple, accessible; dark mode; large-text friendly |
| Forms and validation | react-hook-form + zod | The same zod schemas in all apps; the DB re-validates |
| Data and offline | TanStack Query (+ persisted cache, queued mutations) | Offline for staff delivery and box lists |
| i18n | i18next + react-i18next + expo-localization | All strings in translation files from day one |
| Backend | Supabase (Postgres, Auth, Storage, Realtime, Edge Functions, pg_cron, pg_net) | Region: **Mumbai (ap-south-1)** if offered |
| Push | Expo Push Service → FCM (Android) | Free. **Expo push does not cover web**, so the PWA needs Web Push (VAPID). See Phase 4 spike. |
| Email | **Brevo SMTP** as Supabase custom SMTP | The built-in Supabase mailer is ~2 emails/hour, testing only |
| PDF | expo-print + expo-sharing | Bills, statements, QR sticker sheets, generated on the device |
| QR | react-native-qrcode-svg (generate), expo-camera (scan) | |
| Voice | expo-speech (TTS), expo-audio (record notes), expo-speech-recognition (community, speech-to-text) | |
| Biometric lock | expo-local-authentication | Owner app (mandatory), Staff app (optional), Customer app (optional) |
| Secure session storage | expo-secure-store | |
| Charts | Plain React Native views (decided in Phase 6, see DECISIONS T63) | |
| Web hosting | **Cloudflare Pages** (owner web + customer PWA) | Check Cloudflare terms for commercial use. **Do not use Vercel Hobby** (non-commercial only). |
| Builds and OTA | EAS Build (or local build), EAS Update | |
| Errors | Sentry (free plan) | Scrub personal data before sending |
| Tests | Jest (jest-expo), **pgTAP** (`supabase test db`), Maestro (mobile E2E) | |
| Security tooling | Supabase Security Advisor, Dependabot, `npm audit`, **gitleaks** (pre-commit + CI), Semgrep CE | |
| Local dev | Supabase CLI + Docker Desktop (personal laptop) | |

---

## 5. Business rules (exact)

### 5.1 Items and prices
- An item has: name, category (`main` / `addon`), veg/non-veg flag, unit, active flag, `customer_orderable` flag, max quantity per order.
- Prices live in `item_prices(effective_from)`. A **price change never changes past orders or bills.**

### 5.2 Tiffin types
- Built from items with quantities (`tiffin_type_items`).
- Pricing mode per type: `fixed` (owner-set price) or `sum_of_items`. Price history in `tiffin_type_prices(effective_from)`.

### 5.3 Price resolution for a meal (server-side only)
1. Special menu price (if the order is a special/pre-order)
2. Else the customer-specific override for that tiffin type/item (if any)
3. Else the tiffin type/item price effective on the order date

**The client never sends prices.** Prices are snapshotted on the order and add-on rows when the order is created or the add-on accepted.

### 5.4 Subscriptions
- A customer has 0..n subscriptions. Each has: meal slot, tiffin type, start date, optional end date, days of week, default add-ons, default location, status (`active` / `paused` / `ended`).

### 5.5 Order generation
- A scheduled job generates orders **7 days ahead** from active subscriptions, excluding owner closures and customer skips.
- A subscription change regenerates **future, unlocked** orders only.
- **Order states:** `scheduled` → `delivered` | `not_delivered` | `skipped` | `skipped_late` | `cancelled_closure`
- `order_source`: `subscription` now; `one_off`, `special`, `swiggy`, `zomato` later.

### 5.6 Cutoffs (server clock, Asia/Kolkata)
- Per slot: `delivery_time`, `addon_skip_cutoff` (default 150 minutes before), `location_cutoff` (default 30 minutes before). Each can be **relative minutes** or a **fixed clock time**.
- `slot_overrides(date, slot, …)` for one-day changes.
- Moving the delivery time moves relative cutoffs automatically.
- After a cutoff, customer functions refuse changes. The owner can still change anything (audited).

### 5.7 Charging rules
| Situation | Charged? |
|---|---|
| Delivered | Yes (tiffin + accepted add-ons) |
| Customer skipped **before** the cutoff | No |
| Customer skipped **after** the cutoff | Yes, full, unless within the free late-skip allowance (default 1/month) or a per-customer override, or waived by the owner |
| Owner closure (day off) | No |
| Not delivered (kitchen's fault) | No |

### 5.8 Ledger (one source of truth for money)
- `ledger_entries` per customer: debits (meal, add-on, late-skip, late-payment fee) and credits (payment, waiver, discount, advance).
- **Append-only:** no UPDATE or DELETE for anyone, including the owner. Corrections = reversal entries with a reason.
- Balance = sum of entries (never typed in). Money is stored as **integer paise**.
- Monthly bills are generated for the calendar month or a custom range. A bill is a statement over the ledger; issued bills never change.

### 5.9 Late-payment fee
- Settings: enabled flag, grace days after the bill date, type `flat` / `percent`, amount.
- Per customer: `follow_global` / `exempt` / `custom`.
- A notification goes out 2 days before a fee applies. The fee is a separate named ledger line. The owner can waive it (reversal entry). The rule is shown in the customer's terms at joining.

### 5.10 Advance customers
- Payments credit the ledger. Each delivered meal debits it. A **low balance alert** fires below the threshold set by the owner.

### 5.11 Signup modes (`business_settings.signup_mode`)
- `invite_only`: the customer must redeem a valid invite code.
- `request_to_join`: anyone can create a login but sees only a "Request to join" form. **No data access until the owner approves.**
- `open`: future cloud-kitchen stage (one-off orders with online payment).

### 5.12 Multi-kitchen ready
- **Every business table has `kitchen_id`** (one kitchen now). RLS always scopes by kitchen.

---

## 6. Data model (main tables)

All tables: `id uuid` primary key, `kitchen_id`, `created_at`, `updated_at`, `version int` (optimistic locking). Timestamps are `timestamptz`. Money is `bigint` paise.

| Area | Tables (key columns) |
|---|---|
| Tenant and settings | `kitchens`, `business_settings` (name, UPI ID, UPI QR image, signup_mode, policies, late-fee rules, free late skips N, retention days, low-balance threshold), `meal_slots` (lunch/dinner, delivery_time, cutoff configs), `slot_overrides` |
| Identity and roles | `staff_members` (user_id, role `owner`/`kitchen`/`delivery`/`kitchen_delivery`, can_see_phone, active), `customers` (user_id nullable, name, phone, email, food notes, default_location_id, status, company_id nullable, billing_mode, late_fee_mode, late_skip_override), `customer_invites` (code_hash, customer_id, expires_at, used_at, attempts), `join_requests`, `referral_requests`, `devices` (user_id, push token, platform, last_seen), `companies` (corporate, future) |
| Locations | `places` (hospital/office/college/other), `location_nodes` (parent_id, name, type, **directions text + photo + voice note** for staff), `customer_saved_locations` |
| Menu | `items`, `item_prices`, `tiffin_types`, `tiffin_type_items`, `tiffin_type_prices`, `customer_price_overrides`, `daily_menu`, `special_menus`, `special_menu_items`, `packing_instructions` (per tiffin type: text, photo, voice) |
| Service | `subscriptions`, `subscription_addons`, `closures` (date, slot or both, reason, notified_at), `customer_skips` (date range, slot) |
| Daily operations | `orders` (date, slot, customer, subscription, tiffin_type, status, order_source, price snapshot, location snapshot + today's location text, location_updated_at, assigned_staff_id, delivered_at, delivered_by), `order_addons` (item, qty, price snapshot, requested_by, status), `delivery_proofs`, `boxes` (code e.g. AK-017, active), `box_movements` (box, customer, type `issued`/`kept_at`/`collected`, location text, staff, at), `staff_assignments` (staff, date, slot, location node or customer list), `staff_shifts` (check-in/out) |
| Money in | `ledger_entries`, `bills`, `payments` (amount, method, UTR, proof file, status `submitted`/`confirmed`/`rejected`, idempotency_key, confirmed_by) |
| Money out | `expense_categories`, `expenses` (date, amount, category, vendor, method, receipt file, **kind `running`/`investment`**, staff_id for salaries), `recurring_expenses`, `budgets`, `ingredients`, `item_ingredients` (for shopping list), `waste_entries` |
| Engagement | `notifications` (inbox), `announcements` (scheduled_at), `chat_messages` (customer ↔ owner only; text or voice), `voice_notes`, `feedback` (order, rating 1–5, comment), `loyalty_rules`, `loyalty_rewards` |
| Safety | `audit_log` (actor, action, table, record id, old jsonb, new jsonb, at): **written only by triggers, no UPDATE/DELETE for anyone**; `rate_limits` |

Size estimate: 200 customers × 2 meals × 365 days ≈ 150k order rows/year. This fits the 500 MB free DB for years. Photos and voice are compressed (photo ≈ 200 KB, 30 s voice ≈ 250 KB) and auto-deleted after 30 days.

---

## 7. Owner app

1. **Today dashboard:** lunch/dinner counts by tiffin type and veg/non-veg, add-on totals, countdown to the cutoff, delivery progress per staff member, dues total, pending-task badge (unconfirmed UTRs, open requests, missing boxes).
2. **Kitchen prep list** and **shopping list** (from tomorrow's orders × item ingredients).
3. **Packing list** per customer (add-ons, food notes).
4. **Delivery list** grouped Place → Building → Floor/Ward; call/WhatsApp buttons (WhatsApp = `wa.me` click-to-chat, sent manually by the owner).
5. **Box tracking:** pickup list, QR scan, "box out for more than N days" alerts, QR sticker sheet printing.
6. **Customers:** add/edit/pause/stop/archive, invite code, subscriptions, saved locations, price overrides, late-skip and late-fee overrides, full history, ledger, statement.
7. **Join and referral requests:** approve/reject.
8. **Menu:** items and prices, tiffin type builder (fixed or sum pricing), daily menu, weekly menu, special menus/pre-orders, packing instructions (text/photo/voice).
9. **Calendar and timings:** meal slots, delivery times, cutoffs (relative or fixed), one-day overrides, closures (whole day or slot; auto-cancels orders and notifies), scheduled announcements.
10. **Requests inbox:** add-ons, skips, late location changes (auto-accept rules).
11. **Billing:** generate bills, statement for any range, PDF/image share to WhatsApp, record payment (cash/UPI), confirm/reject submitted UTRs, advances, discounts, waivers, late fees, dues list with one-tap reminders.
12. **Expenses and investments:** quick add (incl. **voice entry with a confirm screen**), receipt photo, categories, recurring reminders, budgets, staff salary/advances.
13. **Reports:** monthly profit/loss, investment payback progress, cost per meal, margin per tiffin type, revenue by type, dues aging, skip trends by weekday, waste trends, calendar heatmap, CSV/Excel export, monthly business report PDF.
14. **Insights** (section 11).
15. **Staff management:** invite, role, phone-number access switch, assign work (by location or per customer per day), live progress, deactivate (revokes all sessions).
16. **Chat** with customers (text + voice notes).
17. **Settings:** business profile, UPI QR, signup mode, all policies, retention, notification preferences, data export, audit log viewer, storage usage meter, "log out all devices".
18. **Global search** (with voice).

## 8. Customer app

1. **Join:** Google sign-in or email OTP → redeem invite code (or "Request to join" in that mode) → accept terms (charging, late fee, privacy).
2. **Home:** today's lunch/dinner status, today's menu, cutoff countdowns, **"I'm at today: [location ▾]"** (recent, saved, owner's list, free text, **voice**, "same as yesterday"), skip button, undo for 5 seconds.
3. **Extras:** request customer-orderable add-ons with prices shown, cancel before the cutoff.
4. **Calendar:** upcoming meals, skip/pause date ranges (**leave/vacation mode**), closures, weekly menu, special menus/pre-orders.
5. **Box:** "I kept my box at…" (+ optional photo), boxes-with-me count.
6. **Delivery:** delivered notification (+ proof photo if any), "received" tap, rating/comment.
7. **Money:** live balance, meal-by-meal history, bills, PDF statement, **Pay** (shows the owner's UPI QR + "Open UPI app" link) → submit UTR → status.
8. **Chat** with the owner (text + voice notes ≤ 30 s).
9. **Refer a colleague** (creates a request for the owner).
10. **Notifications inbox** and reminder settings (e.g. "remind me at 10:30 to set my location").
11. **Profile:** food notes/allergies, saved locations, language, dark mode, biometric lock (optional), log out all devices, request to stop service, request data export or deletion.

## 9. Staff app

1. **Join:** staff invite from the owner only. Optional biometric lock.
2. **Role views:** Kitchen (prep list, packing list, **packing instructions** with photo/voice) / Delivery (my route) / Both.
3. **My route today:** only assigned orders, grouped by location, with **directions per location** (text/photo/voice) and the customer's live location for today. **Read aloud** (TTS).
4. **Actions:** mark delivered (tap or **QR scan**), optional proof photo, "customer not found" + reason, box pickup list, scan box collected.
5. **Offline:** actions are queued with idempotency keys and synced later. The server re-validates every action.
6. **Shift check-in/out** (if the owner enables attendance).
7. **Notifications:** route ready, customer changed location, customer skipped.
8. **Never visible:** prices, bills, payments, dues, expenses, reports, customers outside today's assignment, phone numbers (unless the owner enables them for that staff member).

## 10. Notifications

| Event | Recipient |
|---|---|
| Location not set, 30 min before the location cutoff | Customer |
| Add-on/skip cutoff approaching (opt-in) | Customer |
| Closure announced/cancelled; scheduled announcement | Affected customers |
| Timing change affecting a booked meal | Affected customers + assigned staff |
| Out for delivery / delivered | Customer |
| Add-on accepted/rejected; join/referral decision | Customer |
| Bill generated; payment confirmed/rejected; dues reminder; late fee in 2 days; low advance balance | Customer |
| New request, late location change, UTR submitted, feedback, join/referral request | Owner |
| Daily summary at each cutoff ("Lunch: 23 tiffins, 6 eggs…") | Owner |
| Route ready; customer location changed; customer skipped | Staff |
| Backup failed; new-device login; unusual activity (rate-limit hits) | Owner |
| New-device login | Any user (own account) |

Every notification is also written to the in-app `notifications` inbox. Lock-screen text can hide amounts (setting). **No SMS** (paid). **No WhatsApp Business API** (paid); WhatsApp is only via owner-tapped `wa.me` links.

## 11. Insights (rule-based, free, data stays private)

Each suggestion shows the numbers behind it. Initial rules:
- Category spend change vs last month compared with meal-count change (e.g. "Vegetables +22% while meals +5%").
- Cost per meal trend; margin per tiffin type (needs ingredient costs).
- Skip rate by weekday/slot → "cook ~X fewer on Saturday dinner".
- Waste rate trend.
- Dues > 30 days; customers repeatedly paying late.
- Budget overrun per category.
- Investment payback progress.
- Boxes out > N days.
- Customers with falling order frequency (churn warning).

## 12. Voice (all optional; typing always available)

| Feature | App | Rule |
|---|---|---|
| Speak today's location | Customer | Speech-to-text → match against the location list → **user confirms** |
| Voice note to owner (≤ 30 s) | Customer | Private, playable only by that customer + owner, auto-deleted after 30 days |
| Voice expense entry | Owner | Parsed into amount/category/vendor → **confirm screen before saving** |
| Voice search | Owner | |
| Read delivery list aloud | Staff/Owner | TTS |
| Read prep/packing list aloud | Staff/Owner | TTS |
| Voice typing in any field | All | Phone keyboard mic (no build needed) |

**A voice command never saves data by itself.** On many Android phones the system speech engine may send audio to Google, so voice stays optional.

## 13. Security model

### 13.1 Permission matrix (enforced in the DB)

| Data | Customer | Staff | Owner |
|---|---|---|---|
| Own profile, orders, bills, chat, voice notes | Read | — | Read |
| Other customers' data | **Never** | Only today's assigned orders, limited columns | Read |
| Today's location, skip, add-on request (own, before the cutoff) | Change via functions | — | Change |
| Prices, items, tiffin types, timings, closures, settings | Read the menu only | Read the needed menu/instructions | Change (MFA) |
| Delivery status, box movements | — | Change, **assigned orders today only** | Change |
| Customer phone numbers | Own | Only if enabled for that staff member, assigned orders only | Read |
| Payments, ledger, bills | Own, read; submit UTR | **Never** | Record/confirm (MFA) |
| Expenses, investments, reports, insights | **Never** | **Never** | Full (MFA) |
| Audit log | **Never** | **Never** | Read only. Nobody can modify it. |

### 13.2 Enforcement layers
1. **RLS enabled, deny by default, on every table.** CI fails if any table lacks RLS (Security Advisor + pgTAP check).
2. **Identity always from `auth.uid()` on the server.** Any `customer_id` or `staff_id` sent by a client is ignored, which closes **IDOR/BOLA**.
3. **Customers and staff have no direct INSERT/UPDATE/DELETE grants.** Writes only through named functions, e.g. `set_today_location`, `skip_meal`, `request_addon`, `cancel_addon`, `mark_box_location`, `submit_payment_utr`, `redeem_invite`, `staff_mark_delivered`, `staff_scan_box`, `staff_check_in`. Each function:
   - checks ownership/assignment
   - checks the **cutoff against the server clock** (Asia/Kolkata)
   - validates every value (ranges, lengths, enums)
   - **never accepts prices from the client**, which closes **payload tampering**
4. **Functions are hardened:** `SECURITY DEFINER` only where needed, with `SET search_path = ''` and fully qualified names; `REVOKE EXECUTE ... FROM PUBLIC, anon` then grant only to the needed roles. `anon` can call nothing except what invite/join needs (rate-limited).
5. **Column privacy:** RLS filters rows, not columns, so staff read through functions/views that return only allowed columns. Prices and phone numbers never reach a staff phone unless allowed.
6. **Roles** come from `staff_members` (and optionally `app_metadata`), **never `user_metadata`**, which users can edit themselves.
7. **Owner MFA:** TOTP mandatory. Owner policies require `auth.jwt()->>'aal' = 'aal2'`. **Step-up** for dangerous actions (price change, archive customer, waiver/refund, full export, add staff, change signup mode): require an MFA verification within the last 10 minutes (check `amr` timestamps). Biometric app lock.
8. **Append-only money tables** (`ledger_entries`, `payments` history) and the **immutable `audit_log`** (trigger-written; no UPDATE/DELETE grants for anyone). Nothing is hard-deleted; records are archived.
9. **Concurrency and duplicates:** a `version` column (optimistic locking) refuses stale saves. `idempotency_key` on payments and offline staff actions prevents double recording.
10. **Accounts:**
    - Invite codes are random, single-use, stored hashed, expiring, attempt-limited, and bound to one customer record. Only the owner can re-link a customer to another login.
    - "Log out all devices" (`signOut({ scope: 'global' })`).
    - New-device login alert.
    - Deactivating staff revokes their sessions immediately.
11. **Storage:**
    - Private buckets only.
    - Path includes the owner of the file; storage policies check it.
    - Per-bucket `allowed_mime_types` and `file_size_limit`.
    - Signed URLs with short expiry.
    - Retention job deletes expired voice and photos.
12. **Rate limiting:** Supabase Auth limits + a per-user/per-function `rate_limits` table for invite redemption, requests and chat.
13. **Secrets:** only in Supabase secrets and GitHub Actions secrets. Apps contain only the public anon/publishable key. gitleaks runs in pre-commit and CI.
14. **Supply chain:** lockfile committed, Dependabot, `npm audit` in CI, Semgrep CE, minimal dependencies. **No ads or third-party analytics SDKs.**
15. **Web (owner web + PWA):** HTTPS only, strict Content-Security-Policy, no third-party scripts.
16. **Privacy:**
    - Minimal personal data: name, phone, email, workplace location text. **No GPS tracking, no contacts access.**
    - Privacy policy (also required by the Play Store).
    - Data export and deletion on request.
    - Follow India's DPDP Act 2023 principles.
    - Sentry events scrubbed of personal data.
17. **Things deliberately not built:** live GPS tracking, contacts access, card/bank storage, customer-to-customer chat, public feeds, ads/tracking.

### 13.3 Security tests (CI blocks deployment if any test fails)
- **Matrix tests (pgTAP):** every table × role (`anon`, customer A, customer B, staff assigned, staff unassigned, owner without MFA, owner with MFA) × operation (select/insert/update/delete) = expected allow/deny from 13.1.
- **Attack tests:**
  - customer A reads/changes B's order, location, bill, voice note, file
  - sending another person's ID
  - sending a price of ₹1
  - quantity −5 / 999
  - change after the cutoff
  - change on a past date
  - reuse of an invite code
  - brute-forcing invite codes (lockout)
  - staff reading payments, phone numbers (when disabled), or another staff member's route
  - update/delete of ledger or audit rows
  - `.exe` uploaded as `.jpg`
  - calling functions while logged out
  - owner actions without `aal2`
  - step-up actions without a recent MFA
- **Before launch:** OWASP MASVS/ASVS-based manual review and a proxy-based attack pass (Burp/ZAP style) against staging.

## 14. Money collection details

- The customer app shows the owner's **business UPI QR** (PhonePe/Paytm/Google Pay for Business, free) + an "Open UPI app" link (`upi://pay?pa=…&pn=…&am=…&tn=…`). **Test deep links in Phase 5**: some UPI apps restrict them, and the QR always works.
- The customer submits the UTR (+ optional screenshot). The owner confirms, and a ledger credit is created.
- A payment gateway (automatic confirmation) is optional later. It has fees.

## 15. Environments, deployment, backups

| Environment | Where |
|---|---|
| Development | Local Supabase (Docker) with seed data |
| Staging | Supabase free project #2 |
| Production | Supabase free project #1 (Mumbai if offered) |

| App | Distribution |
|---|---|
| Owner | Android (direct APK on the owner's phones) + web (Cloudflare Pages) |
| Customer | Web app (Cloudflare Pages), installed from Chrome on Android or "Add to Home Screen" on iPhone, with alerts; optional direct APK for Android customers who prefer an app. Play Store only if the owner later pays the $25 fee |
| Staff | Android (direct APK); web app for staff with iPhones |
| Updates | EAS Update (over the air) for JS changes; new builds for native changes |

- **Optional custom domain:** e.g. `app.<domain>` (customer PWA), `owner.<domain>` (owner web). The owner hasn't said yet whether they own a domain.
- **Schema changes:** versioned migrations only (`supabase/migrations`), applied local → staging → production. No manual production edits.
- **Backups:** the Supabase free plan has **no automatic backups**.
  - A nightly GitHub Actions job runs `pg_dump` (+ a storage object manifest), **encrypts it** (age/GPG), and uploads it off-site (e.g. Cloudflare R2 free tier or Google Drive).
  - Keep 30 dailies + 12 monthlies.
  - **Monthly restore drill** into staging.
  - The owner gets a notification if a backup fails.
- **Free-project pausing:** Supabase pauses free projects after 7 days of inactivity. Daily use plus the nightly backup keeps production active. Staging may pause; resume it when needed.

## 16. Costs and free limits (checked 20 Nov 2026; re-verify at signup)

| Item | Free limit | Fits? |
|---|---|---|
| Supabase DB | 500 MB per project, 2 projects | Yes, for years |
| Supabase storage | 1 GB | Yes, with compression + 30-day retention |
| Supabase egress | 5 GB/month | Yes |
| Supabase Edge Functions | 500k invocations/month | Yes |
| Supabase pausing | After 7 days of inactivity | See section 15 |
| Supabase built-in email | ~2/hour, testing only | Use Brevo |
| Brevo | 300 emails/day | Yes (login codes) |
| Expo Push | Free | Yes |
| EAS Build | 30 builds/month (low priority), or local builds | Yes |
| EAS Update | 1,000 MAU | Yes |
| Cloudflare Pages | 500 builds/month | Yes |
| GitHub private repo + Actions | Free minutes | Yes |

**Launch cost: ₹0.** Customers use the web app (installable on Android and iPhone, with alerts); owner and staff phones get the Android app as a direct APK file (EAS `preview` build or a local build). No store account is needed.

**Only if the owner later chooses to pay (none is needed to launch):**
- Google Play developer account: $25 one-time, for a Play Store listing. New personal accounts must first run a closed test with ≥ 12 testers opted in for 14 continuous days.
- (Claude Code on the personal laptop needs a paid Claude plan during the build; that is the owner's existing plan, not a cost of the app.)
- Domain (~₹800–1,000/year), Apple Developer $99/year (native iOS, later), Supabase Pro $25/month (daily backups, no pausing) when outgrown, a payment gateway (fees).

**Sources:** supabase.com/pricing, supabase.com/docs/guides/database/backups, supabase.com/docs/guides/auth/rate-limits, expo.dev/pricing, docs.expo.dev/push-notifications/faq, support.google.com/googleplay/android-developer/answer/14151465, developers.cloudflare.com/pages/platform/limits, vercel.com/docs/limits/fair-use-guidelines, help.brevo.com/hc/en-us/articles/208580669, webkit.org/blog/13878, supabase.github.io/splinter/0015_rls_references_user_metadata

## 17. Implementation phases

| Phase | Work | Done when |
|---|---|---|
| **0. Setup** | Personal accounts (GitHub, Supabase, Cloudflare, Expo, Brevo, Sentry; Google Play later). Monorepo skeleton (3 apps + shared). TS strict, ESLint, Prettier, gitleaks pre-commit, CI (typecheck, lint, tests, audit, Semgrep, gitleaks). Supabase CLI + local stack. i18n scaffolding. | Empty apps build and run on an Android phone; CI green; local Supabase runs |
| **1. Database + security foundation** | All tables (section 6), constraints, indexes, RLS for all, write functions, triggers (audit, updated_at, version), scheduled jobs skeleton, seed data, **full pgTAP matrix + attack tests** (section 13.3) | All security tests pass; Security Advisor clean; no table without RLS |
| **2. Owner app MVP** | Login + MFA + biometric lock, items, tiffin types, customers + invites, subscriptions, meal slots/cutoffs/overrides, closures, order generation, today dashboard, prep/packing/delivery lists, manual payments, statements | One real day runs in parallel with the paper process with matching counts |
| **3. Customer app MVP** | Invite redemption, home, location (incl. voice + same as yesterday), skip/pause, add-ons with cutoff, box location, balance/history, undo | 3–5 trusted customers use it for a week without issues |
| **3b. Staff app MVP** | Staff invites/roles, assignment (owner side), route by location with directions, packing instructions, mark delivered, box pickup, offline queue, read aloud | One delivery run fully done from the Staff app |
| **4. Notifications** | Expo push + inbox + preferences; all events in section 10; scheduled reminders; daily summary. **Spike:** Web Push (VAPID) for the PWA from Edge Functions; if the library is incompatible, choose an alternative and ask the owner. | Every event fires correctly on Android and on an installed iPhone PWA |
| **5. Full billing + boxes QR + chat** | Monthly bills, PDF/share, UPI QR + UTR flow, advances + low-balance alert, late-skip charging (N free), late-payment fees + overrides + waivers, dues reminders, QR stickers (print + scan), proof photos, chat + voice notes, referrals, special menus/pre-orders | One full month reconciles to the rupee against a manual calculation |
| **6. Expenses, reports, insights** | Expenses/investments (+ voice entry), recurring, budgets, staff salary, ingredients + shopping list, waste entries, reports, heatmap, export, monthly PDF report, insights rules, loyalty (off by default) | P&L matches a manual calculation for one month |
| **7. Hardening + pilot** | Full security review + proxy attack pass, backup + restore drill, retention jobs verified, performance check, accessibility pass, privacy policy + terms, Play closed test (≥ 12 testers × 14 days), PWA install guide for iPhone users | All review findings fixed; restore verified; closed test complete |
| **8. Launch and later** | Play production; Marathi/Hindi; `request_to_join` mode for the public listing; later: native iOS, payment gateway, corporate billing, one-off ordering (cloud kitchen), aggregator order import, multi-branch | — |

## 18. Repository layout

```
tiffin-app/
  apps/
    owner/        Expo app (Android + web)
    customer/     Expo app (Android + PWA)
    staff/        Expo app (Android)
  packages/
    shared/       types (generated from DB), zod schemas, money/date/cutoff helpers,
                  i18n strings, shared UI components
  supabase/
    migrations/   versioned SQL
    functions/    Edge Functions (push, web push, scheduled tasks)
    tests/        pgTAP security matrix + attack tests + business rule tests
    seed.sql
  .github/workflows/  ci.yml, backup.yml (nightly encrypted), retention checks
  docs/           decisions log, runbooks (backup restore, release, incident), privacy policy, terms
```

## 19. Coding conventions

- TypeScript `strict`. DB types are generated (`supabase gen types`) into `packages/shared`.
- Money is always integer paise. Format only at display.
- All dates/times are computed in the DB with `Asia/Kolkata`. Clients never decide cutoffs.
- Every new table needs RLS + policies + pgTAP tests **in the same change**.
- Every client write goes through a named DB function with validation.
- No secrets in the repo. `.env` is git-ignored; `.env.example` holds placeholders only.
- Small, reviewed commits. Run tests before every commit.

## 20. Setup checklist (personal laptop)

1. Install **Node.js LTS**, **Git**, **VS Code**, **Docker Desktop**, **Claude Code** (signed in with the **personal** Claude account).
2. Create (personal email): GitHub (private repo `tiffin-app`), Supabase (2 projects: `amruta-prod`, `amruta-staging`), Cloudflare, Expo, Brevo, Sentry. Enable **2FA on every account**.
3. Android phone with developer options for testing. (A Google Play Console account, $25, only if the owner ever wants a Play listing; not needed.)
4. Get the business UPI QR (PhonePe/Paytm/Google Pay for Business).
5. Open Claude Code in an empty `tiffin-app` folder containing this file and say: **"Read amrutas-kitchen-plan.md and start Phase 0."**

## 21. Outside the app (owner's checklist)

- Food business registration: home food businesses in India generally need **FSSAI registration**. Check the current requirement for your turnover.
- Swiggy/Zomato (future): they onboard through their own partner apps and have their own requirements. Their order APIs are generally for approved POS partners, so plan on manual or imported order entry, not guaranteed integration.

## 22. Open items to confirm with the owner when relevant

- Does the owner have a domain? (Optional; affects only web URLs.)
- Default number of free late skips per month (planned: 1). Confirm in Phase 5.
- Attendance (staff check-in) on or off by default. Confirm in Phase 3b.
- Late-payment fee default values (grace days, amount). Confirm in Phase 5.
