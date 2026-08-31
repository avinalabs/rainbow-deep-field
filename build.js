#!/usr/bin/env node
/* Inline everything in src/ into one self-contained dist/index.html.
   One file means GitHub Pages, a Claude artifact preview, and a local file://
   open are all the exact same build. */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

const ORDER = fs.readdirSync(SRC)
  .filter(f => /^\d\d-.*\.js$/.test(f))
  .sort();

const js = ORDER.map(f => {
  const body = fs.readFileSync(path.join(SRC, f), 'utf8');
  return `/* ===== ${f} ===== */\n${body}`;
}).join('\n');

// Typefaces are embedded rather than linked. The page then has zero third-party
// requests, renders identically offline and in the trailer harness, and can't be
// caught out by a font host being slow or blocked.
const FACES = [
  ['Newsreader', 300, 'normal', '@fontsource/newsreader/files/newsreader-latin-300-normal.woff2'],
  ['Newsreader', 400, 'normal', '@fontsource/newsreader/files/newsreader-latin-400-normal.woff2'],
  ['Newsreader', 400, 'italic', '@fontsource/newsreader/files/newsreader-latin-400-italic.woff2'],
  ['Space Grotesk', 400, 'normal', '@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2'],
  ['Space Grotesk', 500, 'normal', '@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2'],
];

const fontCss = FACES.map(([family, weight, style, file]) => {
  const p = path.join(__dirname, 'node_modules', file);
  if (!fs.existsSync(p)) {
    console.warn(`  ! missing font ${file} — run npm install`);
    return '';
  }
  const b64 = fs.readFileSync(p).toString('base64');
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};` +
    `font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
}).join('\n');

const css = fontCss + '\n' + fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

const cfg = fs.existsSync(path.join(SRC, 'config.js'))
  ? fs.readFileSync(path.join(SRC, 'config.js'), 'utf8')
  : '/* no backend configured — the field runs on its founding messages */\n';

html = html.replace('/*CSS*/', () => css).replace('/*JS*/', () => cfg + '\n' + js);

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'index.html'), html);

// A second build for Claude artifact previews, which supply their own document
// skeleton — so this one carries the head contents and body markup, and none of
// the wrapper tags.
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const preview = head.replace(/<meta charset[^>]*>\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '')
  + '\n<style>html,body{height:100%;margin:0}</style>\n' + body;
fs.writeFileSync(path.join(DIST, 'preview.html'), preview);

// docs/ is what GitHub Pages serves (Settings → Pages → main → /docs). Committing
// the built file means Pages needs no build step and can't break on a bad deploy.
const DOCS = path.join(__dirname, 'docs');
fs.mkdirSync(DOCS, { recursive: true });
fs.writeFileSync(path.join(DOCS, 'index.html'), html);
fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');   // stop Jekyll touching anything
fs.writeFileSync(path.join(DOCS, '404.html'), html);  // permalinks are hash routes; be forgiving

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`built dist/index.html, dist/preview.html, docs/index.html — ${kb} KB, ${ORDER.length} modules`);
