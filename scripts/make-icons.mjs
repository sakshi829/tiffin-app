#!/usr/bin/env node
// Draws the app icons (a three-tier tiffin carrier) and renders every PNG the
// three apps need, using headless Chrome as the SVG renderer.
//
//   node scripts/make-icons.mjs            (Chrome at the default Windows path)
//   CHROME="/path/to/chrome" node scripts/make-icons.mjs
//
// To use your own logo later: replace GLYPH below with your SVG markup
// (drawn in a 100 x 100 box, kept inside 21..79 so Android's round mask never cuts it)
// and run the script again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/** One colour per app so the owner can tell them apart on one phone. */
export const APPS = {
  customer: { bg: '#A4491A' },   // terracotta (brand)
  owner: { bg: '#2F5D3A' },      // deep green
  staff: { bg: '#24507A' },      // deep blue
};
const INK = '#FFF6EA';

// Tiffin carrier: handle + three tiers, inside the 21..79 safe area.
const GLYPH = (ink) => `
  <path d="M27.5 77 V31 Q27.5 19 50 19 Q72.5 19 72.5 31 V77" fill="none" stroke="${ink}" stroke-width="3.6" stroke-linecap="round"/>
  <rect x="31.5" y="32" width="37" height="13.5" rx="4" fill="${ink}"/>
  <rect x="31.5" y="48" width="37" height="13.5" rx="4" fill="${ink}"/>
  <rect x="31.5" y="64" width="37" height="13.5" rx="4" fill="${ink}"/>
  <rect x="24" y="36.5" width="7" height="4.5" rx="1.5" fill="${ink}"/>
  <rect x="69" y="36.5" width="7" height="4.5" rx="1.5" fill="${ink}"/>`;

const svg = ({ bg, ink = INK, scale = 1 }) => {
  const t = (1 - scale) * 50;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  ${bg ? `<rect width="100" height="100" fill="${bg}"/>` : ''}
  <g transform="translate(${t} ${t}) scale(${scale})">${GLYPH(ink)}</g></svg>`;
};

function render(markup, size, out) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  const html = path.join(tmp, 'i.html');
  fs.writeFileSync(html, `<!doctype html><html><head><style>html,body{margin:0;background:transparent}
    div{width:${size}px;height:${size}px}</style></head><body><div>${markup}</div></body></html>`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${out}`,
    `--user-data-dir=${path.join(tmp, 'prof')}`, `file:///${html.replace(/\\/g, '/')}`], { stdio: 'ignore' });
  fs.rmSync(tmp, { recursive: true, force: true });
  const b = fs.readFileSync(out);
  if (b.readUInt32BE(16) !== size || b.readUInt32BE(20) !== size) throw new Error(`${out}: wrong size`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(chrome)) { console.error(`Chrome not found at ${chrome}; set CHROME=...`); process.exit(1); }
  for (const [app, { bg }] of Object.entries(APPS)) {
    const dir = path.join(root, 'apps', app, 'assets', 'images');
    render(svg({ bg }), 1024, path.join(dir, 'icon.png'));
    render(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><rect width="100" height="100" fill="${bg}"/></svg>`,
      512, path.join(dir, 'android-icon-background.png'));
    render(svg({}), 512, path.join(dir, 'android-icon-foreground.png'));
    render(svg({ ink: '#FFFFFF' }), 432, path.join(dir, 'android-icon-monochrome.png'));
    render(svg({ scale: 1.3 }), 512, path.join(dir, 'splash-icon.png'));
    render(svg({ bg }), 48, path.join(dir, 'favicon.png'));
    console.log(`${app}: icons written`);
  }
  // Installable web app (customer PWA)
  // Installable web apps (iPhone "Add to Home Screen", Android "Install app") for all three.
  for (const [app, { bg }] of Object.entries(APPS)) {
    const web = path.join(root, 'apps', app, 'public', 'icons');
    render(svg({ bg }), 192, path.join(web, 'icon-192.png'));
    render(svg({ bg }), 512, path.join(web, 'icon-512.png'));
    render(svg({ bg, scale: 0.85 }), 512, path.join(web, 'maskable-512.png'));
    render(svg({ bg }), 180, path.join(web, 'apple-touch-icon.png'));
    console.log(`${app} web icons written`);
  }
}
