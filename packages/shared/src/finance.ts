/**
 * Phase 6 helpers: quick expense entry ("500 vegetables from Ramesh"),
 * spreadsheet export (CSV, safe against formula injection) and the monthly
 * report document. Pure functions, unit-tested; the database does all maths
 * that matters (owner_profit_loss etc.), these only parse input and format output.
 */
import { formatDate } from './dates.ts';
import { formatRupees, isValidPaise, type Paise } from './money.ts';
import { DOC_FONTS, englishDoc, escapeHtml, type DocTr } from './html.ts';

// ------------------------------------------------------------------ quick entry
export interface QuickExpense {
  amountPaise: Paise;
  categoryId: string | null;   // null = owner picks on the confirm screen
  vendor: string | null;
  note: string;
}

// A whole word in any script. JS \b only knows ASCII letters, so it can't find भाजी inside a sentence.
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]';
const word = (alternatives: string) => new RegExp(`(?<!${WORD_CHAR})(?:${alternatives})(?!${WORD_CHAR})`, 'iu');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words people say (English, Marathi, Hindi) -> default category names created with every kitchen (bootstrap_kitchen). */
const KEYWORDS: readonly [RegExp, string][] = [
  [word('vegetables?|veggies|sabzi|sabji|bhaji|onions?|potato(?:es)?|tomato(?:es)?|kanda|batata'
    + '|भाजी|भाज्या|भाजीपाला|कांदा|कांदे|बटाटा|बटाटे|टोमॅटो|सब्जी|सब्ज़ी|सब्जियां|सब्जियाँ|सब्ज़ियाँ|प्याज|प्याज़|आलू|टमाटर'), 'Vegetables'],
  [word('atta|flour|rice|dal|daal|wheat|besan|rava|poha|grains?'
    + '|पीठ|कणीक|गहू|तांदूळ|डाळ|बेसन|रवा|पोहे|आटा|चावल|दाल|गेहूं|गेहूँ|सूजी'), 'Grains & Flour'],
  [word('oil|masala|spices?|salt|sugar|jeera|mirchi'
    + '|तेल|मसाला|मसाले|मीठ|साखर|जिरे|मिरची|नमक|चीनी|शक्कर|जीरा|मिर्च|मिर्ची'), 'Oil & Spices'],
  [word('milk|curd|dahi|paneer|ghee|butter|cheese|dairy'
    + '|दूध|दही|पनीर|तूप|लोणी|घी|मक्खन|डेयरी|डेअरी'), 'Dairy'],
  [word('eggs?|chicken|mutton|fish|meat'
    + '|अंडी|अंडे|अंडा|चिकन|मटण|मटन|मासे|मछली|मांस'), 'Meat & Eggs'],
  [word('gas|cylinder|lpg|fuel|गॅस|गैस|सिलेंडर|सिलिंडर'), 'Gas & Fuel'],
  [word('packaging|foil|containers?|bags?|tape|paper|पॅकिंग|पैकिंग|फॉइल|पिशव्या|पिशवी|थैली|थैलियां'), 'Packaging'],
  [word('petrol|diesel|auto|rickshaw|transport|delivery charge|पेट्रोल|डिझेल|डीज़ल|डीजल|रिक्षा|रिक्शा|ऑटो'), 'Transport'],
  [word('salary|wages?|पगार|मजुरी|वेतन|तनख्वाह|तनख़्वाह'), 'Staff salary'],
  [word('electricity|light bill|water bill|rent|internet|recharge|utilities'
    + '|वीज|लाईट बिल|लाइट बिल|पाणी बिल|भाडे|बिजली|पानी बिल|किराया|रिचार्ज'), 'Utilities'],
  [word('tiffin box(?:es)?|boxes|डबे|डबा|डब्बे|डिब्बे|डिब्बा'), 'Tiffin boxes'],
  [word('mixer|fridge|stove|cooker|equipment|utensils?|मिक्सर|फ्रिज|फ्रीज|कुकर|शेगडी|भांडी|बर्तन|चूल्हा'), 'Kitchen equipment'],
];
/** Words that only say "paid / rupees / of" and are dropped from the note. */
const FILLER = word('paid|spent|bought|rupees|rs|दिले|दिला|दिली|घेतले|घेतला|घेतली|आणले|रुपये|रुपयांचे|रुपयांची|रुपयांचा'
  + '|रुपए|रुपया|पैसे|दिए|दिया|खरीदा|खरीदी|लिया|लिए|चे|ची|चा|के|की|का');
