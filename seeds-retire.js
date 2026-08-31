#!/usr/bin/env node
/* Retire the founding messages once real ones have arrived.

   The 349 messages in src/03-seeds.js exist to solve the cold-start problem: an
   empty sky is a broken-looking sky, and nobody shares a void. Once enough real
   people have left messages, the founding ones have done their job and can go.

   Usage:
     node seeds-retire.js --check          how many real messages are in the sky
     node seeds-retire.js --keep 100       keep the best 100 founding messages
     node seeds-retire.js --keep 0         retire all of them
     node seeds-retire.js --restore        put them all back

   Nothing is destroyed: the full set is preserved in src/03-seeds.full.js the
   first time this runs, so --restore always works. */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const LIVE = path.join(SRC, '03-seeds.js');
const FULL = path.join(SRC, '03-seeds.full.js');

const args = process.argv.slice(2);
const arg = name => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? true);
};

// Read the config the build uses, so --check talks to the same project the site does
function backend() {
  const cfgPath = path.join(SRC, 'config.js');
  if (!fs.existsSync(cfgPath)) return null;
  const cfg = fs.readFileSync(cfgPath, 'utf8');
  const url = (cfg.match(/url:\s*'([^']+)'/) || [])[1];
  const key = (cfg.match(/anonKey:\s*'([^']+)'/) || [])[1];
  return url && key ? { url, key } : null;
}

async function check() {
  const b = backend();
  if (!b) return console.error('no src/config.js — nothing to check');
  const res = await fetch(
    b.url.replace(/\/$/, '') + '/rest/v1/messages?select=id&limit=1',
    { headers: { apikey: b.key, Prefer: 'count=exact', Range: '0-0' } }
  );
  const range = res.headers.get('content-range') || '';
  const total = range.split('/')[1];
  console.log(res.ok
    ? `${total} real messages in the shared sky`
    : `couldn't read the sky — HTTP ${res.status}`);
}

function parseSeeds(text) {
  const body = text.slice(text.indexOf('RDF.SEEDS = ['), text.lastIndexOf('];') + 2);
  const lines = body.split('\n');
  return lines
    .map(l => l.trim())
    .filter(l => l.startsWith('"'))
    .map(l => l.replace(/,$/, ''));
}

function write(keep) {
  if (!fs.existsSync(FULL)) fs.copyFileSync(LIVE, FULL);
  const all = parseSeeds(fs.readFileSync(FULL, 'utf8'));

  // Keep an evenly spread sample rather than the first N, so the mix of voices
  // and subjects survives the cut instead of leaving only the reassurance ones.
  let kept = [];
  if (keep > 0) {
    const step = all.length / Math.min(keep, all.length);
    for (let i = 0; i < Math.min(keep, all.length); i++) {
      kept.push(all[Math.floor(i * step)]);
    }
  }

  const out = `/* Rainbow Deep Field — the founding messages.
   ${kept.length === 0
      ? 'Retired. The sky belongs entirely to other people now.'
      : `${kept.length} of the original ${all.length} remain, kept so the field is
   never empty for somebody arriving for the first time. Everything else out
   there was left by a person who came and typed it.`}
   Regenerate with seeds-retire.js; the full set is kept in 03-seeds.full.js. */
(function (RDF) {
  'use strict';

  RDF.SEEDS = [
${kept.map(l => '    ' + l).join(',\n')}${kept.length ? '\n' : ''}  ];
})(window.RDF = window.RDF || {});
`;
  fs.writeFileSync(LIVE, out);
  console.log(`kept ${kept.length} of ${all.length} founding messages`);
  console.log('now run: node build.js');
}

if (arg('--check') !== null) {
  check();
} else if (arg('--restore') !== null) {
  if (!fs.existsSync(FULL)) {
    console.error('nothing to restore from');
  } else {
    fs.copyFileSync(FULL, LIVE);
    console.log('all founding messages restored — run: node build.js');
  }
} else if (arg('--keep') !== null) {
  write(parseInt(arg('--keep'), 10) || 0);
} else {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('/*')[1].trim());
}
