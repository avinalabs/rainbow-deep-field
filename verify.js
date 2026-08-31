#!/usr/bin/env node
/* End-to-end check of the two paths that only matter once the site is deployed:
   the permalink round trip, and the share-card download. Runs against the exact
   bytes GitHub Pages is serving. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const url = 'file://' + path.join(__dirname, 'docs', 'index.html');
const pass = [], fail = [];
const check = (ok, label, detail) => (ok ? pass : fail).push(label + (detail ? ` — ${detail}` : ''));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  // This sandbox has no route to the internet, so the configured backend is
  // always unreachable here. That is the condition we want to test under: the
  // field has to work perfectly without it.
  const ignorable = t => /ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|Failed to fetch/i.test(t);
  page.on('console', m => { if (m.type() === 'error' && !ignorable(m.text())) errs.push(m.text()); });

  await page.goto(url);
  await page.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 15000 });
  await page.click('#btn-begin');
  await page.waitForTimeout(600);

  const total = await page.evaluate(() => window.RDF.film.world.comets.length);
  check(total === 349, 'seed count', `${total} comets`);

  // leave a message and capture the permalink it hands back
  const text = 'a test rainbow, launched to check the permalink round trip works';
  await page.click('#btn-leave');
  await page.fill('#msg', text);
  await page.waitForTimeout(300);
  const enabled = await page.isEnabled('#btn-send');
  check(enabled, 'compose accepts a valid message');
  await page.click('#btn-send');
  await page.waitForTimeout(1400);

  const link = await page.inputValue('#permalink');
  const hash = (link.match(/#.*$/) || [''])[0];
  check(/^#\/m\/[0-9a-z]+\.[A-Za-z0-9_-]+$/.test(hash),
    'permalink is self-contained', hash.slice(0, 46) + '…');

  // the download really produces a png
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.click('#btn-dl');
  const download = await dl;
  let bytes = 0;
  if (download) {
    const p = path.join('/tmp', 'card-check.png');
    await download.saveAs(p);
    bytes = fs.statSync(p).size;
  }
  check(download && bytes > 20000, 'share card downloads as png', `${bytes} bytes`);
  check(/\.png$/.test(download ? download.suggestedFilename() : ''), 'download filename',
    download ? download.suggestedFilename() : 'none');

  // ——— the round trip: a fresh visitor, brand new browser profile, arriving on that link
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errs.push('arrival: ' + e.message));
  p2.on('console', m => { if (m.type() === 'error' && !ignorable(m.text())) errs.push(m.text()); });
  await p2.goto(url + hash);
  await p2.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 15000 });

  const intro = await p2.textContent('#intro h1');
  check(/Someone left/i.test(intro), 'arrival rewrites the intro', intro.replace(/\s+/g, ' ').trim());
  const cta = await p2.textContent('#btn-begin');
  check(/Take me to it/i.test(cta), 'arrival changes the button', cta.trim());

  await p2.click('#btn-begin');
  /* Wait for the arrival, not for a stopwatch.

     This used to sleep 6500ms and hope. The flight takes about 435 frames, so
     it needed better than sixty frames a second to pass — on a loaded machine
     it simply did not, and the suite failed for reasons that had nothing to do
     with the site. Poll the actual condition with a generous ceiling. */
  await p2.waitForFunction(want => {
    const { engine, world } = window.RDF.film;
    const c = world.comets.filter(x => x.text === want)[0];
    return !!(c && engine.focused && engine.focused.id === c.id);
  }, text, { timeout: 30000 }).catch(() => { /* the check below reports it */ });

  const arrived = await p2.evaluate(wantedText => {
    const { engine, world } = window.RDF.film;
    const c = world.comets.filter(x => x.text === wantedText)[0];
    if (!c) return { found: false, focused: 'none', text: '' };
    const p = world.pos(c, engine.t);
    return {
      found: true,
      dist: Math.round(Math.hypot(p.x - engine.cat.x, p.y - engine.cat.y)),
      focused: engine.focused ? engine.focused.id : 'none',
      isTarget: !!(engine.focused && engine.focused.id === c.id),
      text: c.text
    };
  }, text);

  check(arrived.found, 'the linked comet exists for a new visitor');
  check(arrived.isTarget, 'flew to it and opened it', `dist=${arrived.dist}`);
  check(arrived.text === text, 'the message survived the trip');

  // a link naming a comet this device has never seen must not invent one
  const ctx3 = await browser.newContext();
  const p3 = await ctx3.newPage();
  await p3.goto(url + '#/s/nosuchthing');
  await p3.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 15000 });
  const ghosts = await p3.evaluate(() =>
    window.RDF.film.world.comets.filter(c => !c.text || c.text === 'undefined').length);
  check(ghosts === 0, 'an unknown link invents nothing', `${ghosts} ghost comets`);

  // a link carrying something unkind must be refused
  const nasty = Buffer.from('you are a worthless piece of shit and everyone knows it')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const p4 = await (await browser.newContext()).newPage();
  await p4.goto(url + '#/m/0.' + nasty);
  await p4.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 15000 });
  const total4 = await p4.evaluate(() => window.RDF.film.world.comets.length);
  check(total4 === 349, 'a hostile share link is refused', `${total4} comets`);

  check(errs.length === 0, 'no runtime errors with the backend unreachable',
    errs.join(' | ') || 'clean');

  await browser.close();
  console.log('\nPASS');
  pass.forEach(l => console.log('  ✓ ' + l));
  if (fail.length) {
    console.log('\nFAIL');
    fail.forEach(l => console.log('  ✗ ' + l));
  }
  process.exit(fail.length ? 1 : 0);
})();
