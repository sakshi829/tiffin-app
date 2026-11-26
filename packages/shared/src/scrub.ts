// Error reports (Sentry) must never carry personal data (PLAN 13.2 item 16).
// These pure functions clean an event before it leaves the phone; unit-tested.

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;   // bounded: no catastrophic backtracking
const LONG_NUMBER = /\+?\d[\d -]{5,}\d/g;            // phone numbers, UTRs, amounts with many digits
const BEARER = /(bearer\s{1,5})[A-Z0-9._-]{1,4096}/gi;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const INVITE = /\b[A-Z0-9]{5}-[A-Z0-9]{5}\b/g;        // invite codes

/** Remove emails, phone-like numbers, tokens and invite codes from free text. */
export function scrubText(s: string): string {
  return s.replace(JWT, '[token]').replace(BEARER, '$1[token]').replace(EMAIL, '[email]')
    .replace(INVITE, '[code]').replace(LONG_NUMBER, '[number]');
}

/** Keep only the scheme, host and path of a URL (no query string or fragment). */
export function scrubUrl(u: string): string {
  const cut = u.split(/[?#]/)[0] ?? '';
  return scrubText(cut);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Clean an error event: drop who the user is, request details and extra context;
 * scrub messages, exception values and breadcrumb text. Returns a new object.
 */
export function scrubEvent<T>(event: T): T {
  if (!isObj(event)) return event;
  const e: Obj = { ...event };
  delete e.user;
  delete e.request;
  delete e.extra;
  delete e.server_name;
  if (isObj(e.contexts)) {
    const { os, device, app, runtime } = e.contexts as Obj;   // technical only (model, OS version, app version)
    e.contexts = { os, device: isObj(device) ? { model: device.model, family: device.family, simulator: device.simulator } : undefined, app, runtime };
  }
  if (typeof e.message === 'string') e.message = scrubText(e.message);
  if (isObj(e.exception) && Array.isArray((e.exception as Obj).values)) {
    e.exception = {
      ...(e.exception as Obj),
      values: ((e.exception as Obj).values as unknown[]).map((v) => (isObj(v) && typeof v.value === 'string' ? { ...v, value: scrubText(v.value) } : v)),
    };
  }
  if (Array.isArray(e.breadcrumbs)) {
    e.breadcrumbs = (e.breadcrumbs as unknown[]).map((b) => scrubBreadcrumb(b)).filter((b) => b !== null);
  }
  return e as T;
}

/** Breadcrumbs: console output is dropped; network ones keep only method, path and status. */
export function scrubBreadcrumb<T>(b: T): T | null {
  if (!isObj(b)) return b;
  if (b.category === 'console') return null;
  const out: Obj = { ...b };
  if (typeof out.message === 'string') out.message = scrubText(out.message);
  if (isObj(out.data)) {
    const d = out.data;
    out.data = {
      ...(typeof d.method === 'string' ? { method: d.method } : {}),
      ...(typeof d.url === 'string' ? { url: scrubUrl(d.url) } : {}),
      ...(typeof d.status_code === 'number' ? { status_code: d.status_code } : {}),
      ...(typeof d.to === 'string' ? { to: scrubUrl(d.to) } : {}),
      ...(typeof d.from === 'string' ? { from: scrubUrl(d.from) } : {}),
    };
  }
  return out as T;
}

/** A Sentry DSN looks like https://<public key>@<host>/<project id>. Anything else = reporting stays off. */
export function isValidSentryDsn(dsn: string): boolean {
  return /^https:\/\/[A-Za-z0-9]{16,64}@[A-Za-z0-9.-]+\/\d{1,20}$/.test(dsn);
}
