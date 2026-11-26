#!/usr/bin/env node
// Writes Cloudflare Pages security headers into a web export folder.
//
//   EXPO_PUBLIC_SUPABASE_URL=https://abcd.supabase.co node scripts/web-headers.mjs apps/customer/dist
//
// The Content-Security-Policy allows exactly one backend: YOUR Supabase project
// (not *.supabase.co, which would let injected code send data to anyone's project).
// No third-party scripts, no inline scripts, no framing. Run it after
// `npx expo export --platform web`, as part of the Cloudflare Pages build command
// (docs/SETUP_PERSONAL_LAPTOP.md, step 15).
import fs from 'node:fs';
import path from 'node:path';

export function buildHeaders(supabaseUrl, sentryDsn = '') {
  let api;
  try { api = new URL(supabaseUrl); } catch { throw new Error('EXPO_PUBLIC_SUPABASE_URL is missing or not a URL'); }
  if (api.protocol !== 'https:' || api.pathname !== '/' || api.search || api.hash || api.username) {
    throw new Error(`EXPO_PUBLIC_SUPABASE_URL must be a bare https origin, got ${supabaseUrl}`);
  }
  const origin = api.origin;
  const ws = `wss://${api.host}`;
  const connect = ["'self'", origin, ws];
  if (sentryDsn) {
    let dsn;
    try { dsn = new URL(sentryDsn); } catch { throw new Error('EXPO_PUBLIC_SENTRY_DSN is not a URL'); }
    if (dsn.protocol !== 'https:') throw new Error('EXPO_PUBLIC_SENTRY_DSN must be https');
    connect.push(`https://${dsn.host}`);
  }
  const csp = [
    "default-src 'self'",
    "script-src 'self'",                       // Expo's web export has no inline scripts (checked)
    "style-src 'self' 'unsafe-inline'",        // react-native-web writes its styles at runtime
    `img-src 'self' data: blob: ${origin}`,    // signed photo URLs; data: for the MFA QR code
    `media-src 'self' blob: ${origin}`,        // voice notes
    `connect-src ${connect.join(' ')}`,
    "font-src 'self' data:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  return `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()
  Cross-Origin-Opener-Policy: same-origin

/_expo/static/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: no-cache

/sw.js
  Cache-Control: no-cache
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(path.join(dir, 'index.html'))) {
    console.error('usage: node scripts/web-headers.mjs <web export folder containing index.html>');
    process.exit(1);
  }
  const text = buildHeaders(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '', process.env.EXPO_PUBLIC_SENTRY_DSN ?? '');
  fs.writeFileSync(path.join(dir, '_headers'), text);
  console.log(`wrote ${path.join(dir, '_headers')}`);
}