const UNITS = 'kg|g|gm|l|ltr|litre|ml|pcs|pieces|dozen|%|किलो|ग्रॅम|ग्राम|लिटर|लीटर|मिली|नग|डझन|दर्जन|पीस|पाकीट|पॅकेट|पैकेट';

/**
 * Understands short typed or dictated notes in English, Marathi or Hindi (phone keyboard microphone works too):
 *   "500 vegetables from Ramesh", "gas cylinder 1100", "₹1,250.50 milk", "paid 300 to Raju for curd",
 *   "500 भाजी रमेशकडून", "२ किलो कांदे ८०", "रमेश से 500 की सब्ज़ी".
 * Returns null when no clear amount is found. The result is ALWAYS shown for confirmation.
 */
export function parseQuickExpense(text: string, categories: readonly { id: string; name: string }[]): QuickExpense | null {
  const input = text.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))   // Devanagari digits -> 0-9
    .replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!input) return null;
  const amountRe = new RegExp(`(?:₹|rs\\.?\\s?|inr\\s?|रु\\.?\\s?)?(\\d{1,3}(?:,\\d{2,3})+|\\d{1,9})(\\.\\d{1,2})?(?!\\s?(?:${UNITS}))\\b`, 'gi');
  const amounts = [...input.matchAll(amountRe)];
  if (amounts.length !== 1) return null;     // none, or ambiguous ("2 kg 300") -> let the owner type it
  const m = amounts[0]!;
  const whole = Number((m[1] ?? '').replace(/,/g, ''));
  const frac = m[2] ? Number(m[2].slice(1).padEnd(2, '0')) : 0;
  const amountPaise = whole * 100 + frac;
  if (!isValidPaise(amountPaise) || amountPaise <= 0) return null;

  const rest = (input.slice(0, m.index) + ' ' + input.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, ' ').trim();
  // shop / person: "from Ramesh" · "रमेशकडून", "रमेश यांच्याकडून" · "रमेश से", "Ramesh se" (one word in Marathi/Hindi)
  const vendorMatch = rest.match(/\b(?:from|to|at)\s+([A-Za-z][A-Za-z .'-]{0,59}?)(?=\s+(?:for|on)\b|$)/i)
    ?? rest.match(new RegExp(`(?<!${WORD_CHAR})([\\p{L}\\p{M}]{2,30}?)(?:\\s+यांच्या)?\\s?कडून(?!${WORD_CHAR})`, 'u'))
    ?? rest.match(new RegExp(`(?<!${WORD_CHAR})([\\p{L}\\p{M}]{2,30})\\s+(?:से|को|se|ko)(?!${WORD_CHAR})`, 'iu'));
  const vendor = vendorMatch?.[1]?.trim() || null;
  const fillers = new RegExp(FILLER.source, 'giu');
  const words = rest.replace(vendorMatch?.[0] ?? '\u0000', ' ').replace(fillers, ' ').replace(/\s+/g, ' ').trim();

  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  let categoryId: string | null = null;
  for (const c of categories) {           // the owner's own category names first (any language)
    if (word(escapeRe(c.name.toLowerCase())).test(words)) { categoryId = c.id; break; }
  }
  if (!categoryId) {
    for (const [re, name] of KEYWORDS) {
      if (re.test(words) && byName.has(name.toLowerCase())) { categoryId = byName.get(name.toLowerCase()) ?? null; break; }
    }
  }
  const note = words.replace(/^(for|on)\s+/i, '').slice(0, 200);
  return { amountPaise, categoryId, vendor, note };
}

// ------------------------------------------------------------------ CSV
type Cell = string | number | boolean | null | undefined;

/**
 * RFC 4180 CSV with a BOM (Excel shows ₹ correctly). Text that a spreadsheet would
 * treat as a formula (= + - @ tab CR) is prefixed with ' so opening the file can
 * never run anything (OWASP "CSV injection").
 */
export function toCsv(rows: readonly (readonly Cell[])[]): string {
  const cell = (v: Cell): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Paise -> rupees number for spreadsheets (exact: at most 2 decimals). */
export const paiseToRupeesNumber = (p: number): number => Math.round(p) / 100;

// ------------------------------------------------------------------ report document
export interface ProfitLoss {
  from: string; to: string;
  billed_paise: number; received_paise: number; running_expenses_paise: number; investments_paise: number;
  profit_paise: number; meals_delivered: number; cost_per_meal_paise: number | null; billed_per_meal_paise: number | null;
  waste_tiffins: number; investments_all_time_paise: number; profit_since_first_investment_paise: number;
  payback_percent: number | null;
  by_category: { name: string; kind: 'running' | 'investment'; amount_paise: number; budget_paise: number | null }[];
  by_tiffin_type: { name: string; meals: number; billed_paise: number }[];
}

export interface Insight { severity: 'warn' | 'info'; title: string; detail: string }

export function monthlyReportHtml(kitchenName: string, pl: ProfitLoss, insights: readonly Insight[] = [], tr: DocTr = englishDoc): string {
  const r = (p: number | null | undefined) => escapeHtml(p === null || p === undefined ? '-' : formatRupees(Math.round(Number(p))));
  const row = (label: string, value: string, strong = false) =>
    `<tr${strong ? ' class="b"' : ''}><td>${escapeHtml(label)}</td><td class="n">${value}</td></tr>`;
  const cats = pl.by_category.map((c) =>
    `<tr><td>${escapeHtml(c.name)}${c.kind === 'investment' ? ` <small>${escapeHtml(tr('(investment)'))}</small>` : ''}</td><td class="n">${r(c.amount_paise)}</td>`
    + `<td class="n">${c.budget_paise ? r(c.budget_paise) : ''}</td></tr>`).join('');
  const types = pl.by_tiffin_type.map((t) =>
    `<tr><td>${escapeHtml(t.name)}</td><td class="n">${escapeHtml(t.meals)}</td><td class="n">${r(t.billed_paise)}</td></tr>`).join('');
  const tips = insights.map((i) => `<li><b>${escapeHtml(i.title)}</b><br>${escapeHtml(i.detail)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(tr('Report'))}</title><style>
body{font-family:${DOC_FONTS};color:#1f1a14;margin:24px}
h1{font-size:20px;margin:0}h2{font-size:15px;margin:20px 0 6px}h3{font-size:13px;margin:4px 0 12px;color:#6b6258;font-weight:400}
table{width:100%;border-collapse:collapse;font-size:12px}td,th{border-bottom:1px solid #e6dfd5;padding:5px;text-align:left}
td.n,th.n{text-align:right}tr.b td{font-weight:700}small{color:#6b6258}li{margin:6px 0;font-size:12px}
</style></head><body>
<h1>${escapeHtml(kitchenName)}</h1>
<h3>${escapeHtml(tr('Report {from} – {to}', { from: formatDate(pl.from), to: formatDate(pl.to) }))}</h3>
<h2>${escapeHtml(tr('Summary'))}</h2><table>
${row(tr('Billed to customers'), r(pl.billed_paise))}
${row(tr('Payments received'), r(pl.received_paise))}
${row(tr('Running expenses'), r(pl.running_expenses_paise))}
${row(tr('Profit (billed − running expenses)'), r(pl.profit_paise), true)}
${row(tr('Investments in this period'), r(pl.investments_paise))}
${row(tr('Meals delivered'), escapeHtml(pl.meals_delivered))}
${row(tr('Cost per meal'), r(pl.cost_per_meal_paise))}
${row(tr('Billed per meal'), r(pl.billed_per_meal_paise))}
${row(tr('Tiffins left over (waste)'), escapeHtml(pl.waste_tiffins))}
${row(tr('All investments so far'), r(pl.investments_all_time_paise))}
${row(tr('Recovered from profit'), pl.payback_percent === null ? '-' : `${escapeHtml(pl.payback_percent)}%`)}
</table>
<h2>${escapeHtml(tr('Spending by category'))}</h2><table><thead><tr><th>${escapeHtml(tr('Category'))}</th><th class="n">${escapeHtml(tr('Spent'))}</th><th class="n">${escapeHtml(tr('Budget'))}</th></tr></thead><tbody>${cats || `<tr><td colspan="3">${escapeHtml(tr('No expenses.'))}</td></tr>`}</tbody></table>
<h2>${escapeHtml(tr('Tiffin types'))}</h2><table><thead><tr><th>${escapeHtml(tr('Type'))}</th><th class="n">${escapeHtml(tr('Meals'))}</th><th class="n">${escapeHtml(tr('Billed'))}</th></tr></thead><tbody>${types || `<tr><td colspan="3">${escapeHtml(tr('No meals.'))}</td></tr>`}</tbody></table>
${tips ? `<h2>${escapeHtml(tr('Suggestions'))}</h2><ul>${tips}</ul>` : ''}
</body></html>`;
}
