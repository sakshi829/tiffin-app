# Go-live stages: Amruta's Kitchen

Owner: me (the person typing). Project: 3 Expo apps (owner, customer, staff; Expo SDK 58, React Native,
TypeScript, Expo Router) + Supabase (Postgres + RLS, Auth, Storage, Edge Functions on Deno), hosted on
Cloudflare Pages, login emails via Brevo SMTP, Android alerts via Firebase/Expo push, code and nightly
encrypted backups on GitHub. Detailed instructions for every step: docs/SETUP_PERSONAL_LAPTOP.md
(steps 1-20). Tests and expected results: docs/PENDING_AND_TESTING.md. Decisions: docs/DECISIONS.md.

## Rules (always)
- Everything must stay FREE. Never suggest a paid service or plan. The Play Store ($25) and Apple ($99)
  are NOT used: customers use the web app; owner/staff/customers can also get APKs (EAS "preview").
- I do ALL credentials myself. Never ask me to paste a password, database URL with password,
  service_role key, Brevo SMTP key, backup private key, Firebase service-account JSON, Google client
  secret or access token into the chat. Tell me exactly where to type it and wait.
  The Supabase project URL, anon key, project refs and usernames are public; I can share those.
- STAGING first, then PRODUCTION. Never test on production with fake data (money history is permanent).
- After every code change: npm run typecheck and npm test (49 shared + 207 database expected, or more if
  tests were added). Never weaken a test, an RLS rule or a security check to make something pass.
- Never commit secrets, .env.local, google-services.json, keys, node_modules or build output.
- Stop and tell me whenever I must click, log in, download, or type a secret.
- Tick items in docs/PENDING_AND_TESTING.md as they pass.

## My accounts (fill in)
GitHub username: sakshi829  repo: tiffin-app (private)
Supabase staging ref: sotltsasuqsleaqgmotj  prod ref: vdctvgissdgoimgllttk  (region Mumbai, free plan)
Expo username: sakshimanchekar29  Expo organization slug (if any): ____
Brevo: account done, my email verified as sender. Cloudflare, Firebase (Spark plan), Google 2-Step: done.

## Stage 1: Laptop ready ✅
Tools installed, git set up with my personal email, git hooks on, npm ci, tests and typecheck pass.
Node.js 26 is installed (project needs >=22; CI and Cloudflare use 24). If anything fails only on 26,
tell me to install Node 24 LTS.

## Stage 2: Accounts + GitHub ✅
Me: accounts with 2FA (done). Claude: commit and push to the private repo, check nothing secret or
generated is staged, check the GitHub Actions "ci" run is green. Me: run `gh auth login` when asked
(GitHub.com > HTTPS > authenticate Git > web browser).
Done when: CI green.
Done 26 Nov 2026: CI run 45857415970 green (test, secrets-scan, static-analysis). The pending code change
(below) went in first, as 098acf2.

## Stage 3: Staging database (setup steps 4, 5, 6, 13A, 14.2, 15.1)
Claude: `npx supabase link` to STAGING, `npx supabase db push` (all migrations). Guide me in the dashboard:
- Auth > Email: OTP codes; Magic Link and Confirm signup templates must contain {{ .Token }} (6-digit code).
- Auth > SMTP (Brevo): host smtp-relay.brevo.com, port 587, username = the Login shown in Brevo
  SMTP & API > SMTP, password = a new Brevo SMTP key named "supabase-staging" (I generate it and paste it
  into Supabase myself), sender = my verified Brevo sender email, sender name "Amruta's Kitchen".
- Auth > MFA: TOTP on. Sign-ups: enabled.
- Storage: 5 PRIVATE buckets: kitchen-media, delivery-proofs, payment-proofs, receipts (2 MB,
  image/jpeg, image/png, image/webp) and voice-notes (1 MB, audio/mp4, audio/x-m4a, audio/m4a, audio/aac,
  audio/webm). Never public.
Then run supabase/tests/verify_live.sql.
Me: `npx supabase login`, type the staging DB password, Brevo key into Supabase, dashboard clicks.
Done when: verify_live.sql shows no problem rows.

## Stage 4: Owner account + try all 3 apps on staging (setup steps 7, 9, 9b, 9c, 10)
Claude: tell me how to add my user (Auth > Users > Add user, my personal email), give me the
app.bootstrap_kitchen SQL, create .env.local for all 3 apps with the STAGING URL + anon key, start the
owner web app, then customer and staff, and walk me through the step 10 checklist and PENDING sections
E, G, H one item at a time.
Me: add the user, run the SQL, sign in, set up the authenticator app on my phone (save its setup key in
my password manager), do each test.
Done when: step 10 checklist and E, G, H pass.

## Stage 5: Alerts + background jobs on staging (setup steps 11, 13B, 17)
Claude: `eas init` in all 3 apps; Firebase for Android (3 Android apps: com.amrutaskitchen.owner,
com.amrutaskitchen.app, com.amrutaskitchen.staff; google-services.json per app, NOT committed; the FCM V1
service-account key uploaded with `eas credentials`); deploy send-push and media-retention Edge Functions
with verify_jwt = false and CRON_SECRET; Vault secrets + pg_net + the cron jobs (send-push every minute,
media-retention daily 03:30 IST); VAPID keys (scripts/vapid-keys.mjs) for web alerts.
Me: log in to Expo and Firebase, download the files you name, generate and upload the service-account key,
type secrets in the terminal myself.
Done when: functions deployed, `select jobname from cron.job;` lists the jobs, verify_live.sql clean.

