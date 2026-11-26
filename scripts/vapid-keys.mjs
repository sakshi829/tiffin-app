#!/usr/bin/env node
// Makes the key pair that identifies YOUR server to browser push services (VAPID).
// Run once on your personal laptop:   node scripts/vapid-keys.mjs
//   - VAPID_PUBLIC_KEY  -> Supabase Edge Function secret AND every app's EXPO_PUBLIC_VAPID_PUBLIC_KEY (public; fine in the apps)
//   - VAPID_PRIVATE_KEY -> Supabase Edge Function secret ONLY (never in an app, file or chat)
//   - VAPID_SUBJECT     -> Supabase secret: mailto:<your email> (push services contact this address if something is wrong)
// Making new keys later means every browser has to turn alerts on again.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
console.log(`VAPID_PUBLIC_KEY=${b64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log('VAPID_SUBJECT=mailto:you@example.com   <- change to your email');
