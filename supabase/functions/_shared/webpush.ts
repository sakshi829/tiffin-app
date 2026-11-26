// Web Push (for the iPhone/Android web app), using only WebCrypto, so it runs in
// Supabase Edge Functions (Deno) and in the Node tests. No third-party library.
//   - Message encryption: RFC 8291 (Message Encryption for Web Push) with the
//     aes128gcm content coding of RFC 8188.
//   - Server identification: VAPID (RFC 8292), an ES256-signed JWT.
// Verified against http_ece (the RFC author's reference library) and frozen as a
// fixed example in supabase/tests/25-webpush.test.mjs.

const enc = new TextEncoder();
/** Bytes backed by a normal ArrayBuffer (what WebCrypto and fetch accept). */
export type Bytes = Uint8Array<ArrayBuffer>;

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url');
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : s.length % 4 === 0 ? '' : null;
  if (pad === null) throw new Error('bad base64url length');
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** A browser push subscription (PushSubscription.toJSON()). */
export interface WebSubscription { endpoint: string; keys: { p256dh: string; auth: string } }

/**
 * Only real browser push services may be contacted (stops the server being used
 * to call arbitrary URLs: SSRF). Apple, Google/Chrome, Mozilla, Microsoft.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return h === 'web.push.apple.com'
    || h === 'fcm.googleapis.com'
    || h === 'updates.push.services.mozilla.com'
    || /^[a-z0-9-]+\.notify\.windows\.com$/.test(h);
}

/** Validate a stored subscription before using it. */
export function parseSubscription(v: unknown): WebSubscription | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const keys = o.keys as Record<string, unknown> | undefined;
  if (typeof o.endpoint !== 'string' || !isAllowedPushEndpoint(o.endpoint) || !keys) return null;
  const { p256dh, auth } = keys;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  try {
    if (b64urlDecode(p256dh).length !== 65 || b64urlDecode(auth).length !== 16) return null;
  } catch { return null; }
  return { endpoint: o.endpoint, keys: { p256dh, auth } };
}

/**
 * RFC 8291 encryption. `salt` and `serverKeys` are only passed in tests (fixed
 * example); normally both are fresh and random for every message.
 */
export async function encryptPayload(
  sub: WebSubscription, plaintext: Bytes,
  testOnly?: { salt: Bytes; serverKeys: CryptoKeyPair },
): Promise<Bytes> {
  const uaPublic = b64urlDecode(sub.keys.p256dh);
  const authSecret = b64urlDecode(sub.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('bad subscription keys');
  if (plaintext.length > 3993) throw new Error('payload too large');   // 4096-byte record minus overhead

  const serverKeys = testOnly?.serverKeys
    ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256));

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = (await hmac(prkKey, concat(keyInfo, new Uint8Array([1])))).slice(0, 32);

  const salt = testOnly?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  // One record: plaintext followed by the 0x02 "last record" delimiter.
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(plaintext, new Uint8Array([2]))));

  // Header: salt(16) | record size (uint32, 4096) | key id length (65) | as_public
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** VAPID keys from base64url (public: 65-byte uncompressed point; private: 32-byte scalar). */
export async function importVapidKey(publicB64: string, privateB64: string): Promise<CryptoKey> {
  const pub = b64urlDecode(publicB64);
  const d = b64urlDecode(privateB64);
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error('bad VAPID keys');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), d: b64urlEncode(d), ext: true };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** The Authorization header value for one push service (audience = its origin), valid 12 hours. */
export async function vapidAuthorization(endpoint: string, subject: string, publicB64: string, privateKey: CryptoKey, nowSec: number): Promise<string> {
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) throw new Error('VAPID subject must be mailto: or https:');
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${publicB64}`;
}

/** What the browser's service worker receives (kept small; same text as the phone alert). */
export function webPayload(title: string, body: string, data: Record<string, unknown> | null): Bytes {
  const kind = typeof data?.kind === 'string' ? data.kind : undefined;
  return enc.encode(JSON.stringify({ title: title.slice(0, 80), body: body.slice(0, 300), kind }));
}

/** Push service answer → what to do. 201/202 sent; 404/410 the subscription is gone; else try again later. */
export function webPushOutcome(status: number): 'ok' | 'gone' | 'retry' {
  if (status === 201 || status === 202 || status === 200) return 'ok';
  if (status === 404 || status === 410) return 'gone';
  return 'retry';
}
