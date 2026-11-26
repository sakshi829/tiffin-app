import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, statementHtml, stickerSheetHtml } from './html.ts';

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml(`<script>alert("x")</script> & 'y'`), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
});

test('statement: running balance, closing line, and no injectable names or notes', () => {
  const html = statementHtml({
    kitchenName: "Amruta's Kitchen", customerName: '<img src=x onerror=alert(1)>', from: '2026-12-01', to: '2026-12-31',
    openingPaise: 1000,
    entries: [
      { entry_date: '2026-12-01', kind: 'meal', amount_paise: 8000, note: null },
      { entry_date: '2026-12-02', kind: 'payment', amount_paise: -5000, note: '<b>cash</b>' },
    ],
    upiId: 'amruta@okaxis',
  });
  assert.ok(html.includes('₹90') && html.includes('₹40'), 'running balances 90 then 40');
  assert.ok(html.includes('Amount due: ₹40'));
  assert.ok(!html.includes('<img'), 'customer name escaped');
  assert.ok(!html.includes('<b>cash'), 'note escaped');
  assert.ok(html.includes('Pay by UPI to amruta@okaxis'));
});

test('sticker sheet only accepts real codes and generated SVG', () => {
  const ok = stickerSheetHtml('AK', [{ code: 'AK-001', svg: '<svg></svg>' }]);
  assert.ok(ok.includes('AK-001'));
  assert.throws(() => stickerSheetHtml('AK', [{ code: '<x>', svg: '<svg></svg>' }]));
  assert.throws(() => stickerSheetHtml('AK', [{ code: 'AK-002', svg: '<script>' }]));
});

test('documents in Marathi and Hindi: every label translated, values and dates kept', async () => {
  const { translate, setDisplayLanguage } = await import('./i18n.ts');
  const { monthlyReportHtml } = await import('./finance.ts');
  for (const lang of ['mr', 'hi'] as const) {
    setDisplayLanguage(lang);
    const tr = (t: string, v?: Record<string, string | number>) => translate(t, v, lang);
    const st = statementHtml({ kitchenName: "Amruta's Kitchen", customerName: 'Asha', from: '2026-12-01', to: '2026-12-31', openingPaise: 0,
      entries: [{ entry_date: '2026-12-01', kind: 'meal', amount_paise: 8000, note: null }], upiId: 'amruta@okaxis', contactPhone: '98200 00000' }, tr);
    const rep = monthlyReportHtml("Amruta's Kitchen", {
      from: '2026-12-01', to: '2026-12-31', billed_paise: 1, received_paise: 1, running_expenses_paise: 1, investments_paise: 1, profit_paise: 1,
      meals_delivered: 1, cost_per_meal_paise: 1, billed_per_meal_paise: 1, waste_tiffins: 0, investments_all_time_paise: 1,
      profit_since_first_investment_paise: 1, payback_percent: 5, by_category: [], by_tiffin_type: [] }, [], tr);
    for (const html of [st, rep]) {
      // visible text only (tags and CSS removed); only values may stay in Latin letters
      const text = html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'");
      const left = text.replace(/Amruta's Kitchen|Asha|amruta@okaxis|UPI/g, '').match(/[A-Za-z]{3,}/g);
      assert.equal(left, null, `${lang}: English left: ${left}`);
      assert.match(text, /[ऀ-ॿ]/);
    }
    assert.ok(st.includes(lang === 'mr' ? 'डिसें' : 'दिस'), 'dates in the language');
    assert.ok(st.includes('₹80'));
  }
  setDisplayLanguage('en');
  assert.ok(statementHtml({ kitchenName: 'K', customerName: 'A', from: '2026-12-01', to: '2026-12-31', openingPaise: 0, entries: [] }).includes('Nothing due. Thank you!'));
});
