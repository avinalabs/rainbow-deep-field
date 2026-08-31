#!/usr/bin/env node
/* Plays every pocket, all the way through, and reports.

   Two jobs. First: does each one actually work — enter, run sixty seconds,
   score, end, return, no errors. Second: what does a competent minute pay?
   Twenty pockets sharing one score readout have to mean the same thing, or the
   stingy ones read as broken rather than as different.

   The bot flies the real flight model by driving the real pointer at whatever
   each pocket's own `aim` points to, so it is playing the game rather than
   teleporting through it. It is unfairly good at pursuit and unfairly bad at
   anything asking for restraint or timing, which is worth remembering when
   reading the numbers.

     node verify-pockets.js            play them all
     node verify-pockets.js --scales   print a scale table to paste into source
*/
const { chromium } = require('playwright');
const path = require('path');

const WANT = 2000;                 // what a good minute should be worth anywhere
const FPS = 30;
const SECONDS = 61;
const url = 'file://' + path.join(__dirname, 'docs', 'index.html');
const scalesOnly = process.argv.includes('--scales');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|Failed to fetch/i.test(m.text())) {
      errs.push(m.text());
    }
  });

  await page.addInitScript(() => { window.RDF_FILM = true; });
  await page.goto(url);
  await page.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 20000 });
  await page.evaluate(() => { const b = document.getElementById('btn-begin'); if (b) b.click(); });

  const keys = await page.evaluate(() =>
    (window.RDF.POCKETS || []).map(d => ({ key: d.key, name: d.name, scale: d.scale || 1 })));

  const rows = [];
  for (const def of keys) {
    const before = errs.length;
    const r = await page.evaluate(async ({ key, fps, seconds }) => {
      const { engine, step } = window.RDF.film;
      window.RDF.pocket(key);

      const dt = 1 / fps;
      let entered = false, aimed = 0, exited = false;
      let raw = 0, hiCombo = 0, minLeft = 999;

      for (let i = 0; i < seconds * fps; i++) {
        const p = engine.pocket;
        if (p) {
          entered = true;
          minLeft = Math.min(minLeft, p.left);
          hiCombo = Math.max(hiCombo, p.combo || 0);
          raw = p.score / (p.def.scale || 1);          // unscaled, so scales can be re-derived

          // fly the real model: put the pointer on whatever the pocket points at
          let t = null;
          try { t = p.def.aim ? p.def.aim(p, engine) : null; } catch (e) { t = null; }
          /* The Relic has no aim marker on purpose — it is about noticing, and a
             pointer would hand you the answer. So the bot sweeps it instead of
             sitting still, which is at least a crude imitation of looking. */
          if (!t) {
            if (!window.__sweep || i % 90 === 0) {
              const a = (i / 90) * 1.7;
              window.__sweep = [Math.cos(a) * p.R * 0.55, Math.sin(a) * p.R * 0.55];
            }
            t = window.__sweep;
          } else {
            aimed++;
          }
          if (t) {
            const w = p.toWorld(t[0], t[1]);
            const z = engine.zEff || engine.cam.z;
            engine.pointer.down = true;
            engine.pointer.active = true;
            engine.pointer.x = (w.x - engine.cam.x) * z + engine.W / 2;
            engine.pointer.y = (w.y - engine.cam.y) * z + engine.H / 2;
          } else {
            engine.pointer.down = false;
          }
        } else if (entered) { exited = true; break; }
        step(dt);
      }
      engine.pointer.down = false;
      // if it is somehow still running, get out so the next one starts clean
      if (engine.pocket) { engine.pocket.left = 0.05; for (let i = 0; i < 40; i++) step(dt); }
      return { entered, exited, raw: Math.round(raw), aimed, hiCombo, minLeft: Math.round(minLeft * 10) / 10 };
    }, { key: def.key, fps: FPS, seconds: SECONDS });

    await page.waitForTimeout(120);
    rows.push({ ...def, ...r, errs: errs.length - before });
  }

  await browser.close();

  if (scalesOnly) {
    console.log('\n  key            raw    suggested scale');
    rows.forEach(r => {
      const s = r.raw > 0 ? (WANT / r.raw) : 1;
      console.log(`  ${r.key.padEnd(14)} ${String(r.raw).padStart(6)}   ${s.toFixed(2)}`);
    });
    return;
  }

  let bad = 0;
  console.log('\n  pocket           entered  ends  aimed   raw   scaled   errors');
  console.log('  ' + '─'.repeat(64));
  for (const r of rows) {
    const scaled = Math.round(r.raw * r.scale);
    // the Relic has no aim marker by design, so scoring is the test there
    const ok = r.entered && r.exited && r.raw > 0 && r.errs === 0;
    if (!ok) bad++;
    console.log(
      `  ${(ok ? '✓ ' : '✗ ') + r.key.padEnd(14)}` +
      `${String(r.entered).padStart(6)} ${String(r.exited).padStart(6)}` +
      `${String(r.aimed).padStart(7)} ${String(r.raw).padStart(6)} ${String(scaled).padStart(7)}` +
      `${String(r.errs).padStart(8)}`
    );
  }
  const scaledAll = rows.map(r => Math.round(r.raw * r.scale)).filter(n => n > 0);
  const lo = Math.min(...scaledAll), hi = Math.max(...scaledAll);
  console.log('  ' + '─'.repeat(64));
  console.log(`  ${rows.length} pockets · ${rows.length - bad} working · scored range ${lo}–${hi}`);
  if (errs.length) console.log('\n  errors:\n   ' + [...new Set(errs)].slice(0, 8).join('\n   '));
  process.exit(bad ? 1 : 0);
})();
