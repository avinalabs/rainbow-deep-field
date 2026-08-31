#!/usr/bin/env node
/* Renders the trailer frame by frame.
   The page's own animation loop is switched off and the clock is driven from
   here, so every frame lands on an exact timestamp and the result is smooth no
   matter how long a frame takes to draw.

   usage: node trailer.js [wide|tall] */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MODE = process.argv[2] === 'tall' ? 'tall' : 'wide';
const SIZE = MODE === 'tall' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
const FPS = 30;
const FRAMES = path.join(__dirname, 'frames-' + MODE);

// The three messages the trailer stops on. Chosen, not random: the first is the
// promise, the second is the theme stated outright, the third is the invitation.
const BEATS = [
  "you're doing better than the version of you from a year ago could have hoped",
  'you have never seen the same rainbow as another person',
  'someone will find yours the way you found this one'
];

/* ——— shot list, in seconds ———
   The middle section is new: five of the twenty pockets, under two seconds
   each. The first cut sold the field and never mentioned that there is
   anything to do in it, which was true when it was made and is not any more.
   Two seconds is enough to register "that is a different game" and not enough
   to explain it — which is right for a trailer.

   The order is not arbitrary. Prism throws a white beam into a full spectrum,
   and then the four that follow run red → green → blue → violet, so the
   montage is itself a rainbow. Nobody will notice and everybody will feel it. */
const SHOTS = [
  { at: 0.0,  kind: 'approach', beat: 0, from: 1500, dur: 6.0 },
  { at: 6.0,  kind: 'approach', beat: 1, from: 1250, dur: 5.6 },
  { at: 11.6, kind: 'pocket', key: 'prism',  dur: 1.9 },   // the whole spectrum
  { at: 13.5, kind: 'pocket', key: 'shock',  dur: 1.9 },   // red
  { at: 15.4, kind: 'pocket', key: 'aurora', dur: 1.9 },   // green
  { at: 17.3, kind: 'pocket', key: 'pulsar', dur: 1.9 },   // blue
  { at: 19.2, kind: 'pocket', key: 'disk',   dur: 1.9 },   // violet
  { at: 21.1, kind: 'approach', beat: 2, from: 1150, dur: 5.2 },
  { at: 26.3, kind: 'pullback', dur: 7.0 },
  { at: 33.3, kind: 'end', dur: 0.0 }
];
const RUNTIME = 33.3;

(async () => {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGEERROR', e.message));

  await page.addInitScript(() => { window.RDF_FILM = true; });
  await page.goto('file://' + path.join(__dirname, 'dist', 'index.html'));
  await page.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 15000 });

  // strip every piece of interface — the trailer is the field, nothing else
  await page.evaluate(() => {
    document.querySelectorAll('.sheet,.hud,.stats,.bar,.leave,.hint,.toast,.milestone,.pocket,.carry,.chase,.keys')
      .forEach(el => el.remove());
  });

  // A vertical frame is 1080 wide but watched on a phone held close — the caption
  // has to be roughly twice the size it would be in a browser window.
  await page.evaluate(ui => { window.RDF.film.engine.uiScale = ui; }, MODE === 'tall' ? 2.15 : 1);

  await page.evaluate(beats => {
    const f = window.RDF.film;
    window.__beats = beats.map(t => f.find(t)).filter(Boolean);
    if (window.__beats.length !== beats.length) console.warn('missing beat comet');
  }, BEATS);

  const total = Math.round(RUNTIME * FPS);
  let shotIdx = -1;

  for (let i = 0; i < total; i++) {
    const t = i / FPS;

    // Enter a new shot: place the explorer and point her at the beat.
    const si = SHOTS.findIndex((s, k) =>
      t >= s.at && (k === SHOTS.length - 1 || t < SHOTS[k + 1].at));
    if (si !== shotIdx) {
      shotIdx = si;
      await page.evaluate(shot => {
        const { engine, world } = window.RDF.film;
        if (shot.kind === 'approach') {
          if (engine.pocket) { engine.pocket.left = 0; window.RDF.film.step(0.02); }
          engine.pointer.down = false;
          const c = window.__beats[shot.beat];
          if (!c) return;
          const p = world.pos(c, engine.t);
          // come in from a different bearing each time so the cuts don't rhyme
          const ang = [2.4, 0.7, 4.1][shot.beat] || 1;
          engine.warp(p.x + Math.cos(ang) * shot.from, p.y + Math.sin(ang) * shot.from);
          engine.cam.z = engine.cam.zt = 0.5;
          engine.lock = null;
          engine.flyTo(p.x, p.y);
        } else if (shot.kind === 'pocket') {
          // hop straight from one pocket to the next without the hand-back
          if (engine.pocket) { engine.pocket.left = 0; window.RDF.film.step(0.02); }
          if (window.RDF.pocket) window.RDF.pocket(shot.key);
          engine.pointer.down = false;
        } else if (shot.kind === 'pullback') {
          engine.pointer.down = false;
          if (engine.pocket) { engine.pocket.left = 0; window.RDF.film.step(0.02); }
          engine.lock = { x: 0, y: 0 };
        }
      }, SHOTS[si]);
    }

    // Continuous moves inside a shot.
    await page.evaluate(({ t, shot }) => {
      const { engine, world } = window.RDF.film;
      if (shot.kind === 'approach') {
        const c = window.__beats[shot.beat];
        if (c) {
          const p = world.pos(c, engine.t);
          const d = Math.hypot(p.x - engine.cat.x, p.y - engine.cat.y);
          // creep closer while reading, so the shot keeps breathing
          if (d < 240) { engine.autopilot = null; engine.cat.vx *= 0.9; engine.cat.vy *= 0.9; }
          const into = (t - shot.at) / shot.dur;
          engine.cam.zt = 0.50 + into * 0.10;
        }
      } else if (shot.kind === 'pocket') {
        const q = engine.pocket;
        if (q) {
          let t = null;
          try { t = q.def.aim ? q.def.aim(q, engine) : null; } catch (e) { t = null; }
          if (t) {
            const w = q.toWorld(t[0], t[1]);
            const zz = engine.zEff || engine.cam.z;
            engine.pointer.down = true;
            engine.pointer.active = true;
            engine.pointer.x = (w.x - engine.cam.x) * zz + engine.W / 2;
            engine.pointer.y = (w.y - engine.cam.y) * zz + engine.H / 2;
          }
        }
      } else if (shot.kind === 'pullback') {
        engine.pointer.down = false;
        const into = Math.min(1, (t - shot.at) / shot.dur);
        const e = into < 0.5 ? 4 * into ** 3 : 1 - Math.pow(-2 * into + 2, 3) / 2;
        const zEnd = Math.min(window.innerWidth, window.innerHeight) / (world.R * 2.35);
        engine.cam.z = engine.cam.zt = 0.60 * Math.pow(zEnd / 0.60, e);
        engine.cat.vx = 190; engine.cat.vy = -70;    // keep her trailing across frame
      }
    }, { t, shot: SHOTS[shotIdx] });

    await page.evaluate(dt => window.RDF.film.step(dt), 1 / FPS);
    await page.screenshot({
      path: path.join(FRAMES, String(i).padStart(4, '0') + '.jpg'),
      type: 'jpeg', quality: 94
    });
    if (i % 60 === 0) process.stdout.write(`\r  ${i}/${total} frames`);
  }

  await browser.close();
  console.log(`\n  rendered ${total} frames to ${path.basename(FRAMES)}/`);
})();
