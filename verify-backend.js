#!/usr/bin/env node
/* Exercises the Supabase path without a Supabase project.
   Serves the real built page and a stand-in PostgREST from one origin, so the
   client's fetch code, header handling, RPC shapes and error mapping all run for
   real. The stand-in mimics the parts of the API the app touches, including the
   shapes of the errors the schema raises. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const pass = [], fail = [];
const check = (ok, label, detail) => (ok ? pass : fail).push(label + (detail ? ` — ${detail}` : ''));

// ——— the stand-in database ———
const rows = [
  { id: 'aaa11', body: 'a message that was already in the shared sky', ts: 1755000000000, lights: 4 },
  { id: 'bbb22', body: 'another one somebody left before you arrived', ts: 1755100000000, lights: 0 }
];
const calls = { get: 0, leave: 0, light: 0, report: 0, headers: null };

// Point the real built page at the stand-in. If the build already carries a
// config, overwrite it in place — injecting an earlier script would just be
// clobbered by the real one a moment later.
const TEST_CFG = "window.RDF_CONFIG={supabase:{url:'',anonKey:'sb_publishable_testkey123'}};";
const built = fs.readFileSync(path.join(__dirname, 'docs', 'index.html'), 'utf8');
const swapped = built.replace(/window\.RDF_CONFIG\s*=\s*\{[\s\S]*?\n\};/, TEST_CFG);
if (swapped === built) {
  console.error('could not find the config in the build — check build.js');
  process.exit(1);
}
const html = swapped;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }

  if (url.pathname === '/rest/v1/messages') {
    calls.get++;
    calls.headers = req.headers;
    return send(200, rows);
  }

  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    let raw = '';
    req.on('data', d => (raw += d));
    return req.on('end', () => {
      const fn = url.pathname.split('/').pop();
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (e) { /* ignore */ }

      if (fn === 'leave_message') {
        calls.leave++;
        // mirror the schema: the server has the final say on both
        if (/\bcrypto\b/i.test(body.p_text)) {
          return send(400, { message: 'rejected: unkind', code: '23514' });
        }
        if (calls.leave > 2) {
          return send(400, { message: 'slow down', code: '23514' });
        }
        return send(200, [{ id: 'srv' + calls.leave, ts: 1755200000000 + calls.leave }]);
      }
      if (fn === 'light_message') { calls.light++; return send(200, 9); }
      if (fn === 'report_message') { calls.report++; return send(200, null); }
      return send(404, { message: 'no such function' });
    });
  }

  res.writeHead(404);
  res.end('nope');
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const origin = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  // A refused write is a 400 by design; the browser logs every failed fetch as a
  // console error whether or not the app handled it. Only unhandled ones count.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/status of 400/.test(m.text())) return;
    errs.push(m.text());
  });

  await page.goto(origin + '/');
  await page.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 15000 });

  const n = await page.evaluate(() => window.RDF.film.world.comets.length);
  check(n === 351, 'shared messages merge into the sky', `${n} comets (349 founding + 2 remote)`);
  check(calls.get === 1, 'read hits PostgREST once', `${calls.get} calls`);
  check(calls.headers && calls.headers.apikey === 'sb_publishable_testkey123',
    'publishable key sent as apikey');
  check(calls.headers && !calls.headers.authorization,
    'publishable key is not put in Authorization', String(calls.headers.authorization));

  const remoteText = await page.evaluate(() => {
    const c = window.RDF.film.world.comets.filter(x => x.id === 'aaa11')[0];
    return c ? c.text + '|' + c.lights : 'missing';
  });
  check(remoteText === 'a message that was already in the shared sky|4',
    'remote rows map body→text and keep lights', remoteText);

  await page.click('#btn-begin');
  await page.waitForTimeout(400);

  // a good message goes to the server and takes the server's id
  await page.click('#btn-leave');
  await page.fill('#msg', 'this one should reach the shared sky and come back with a server id');
  await page.waitForTimeout(250);
  await page.click('#btn-send');
  await page.waitForTimeout(1500);
  const link = await page.inputValue('#permalink');
  check(calls.leave === 1, 'submit calls leave_message', `${calls.leave}`);
  check(/#\/m\//.test(link), 'still issues a self-contained link');
  const sentId = await page.evaluate(() =>
    (JSON.parse(localStorage.getItem('rdf.mine.v1') || '[]').slice(-1)[0] || {}).id);
  check(sentId === 'srv1', 'adopts the id the server assigned', String(sentId));

  // the server refusing something must surface as the server's reason, not a shrug
  await page.click('[data-close="sent"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => localStorage.removeItem('rdf.last.v1'));
  await page.click('#btn-leave');
  await page.fill('#msg', 'check out my crypto airdrop, guaranteed free money for you');
  await page.waitForTimeout(250);
  const canSend = await page.isEnabled('#btn-send');
  const shownWhy = await page.textContent('#err');
  check(!canSend, 'the client refuses spam before the network', shownWhy.trim());

  await page.fill('#msg', 'a perfectly nice sentence that the server will decide to refuse anyway');
  await page.waitForTimeout(250);
  await page.evaluate(() => localStorage.removeItem('rdf.last.v1'));
  await page.click('#btn-send');
  await page.waitForTimeout(1200);
  if (await page.isVisible('#sent.open')) {
    await page.click('[data-close="sent"]');
    await page.waitForTimeout(400);
    await page.click('#btn-leave');
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => localStorage.removeItem('rdf.last.v1'));
  await page.fill('#msg', 'this third one should trip the server side rate limit and say so');
  await page.waitForTimeout(250);
  await page.click('#btn-send');
  await page.waitForTimeout(1200);
  const errText = await page.textContent('#err');
  check(/one rainbow at a time|few minutes/i.test(errText),
    'server rate limit is shown in plain language', JSON.stringify(errText));

  // lighting and reporting reach the right functions
  if (await page.isVisible('#compose.open')) await page.click('[data-close="compose"]');
  if (await page.isVisible('#sent.open')) await page.click('[data-close="sent"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const { engine, world } = window.RDF.film;
    const c = world.byId['bbb22'];
    const p = world.pos(c, engine.t);
    engine.warp(p.x, p.y);
  });
  await page.waitForTimeout(900);
  await page.click('#btn-light');
  await page.waitForTimeout(500);
  check(calls.light === 1, 'light calls light_message', `${calls.light}`);
  await page.click('#btn-report');
  await page.waitForTimeout(500);
  check(calls.report === 1, 'report calls report_message', `${calls.report}`);

  // ——— and the part that matters most: the site must survive the database dying
  const errs2 = [];
  const p3 = await (await browser.newContext()).newPage();
  p3.on('pageerror', e => errs2.push(e.message));
  await p3.route('**/rest/v1/**', route => route.abort());
  await p3.goto(origin + '/');
  await p3.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 15000 });
  const offlineCount = await p3.evaluate(() => window.RDF.film.world.comets.length);
  check(offlineCount === 349, 'an unreachable database degrades to the founding sky',
    `${offlineCount} comets`);
  await p3.click('#btn-begin');
  await p3.click('#btn-leave');
  await p3.fill('#msg', 'written while the database was unreachable, should still be mine');
  await p3.waitForTimeout(250);
  await p3.click('#btn-send');
  await p3.waitForTimeout(1500);
  const offlineLink = await p3.inputValue('#permalink');
  check(/#\/m\//.test(offlineLink), 'a message still sends and still shares when offline');
  check(errs2.length === 0, 'no errors while offline', errs2.join(' | ') || 'clean');

  check(errs.length === 0, 'no runtime errors', errs.join(' | ') || 'clean');

  await browser.close();
  server.close();

  console.log('\nPASS');
  pass.forEach(l => console.log('  ✓ ' + l));
  if (fail.length) { console.log('\nFAIL'); fail.forEach(l => console.log('  ✗ ' + l)); }
  process.exit(fail.length ? 1 : 0);
})();
