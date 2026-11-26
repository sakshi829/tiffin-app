/**
 * Calendar dates are ISO strings 'YYYY-MM-DD' in India time (Asia/Kolkata, UTC+5:30, no DST).
 * The DATABASE decides cutoffs; these helpers are only for display and pickers.
 * Implemented without Intl time zones so they behave the same on every phone/JS engine.
 */

import { getDisplayLanguage, MONTH_NAMES, WEEKDAY_NAMES } from './i18n.ts';

export type IsoDate = string;

const IST_OFFSET_MS = 330 * 60 * 1000;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's date in India. */
export function istToday(nowMs: number = Date.now()): IsoDate {
  return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  if (!isIsoDate(date)) throw new RangeError(`Invalid date: ${date}`);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday 1 = Monday ... 7 = Sunday (matches the database days_of_week). */
export function isoWeekday(date: IsoDate): number {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** "Tue, 1 Dec" (adds the year when it differs from `refYear`). */
export function formatDate(date: IsoDate, refYear?: number): string {
  if (!isIsoDate(date)) return date;
  const d = new Date(`${date}T00:00:00Z`);
  const lang = getDisplayLanguage();   // English, Marathi or Hindi day/month names
  const base = `${WEEKDAY_NAMES[lang][d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_NAMES[lang][d.getUTCMonth()]}`;
  return refYear !== undefined && d.getUTCFullYear() !== refYear ? `${base} ${d.getUTCFullYear()}` : base;
}

/** First and last day of the month containing `date`. */
export function monthRange(date: IsoDate): { from: IsoDate; to: IsoDate } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}

/** India date + "HH:MM" (24h) -> ISO timestamp in UTC, e.g. ('2026-12-01','18:00') -> '2026-12-01T12:30:00.000Z'. */
export function istToIso(date: IsoDate, hhmm: string): string {
  if (!isIsoDate(date) || !/^\d{2}:\d{2}$/.test(hhmm)) throw new RangeError(`Invalid date/time: ${date} ${hhmm}`);
  return new Date(Date.parse(`${date}T${hhmm}:00Z`) - IST_OFFSET_MS).toISOString();
}

/** "13:30:00" or "13:30" -> "1:30 PM" */
export function formatTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** Accepts "13:30", "1:30 pm", "9:05am" -> "13:30" (24h), or null if invalid. */
export function parseTime(input: string): string | null {
  const t = input.trim();
  if (t.length > 10) return null;
  const m = /^(\d{1,2})(?::(\d{2}))? ?(am|pm)?$/i.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
