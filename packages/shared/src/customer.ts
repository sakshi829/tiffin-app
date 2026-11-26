/**
 * Customer-app helpers. These only decide what the screen SHOWS (enabled
 * buttons, countdowns); every action is re-checked by the database.
 */
import type { MyOrder } from './types.ts';

export interface MealActions {
  canChangeExtras: boolean;      // before the extras/skip cutoff
  canSkipFree: boolean;          // skip now = no charge
  canSkipLate: boolean;          // after the cutoff but before delivery: may be charged
  canUnskip: boolean;            // only a free skip, before the cutoff
  canSetLocation: boolean;       // before the location cutoff
  canMarkBox: boolean;           // delivered in the last 3 days
}

export function mealActions(o: Pick<MyOrder, 'status' | 'addon_cutoff_at' | 'location_cutoff_at' | 'delivery_at' | 'order_date'>,
  nowMs: number, todayIso: string): MealActions {
  const beforeAddon = nowMs < Date.parse(o.addon_cutoff_at);
  const beforeLocation = nowMs < Date.parse(o.location_cutoff_at);
  const beforeDelivery = nowMs < Date.parse(o.delivery_at);
  const scheduled = o.status === 'scheduled';
  const threeDaysAgo = new Date(Date.parse(`${todayIso}T00:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10);
  return {
    canChangeExtras: scheduled && beforeAddon,
    canSkipFree: scheduled && beforeAddon,
    canSkipLate: scheduled && !beforeAddon && beforeDelivery,
    canUnskip: o.status === 'skipped' && beforeAddon,
    canSetLocation: scheduled && beforeLocation,
    canMarkBox: o.status === 'delivered' && o.order_date >= threeDaysAgo,
  };
}

/** "2 h 05 min", "45 min", "less than a minute", or null when the time has passed. */
export function formatCountdown(targetIso: string, nowMs: number): string | null {
  const ms = Date.parse(targetIso) - nowMs;
  if (!(ms > 0)) return null;
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return 'less than a minute';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Clock time of an ISO timestamp in India, e.g. "11:00 AM". */
export function istClock(iso: string): string {
  const d = new Date(Date.parse(iso) + 330 * 60_000);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

const UPI_ID = /^[A-Za-z0-9.\-_]{2,64}@[A-Za-z0-9]{2,64}$/;

/** upi://pay link that opens the customer's UPI app with amount and note filled in. */
export function upiPayLink(p: { upiId: string; payeeName: string; amountPaise: number; note: string }): string | null {
  if (!UPI_ID.test(p.upiId) || !Number.isSafeInteger(p.amountPaise) || p.amountPaise <= 0) return null;
  const am = (p.amountPaise / 100).toFixed(2);
  const q = [
    `pa=${encodeURIComponent(p.upiId)}`, `pn=${encodeURIComponent(p.payeeName.slice(0, 50))}`,
    `am=${am}`, 'cu=INR', `tn=${encodeURIComponent(p.note.slice(0, 50))}`,
  ];
  return `upi://pay?${q.join('&')}`;
}

/** Simple, forgiving search for the location picker ("ward5" finds "Ward 5"). */
export function matchesSearch(text: string, query: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const q = norm(query);
  return q === '' || norm(text).includes(q);
}
