/**
 * Printable documents (bill/statement PDF, QR sticker sheet) as HTML strings.
 * Every value coming from people (names, notes) is HTML-escaped, so nothing a
 * customer types can inject markup or scripts into a PDF or print view.
 * Labels come from `tr` (the screen's translator), so a PDF is in the app's
 * language; without it they are English. Dates follow the app language already.
 */
import { formatDate } from './dates.ts';
import { formatRupees } from './money.ts';
import { interpolate, type Vars } from './i18n.ts';

/** The screen's tr(); the default keeps English. */
export type DocTr = (text: string, vars?: Vars) => string;
export const englishDoc: DocTr = (text, vars) => interpolate(text, vars);

/** Fonts with Devanagari first-class (system fonts on Android/iPhone/Windows/Mac). */
export const DOC_FONTS = "-apple-system,Roboto,'Noto Sans','Noto Sans Devanagari','Nirmala UI',Mangal,Arial,sans-serif";

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const KIND: Record<string, string> = {
  meal: 'Meal', addon: 'Extra', late_skip: 'Late skip', late_fee: 'Late fee', payment: 'Payment',
  waiver: 'Waived', discount: 'Discount', adjustment: 'Adjustment', reversal: 'Correction',
};

export interface StatementDoc {
  kitchenName: string;
  customerName: string;
  from: string;
  to: string;
  openingPaise: number;
  entries: { entry_date: string; kind: string; amount_paise: number; note: string | null }[];
  upiId?: string | null;
  contactPhone?: string | null;
}

export function statementHtml(d: StatementDoc, tr: DocTr = englishDoc): string {
  const e_ = escapeHtml;
  let running = d.openingPaise;
  const rows = d.entries.map((e) => {
    running += e.amount_paise;
    return `<tr><td>${e_(formatDate(e.entry_date))}</td><td>${e_(KIND[e.kind] ? tr(KIND[e.kind]!) : e.kind)}${e.note ? ` <small>${e_(e.note)}</small>` : ''}</td>`
      + `<td class="n">${e_(formatRupees(e.amount_paise))}</td><td class="n">${e_(formatRupees(running))}</td></tr>`;
  }).join('');
  const closing = running;
  const total = closing > 0 ? tr('Amount due: {amount}', { amount: formatRupees(closing) })
    : closing < 0 ? tr('Advance balance: {amount}', { amount: formatRupees(-closing) }) : tr('Nothing due. Thank you!');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e_(tr('Statement'))}</title><style>
body{font-family:${DOC_FONTS};color:#1f1a14;margin:24px}
h1{font-size:20px;margin:0}h2{font-size:15px;margin:4px 0 16px;color:#6b6258}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #e6dfd5;padding:6px;text-align:left}
td.n,th.n{text-align:right}small{color:#6b6258}.total{font-size:16px;font-weight:700;margin-top:16px}
footer{margin-top:24px;font-size:11px;color:#6b6258}
</style></head><body>
<h1>${e_(d.kitchenName)}</h1>
<h2>${e_(tr('Statement for {name} · {from} – {to}', { name: d.customerName, from: formatDate(d.from), to: formatDate(d.to) }))}</h2>
<table><thead><tr><th>${e_(tr('Date'))}</th><th>${e_(tr('Details'))}</th><th class="n">${e_(tr('Amount'))}</th><th class="n">${e_(tr('Balance'))}</th></tr></thead><tbody>
<tr><td></td><td>${e_(tr('Opening balance'))}</td><td></td><td class="n">${e_(formatRupees(d.openingPaise))}</td></tr>
${rows}
</tbody></table>
<p class="total">${e_(total)}</p>
<footer>${d.upiId ? `${e_(tr('Pay by UPI to {upi}.', { upi: d.upiId }))} ` : ''}${d.contactPhone ? e_(tr('Questions: {phone}.', { phone: d.contactPhone })) : ''}</footer>
</body></html>`;
}

/** A4 sheet of QR stickers: 4 per row. `svg` must come from a QR generator (not from user input). */
export function stickerSheetHtml(kitchenName: string, stickers: readonly { code: string; svg: string }[], tr: DocTr = englishDoc): string {
  const cells = stickers.map((s) => {
    if (!/^AK-\d{3,6}$/.test(s.code) || !s.svg.startsWith('<svg')) throw new Error('Invalid sticker');
    return `<div class="s">${s.svg}<div class="c">${escapeHtml(s.code)}</div><div class="k">${escapeHtml(kitchenName)}</div></div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(tr('Box stickers'))}</title><style>
body{font-family:${DOC_FONTS};margin:12mm}.g{display:flex;flex-wrap:wrap;gap:6mm}
.s{width:40mm;border:1px dashed #999;padding:3mm;text-align:center;page-break-inside:avoid}
.s svg{width:32mm;height:32mm}.c{font-size:14pt;font-weight:700}.k{font-size:8pt;color:#555}
</style></head><body><div class="g">${cells}</div></body></html>`;
}
