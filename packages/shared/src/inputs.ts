/**
 * Number boxes: what may be typed, and when a value is not finished yet.
 * Phone keyboards only SUGGEST digits (keyboardType); a laptop keyboard or a paste can type
 * anything, so every number box cleans what it gets. The real checks stay where they were
 * (screens on Save, and the database), these only stop obvious mistakes while typing.
 */
export type NumericKind = 'money' | 'signed-money' | 'quantity' | 'integer' | 'phone';

const DECIMALS: Record<'money' | 'signed-money' | 'quantity', number> = { 'money': 2, 'signed-money': 2, 'quantity': 3 };
const WHOLE_DIGITS: Record<'money' | 'signed-money' | 'quantity', number> = { 'money': 8, 'signed-money': 8, 'quantity': 6 };
/** Same ceiling as money.ts MAX_PAISE: ₹1 crore for any single amount. */
export const MAX_RUPEES = 1_00_00_000;

/** Keep only what this kind of box may contain ("₹1,200.505" -> "1200.50", "12abc" -> "12"). */
export function cleanNumericInput(kind: NumericKind, raw: string): string {
  const text = raw ?? '';
  if (kind === 'phone') {
    const plus = /^\s*\+/.test(text);
    const rest = text.replace(/[^\d\s-]/g, '').replace(/\s{2,}/g, ' ').replace(/-{2,}/g, '-').replace(/^[\s-]+/, '');
    return (plus ? '+' : '') + rest;
  }
  if (kind === 'integer') return text.replace(/\D/g, '');
  const negative = kind === 'signed-money' && /^\s*[-−–]/.test(text);
  const kept = text.replace(/[^\d.]/g, '');
  const dot = kept.indexOf('.');
  let whole = dot === -1 ? kept : kept.slice(0, dot);
  let frac = dot === -1 ? '' : kept.slice(dot + 1).replace(/\./g, '');
  whole = whole.slice(0, WHOLE_DIGITS[kind]);
  frac = frac.slice(0, DECIMALS[kind]);
  return (negative ? '-' : '') + whole + (dot === -1 ? '' : '.' + frac);
}

export type NumericProblem = 'unfinished' | 'range' | 'too-large' | null;

/** Why a cleaned value can't be used yet (shown under the box while typing). Empty = no problem. */
export function numericInputProblem(kind: NumericKind, value: string, range?: { min?: number; max?: number }): NumericProblem {
  const v = (value ?? '').trim();
  if (v === '' || kind === 'phone') return null;
  if (kind !== 'integer' && (/^-?\.?$/.test(v) || v.endsWith('.'))) return 'unfinished';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'unfinished';
  if (kind !== 'integer' && kind !== 'quantity' && Math.abs(n) > MAX_RUPEES) return 'too-large';
  if (range && ((range.min !== undefined && n < range.min) || (range.max !== undefined && n > range.max))) return 'range';
  return null;
}
