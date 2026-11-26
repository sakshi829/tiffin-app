# Setup on your personal laptop

Everything here uses **your personal accounts** and is done **only on your personal laptop**.
Never log in to these accounts on the job laptop, and never paste keys into chat, email or code.

Free-tier limits were checked on 20 Nov 2026. Check them again when you sign up (PLAN.md section 16).

**Tick your progress in [PENDING_AND_TESTING.md](PENDING_AND_TESTING.md).** It lists every step below with its test and expected result.

---

## 1. Install tools

| Tool | Why |
|---|---|
| Node.js 24 LTS | runs the project and tests |
| Git | version control |
| VS Code | editor |
| Claude Code (signed in with your **personal** Claude account) | continue building |
| gitleaks (https://github.com/gitleaks/gitleaks#installing) | blocks secrets from being committed |
| age (https://github.com/FiloSottile/age#installation) | encrypts/decrypts backups |
| Docker Desktop (optional) | only for running a full local Supabase later |

## 2. Copy the project and check it

1. Copy the `tiffin-app` folder from the USB drive or personal Google Drive. **Don't copy `node_modules`**; it is reinstalled below.
2. In a terminal inside `tiffin-app`:
   ```bash
   git init
   git config user.name  "Your Name"
   git config user.email "your-personal-email@example.com"   # personal, NOT work
   git config core.hooksPath scripts/git-hooks                 # turns on the secret blocker
   npm ci
   npm test            # expect: 49 + 207 passing (all green)
   npm run typecheck   # expect: no errors
   ```

## 3. Create accounts (personal email, turn on 2FA on every one)

| Service | What to create |
|---|---|
| GitHub | a **private** repo `tiffin-app` (empty, no README) |
| Supabase | project `amruta-prod`, region **Mumbai (ap-south-1)** if offered. Save the database password in a password manager |
| Supabase | project `amruta-staging` (free plan allows 2) |
| Brevo | free account → SMTP key (for login emails) |
| Google Cloud | OAuth client (for "Sign in with Google"), done in Phase 2 with Claude |
| Expo | account (builds), Phase 2 |
| Cloudflare | account (web hosting), Phase 2 |
| Sentry | account (error reports), Phase 2 |

Push the code:
```bash
git add -A
git status            # check: no .env, no keys, no node_modules
git commit -m "Phase 0 + Phase 1: project setup, database, security, tests"
git branch -M main
git remote add origin https://github.com/<your-username>/tiffin-app.git
git push -u origin main
```
Open the repo's **Actions** tab: `ci` should go green.

## 4. Deploy the database (staging first, then production)

```bash
npx supabase login
npx supabase init            # creates supabase/config.toml; keep the existing migrations folder
npx supabase link --project-ref <staging-project-ref>
npx supabase db push         # applies supabase/migrations in order
```
Repeat `link` + `db push` with the **production** project ref when staging is verified.

## 5. Auth settings (Supabase dashboard → Authentication)

- **Providers:** enable **Google** (Phase 2) and **Email** with OTP codes. The apps will not offer passwords.
- **SMTP:** set Brevo as custom SMTP (Supabase's built-in mailer allows only ~2 emails/hour).
- **Email templates** (Authentication → Emails): in **Magic Link** and **Confirm signup**, include `{{ .Token }}` so people receive a **6-digit code**, e.g. "Your Amruta's Kitchen code is {{ .Token }}". The apps use codes, not links.
- **MFA:** enable **TOTP** (authenticator app).
- **Sign-ups:** leave enabled. A new login sees **nothing** until it redeems an invite (enforced in the database).

## 6. Verify security on the real project

Open **SQL Editor** → paste and run [supabase/tests/verify_live.sql](../supabase/tests/verify_live.sql).
Every check must return **zero rows**, and the last one must say `ok`. If anything shows up, **stop** and fix it before using the app.

## 7. Create the kitchen and your owner account

1. Dashboard → Authentication → **Add user** with your personal email.
2. Copy that user's ID, then in the SQL Editor run:
   ```sql
   select app.bootstrap_kitchen('Amruta''s Kitchen', '<your-user-id>', 'Amruta');
   ```
   This creates the kitchen, settings, lunch 13:30 / dinner 20:30, default expense categories and your owner role.
3. Owner access requires MFA. You set up your authenticator the first time you sign in to the Owner app (step 9).

## 8. Nightly encrypted backups

1. Create a backup key pair:
   ```bash
   age-keygen -o amruta-backup.key
   ```
   It prints a **public key** starting with `age1...`.
   Keep `amruta-backup.key` (the **private** key) **offline**: a USB drive plus a copy in your password manager. **Never upload it anywhere.** Without it, backups can't be read, by anyone, including you.
2. GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**:
   - `BACKUP_AGE_PUBLIC_KEY` = the `age1...` public key
   - `SUPABASE_DB_URL` = production **Session pooler** connection string (Supabase → Connect → Session pooler), with your DB password. The direct connection is IPv6-only, and GitHub runners have no IPv6.
3. Actions → `nightly-backup` → **Run workflow** once. It must finish green and produce a `.age` artifact.
4. **Test a restore** into the staging project with `scripts/restore-drill.sh` (step 19.4). Do not use plain `pg_restore --data-only`: tried on a test copy, it lost data, because the database's safety rules ran again while loading.

## 9. Run the Owner app

1. Supabase → Project Settings → API: copy the **Project URL** and the **anon / publishable** key (never the service_role key).
2. Create `apps/owner/.env.local` (git-ignored):
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   ```
   Use the **staging** project while testing.
3. Start it:
   ```bash
   cd apps/owner
   npx expo start
   ```
   - **Android phone:** install **Expo Go** and scan the QR code. If Expo Go reports a missing native module, build a development app instead: `npx expo run:android` (needs Android Studio) or `npx eas-cli@latest build --profile development --platform android`.
   - **Laptop browser:** press `w`.
4. First sign-in: your email → 6-digit code → **set up the authenticator** (tap "Open authenticator app" on the phone, or type the setup key) → enter its code.
   **Save the setup key in your password manager.** It lets you add the same authenticator to a new phone if you lose this one.
5. Lost both the phone and the key? In the Supabase SQL editor (as the database owner) remove the factor, then sign in again and set up a new one:
   ```sql
   delete from auth.mfa_factors where user_id = '<your-user-id>';
   ```

### 9b. Run the Customer app

1. Create `apps/customer/.env.local` with the **same** two lines as the owner app (staging URL + anon key).
2. Make sure **Authentication → Sign-ups are enabled** and the **Confirm signup** email template contains `{{ .Token }}` (new customers get a code, not a link).
3. `cd apps/customer && npx expo start`. Open on a second phone (Expo Go) or press `w` for the browser.
4. Follow the Phase 3 checklist in [PENDING_AND_TESTING.md](PENDING_AND_TESTING.md) section **G**.

### 9c. Run the Staff app

1. Create `apps/staff/.env.local` with the same two lines (staging URL + anon key).
2. `cd apps/staff && npx expo start`, then open it on the delivery person's phone (Expo Go or a development build).
3. Follow the Phase 3b checklist in [PENDING_AND_TESTING.md](PENDING_AND_TESTING.md) section **H**.

## 10. Phase 2 acceptance checklist (staging project)

Tick every line before using the app with real customers:

- [ ] Sign in with the email code; authenticator setup works; signing out and in again asks for the authenticator code.
- [ ] Phone: after 2+ minutes in the background, the app asks for fingerprint/PIN.
- [ ] Menu: add items (e.g. Roti main, Egg / Salad / Bhakri extras, customer can request), set prices (asks for the authenticator code), build "Veg Standard" and "Non-Veg" tiffin types with fixed prices.
- [ ] More › Locations: add a place and a few wards/labs with directions.
- [ ] More › Meal timings: set your real lunch/dinner times. Check the cutoff text on Today matches.
- [ ] Customers: add 2 test customers, give each a lunch and/or dinner plan, and check Today shows them for today .. +7 days.
- [ ] Create an invite code (shown once). Use it in the Customer app (section G of PENDING_AND_TESTING.md).
- [ ] Today › Delivery: mark one delivered, one not delivered (with reason), one skipped. Customers › balance changes only for the delivered one.
- [ ] Record a cash payment; tap Save twice quickly and check only one payment appears.
- [ ] Statement: shows opening, meals, extras, payment and the right balance; "Save as bill" works once for the same dates.
- [ ] Days off: add one for tomorrow's lunch. Today (tomorrow) shows those meals as Closed. Undo restores them.
- [ ] Change an item price from tomorrow: today's already-cut-off meals keep the old price; later ones show the new one.
- [ ] Run `supabase/tests/verify_live.sql` again (all zero rows / `ok`).

Note anything that looks wrong and give it to Claude in the next session.

## 11. Phone alerts (push notifications), Phase 4

Alerts always appear **inside the apps** (Alerts tab / More › Alerts) without any of this. These steps add **phone pop-ups** on Android.
Facts checked in Expo's SDK 58 docs (Nov 2026): push does **not** work in Expo Go (a development build is needed), and Expo's push module has **no web support** (iPhone web-app users see alerts in the app only, PENDING F5).

**A. Link each app to Expo (gives the push project id)**
```bash
cd apps/owner && npx eas-cli@latest init      # repeat in apps/customer and apps/staff
```
This writes `extra.eas.projectId` into each `app.json`. Commit that change.

**B. Firebase (Android delivery)**, following https://docs.expo.dev/push-notifications/fcm-credentials/ :
1. Firebase console → create a project → add **three Android apps** with the package names `com.amrutaskitchen.owner`, `com.amrutaskitchen.app`, `com.amrutaskitchen.staff`.
2. Download each app's `google-services.json` into that app's folder and add `"googleServicesFile": "./google-services.json"` under `android` in its `app.json`.
   Our `.gitignore` excludes `google-services.json`, so it is **not** uploaded by EAS from git. Follow Expo's guide for providing it to EAS builds (EAS file environment variable / `.easignore`), and **check this when making the first build**.
3. Firebase → Project settings → Service accounts → generate a key (JSON). Upload it with `npx eas-cli@latest credentials` (Android → Google Service Account → FCM V1). **Never commit this JSON.**

**C. Development build** (per app, on your phone):
```bash
npx eas-cli@latest build --profile development --platform android
```
Install the APK from the link, then `npx expo start --dev-client`.

**D. Deploy the push sender (Edge Function `send-push`)**
1. Make a random secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. In `supabase/config.toml` add:
   ```toml
   [functions.send-push]
   verify_jwt = false
   ```
   (The scheduler has no user login. The function instead requires the `x-cron-secret` header.)
3. ```bash
   npx supabase secrets set CRON_SECRET=<the random secret>
   # optional, recommended: turn on "enhanced push security" at expo.dev → Access tokens, then:
   npx supabase secrets set EXPO_ACCESS_TOKEN=<expo access token>
   npx supabase functions deploy send-push
   ```

**E. Run it every minute** (Database → Extensions: enable **pg_net**; pg_cron is already on). In the SQL editor:
```sql
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
select vault.create_secret('<the same random secret>', 'push_cron_secret');
select cron.schedule('send-push-every-minute', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    body := '{}'::jsonb);
$$);
```
This secret can only trigger a send run; it gives no access to data. (Supabase notes that pg_net briefly keeps request headers in `net.http_request_queue`, which is another reason not to send the service key from cron.)

**F. Test:** follow [PENDING_AND_TESTING.md](PENDING_AND_TESTING.md) section **I**.

## 12. Continue building

Open Claude Code in `tiffin-app` and say:

> Read PLAN.md and docs/STATUS.md, then continue with the next phase.

## 13. Private files: photos, screenshots, voice notes (Phase 5b)

**A. Create 4 PRIVATE buckets** (Dashboard → Storage → New bucket). Supabase recommends creating buckets in the dashboard / API, not with SQL. The access rules themselves are already in the migrations.

| Bucket name (exact) | Public? | Max file size | Allowed types |
|---|---|---|---|
| `kitchen-media` | **No** | 2 MB | `image/jpeg, image/png, image/webp` |
| `delivery-proofs` | **No** | 2 MB | `image/jpeg, image/png, image/webp` |
| `payment-proofs` | **No** | 2 MB | `image/jpeg, image/png, image/webp` |
| `voice-notes` | **No** | 1 MB | `audio/mp4, audio/x-m4a, audio/m4a, audio/aac, audio/webm` |

Never tick "Public bucket": every file is shown through 5-minute private links only.

**B. Automatic deletion after 30 days** (delivery photos, voice notes; payment screenshots after 400 days). Files must be deleted through the Storage API (deleting rows in SQL leaves the file billed), so a small Edge Function does it:
1. In `supabase/config.toml` add:
   ```toml
   [functions.media-retention]
   verify_jwt = false
   ```
2. `npx supabase functions deploy media-retention` (it uses the same `CRON_SECRET` as `send-push`).
3. SQL editor (Vault secrets from step 11 E):
   ```sql
   select cron.schedule('media-retention-daily', '0 22 * * *', $$   -- 03:30 IST
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/media-retention',
       headers := jsonb_build_object('Content-Type', 'application/json',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
       body := '{}'::jsonb);
   $$);
   ```

**C. Check:** run `supabase/tests/verify_live.sql` again. It now also fails if a bucket is missing or public, or if a storage access rule is missing.

**D. Phone builds:** camera, photo and microphone permission messages are already in each `app.json`. After this phase, **make new development builds** (step 11 C), because new native modules were added (camera, image picker, audio, print, sharing). Expo Go may not include all of them.

**E. Test:** follow [PENDING_AND_TESTING.md](PENDING_AND_TESTING.md) section **K**.

## 14. Expenses, receipts and reports (Phase 6)

1. `npx supabase db push` (staging first). This adds the expense, budget, ingredient, waste and loyalty tables, the report functions and the daily `finance-jobs` job (08:30 IST: "rent is due" alerts).
2. **Create a 5th PRIVATE bucket** (Dashboard → Storage → New bucket):

   | Bucket name (exact) | Public? | Max file size | Allowed types |
   |---|---|---|---|
   | `receipts` | **No** | 2 MB | `image/jpeg, image/png, image/webp` |

   Only you (the owner) can upload or see receipts. They are **not** deleted after 30 days, because they are part of your accounts.
3. Run `supabase/tests/verify_live.sql`: no problem rows. Check `select jobname from cron.job;` lists `finance-jobs`.
4. No new native modules in this phase. A development build made after step 13 works; Expo Go is fine for the web version.
5. **Test:** [PENDING_AND_TESTING.md](PENDING_AND_TESTING.md) section **L**.

## 15. Hardening, web hosting, privacy and Play Store (Phase 7)

**1. Database.** `npx supabase db push` (staging first). Then make sure **all 5 buckets** have their limits (Dashboard → Storage → bucket → Edit):

| Bucket | Max file size | Allowed types |
|---|---|---|
| `kitchen-media`, `delivery-proofs`, `payment-proofs`, `receipts` | 2 MB | `image/jpeg, image/png, image/webp` |
| `voice-notes` | 1 MB | `audio/mp4, audio/x-m4a, audio/m4a, audio/aac, audio/webm` |

Run `supabase/tests/verify_live.sql`: no problem rows (it now also checks these limits).

**2. Backups + restore drill.**
- Re-run Actions → `nightly-backup` once (it now leaves out login sessions and one-time codes; after a restore people just sign in again).
- **Drill** (do it now, then monthly): push the migrations to **staging** so its tables exist, then run `scripts/restore-drill.sh` (step 19.4). It compares every table with the backup for you. Write the date in your notes.
- Optional (F39): GitHub → Settings → Environments → New environment `production` → Deployment branches: **main only** → move `SUPABASE_DB_URL` and `BACKUP_AGE_PUBLIC_KEY` there, then add `environment: production` under `backup:` in `.github/workflows/backup.yml`.

**3. Web hosting (Cloudflare Pages).** Two **separate** Pages projects (so the owner and customer sites never share browser storage), both connected to your GitHub repo:

| Project | Build command | Output folder |
|---|---|---|
| customer (`amrutas`) | `npm ci && npm --workspace @amruta/customer exec -- expo export --platform web && node scripts/web-headers.mjs apps/customer/dist` | `apps/customer/dist` |
| owner (`amrutas-owner`) | `npm ci && npm --workspace @amruta/owner exec -- expo export --platform web && node scripts/web-headers.mjs apps/owner/dist` | `apps/owner/dist` |
| staff (`amrutas-staff`, for staff with iPhones; Phase 8a) | `npm ci && npm --workspace @amruta/staff exec -- expo export --platform web && node scripts/web-headers.mjs apps/staff/dist` | `apps/staff/dist` |

Environment variables (Production) for each: `NODE_VERSION` = `24`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`; customer also `EXPO_PUBLIC_PRIVACY_URL` = `https://<customer site>/privacy.html`. The headers script **refuses** to build without an `https://` Supabase URL. If the workspace command differs, `cd apps/customer && npx expo export --platform web` does the same. Check: PENDING **M14**.

**4. Privacy policy.** Fill every `[BRACKET]` in `apps/customer/public/privacy.html` (your name, city, contact email/phone, Supabase region, date), commit, redeploy. It is served at `https://<customer site>/privacy.html`. Have someone you trust read it; it describes exactly what the app does but is not legal advice.

**5. Tell iPhone customers how to install** (send on WhatsApp):
> Open https://<customer site> in **Safari** → tap **Share** → **Add to Home Screen** → open Amruta's from the home screen → sign in with the code we email you. (Alerts appear inside the app on iPhone.)

Android customers install from the Play Store link once it exists; meanwhile Chrome → ⋮ → **Install app** works too.

**6. Attack pass (staging).** First run the automated pass (step 19.3); then, by hand: install OWASP ZAP (free) or Burp Community. Set the phone or browser to use it as a proxy, sign in as customer A, and for each request you see, try changing it and resending:
- another customer's id or order id;
- a price or amount (₹1, −5, 999);
- a date in the past, or after the cutoff;
- an extra field (`"kitchen_id"`, `"user_id"`, `"status":"delivered"`);
- calling an `owner_*` function as a customer;
- uploading a `.exe` renamed `.jpg`;
- the same request 50 times.

Every one must be refused or change nothing (PENDING **M21**). Note anything that succeeds and ask Claude to fix it.

**7. Getting the apps onto phones, free.**
- **Customers (Android and iPhone):** send the customer web link on WhatsApp with the step 5 message. On Android, Chrome › ⋮ › **Install app**; on iPhone, Share › **Add to Home Screen**. Alerts work in both (step 17).
- **Owner and staff (Android):** `npx eas-cli@latest build --platform android --profile preview` in `apps/owner` and `apps/staff` (free EAS plan, about 30 builds a month). Download the `.apk`, send it to the phone, open it and allow "Install unknown apps" for that one install. Staff with iPhones use the staff web app.
- Optional: Android customers who prefer an app can get the customer `.apk` the same way.

**Optional, paid ($25 one-time), only if you ever want a Play Store listing. Skip it for the free setup:** Play Store closed test (customer app; F8):
1. Google Play Console developer account ($25, one-time). Create the app **Amruta's Kitchen**, package `com.amrutaskitchen.app`.
2. In `apps/customer`: `npx eas-cli@latest init` (if not done in step 11 A), then `npx eas-cli@latest build --platform android --profile production` → download the `.aab`. (`eas.json` and the development client are already in each app since Phase 7b.)
3. Play Console → Testing → **Closed testing** → create a track → upload the `.aab` → add at least **12 testers** (a Google Group or emails) → they opt in from the link → keep it running **14 days**.
4. Store listing: privacy policy URL = `https://<customer site>/privacy.html`; **Delete account URL** = `https://<customer site>/privacy.html#delete`.
5. **Data safety** form, from what the app does (check each against privacy.html):
   - Personal info: name, email, phone, address (the delivery place).
   - Financial info: purchase history (meals, bills).
   - Messages: in-app messages.
   - Photos: payment screenshots.
   - Audio: voice notes.
   - Device IDs: the push token.
   - All of it: collected, not shared, encrypted in transit; users can request deletion.
   - No location, no contacts, no ads.
6. Owner and staff apps are not on the store: `npx eas-cli@latest build --platform android --profile preview` makes an APK (profile already in `eas.json`); install the file directly.

**8. Test:** [PENDING_AND_TESTING.md](PENDING_AND_TESTING.md) section **M**.

## 16. Launch prep (Phase 7b)

1. `npx supabase db push` (staging first): push receipts, sign-in alerts, live chat, clean-up of unused receipts, the heatmap report. Nothing new to schedule: the existing `send-push` job (every minute) now also checks push receipts, and the daily `media-retention` job also tidies references and unused receipts.
2. **Redeploy both Edge Functions** (they changed): `npx supabase functions deploy send-push` and `npx supabase functions deploy media-retention` (exactly as in steps 11 D and 13; `config.toml` already keeps their scheduler-secret setup).
3. **Sentry (optional, free plan):** create an account and a project per app (React Native), copy each project's **DSN**:
   - Phones: put `EXPO_PUBLIC_SENTRY_DSN=...` in each app's `.env.local` (or as an EAS environment variable), then build.
   - Web: add the same variable to each Cloudflare Pages project; the headers script then allows only that Sentry address.
   - Uploading source maps is switched **off** (`SENTRY_DISABLE_AUTO_UPLOAD` in `eas.json`), so builds need no Sentry login. Reports still work; stack traces show bundle positions. To get readable traces later, follow Sentry's Expo guide for an auth token and remove that line.
   - In Sentry → Project settings → Security & Privacy, also switch on **Data scrubbing** and **Prevent storing of IP addresses** (a second layer behind the app's own scrubbing).
4. **New builds for all 3 apps** (new native modules: app lock in the customer app, screenshot blocking in the owner app, Sentry, development client): `npx eas-cli@latest build --profile development --platform android` in each app folder, install, then `npx expo start --dev-client`.
5. Realtime is on by default in Supabase; check Project › Realtime is enabled.
6. **Test:** [PENDING_AND_TESTING.md](PENDING_AND_TESTING.md) section **N**.

## 17. iPhone (Phase 8a)

**A. Alerts in the web app (free, works today):**
1. `node scripts/vapid-keys.mjs` on your laptop. It prints three lines.
2. Supabase → Edge Functions → Secrets: add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:` + your email). The private key goes **only** here.
3. Add `EXPO_PUBLIC_VAPID_PUBLIC_KEY` = the public key to all three Cloudflare Pages projects (and each app's `.env.local`), then redeploy the sites.
4. `npx supabase db push` (staging first) and `npx supabase functions deploy send-push`.
5. Make the **staff** web site too if any staff use iPhones (step 15.3 table).
6. Tell iPhone users: Safari → site → **Share → Add to Home Screen** → open from the icon → Alerts → **Turn on alerts**. (iOS 16.4 or newer.)
7. Test: PENDING section **O**.

Making new VAPID keys later means every browser must turn alerts on again, so keep the three values in your password manager.

**B. Native iPhone apps (optional, $99/year):** decision 16 was "web app first, native iPhone later". The code and settings are ready, so when you want it:
1. Join the Apple Developer Program (personal Apple ID, $99/year).
2. `npx eas-cli@latest build --platform ios --profile production` in an app folder (EAS builds in the cloud; no Mac needed). EAS asks for your Apple login and creates the certificates and the push key (APNs) for you.
3. `npx eas-cli@latest submit --platform ios` → TestFlight → install on your iPhone → test (PENDING O11).
4. App Store review needs: privacy policy URL (step 15.4), "App Privacy" answers (same as the Play Data safety in step 15.7), screenshots, and **a login the reviewer can use**. Our sign-in emails a code, which a reviewer can't receive: see PENDING **F43** (planned for Phase 8b; Google Play's "App access" form has the same need).

## 18. Languages, join requests, store review (Phase 8b)

1. `npx supabase db push` (staging first).
2. **Store-review login** (only if you publish to the Play Store or App Store, both paid; skip it for the free setup):
   1. Supabase → Authentication → Users → **Add user → Create new user** twice, with "Auto confirm" on:
      - `reviewer@<your domain or a new mailbox>` with a **long random password** (24+ characters, from your password manager);
      - `demo-owner@…` with any long password. Nobody signs in as this one; it only owns the demo kitchen.
   2. SQL editor (production): `select app.create_review_demo('reviewer@…', 'demo-owner@…');` It creates "Demo Kitchen (store review)" with a sample menu, a hospital ward and lunches for the next days, and links the reviewer to it. Your real kitchen is untouched and invisible to the reviewer.
   3. Put the reviewer email + password in Play Console → App content → **App access**, with: *Tap "App store reviewer? Sign in with a password" on the first screen.*
   4. After approval: `select app.end_review_demo('reviewer@…');` then delete the reviewer user (Authentication → Users). Repeat 2.1–2.3 for the next review.
3. **Request to join (optional):** find your kitchen id with `select id, name from public.kitchens;`, set `EXPO_PUBLIC_KITCHEN_ID=<that id>` for the customer app (`.env.local` / EAS / Cloudflare), rebuild. Then Owner app › Business settings › Sign-up → "Requests" when you want strangers to be able to ask. Leave "Invite code only" otherwise.
4. **Languages:** nothing to configure. Have a fluent Marathi and Hindi reader go through the app (PENDING F45). Fixes go in `packages/shared/src/i18n-mr.ts` / `i18n-hi.ts` (only the text on the right; keep the {placeholders}), then `npm test`.
5. **Store listing:** `docs/STORE_LISTING.md` has the text in all three languages.
6. Test: PENDING section **P**.

## 19. Staff and alert languages, loyalty progress, attack pass, restore drill (Phase 8c)

1. **Database:** `npx supabase db push` to **staging**, run `verify_live.sql`, try PENDING Q2–Q5 there, then push to production.
2. **New builds:** all three apps (the staff app's settings changed for F42, and every app has the new switches). Web apps redeploy on push.
3. **Automated attack pass (staging only).** Needs Node 24 and this repo (`npm ci` done).
   1. Staging dashboard › Authentication › Users › **Add user** (tick "Auto confirm") seven times, all with the **same** long password, using your own address with `+atk-…` added: `you+atk-owner1@gmail.com`, `+atk-owner2`, `+atk-custa`, `+atk-custb`, `+atk-custc`, `+atk-staff`, `+atk-stranger` (Gmail delivers all of them to you; nothing is sent anyway).
   2. Open `scripts/attack-pass/setup.sql`, put your address in `v_base`, paste it into the **staging** SQL editor, run. It ends with "Attack fixture ready".
   3. In a terminal (staging URL and **anon** key from staging › Project Settings › API; the live project URL only as a safety catch):
      ```bash
      ATTACK_SUPABASE_URL=https://<staging-ref>.supabase.co ATTACK_ANON_KEY=<staging anon key> \
      ATTACK_LIVE_URL=https://<live-ref>.supabase.co ATTACK_EMAIL_BASE=you@gmail.com ATTACK_PASSWORD='<that password>' \
      node scripts/attack-pass/run.mjs --staging
      ```
      Every line must say **PASS** (exit code 0). A FAIL line shows what got through: send it to Claude and don't go live until it's fixed.
   4. Optional: `scripts/attack-pass/teardown.sql` (same `v_base`) unlinks the test users; then delete them.
4. **Restore drill (monthly).** Needs `age` and the PostgreSQL 17 client tools. Download the latest `backup-…` artifact from GitHub Actions and unzip it, then:
   ```bash
   STAGING_DB_URL='<staging Session pooler URL with password>' LIVE_PROJECT_REF=<live-ref> \
   bash scripts/restore-drill.sh amruta-XXXX.dump.age amruta-backup.key --wipe-staging <staging-ref>
   ```
   It **replaces all data on staging** with the backup (everyone signs in to staging again), all or nothing, and refuses the live project. Expected: "PASS: every table on staging matches the backup row for row." and no problem rows from verify_live. Photos and voice notes are files, not database rows: they are not in this backup (Supabase keeps them; see PENDING M for retention).
   **In a real emergency** (live database lost), the same script restores into a new project: create it, `supabase db push`, then run the script with that project's URL and ref.
5. **Owner app language (8d):** owner sign-in screen or More › Language. Your alerts and Money › Suggestions follow it after the next one arrives. Have a fluent reader check the owner screens too (PENDING F45). Printed/exported documents stay English (decision T114).
6. Test: PENDING section **Q** (Q1–Q16).

## 20. Continue with Google (optional, free; Phase 8e)

Do this only if you want the Google button; email codes keep working either way. Everything here is free.
1. **Google Cloud** (console.cloud.google.com, with your personal Google account): New project "Amruta's Kitchen" › APIs & Services › **OAuth consent screen**: External; app name, your support email; scopes only email and profile (no review needed for these); publish it ("In production").
2. **Credentials › Create credentials › OAuth client ID › Web application.** Authorized redirect URI: `https://<live-ref>.supabase.co/auth/v1/callback` (add the staging one too: `https://<staging-ref>.supabase.co/auth/v1/callback`). Copy the Client ID and Client secret.
3. **Supabase › Authentication › Sign In / Providers › Google:** enable, paste the Client ID and secret (the secret goes **only** here, never into an app or file). Do it on staging first.
4. **Supabase › Authentication › URL Configuration › Redirect URLs:** add
   `amrutaskitchen://auth-callback`, `akowner://auth-callback`, `akstaff://auth-callback`,
   `https://<customer site>/auth-callback`, `https://<owner site>/auth-callback`, `https://<staff site>/auth-callback`.
5. Set `EXPO_PUBLIC_GOOGLE_SIGNIN=on` for each app (`.env.local`, the Cloudflare Pages variables and EAS), then rebuild / redeploy.
6. Test: PENDING **Q19–Q21**.

## Never do

- Put the Supabase **service_role** key, DB password or the backup private key in any app, file in the repo, chat or email.
- Commit `.env` files (they are git-ignored, and the pre-commit hook and CI also scan for secrets).
- Use your work laptop, work email or work GitHub for this project.