## Stage 6: Android test apps on staging (setup steps 11C, 15.7 free path)
Claude: build APKs for all 3 apps with EAS "preview" profile against STAGING; tell me how to install;
walk me through PENDING sections I, K, L (and N, O, P, Q items that can be tested on staging).
Me: install on my phone + a second phone, do the tests.
Done when: those sections pass.

## Stage 7: Security check on staging (setup step 19.3)
Claude: tell me the 7 test users to create (my email with +atk-owner1, +atk-owner2, +atk-custa, +atk-custb,
+atk-custc, +atk-staff, +atk-stranger; auto-confirm; one shared long password), give me
scripts/attack-pass/setup.sql with v_base set to my email, then run scripts/attack-pass/run.mjs --staging
with the STAGING URL + anon key (ATTACK_LIVE_URL = prod URL as a safety catch).
Me: create the users, type the password when the script asks.
Done when: every line PASS (exit code 0).

## Stage 8: Production (repeat stage 3 + stage 4 setup + stage 5 server side on PROD)
Claude: link PROD, db push, same auth settings (a second Brevo key "supabase-prod"), 5 buckets, Edge
Functions + Vault + crons, verify_live.sql, then step 7 for my REAL owner account and kitchen.
Me: same logins/passwords as stage 3 but for prod; authenticator for the real owner account.
Done when: verify_live.sql clean on prod and I can sign in to the owner app on prod.

## Stage 9: Backups + restore drill (setup steps 8, 19.4)
Claude: age-keygen, GitHub secret BACKUP_AGE_PUBLIC_KEY, tell me how to add SUPABASE_DB_URL (prod Session
pooler URL with password) myself, run the nightly-backup workflow once, then run scripts/restore-drill.sh
into STAGING (never plain pg_restore --data-only: it loses data).
Me: type the DB URL into the GitHub secret; keep amruta-backup.key on USB + password manager and delete it
from the laptop after the drill.
Done when: backup workflow green and the drill prints "PASS: every table on staging matches the backup".

## Stage 10: Web apps online (setup steps 15.3, 15.4, 15.5)
Claude: 3 separate Cloudflare Pages projects (customer, owner, staff) from the GitHub repo with the build
commands in step 15.3, env vars per project (NODE_VERSION 24, EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_
SUPABASE_ANON_KEY for PROD, customer also EXPO_PUBLIC_PRIVACY_URL, EXPO_PUBLIC_VAPID_PUBLIC_KEY,
optionally EXPO_PUBLIC_KITCHEN_ID); fill apps/customer/public/privacy.html with my details; give me the
WhatsApp message for customers (Android: Chrome > Install app; iPhone: Share > Add to Home Screen).
Me: log in to Cloudflare, enter env vars in the dashboard, give my name/city/contact for the privacy page.
Done when: all 3 sites load over https and sign-in works on prod.

## Stage 11: Live Android apps (free)
Claude: build APKs (EAS preview) for owner, staff, customer pointed at PROD; install instructions for me,
staff and customers.
Me: install on my phone and staff phones.

## Stage 12: Final checks on live
Claude: walk me through PENDING sections M to Q on PROD (only harmless checks; anything that creates fake
money records is done on staging), pin GitHub Actions versions to commit SHAs (F38), optional F39.
(F38 already done in Stage 2, commit 45433b0: CI needed it to go green.)
Me: do the tests; ask a fluent Marathi and Hindi reader to check the texts (F45).

## Stage 13 (optional): Continue with Google (setup step 20)
Claude: guide me through Google Cloud (OAuth consent screen External, email+profile only, publish; Web
OAuth client with redirect URIs https://<ref>.supabase.co/auth/v1/callback for staging and prod),
Supabase Google provider, Redirect URLs amrutaskitchen://auth-callback, akowner://auth-callback,
akstaff://auth-callback and https://<each site>/auth-callback; then set EXPO_PUBLIC_GOOGLE_SIGNIN=on,
rebuild, test Q19-Q21.
Me: create the client and paste the client secret into Supabase myself.

## Stage 14: Go live
Claude: help me set meal timings, menu, prices, locations; add first customers and staff; create invite
codes; write the WhatsApp messages.
Me: send invites, start.

## After going live
- Monthly: restore drill (setup step 19.4).
- Any change: on staging first, tests must pass, then production.
- Bigger features (corporate billing, one-off orders, more branches) are parked until I ask.

## Pending code change (made after the zip was created; do it in Stage 2 before pushing) ✅ done (098acf2)
In packages/app-core/src/ui/kit.tsx, Screen component, change the ScrollView contentContainerStyle to
{ padding: space.lg, gap: space.md, paddingBottom: 48, width: '100%', maxWidth: 760, alignSelf: 'center' }
with a comment: phones full width; tablets and laptops get a centred column so lines stay readable.
Run typecheck + tests, check the web build at 360, 768 and 1280 px wide, commit "Centred column on wide screens".
