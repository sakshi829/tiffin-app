// Every text the customer, staff and owner apps can show must have a Marathi and a Hindi version with
// the same {placeholders}. The texts are collected from the source with the
// TypeScript parser, so a new tr('...') without translations fails this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { DICTIONARIES, formatDate, interpolate, langFromLocale, placeholders, setDisplayLanguage, translate } from './index.ts';
import { ERROR_MESSAGES } from './errors.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx?|mts)$/.test(e.name) && !e.name.includes('.test.') ? [path.join(dir, e.name)] : []);

/** Texts the apps pass to tr(...), keep in lookup tables they translate, or give Chips as option labels. */
export function collectCustomerTexts(): Map<string, string> {
  const files = [...walk(path.join(root, 'apps/customer/src')), ...walk(path.join(root, 'apps/staff/src')), ...walk(path.join(root, 'apps/owner/src')),
    ...walk(path.join(root, 'packages/app-core/src')), path.join(root, 'packages/shared/src/display.ts'),
    path.join(root, 'packages/shared/src/html.ts'), path.join(root, 'packages/shared/src/finance.ts')];   // PDFs
  const found = new Map<string, string>();   // text -> file
  const add = (s: string, file: string) => { if (/[A-Za-z]{2,}/.test(s.replace(/\{[A-Za-z0-9_]+\}/g, ''))) found.set(s, path.relative(root, file)); };
  const literals = (e: ts.Expression, file: string) => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) add(e.text, file);
    else if (ts.isConditionalExpression(e)) { literals(e.whenTrue, file); literals(e.whenFalse, file); }
    else if (ts.isParenthesizedExpression(e)) literals(e.expression, file);
  };
  for (const file of files) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ['tr', 'translate'].includes(n.expression.getText(sf)) && n.arguments[0]) literals(n.arguments[0], file);
      // lookup tables the screens translate: STATUS / LABEL / WEB_TEXT / RESULT_TEXT, and alert-setting labels
      if (ts.isVariableDeclaration(n) && ['STATUS', 'LABEL', 'ROLE', 'KIND', 'WEB_TEXT', 'RESULT_TEXT', 'SIGN_OUT_PARTIAL', 'STATUS_LABEL', 'KIND_LABEL', 'DAY', 'DAY_LONG'].includes(n.name.getText(sf)) && n.initializer) {
        const scan = (m: ts.Node): void => {
          if (ts.isPropertyAssignment(m) && ['text', 'label'].includes(m.name.getText(sf))) literals(m.initializer, file);
          else if (ts.isPropertyAssignment(m) && m.name.getText(sf) !== 'tone' && (ts.isStringLiteral(m.initializer) || ts.isConditionalExpression(m.initializer))) literals(m.initializer, file);
          else if (ts.isStringLiteral(m) && ts.isArrayLiteralExpression(m.parent)) add(m.text, file);   // DAY = ['', 'Mon', …]
          else if (ts.isBinaryExpression(m) && m.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            // 'a' + 'b' concatenation (SIGN_OUT_PARTIAL)
            const parts: string[] = []; const flat = (x: ts.Expression): boolean => ts.isBinaryExpression(x) ? flat(x.left) && flat(x.right)
              : ts.isStringLiteral(x) ? (parts.push(x.text), true) : false;
            if (flat(m)) { add(parts.join(''), file); return; }
          }
          ts.forEachChild(m, scan);
        };
        scan(n.initializer);
      }
      // option lists ({ value, label }): Chips/MultiChips and the alert settings translate their labels
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'label' && !/[\\/]ui[\\/]kit\.tsx$/.test(file)) literals(n.initializer, file);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  for (const m of Object.values(ERROR_MESSAGES)) add(m, 'packages/shared/src/errors.ts');
  return found;
}

