#!/usr/bin/env node
/* The phone pass.

   Everything here is a bug that shipped. A tester reported that the coloured
   singularities "look cosmetic" on a phone — you fly at one and nothing
   happens — and the cause turned out to be three things stacked on top of each
   other, none of which a desktop browser can show you:

     1. On a coarse pointer the pointerdown handler returned early after the
        stick check and never set `pointer.down`, so hold-to-fly — the gesture
        the intro text promises, and the only one most people try — did nothing
        at all anywhere on the glass.
     2. The stick that replaced it claimed a rectangle covering 54% of the
        width and 42% of the height, and drew its resting hint somewhere else
        entirely, so the control and the thing accepting your thumb were in
        different places.
     3. That hint disappeared permanently after first use, so there was nothing
        on screen saying where to press.

   The measurable consequence: a cat flying straight through the middle of a
   singularity, within five world units of its centre, and not being taken.

   Run against docs/index.html, which is what GitHub Pages serves.

     node verify-mobile.js
*/
const { chromium } = require('playwright');
const path = require('path');

const url = 'file://' + path.join(__dirname, 'docs', 'index.html');
const PHONE = { width: 390, height: 844 };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 3, isMobile: true, hasTouch: true
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|Failed to fetch/i.test(m.text())) {
      errs.push(m.text());
    }
  });

  await page.goto(url);
  // wait for the real boot, not just the namespace — clicking "begin" before
  // wire() has attached its listener silently does nothing, which cost an hour
  await page.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 20000 });
  await page.tap('#btn-begin');
  await page.waitForTimeout(1100);

  const boot = await page.evaluate(() => {
    const e = window.__E = window.RDF.film.engine;
    return { live: e.live, coarse: e.coarse, dpr: e.dpr, sings: (e.sings || []).length };
  });
  check('the field is live after Start flying', boot.live === true, 'live=' + boot.live);
  check('a phone is detected as a touch device', boot.coarse === true);
  check('phone text is drawn at full density', boot.dpr === 3, 'dpr=' + boot.dpr);
  check('all twenty doors are placed', boot.sings === 20, boot.sings + ' doors');

  /* ---- the canvas is not being resampled ----

     `clientWidth`/`clientHeight` are specified to return rounded integers, and
     iOS Safari's viewport is fractional nearly all the time — it sits on
     heights like 659.5 and 739.297 while the address bar slides. Sizing the
     backing store from the rounded number gave a canvas whose pixel ratio was
     3.0023 instead of 3, so the browser resampled every pixel on the way to the
     screen and everything drawn on it went soft.

     That was the whole "text looks blurry on mobile" report, and it is why
     raising the pixel ratio did not help: the resample happens at any ratio. */

  const crisp = await page.evaluate(() => {
    const cv = document.getElementById('sky');
    const e = window.__E;
    const out = [];
    for (const h of [844, 659.5, 739.297, 660.0001]) {
      cv.style.height = h + 'px';
      e.resize();
      const r = cv.getBoundingClientRect();
      out.push({
        asked: h,
        ratioW: +(cv.width / r.width).toFixed(4),
        ratioH: +(cv.height / r.height).toFixed(4),
        dpr: e.dpr
      });
    }
    cv.style.height = '';
    cv.style.width = '';
    e.resize();
    return out;
  });
  const offBy = crisp.filter(r => Math.abs(r.ratioW - r.dpr) > 0.0005
    || Math.abs(r.ratioH - r.dpr) > 0.0005);
  check('the backing store matches the box exactly, at any fractional height',
    offBy.length === 0,
    offBy.length ? offBy.map(r => r.asked + '→' + r.ratioH).join(', ')
      : crisp.map(r => r.asked + '→' + r.ratioH).join(', '));

  /* ---- the stick is where it is drawn, and no bigger than it looks ---- */

  const geom = await page.evaluate(() => {
    const e = window.__E, h = e.stickHome(), r = e.stickRadius();
    const probe = [
      ['on the stick', h.x, h.y],
      ['just off its rim', h.x - r * 1.4, h.y],
      ['screen middle', e.W / 2, e.H / 2],
      ['upper right', e.W - 40, 120],
      ['lower left', 40, e.H - 60],
      ['well left of the stick', e.W * 0.4, e.H - 120]
    ].map(([n, x, y]) => [n, e.inStickZone(x, y)]);
    // how much of the glass the stick claims
    let inside = 0, total = 0;
    for (let x = 4; x < e.W; x += 6) for (let y = 4; y < e.H; y += 6) {
      total++; if (e.inStickZone(x, y)) inside++;
    }
    /* Real overlap, not just "is it above the row". The buttons are centred and
       the stick is in the corner, so they can share a band of the screen
       without ever touching — checking only the vertical would fail a layout
       that is perfectly fine. */
    const hits = [];
    for (const id of ['btn-leave', 'bar', 'hud']) {
      const el = document.getElementById(id);
      if (!el || el.classList.contains('hidden')) continue;
      const b = el.getBoundingClientRect();
      if (!b.width) continue;
      const nx = Math.max(b.left, Math.min(h.x, b.right));
      const ny = Math.max(b.top, Math.min(h.y, b.bottom));
      if (Math.hypot(h.x - nx, h.y - ny) < r) hits.push(id);
    }
    return {
      probe, share: inside / total, home: h, r, hits,
      offBottom: Math.round(e.H - (h.y + r)), offRight: Math.round(e.W - (h.x + r))
    };
  });

  const zone = Object.fromEntries(geom.probe);
  check('the stick accepts a thumb on itself', zone['on the stick'] === true);
  check('and nothing far from it', !zone['screen middle'] && !zone['upper right']
    && !zone['lower left'] && !zone['well left of the stick']);
  check('it claims under a tenth of the glass', geom.share < 0.10,
    (geom.share * 100).toFixed(1) + '%');
  check('and it touches none of the buttons', geom.hits.length === 0,
    geom.hits.length ? 'overlaps ' + geom.hits.join(', ') : 'clear');
  check('it sits in the bottom-right corner',
    geom.offBottom >= 0 && geom.offBottom < 90 && geom.offRight >= 0 && geom.offRight < 60,
    geom.offBottom + 'px from the bottom, ' + geom.offRight + 'px from the right');

  /* ---- and it holds still ----

     It did not. The stick used to sit above a floor measured off the button
     row, and that row grows a "Share this one" bar next to a message and loses
     it inside a pocket — so the stick rode up to the middle of the screen and
     back down again depending on where you were. Reported from a real phone,
     with two screenshots showing it in two different places. */

  const stayed = await page.evaluate(async () => {
    const e = window.__E;
    const where = () => { const h = e.stickHome(); return [Math.round(h.x), Math.round(h.y)]; };

    const bare = where();
    // next to a message: the share bar appears under it
    const c = window.RDF.__world.comets[0];
    e.warp(c.x, c.y);
    for (let i = 0; i < 120; i++) { e.update(1 / 60); e.draw(); }
    const reading = where();
    // and inside a pocket, where all of that furniture is hidden
    window.RDF.pocket('prism');
    for (let i = 0; i < 30; i++) { e.update(1 / 60); e.draw(); }
    const pocket = where();
    e.pocket.left = 0;
    for (let i = 0; i < 40; i++) { e.update(1 / 60); e.draw(); }
    return { bare, reading, pocket };
  });
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  check('the stick does not move when a message opens',
    same(stayed.bare, stayed.reading),
    JSON.stringify(stayed.bare) + ' vs ' + JSON.stringify(stayed.reading));
  check('nor when you go inside a pocket',
    same(stayed.bare, stayed.pocket),
    JSON.stringify(stayed.bare) + ' vs ' + JSON.stringify(stayed.pocket));

  /* ---- both gestures reach a door ---- */

  async function flyIn(how) {
    const seen = await page.evaluate(() => {
      const e = window.__E, s = e.sings[0];
      e.singCool = 0; s.done = false;
      if (e.pocket) { e.pocket.left = 0; }
      const z = e.zEff || e.cam.z;
      e.warp(s.x, s.y + 300 / z); e.cat.vx = 0; e.cat.vy = 0;
      return { sx: Math.round((s.x - e.cam.x) * z + e.W / 2), sy: Math.round((s.y - e.cam.y) * z + e.H / 2) };
    });
    await how(seen);
    const out = await page.evaluate(async () => {
      const e = window.__E, s = e.sings[0];
      let min = 1e9;
      for (let i = 0; i < 260; i++) {
        await new Promise(r => requestAnimationFrame(r));
        min = Math.min(min, Math.hypot(s.x - e.cat.x, s.y - e.cat.y));
        if (e.pocket) return { got: e.pocket.def.key, frames: i };
      }
      return { got: null, min: Math.round(min) };
    });
    // let go and come back out for the next one
    await page.evaluate(() => {
      const el = document.querySelector('canvas');
      [7, 9].forEach(id => el.dispatchEvent(
        new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', bubbles: true })));
      const e = window.__E; if (e.pocket) e.pocket.left = 0;
    });
    await page.waitForTimeout(400);
    return out;
  }

  const held = await flyIn(async (s) => {
    await page.evaluate(({ x, y }) => {
      document.querySelector('canvas').dispatchEvent(new PointerEvent(
        'pointerdown', { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    }, { x: s.sx, y: s.sy });
  });
  check('a thumb held on a door goes through it', held.got === 'prism',
    held.got || ('never taken — closest approach ' + held.min + ' units'));

  const stick = await flyIn(async () => {
    await page.evaluate(() => {
      const e = window.__E, h = e.stickHome(), el = document.querySelector('canvas');
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, pointerType: 'touch', clientX: h.x, clientY: h.y, bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, pointerType: 'touch', clientX: h.x, clientY: h.y - 70, bubbles: true }));
    });
  });
  check('and the stick gets you there too', stick.got === 'prism',
    stick.got || ('never taken — closest approach ' + stick.min + ' units'));

  /* ---- a door still works while a mouse has one of our sentences ----

     It did not. `stepSings` bailed out entirely for the whole length of a
     chase — up to 110 seconds — so all twenty doors went inert with nothing
     saying why. Reported as "I went to the pulsar and it didn't go in; after I
     refreshed it went in fine", a refresh being the thing that ends a chase. */

  const chase = await page.evaluate(async () => {
    const e = window.__E, s = e.sings[1];
    e.singCool = 0; s.done = false;
    if (e.pocket) { e.pocket.left = 0; for (let i = 0; i < 40; i++) e.update(1 / 60); }

    // watch for the explanation the door is supposed to give
    e.__hintSeen = false;
    const realHold = e.onDoorHeldOff;
    e.onDoorHeldOff = function (d) { e.__hintSeen = true; if (realHold) realHold(d); };

    // start a chase for real, through the mouse's own entry point
    e.mouse.active = true;
    e.mouse.letter = window.RDF.__world.comets[3];
    e.mouse.t0 = e.t; e.mouse.elapsed = 0;
    e.mouse.x = e.cat.x + 40000; e.mouse.y = e.cat.y + 40000;   // far away, so it can't be caught
    const wasChasing = e.mouse.active;

    // sit at the rim of what would normally be the pull, and confirm no tow
    e.warp(s.x - s.rs * 5, s.y);
    e.cat.vx = 0; e.cat.vy = 0;
    for (let i = 0; i < 60; i++) e.update(1 / 60);
    const towed = Math.round(Math.hypot(e.cat.vx, e.cat.vy));
    const explained = !!e.__hintSeen;

    // now fly deliberately into the core — this must still work
    e.warp(s.x - s.rs * 0.5, s.y);
    e.cat.vx = 0; e.cat.vy = 0;
    for (let i = 0; i < 30; i++) { e.update(1 / 60); if (e.pocket) break; }
    const got = e.pocket ? e.pocket.def.key : null;
    if (e.pocket) { e.pocket.left = 0; for (let i = 0; i < 40; i++) e.update(1 / 60); }
    e.mouse.active = false; e.mouse.letter = null;
    return { wasChasing, towed, got, want: s.def.key, explained };
  });
  check('a chase really was running', chase.wasChasing === true);
  check('a door does not tow you off a chase', chase.towed < 30, 'speed ' + chase.towed);
  check('but flying into one still takes you', chase.got === chase.want,
    chase.got || 'refused — this is the bug that shipped');
  check('and the hold-off says so out loud', chase.explained === true);

  /* ---- the readout never lands on the courier's panel ----

     The readout had a ceiling measured DOWN from a fraction of the screen
     height, so it shrank as the message grew: a long message beside a courier
     carrying a long message got pushed back up under the courier's panel and
     the two sets of words shared the same pixels. Reported from a phone with a
     screenshot. Tested here at the worst case the field can produce. */

  const stack = await page.evaluate(async () => {
    const e = window.__E, w = window.RDF.__world;
    if (e.pocket) { e.pocket.left = 0; for (let i = 0; i < 40; i++) e.update(1 / 60); }
    e.mouse.active = false; e.mouse.letter = null;
    const byLen = [...w.comets].sort((a, b) => b.text.length - a.text.length);
    e.warp(byLen[0].x, byLen[0].y);
    for (let i = 0; i < 140; i++) { e.update(1 / 60); e.draw(); }
    const cour = e.couriers.list[0];
    cour.letter = byLen[1];
    if (e.couriers.onGreet) e.couriers.onGreet(cour);
    // she gets the screen for three seconds; the stacking question is about
    // afterwards, when her panel is still up and the readout comes back
    e.carryHold = e.t - 1;
    e.readoutTop = undefined;
    for (let i = 0; i < 60; i++) { e.update(1 / 60); e.draw(); }
    const cr = document.getElementById('carry').getBoundingClientRect();
    return {
      longest: byLen[0].text.length, carried: byLen[1].text.length,
      carryBottom: Math.round(cr.bottom),
      hard: e.reserveTop, soft: e.reserveSoft,
      readoutTop: Math.round(e.readoutTop === undefined ? -1 : e.readoutTop)
    };
  });
  check('the readout starts below the courier panel',
    stack.readoutTop > stack.carryBottom,
    'readout at ' + stack.readoutTop + ', panel ends at ' + stack.carryBottom +
    ' (' + stack.longest + '-char message, ' + stack.carried + '-char carried)');
  check('the hard floor clears the bands', stack.hard >= stack.carryBottom,
    'hard floor ' + stack.hard + ' vs panel ' + stack.carryBottom);

  /* ---- the chase clock counts seconds, not frames ----

     The engine's frame delta is capped at 50ms so a stutter cannot fling
     anybody across the field. The chase clock was built on that capped delta,
     so on a phone below 20fps it ran slow in proportion to the dropped frames —
     reported as "the screen time wasn't changing", measured at about 40% of
     real speed. */

  const clock = await page.evaluate(async () => {
    const e = window.__E, w = window.RDF.__world;
    e.mouse.active = true; e.mouse.letter = w.comets[9];
    e.mouse.elapsed = 0;
    e.mouse.x = e.cat.x + 60000; e.mouse.y = e.cat.y + 60000;

    // ten frames that each took a quarter of a second in the real world, which
    // is what a phone at 4fps looks like
    for (let i = 0; i < 10; i++) { e.realDt = 0.25; e.mouse.update(1 / 60, e); }
    const slowFrames = +e.mouse.elapsed.toFixed(2);

    e.mouse.elapsed = 0;
    for (let i = 0; i < 10; i++) { e.realDt = 1 / 60; e.mouse.update(1 / 60, e); }
    const fastFrames = +e.mouse.elapsed.toFixed(2);

    e.mouse.active = false; e.mouse.letter = null;
    delete e.realDt;
    return { slowFrames, fastFrames };
  });
  check('ten quarter-second frames count two and a half seconds',
    Math.abs(clock.slowFrames - 2.5) < 0.01, clock.slowFrames + 's');
  check('and ten fast frames count a sixth of one',
    Math.abs(clock.fastFrames - 10 / 60) < 0.01, clock.fastFrames + 's');

  /* ---- a courier gets the screen to herself ---- */

  const courier = await page.evaluate(async () => {
    const e = window.__E, w = window.RDF.__world;
    const c = w.comets.find(x => x.text.length > 80) || w.comets[0];
    e.warp(c.x, c.y);
    for (let i = 0; i < 140; i++) { e.update(1 / 60); e.draw(); }
    const readingFirst = e.readoutTop > 0 && e.focused;

    const cour = e.couriers.list[1];
    cour.letter = w.comets[11];
    if (e.couriers.onDeliver) e.couriers.onDeliver(cour, cour.letter);
    e.draw();
    const hold = e.carryHold - e.t;

    // the readout should have stepped aside
    e.readoutTop = undefined;
    for (let i = 0; i < 6; i++) { e.update(1 / 60); e.draw(); }
    const yielded = e.readoutTop === undefined;

    // and come back once she has finished
    e.carryHold = e.t - 1;
    e.readoutTop = undefined;
    for (let i = 0; i < 30; i++) { e.update(1 / 60); e.draw(); }
    const returned = e.readoutTop !== undefined;
    return { readingFirst: !!readingFirst, hold: +hold.toFixed(1), yielded, returned };
  });
  check('a message was open to begin with', courier.readingFirst);
  check('a courier holds the screen for about three seconds',
    courier.hold >= 2.5 && courier.hold <= 3.5, courier.hold + 's');
  check('and the rainbow readout steps aside for her', courier.yielded);
  check('then comes back when she is done', courier.returned);

  /* ---- sustained speed shows ---- */

  const speed = await page.evaluate(async () => {
    const e = window.__E;
    e.warp(0, 60000);                       // empty space: nothing to read, nothing to slow her
    for (let i = 0; i < 30; i++) { e.update(1 / 60); e.draw(); }
    const marks = [];
    for (let i = 0; i < 260; i++) {
      e.stick.on = true; e.stick.mag = 1; e.stick.x = 1; e.stick.y = 0;
      e.update(1 / 60); e.draw();
      if (i === 60) marks.push({ at: '1s', fast: +e.fast.toFixed(2) });
      if (i === 120) marks.push({ at: '2s', fast: +e.fast.toFixed(2) });
      if (i === 255) marks.push({ at: '4s', fast: +e.fast.toFixed(2) });
    }
    e.stick.on = false; e.stick.mag = 0;
    for (let i = 0; i < 120; i++) { e.update(1 / 60); e.draw(); }
    return { marks, after: +e.fast.toFixed(2) };
  });
  const at = k => (speed.marks.find(m => m.at === k) || {}).fast;
  check('a quick burst does not light her up', at('1s') === 0, 'fast=' + at('1s') + ' at 1s');
  check('but a sustained one does', at('4s') > 0.9, 'fast=' + at('4s') + ' at 4s');
  check('and it goes out when you let go', speed.after === 0, 'fast=' + speed.after);

  /* ---- the chase is unmistakable ---- */

  const red = await page.evaluate(() => {
    const s = [...document.querySelectorAll('style')].map(n => n.textContent).join('\n');
    const time = (s.match(/\.chase-time\{[^}]*\}/) || [''])[0];
    const note = (s.match(/\.chase-note\{[^}]*\}/) || [''])[0];
    const dot = (s.match(/\.chase-note::before\{[^}]*\}/) || [''])[0];
    return {
      timeIsRed: /#ff[0-9a-f]{4}/i.test(time) && !/#ffe6a8/i.test(time),
      timeThrobs: /animation/.test(time),
      dotBlinks: /animation/.test(dot) && /#ff/i.test(dot),
      noteIsRed: /#ff/i.test(note)
    };
  });
  check('the chase clock is red, not gold', red.timeIsRed);
  check('and it pulses', red.timeThrobs);
  check('with a blinking dot beside it', red.dotBlinks);

  /* ---- the stick reads correctly from its fixed base ---- */

  const aim = await page.evaluate(() => {
    const e = window.__E, h = e.stickHome(), r = e.stickRadius();
    const el = document.querySelector('canvas');
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 11, pointerType: 'touch', clientX: h.x, clientY: h.y, bubbles: true }));
    const read = (dx, dy) => {
      el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 11, pointerType: 'touch', clientX: h.x + dx, clientY: h.y + dy, bubbles: true }));
      return { x: +e.stick.x.toFixed(2), y: +e.stick.y.toFixed(2), mag: +e.stick.mag.toFixed(2) };
    };
    const up = read(0, -r);
    const right = read(r, 0);
    const far = read(r * 4, 0);          // dragged way past the rim
    const dead = read(2, 2);             // barely moved
    const base = { x: e.stick.bx, y: e.stick.by };
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, pointerType: 'touch', bubbles: true }));
    return { up, right, far, dead, base, home: h, off: !e.stick.on };
  });
  check('pushing up reads as up', aim.up.y < -0.9 && aim.up.mag > 0.9, JSON.stringify(aim.up));
  check('pushing right reads as right', aim.right.x > 0.9 && aim.right.mag > 0.9, JSON.stringify(aim.right));
  check('dragging past the rim stays at full tilt', aim.far.mag === 1 && aim.far.x > 0.9, JSON.stringify(aim.far));
  check('a dead zone in the middle', aim.dead.mag === 0, JSON.stringify(aim.dead));
  check('the base never wanders off home',
    Math.abs(aim.base.x - aim.home.x) < 0.5 && Math.abs(aim.base.y - aim.home.y) < 0.5);
  check('letting go releases it', aim.off === true);

  /* ---- a pocket is playable on a small screen ----

     SCREEN_SPEED is pixels per second of APPARENT motion, which keeps the field
     feeling the same at every zoom and quietly means a narrow screen is crossed
     in a fraction of the time a wide one is. In the field that is fine. Inside a
     pocket the arena IS the screen, and a phone was crossing the whole 2000-unit
     arena in 0.44s against a desktop's 0.81s — in a third of the screen area,
     because the arena was fitted to half the short side. Every correction
     overshot. Reported as "moving is very hard". */

  const arena = await page.evaluate(async () => {
    const e = window.__E;
    if (e.pocket) { e.pocket.left = 0; for (let i = 0; i < 40; i++) e.update(1 / 60); }
    e.mouse.active = false; e.mouse.letter = null;
    window.RDF.pocket('prism');
    for (let i = 0; i < 20; i++) { e.update(1 / 60); e.draw(); }
    const R = e.pocket.R, z = e.zEff || e.cam.z;
    const pace = e.pocketPace();
    const speed = (520 / z) * pace;
    const out = {
      arenaPx: Math.round(R * z), screenW: Math.round(e.W),
      fill: +(R * z / e.W).toFixed(2),
      cross: +(R / speed).toFixed(2), pace: +pace.toFixed(2)
    };
    e.pocket.left = 0;
    for (let i = 0; i < 40; i++) { e.update(1 / 60); e.draw(); }
    return out;
  });
  check('the arena uses most of a phone screen', arena.fill > 0.7,
    arena.arenaPx + 'px of ' + arena.screenW + ' (' + Math.round(arena.fill * 100) + '%)');
  check('and is not crossed in a blink', arena.cross > 0.75,
    arena.cross + 's to cross, pace ' + arena.pace);

  /* ---- the compass, which is how you find a door at all on a small screen ---- */

  const compass = await page.evaluate(() => {
    const e = window.__E;
    // stand well away from everything so the doors are all off screen
    e.warp(0, 0);
    const z = e.zEff || e.cam.z;
    let off = 0;
    for (const s of e.sings) {
      const sx = (s.x - e.cam.x) * z + e.W / 2, sy = (s.y - e.cam.y) * z + e.H / 2;
      if (sx < -20 || sx > e.W + 20 || sy < -20 || sy > e.H + 20) off++;
    }
    return { off, total: e.sings.length, hasCompass: typeof window.RDF.pockets.drawCompass === 'function' };
  });
  check('there is a compass for off-screen doors', compass.hasCompass);
  check('and it has something to point at', compass.off > 0,
    compass.off + '/' + compass.total + ' off screen from the middle');

  // and it must survive being drawn — a throw here would take the frame down
  await page.evaluate(() => { for (let i = 0; i < 30; i++) window.RDF.film.step(1 / 60); });

  /* ---- the readout stays legible and out of the way ---- */

  const readout = await page.evaluate(async () => {
    const e = window.__E, c = window.RDF.__world.comets[0];
    e.warp(c.x, c.y);
    for (let i = 0; i < 90; i++) { e.update(1 / 60); e.draw(); }
    return { hudBottom: e.hudBottom, reserveTop: e.reserveTop, footTop: e.footTop, H: e.H };
  });
  check('the readout is pushed below the buttons', readout.hudBottom > 0 && readout.hudBottom < readout.H * 0.3,
    'hudBottom=' + readout.hudBottom);
  check('and the floor is measured, not guessed', readout.footTop > 28,
    'footTop=' + readout.footTop);

  check('no runtime errors anywhere in the pass', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();

  const bad = results.filter(r => !r.ok);
  console.log('\n' + (bad.length ? 'FAIL' : 'PASS'));
  for (const r of results) {
    console.log('  ' + (r.ok ? '✓ ' : '✗ ') + r.name + (r.detail ? ' — ' + r.detail : ''));
  }
  process.exit(bad.length ? 1 : 0);
})();
