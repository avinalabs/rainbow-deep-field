#!/usr/bin/env node
/* Does the beam actually cost you anything now?
   Drops into the Pulsar, parks the cat where the beam must sweep over it, and
   watches the clock. */
const { chromium } = require('playwright');
const path = require('path');

const pass = [], fail = [];
const check = (ok, label, detail) => (ok ? pass : fail).push(label + (detail ? ` — ${detail}` : ''));
const url = 'file://' + path.join(__dirname, 'docs', 'index.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|Failed to fetch/i.test(m.text())) {
      errs.push(m.text());
    }
  });

  await page.goto(url);
  await page.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 20000 });
  await page.click('#btn-begin');
  await page.waitForTimeout(500);

  check(typeof await page.evaluate(() => typeof window.RDF.pocket) === 'string',
    'the pocket test hook exists');

  await page.evaluate(() => window.RDF.pocket('pulsar'));
  await page.waitForTimeout(1200);

  const inside = await page.evaluate(() => {
    const p = window.RDF.film.engine.pocket;
    return p ? { key: p.def.key, left: p.left, hasPenalty: typeof p.penalty === 'function' } : null;
  });
  check(!!inside && inside.key === 'pulsar', 'entered the pulsar', inside && inside.key);
  check(inside && inside.hasPenalty, 'the run exposes a time penalty');

  // Park right beside the star. The beam sweeps the whole circle, so sitting
  // near the middle guarantees it passes over us within one rotation.
  const before = await page.evaluate(() => {
    const { engine } = window.RDF.film;
    const p = engine.pocket;
    engine.cat.x = p.ox + 260; engine.cat.y = p.oy;
    engine.cat.vx = 0; engine.cat.vy = 0;
    return { left: p.left, dazzle: p.dazzle };
  });

  // let it sweep, sampling as we go
  let sawDazzle = false, sawFlash = false, biggestDrop = 0, prev = before.left;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => {
      const p = window.RDF.film.engine.pocket;
      const el = document.getElementById('pocket');
      return p ? {
        left: p.left, dazzle: p.dazzle, timeHit: p.timeHit,
        note: (el && el.querySelector('.pocket-note').textContent) || '',
        hit: !!(el && el.classList.contains('hit'))
      } : null;
    });
    if (!s) break;
    if (s.dazzle > 0) sawDazzle = true;
    if (s.hit) sawFlash = true;
    const drop = prev - s.left;
    if (drop > biggestDrop) biggestDrop = drop;
    prev = s.left;
    if (sawDazzle && biggestDrop > 1 && sawFlash) break;
  }

  check(sawDazzle, 'the beam caught the cat');
  // one 100ms sample can only lose 0.1s to the clock; anything above that is a penalty
  check(biggestDrop > 2, 'being caught takes real time off the clock',
    `−${biggestDrop.toFixed(1)}s in one frame`);
  check(Math.abs(biggestDrop - 60 * 0.07) < 1.5, 'the penalty is the intended 7% of the minute',
    `${biggestDrop.toFixed(1)}s vs 4.2s expected`);
  check(sawFlash, 'the clock flashes so the loss is visible');

  const note = await page.evaluate(() =>
    document.getElementById('pocket').querySelector('.pocket-note').textContent);
  check(/dazzled/.test(note) || sawDazzle, 'the note names what happened', JSON.stringify(note));

  /* Every time, not just at the start.

     The beam angle accumulates without bound, and the "are you in the beam"
     test used ((a - b + 3PI) % TAU) - PI — which JavaScript evaluates with the
     sign of its dividend, so once the beam passed about 3PI the expression
     could never fall inside the beam width again. Measured: three hits in the
     first stretch of a run and then nothing, with the beam sweeping harmlessly
     through the cat for the remaining forty-five seconds.

     This parks the cat in the beam's path for a whole run and counts. */
  const sweep = await page.evaluate(async () => {
    const { engine, step } = window.RDF.film;
    if (engine.pocket) { engine.pocket.left = 0; for (let i = 0; i < 40; i++) step(1 / 60); }
    window.RDF.pocket('pulsar');
    const hits = [];
    let wall = 0;
    for (let i = 0; i < 60 * 90; i++) {
      const q = engine.pocket; if (!q) break;
      const w = q.toWorld(600, 0);                    // hold still in the sweep
      engine.cat.x = w.x; engine.cat.y = w.y; engine.cat.vx = 0; engine.cat.vy = 0;
      const before = q.left;
      step(1 / 60);
      wall += 1 / 60;
      const after = engine.pocket ? engine.pocket.left : 0;
      if (before - after - 1 / 60 > 0.5) hits.push(+wall.toFixed(1));
    }
    const gaps = hits.slice(1).map((t, i) => +(t - hits[i]).toFixed(1));
    return { hits, gaps, ended: +wall.toFixed(1), last: hits[hits.length - 1] };
  });
  check(sweep.hits.length >= 6, 'the beam catches you again and again',
    sweep.hits.length + ' times in one run');
  /* The run ends early precisely BECAUSE it keeps landing — eight hits is
     thirty-four seconds off a sixty-second clock — so the test is that the
     beam is still catching at the moment the run runs out, not that it is
     still catching at some fixed wall-clock time. */
  check(sweep.ended - sweep.last < 5, 'right up until the clock runs out',
    'last hit at ' + sweep.last + 's, run ended at ' + sweep.ended + 's');
  check(sweep.gaps.every(g => g < 6), 'at every sweep, evenly',
    'gaps: ' + sweep.gaps.join(', ') + 's');

  // and the run still ends cleanly
  await page.evaluate(() => {
    const e = window.RDF.film.engine;
    if (!e.pocket) { e.singCool = 0; window.RDF.pocket('pulsar'); window.RDF.film.step(1 / 60); }
    e.pocket.left = 0.4;
  });
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => !!window.RDF.film.engine.pocket);
  check(!after, 'the run ends and returns you to the field');

  check(errs.length === 0, 'no runtime errors', errs.join(' | ') || 'clean');

  await browser.close();
  console.log('\nPASS');
  pass.forEach(l => console.log('  ✓ ' + l));
  if (fail.length) { console.log('\nFAIL'); fail.forEach(l => console.log('  ✗ ' + l)); }
  process.exit(fail.length ? 1 : 0);
})();