test('every customer, staff and owner app text has Marathi and Hindi translations with the same placeholders', () => {
  const texts = collectCustomerTexts();
  assert.ok(texts.size > 250, `only ${texts.size} texts found: is the scan broken?`);
  const problems: string[] = [];
  for (const [text, file] of texts) {
    for (const [lang, dict] of Object.entries(DICTIONARIES)) {
      const tr = dict[text];
      if (tr === undefined) { problems.push(`${lang} missing: "${text}" (${file})`); continue; }
      if (!tr.trim()) problems.push(`${lang} empty: "${text}"`);
      if (placeholders(tr).join() !== placeholders(text).join()) problems.push(`${lang} placeholders differ: "${text}" -> "${tr}"`);
    }
  }
  assert.deepEqual(problems.slice(0, 40), [], `${problems.length} problems`);
});

test('no English words are filled INTO a translated sentence (each case needs its own whole sentence)', () => {
  // e.g. tr('{value} · {name}', { value: slot === 'lunch' ? 'Lunch' : 'Dinner' }) shows "Lunch" in every language,
  // and tr('Also for my {meal_slot} today', { meal_slot: o.meal_slot }) shows the raw database word.
  const files = [...walk(path.join(root, 'apps/customer/src')), ...walk(path.join(root, 'apps/staff/src')), ...walk(path.join(root, 'apps/owner/src')), ...walk(path.join(root, 'packages/app-core/src'))];
  const problems: string[] = [];
  for (const file of files) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ['tr', 'translate'].includes(n.expression.getText(sf)) && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1])) {
        for (const p of n.arguments[1].properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const where = `${path.relative(root, file)}:${sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1}`;
          const find = (m: ts.Node): void => {
            if (ts.isCallExpression(m) && ['tr', 'translate'].includes(m.expression.getText(sf))) return;   // translated on its own
            const par = m.parent;
            const compared = ts.isBinaryExpression(par) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(par.operatorToken.kind);
            if ((ts.isStringLiteral(m) || ts.isNoSubstitutionTemplateLiteral(m)) && (/[A-Za-z]{2,}/.test(m.text) || /^(s|es)$/.test(m.text)) && !compared && !ts.isElementAccessExpression(par)) problems.push(`${where} "${m.text}"`);
            if (ts.isTemplateExpression(m) && /[A-Za-z]{2,}/.test(m.head.text + m.templateSpans.map((s) => s.literal.text).join(''))) problems.push(`${where} ${m.getText(sf)}`);
            ts.forEachChild(m, find);
          };
          find(p.initializer);
          const text = p.initializer.getText(sf);
          if (/\.(meal_slot|status|role|kind)\b(?![.\w])/.test(text) && !/tr\(|translate\(|STATUS\[|LABEL\[|ROLE\[|KIND\[|===/.test(text)) problems.push(`${where} raw database word: ${text}`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  assert.deepEqual(problems, []);
});

test('dictionaries hold no stale entries (every key is still used somewhere)', () => {
  const texts = collectCustomerTexts();
  for (const [lang, dict] of Object.entries(DICTIONARIES)) {
    const stale = Object.keys(dict).filter((k) => !texts.has(k));
    assert.deepEqual(stale, [], `${lang}: unused keys`);
  }
});

test('translate: language choice, English fallback, placeholders', () => {
  assert.equal(translate('Send code', undefined, 'en'), 'Send code');
  assert.equal(translate('No such text anywhere', undefined, 'mr'), 'No such text anywhere');
  assert.equal(interpolate('Hello {name}, {count} left', { name: 'Asha', count: 3 }), 'Hello Asha, 3 left');
  assert.equal(interpolate('Hello {name}', {}), 'Hello {name}');
  assert.deepEqual([langFromLocale('mr-IN'), langFromLocale('hi_IN'), langFromLocale('en-GB'), langFromLocale(undefined)], ['mr', 'hi', 'en', 'en']);
  setDisplayLanguage('mr');
  assert.equal(formatDate('2026-12-01'), 'मंगळ, 1 डिसें');
  setDisplayLanguage('hi');
  assert.equal(formatDate('2026-12-01'), 'मंगल, 1 दिस');
  setDisplayLanguage('en');
  assert.equal(formatDate('2026-12-01'), 'Tue, 1 Dec');
});
