/**
 * Money is ALWAYS an integer number of paise (1 rupee = 100 paise).
 * Never use floating-point rupees for storage or arithmetic.
 * The database is the source of truth for prices; these helpers are for display and input only.
 */

export type Paise = number;

const MAX_PAISE = 10_000_000_00; // ₹1 crore: sanity ceiling for any single amount entered in the UI

export function isValidPaise(value: unknown): value is Paise {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_PAISE;
}

/** 12345 -> "₹123.45", 12300 -> "₹123", -500 -> "-₹5" (Indian digit grouping). */
export function formatRupees(paise: Paise, opts: { alwaysShowPaise?: boolean } = {}): string {
  if (!isValidPaise(paise)) throw new RangeError(`Invalid paise amount: ${String(paise)}`);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  const grouped = groupIndian(rupees);
  const decimals = rest !== 0 || opts.alwaysShowPaise ? `.${String(rest).padStart(2, '0')}` : '';
  return `${negative ? '-' : ''}₹${grouped}${decimals}`;
}

/**
 * Parse user-typed rupees ("120", "120.5", "1,200.50", "₹80") into paise.
 * Returns null for anything ambiguous or invalid (more than 2 decimals, letters, negative).
 */
export function parseRupeesToPaise(input: string): Paise | null {
  const cleaned = input.trim().replace(/^₹/, '').replace(/,/g, '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return isValidPaise(paise) ? paise : null;
}

function groupIndian(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const head = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${last3}`;
}
