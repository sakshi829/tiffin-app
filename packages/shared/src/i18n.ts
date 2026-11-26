// Languages (decision 17): English, Marathi, Hindi.
// The ENGLISH text is the key: screens call t('Send code'); the Marathi and Hindi
// dictionaries map that English to the translation. Anything missing shows in
// English (never blank). i18n.test.ts checks that every text the customer app
// shows has both translations with the same {placeholders}.
import { MR } from './i18n-mr.ts';
import { HI } from './i18n-hi.ts';

export type Lang = 'en' | 'mr' | 'hi';
export const LANGUAGES: readonly { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'mr', label: 'मराठी' },
  { value: 'hi', label: 'हिन्दी' },
];
export const DICTIONARIES: Record<Exclude<Lang, 'en'>, Readonly<Record<string, string>>> = { mr: MR, hi: HI };

let current: Lang = 'en';
/** Set by the app's language provider; used by shared display helpers (dates, meal times). */
export function setDisplayLanguage(lang: Lang): void { current = lang; }
export function getDisplayLanguage(): Lang { return current; }

export type Vars = Readonly<Record<string, string | number>>;

/** Replace {name} placeholders. Unknown placeholders stay visible (so a mistake is noticed, not hidden). */
export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function translate(text: string, vars?: Vars, lang: Lang = current): string {
  const t = lang === 'en' ? text : (DICTIONARIES[lang][text] ?? text);
  return interpolate(t, vars);
}

/** The {placeholders} used in a text, sorted (for the completeness test). */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]!).sort();
}

/** Language from the phone's settings, e.g. "mr-IN" -> mr. */
export function langFromLocale(locale: string | null | undefined): Lang {
  const l = (locale ?? '').toLowerCase();
  if (l.startsWith('mr')) return 'mr';
  if (l.startsWith('hi')) return 'hi';
  return 'en';
}

export const WEEKDAY_NAMES: Record<Lang, readonly string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  mr: ['रवि', 'सोम', 'मंगळ', 'बुध', 'गुरु', 'शुक्र', 'शनि'],
  hi: ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'],
};
export const MONTH_NAMES: Record<Lang, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  mr: ['जाने', 'फेब्रु', 'मार्च', 'एप्रि', 'मे', 'जून', 'जुलै', 'ऑग', 'सप्टें', 'ऑक्टो', 'नोव्हें', 'डिसें'],
  hi: ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून', 'जुल', 'अग', 'सित', 'अक्टू', 'नव', 'दिस'],
};
