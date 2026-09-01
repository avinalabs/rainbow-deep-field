#!/usr/bin/env node
/* The whole thing, in a real browser, end to end.

   The other suites each guard one area — the field, the backend, the phone, the
   pockets, the pulsar's time penalty. This one is the sweep: every feature a
   visitor can actually reach, driven through a real page with real events, on a
   desktop viewport and a phone viewport, against docs/index.html — the file
   GitHub Pages serves.

   It is deliberately shallow and wide. Where a suite already goes deep (twenty
   pockets played to completion, sixteen backend paths, forty phone checks) this
   one only asks "does it work at all", because the value here is coverage: the
   bugs this catches are the ones where a whole feature is dead and no other
   suite happens to touch it.

     node verify-all.js            both viewports
     node verify-all.js desktop    just the wide one
     node verify-all.js phone      just the narrow one
*/
const { chromium } = require('playwright');
const path = require('path');

const url = 'file://' + path.join(__dirname, 'docs', 'index.html');
const only = process.argv[2];

const VIEWS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, dsf: 1, touch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, dsf: 3, touch: true }
].filter(v => !only || v.name === only);

let results = [];
function check(area, name, ok, detail) {
  results.push({ area, name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}

/** Drive the real flight model toward a world point until it arrives. */
async function flyTo(page, getTarget, frames = 400) {
  return page.evaluate(async ({ fn, frames }) => {
    const e = window.__E;
    const t = (new Function('e', 'return (' + fn + ')(e)'))(e);
    if (!t) return { arrived: false, why: 'no target' };
    e.autopilot = { x: t.x, y: t.y, cb: null };
    for (let i = 0; i < frames; i++) {
      e.update(1 / 60); e.draw();
      if (Math.hypot(t.x - e.cat.x, t.y - e.cat.y) < 90) return { arrived: true, i };
    }
    return { arrived: false, d: Math.round(Math.hypot(t.x - e.cat.x, t.y - e.cat.y)) };
  }, { fn: getTarget.toString(), frames });
}

async function run(view) {
  const A = (name, ok, detail) => check(view.name, name, ok, detail);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: view.viewport, deviceScaleFactor: view.dsf,
    isMobile: view.touch, hasTouch: view.touch
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|Failed to fetch|net::/i.test(m.text())) {
      errs.push(m.text());
    }
  });

  /* ---------------------------------------------------------------- boot */

  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 25000 });
  A('the page boots', true, (Date.now() - t0) + 'ms');

  const intro = await page.evaluate(() => {
    const s = document.getElementById('intro');
    return {
      open: s.classList.contains('open'),
      h1: (s.querySelector('h1') || {}).textContent,
      cta: (document.getElementById('btn-begin') || {}).textContent,
      hint: (document.getElementById('controls-hint') || {}).textContent
    };
  });
  A('the intro is showing', intro.open === true);
  A('it says what the place is', /rainbow|kind|stranger/i.test(intro.h1 + ' ' + intro.cta),
    JSON.stringify(intro.h1));
  A('the controls hint matches the device', intro.hint && intro.hint.length > 10,
    (intro.hint || '').slice(0, 60));

  const noThirdParty = await page.evaluate(() =>
    [...document.querySelectorAll('script[src],link[href],img[src]')]
      .map(n => n.src || n.href).filter(u => u && !u.startsWith('data:') && !u.startsWith('file:')));
  A('no third-party requests', noThirdParty.length === 0, noThirdParty.join(', ') || 'none');

  /* ------------------------------------------------------------ starting */

  if (view.touch) await page.tap('#btn-begin'); else await page.click('#btn-begin');
  await page.waitForTimeout(1100);

  const started = await page.evaluate(() => {
    const e = window.__E = window.RDF.film.engine;
    return {
      live: e.live,
      introClosed: !document.getElementById('intro').classList.contains('open'),
      hudShown: !document.getElementById('hud').classList.contains('hidden'),
      statsShown: !document.getElementById('stats').classList.contains('hidden'),
      leaveShown: !document.getElementById('btn-leave').classList.contains('hidden'),
      comets: window.RDF.__world.comets.length,
      doors: (e.sings || []).length,
      couriers: (e.couriers && e.couriers.list || []).length,
      dpr: e.dpr
    };
  });
  A('the intro closes', started.introClosed);
  A('the field goes live', started.live === true);
  A('the interface appears', started.hudShown && started.statsShown && started.leaveShown);
  A('the sky is populated', started.comets >= 349, started.comets + ' rainbows');
  A('twenty doors are placed', started.doors === 20);
  A('the couriers are out', started.couriers > 0, started.couriers + ' cats');

  /* ---------------------------------------------------------- the buttons */

  const sound = await page.evaluate(() => {
    const b = document.getElementById('btn-sound');
    const before = window.RDF.audio.isMuted();
    b.click();
    const after = window.RDF.audio.isMuted();
    b.click();
    return { before, after, back: window.RDF.audio.isMuted() };
  });
  A('the sound toggle works', sound.before !== sound.after && sound.back === sound.before);

  const help = await page.evaluate(async () => {
    document.getElementById('btn-help').click();
    await new Promise(r => setTimeout(r, 250));
    const s = document.getElementById('help');
    const open = s.classList.contains('open');
    const text = s.textContent;
    s.querySelector('.close').click();
    await new Promise(r => setTimeout(r, 250));
    return { open, closed: !s.classList.contains('open'), len: text.length, text };
  });
  A('the help sheet opens and closes', help.open && help.closed);
  A('it explains flying, reading and leaving',
    /fly/i.test(help.text) && /read/i.test(help.text) && /leave/i.test(help.text));

  const wide = await page.evaluate(async () => {
    const e = window.__E, z0 = e.cam.zt;
    document.getElementById('btn-wide').click();
    for (let i = 0; i < 90; i++) { e.update(1 / 60); e.draw(); }
    const z1 = e.cam.zt;
    document.getElementById('btn-wide').click();
    for (let i = 0; i < 90; i++) { e.update(1 / 60); e.draw(); }
    return { z0, z1, z2: e.cam.zt };
  });
  A('the whole-field view zooms out', wide.z1 < wide.z0 * 0.5,
    wide.z0.toFixed(3) + ' → ' + wide.z1.toFixed(4));
  A('and comes back', wide.z2 > wide.z1 * 1.5);

  /* ------------------------------------------------------------- flying */

  const keys = await page.evaluate(async () => {
    const e = window.__E;
    e.warp(0, 40000); e.cat.vx = 0; e.cat.vy = 0;
    const a = { x: e.cat.x, y: e.cat.y };
    for (const k of ['w', 'a', 's', 'd']) {
      e.keys[k] = true;
      for (let i = 0; i < 40; i++) { e.update(1 / 60); e.draw(); }
      e.keys[k] = false;
    }
    return Math.round(Math.hypot(e.cat.x - a.x, e.cat.y - a.y));
  });
  A('WASD flies the cat', keys > 200, keys + ' units');

  const held = await page.evaluate(async () => {
    const e = window.__E;
    e.warp(0, 40000); e.cat.vx = 0; e.cat.vy = 0;
    const a = { x: e.cat.x, y: e.cat.y };
    const el = document.querySelector('canvas');
    el.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 21, pointerType: e.coarse ? 'touch' : 'mouse',
      clientX: e.W * 0.3, clientY: e.H * 0.25, bubbles: true
    }));
    for (let i = 0; i < 90; i++) { e.update(1 / 60); e.draw(); }
    const moved = Math.round(Math.hypot(e.cat.x - a.x, e.cat.y - a.y));
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21, bubbles: true }));
    return moved;
  });
  A('holding a pointer flies the cat', held > 200, held + ' units');

  const zoom = await page.evaluate(async () => {
    const e = window.__E, z0 = e.cam.zt;
    document.querySelector('canvas').dispatchEvent(
      new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
    const z1 = e.cam.zt;
    document.querySelector('canvas').dispatchEvent(
      new WheelEvent('wheel', { deltaY: 800, bubbles: true, cancelable: true }));
    return { z0, z1, z2: e.cam.zt };
  });
  A('the wheel zooms both ways', zoom.z1 > zoom.z0 && zoom.z2 < zoom.z1,
    [zoom.z0, zoom.z1, zoom.z2].map(n => n.toFixed(3)).join(' → '));

  /* -------------------------------------------------------- reading one */

  const read = await page.evaluate(async () => {
    const e = window.__E, w = window.RDF.__world;
    const c = w.comets.find(x => !x.found && x.text.length > 40) || w.comets[0];
    const p = w.pos(c, e.t);
    e.warp(p.x, p.y); e.cat.vx = 0; e.cat.vy = 0;
    const before = e.found;
    for (let i = 0; i < 200; i++) { e.update(1 / 60); e.draw(); }
    return {
      focused: !!e.focused, id: e.focused && e.focused.id, want: c.id,
      readingClass: document.body.classList.contains('reading'),
      barShown: !document.getElementById('bar').classList.contains('hidden'),
      counted: e.found > before,
      readoutDrawn: e.readoutTop > 0, readoutTop: Math.round(e.readoutTop || -1),
      statText: (document.getElementById('stat-found') || {}).textContent
    };
  });
  A('drifting close opens a message', read.focused && read.id === read.want);
  A('the readout is drawn', read.readoutDrawn, 'top=' + read.readoutTop);
  A('the page knows it is being read', read.readingClass);
  A('the light / share / report bar appears', read.barShown);
  A('the find is counted', read.counted, 'found reads ' + read.statText);

  const spectrum = await page.evaluate(() => {
    const c = window.__E.focused;
    const s = c.spec;
    const same = window.RDF.spectrum.analyse(c.text);
    return {
      bands: s.bands.length, nm: [Math.round(s.startNm), Math.round(s.endNm)],
      lines: s.lines.length, designation: s.designation,
      deterministic: Math.round(same.startNm) === Math.round(s.startNm)
        && same.designation === s.designation && same.bands.length === s.bands.length
    };
  });
  A('the message has a real spectrum', spectrum.bands > 3 && spectrum.lines > 0,
    spectrum.bands + ' bands, ' + spectrum.lines + ' lines, ' + spectrum.nm.join('–') + 'nm');
  A('the same words give the same spectrum', spectrum.deterministic);

  /* ----------------------------------------------------- lighting one up */

  const lit = await page.evaluate(async () => {
    const btn = document.getElementById('btn-light');
    const c = window.__E.focused;
    const before = window.RDF.store.isLit(c.id);
    btn.click();
    await new Promise(r => setTimeout(r, 400));
    return { before, after: window.RDF.store.isLit(c.id), lit: btn.classList.contains('lit') };
  });
  A('a message can be lit up', lit.before !== lit.after && lit.lit);

  /* ------------------------------------------------ sharing and the card */

  // "Share this one" copies the link and says so; the card sheet is what you
  // get after sending one of your own, which is tested further down.
  const share = await page.evaluate(async () => {
    let copied = null;
    const real = navigator.clipboard && navigator.clipboard.writeText;
    if (navigator.clipboard) navigator.clipboard.writeText = async t => { copied = t; };
    document.getElementById('btn-share').click();
    await new Promise(r => setTimeout(r, 500));
    if (navigator.clipboard && real) navigator.clipboard.writeText = real;
    const toast = document.querySelector('.toast');
    return { copied, toast: toast && toast.textContent,
      hasPayload: /#\/m\/[a-z0-9]+\./.test(copied || '') };
  });
  A('sharing copies a self-contained link', share.hasPayload,
    (share.copied || '(nothing copied)').slice(0, 60) + '…');
  A('and confirms it', /copied/i.test(share.toast || ''), share.toast);

  /* ------------------------------------------------------------ composing */

  const compose = await page.evaluate(async () => {
    document.getElementById('btn-leave').click();
    await new Promise(r => setTimeout(r, 450));
    const sheet = document.getElementById('compose');
    const msg = document.getElementById('msg');
    const send = document.getElementById('btn-send');
    const startDisabled = send.disabled;

    // the counter and live preview
    msg.value = 'a quiet test rainbow for the sweep';
    msg.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const count = (document.getElementById('count') || {}).textContent;
    const nm = (document.getElementById('prev-nm') || {}).textContent;
    const enabled = !send.disabled;

    // and what it refuses — ordinary words, no profanity, purely cruel
    msg.value = 'you are all worthless and I hate every one of you';
    msg.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const err = (document.getElementById('err') || {}).textContent;

    // over-length
    msg.value = 'x'.repeat(300);
    msg.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const longCount = (document.getElementById('count') || {}).textContent;
    const longBlocked = send.disabled;

    return { startDisabled, count, nm, enabled, err, longCount, longBlocked,
      open: sheet.classList.contains('open') };
  });
  A('the compose sheet opens', compose.open);
  A('send is disabled until there are words', compose.startDisabled && compose.enabled);
  A('the character count works', /\d+ \/ 160/.test(compose.count || ''), compose.count);
  A('the live spectrum preview updates', /\d+–\d+ nm/.test(compose.nm || ''), compose.nm);
  A('unkind words are refused', (compose.err || '').length > 0, compose.err);
  A('an over-long message cannot be sent', compose.longBlocked, compose.longCount);

  const sent = await page.evaluate(async () => {
    const msg = document.getElementById('msg');
    const text = 'a quiet test rainbow, ' + Date.now().toString(36);
    msg.value = text;
    msg.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const before = window.RDF.__world.comets.length;
    document.getElementById('btn-send').click();
    await new Promise(r => setTimeout(r, 1400));
    const link = (document.getElementById('permalink') || {}).value || '';
    const found = window.RDF.__world.comets.find(c => c.text === text);
    document.getElementById('sent').querySelector('.close').click();
    await new Promise(r => setTimeout(r, 250));
    return { before, after: window.RDF.__world.comets.length, link, placed: !!found, text };
  });
  A('a message can be sent with the database unreachable', sent.after === sent.before + 1,
    sent.before + ' → ' + sent.after);
  A('it lands in the sky', sent.placed);
  A('and comes back with a shareable link', /#\/m\//.test(sent.link));

  /* ------------------------------------------------------ the permalink */

  const trip = await ctx.newPage();
  const triperrs = [];
  trip.on('pageerror', e => triperrs.push(e.message));
  const hash = sent.link.slice(sent.link.indexOf('#'));
  await trip.goto(url + hash);
  await trip.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 25000 });
  const arrival = await trip.evaluate(() => ({
    eyebrow: (document.querySelector('#intro .eyebrow') || {}).textContent,
    cta: (document.getElementById('btn-begin') || {}).textContent
  }));
  A('a shared link rewrites the intro for the arrival',
    /sent you|left this|for you/i.test(arrival.eyebrow || ''), arrival.eyebrow);
  A('and changes the button', /take me|go/i.test(arrival.cta || ''), arrival.cta);

  await trip.click('#btn-begin');
  await trip.waitForTimeout(1400);
  const landed = await trip.evaluate(async (want) => {
    const e = window.RDF.film.engine;
    for (let i = 0; i < 700; i++) {
      e.update(1 / 60); e.draw();
      if (e.focused && e.focused.text === want) return { ok: true, i };
    }
    return { ok: false, focused: e.focused && e.focused.text };
  }, sent.text);
  A('a stranger with the link lands on that exact message', landed.ok,
    landed.ok ? ('after ' + landed.i + ' frames') : ('got ' + landed.focused));
  A('no errors on the arrival page', triperrs.length === 0, triperrs.slice(0, 2).join(' | '));
  await trip.close();

  /* ------------------------------------------------------------ reporting */

  const report = await page.evaluate(async () => {
    const e = window.__E, w = window.RDF.__world;
    const c = w.comets[3];
    const p = w.pos(c, e.t);
    e.warp(p.x, p.y);
    for (let i = 0; i < 200; i++) { e.update(1 / 60); e.draw(); }
    if (!e.focused) return { skipped: true };
    document.getElementById('btn-report').click();
    await new Promise(r => setTimeout(r, 500));
    const toast = document.querySelector('.toast');
    return { fired: true, toast: toast && toast.textContent };
  });
  A('a message can be reported', report.fired === true, report.toast || '');

  /* ------------------------------------------------------- the couriers */

  const courier = await page.evaluate(async () => {
    const e = window.__E, w = window.RDF.__world;
    const cour = e.couriers.list[0];
    cour.letter = w.comets[12];
    if (e.couriers.onGreet) e.couriers.onGreet(cour);
    await new Promise(r => setTimeout(r, 120));
    const panel = document.getElementById('carry');
    const shown = panel.classList.contains('on');
    const text = panel.textContent;
    const held = e.carryHold - e.t;
    if (e.couriers.onPart) e.couriers.onPart();
    await new Promise(r => setTimeout(r, 120));
    return { shown, text: text.slice(0, 60), held: +held.toFixed(1),
      gone: !panel.classList.contains('on') };
  });
  A('a courier alongside shows what she carries', courier.shown, courier.text);
  A('she holds the screen for about three seconds',
    courier.held >= 2.5 && courier.held <= 3.5, courier.held + 's');
  A('and the panel clears when she leaves', courier.gone);

  /* ------------------------------------------------------------ the mouse */

  const chase = await page.evaluate(async () => {
    const e = window.__E;
    e.mouse.stop(false, e);
    const ok = e.mouse.start(e);
    await new Promise(r => setTimeout(r, 200));
    const band = document.getElementById('chase');
    const on = band.classList.contains('on');
    const stolen = e.mouse.letter && e.mouse.letter.taken;
    // it is unreachable where it is; drag it onto the cat and catch it
    e.mouse.x = e.cat.x + 10; e.mouse.y = e.cat.y + 10;
    let caught = false;
    for (let i = 0; i < 30; i++) {
      e.realDt = 1 / 60; e.update(1 / 60); e.draw();
      if (!e.mouse.active) { caught = true; break; }
    }
    await new Promise(r => setTimeout(r, 400));
    const sheet = document.getElementById('sent');
    const closed = sheet.classList.contains('open');
    if (closed) { sheet.querySelector('.close').click(); await new Promise(r => setTimeout(r, 250)); }
    return { ok, on, stolen: !!stolen, caught,
      bandGone: !document.getElementById('chase').classList.contains('on') };
  });
  A('a mouse can steal a message', chase.ok && chase.stolen);
  A('the chase clock appears', chase.on);
  A('the mouse can be caught', chase.caught);
  A('and the clock goes away afterwards', chase.bandGone);

  /* ---------------------------------------------- the hole in the middle */

  const hole = await page.evaluate(async () => {
    const e = window.__E;
    e.mouse.active = false; e.mouse.letter = null;
    e.hole.cool = 0; e.singCool = 0;
    e.warp(e.hole.x + 200, e.hole.y);
    e.cat.vx = 0; e.cat.vy = 0;
    const from = { x: e.cat.x, y: e.cat.y };
    let moved = 0;
    for (let i = 0; i < 400; i++) {
      e.update(1 / 60); e.draw();
      const d = Math.hypot(e.cat.x - from.x, e.cat.y - from.y);
      if (d > 4000) { moved = Math.round(d); break; }
    }
    return { moved };
  });
  A('the middle of the galaxy puts you down somewhere else', hole.moved > 4000,
    hole.moved + ' units away');

  /* ------------------------------------------------------------ a pocket */

  const pocket = await page.evaluate(async () => {
    const e = window.__E;
    e.singCool = 0;
    window.RDF.pocket('prism');
    for (let i = 0; i < 30; i++) { e.update(1 / 60); e.draw(); }
    const band = document.getElementById('pocket');
    const inside = !!e.pocket;
    const hud = band.classList.contains('on');
    const name = (band.querySelector('.pocket-name') || {}).textContent;
    const fieldHidden = document.getElementById('stats').classList.contains('hidden');
    // play it for a few seconds using the pocket's own aim
    for (let i = 0; i < 240; i++) {
      const p = e.pocket; if (!p) break;
      let t = null; try { t = p.def.aim ? p.def.aim(p, e) : null; } catch (err) { }
      if (t) {
        const w = p.toWorld(t[0], t[1]); const z = e.zEff || e.cam.z;
        e.pointer.down = true; e.pointer.active = true;
        e.pointer.x = (w.x - e.cam.x) * z + e.W / 2;
        e.pointer.y = (w.y - e.cam.y) * z + e.H / 2;
      }
      e.update(1 / 60); e.draw();
    }
    const scored = e.pocket ? Math.round(e.pocket.score) : 0;
    const clockRan = e.pocket ? e.pocket.left < 59 : false;
    e.pointer.down = false;
    if (e.pocket) e.pocket.left = 0;
    for (let i = 0; i < 60; i++) { e.update(1 / 60); e.draw(); }
    return {
      inside, hud, name, fieldHidden, scored, clockRan,
      out: !e.pocket,
      fieldBack: !document.getElementById('stats').classList.contains('hidden'),
      best: window.RDF.store.pocketBest('prism').best
    };
  });
  A('a door drops you into a pocket', pocket.inside, pocket.name);
  A('the pocket HUD replaces the field furniture', pocket.hud && pocket.fieldHidden);
  A('the clock runs and it scores', pocket.clockRan && pocket.scored > 0,
    pocket.scored + ' points');
  A('the run ends and gives you back', pocket.out && pocket.fieldBack);
  A('the best score is remembered', pocket.best > 0, 'best ' + pocket.best);

  const everyDoor = await page.evaluate(async () => {
    const e = window.__E;
    const bad = [];
    for (const def of window.RDF.POCKETS) {
      e.singCool = 0;
      window.RDF.pocket(def.key);
      let ok = false;
      for (let i = 0; i < 20; i++) { e.update(1 / 60); e.draw(); if (e.pocket) { ok = true; break; } }
      if (!ok || e.pocket.def.key !== def.key) bad.push(def.key);
      if (e.pocket) { e.pocket.left = 0; for (let i = 0; i < 50; i++) { e.update(1 / 60); e.draw(); } }
    }
    return { total: window.RDF.POCKETS.length, bad };
  });
  A('all twenty pockets can be entered and left', everyDoor.bad.length === 0,
    (everyDoor.total - everyDoor.bad.length) + '/' + everyDoor.total +
    (everyDoor.bad.length ? ' — failed: ' + everyDoor.bad.join(', ') : ''));

  /* -------------------------------------------------------------- traffic */

  const ships = await page.evaluate(async () => {
    const e = window.__E;
    if (e.pocket) { e.pocket.left = 0; for (let i = 0; i < 40; i++) { e.update(1 / 60); e.draw(); } }
    e.warp(0, 60000);
    e.ships.list.length = 0; e.ships.seen = 0; e.ships.next = 0.2;

    // ten simulated minutes of the field, to see how often one goes past
    let peak = 0;
    for (let i = 0; i < 60 * 600; i++) {
      e.ships.update(1 / 60, e);
      peak = Math.max(peak, e.ships.list.length);
    }
    const perTenMin = e.ships.seen;

    // one on screen, drawn, and confirm nothing throws
    e.ships.list.length = 0;
    const s = e.ships.spawn(e);
    s.x = e.W / 2; s.y = e.H / 2; s.life = 4; s.vx = 0; s.vy = 0;
    for (let i = 0; i < 5; i++) e.draw();
    const onScreen = e.ships.list.length === 1;

    // and none inside a pocket, because that is not this sky
    window.RDF.pocket('prism');
    for (let i = 0; i < 20; i++) { e.update(1 / 60); e.draw(); }
    const before = e.ships.list.length;
    e.ships.next = 0;
    for (let i = 0; i < 120; i++) e.ships.update(1 / 60, e);
    const spawnedInPocket = e.ships.list.length > before;
    if (e.pocket) { e.pocket.left = 0; for (let i = 0; i < 50; i++) { e.update(1 / 60); e.draw(); } }
    e.ships.list.length = 0;

    return { perTenMin, peak, onScreen, spawnedInPocket };
  });
  A('ships pass by now and then', ships.perTenMin >= 4 && ships.perTenMin <= 30,
    ships.perTenMin + ' in ten minutes');
  A('never more than a couple at once', ships.peak <= 2, 'peak ' + ships.peak);
  A('one draws without complaint', ships.onScreen);
  A('and none turn up inside a pocket', ships.spawnedInPocket === false);

  const deterministic = await page.evaluate(() => {
    // the same seed must give the same traffic, like everything else here
    const mk = () => {
      const s = new window.RDF.Ships();
      const fake = { W: 1280, H: 800, cam: { x: 0, y: 0 }, zEff: 0.5, pocket: null, reduceMotion: false };
      const seq = [];
      for (let i = 0; i < 60 * 400; i++) {
        s.update(1 / 60, fake);
        if (s.list.length) seq.push(Math.round(s.list[s.list.length - 1].y));
      }
      return seq.slice(0, 40).join(',');
    };
    return mk() === mk();
  });
  A('the same sky gives the same traffic', deterministic === true);

  /* ---------------------------------------------------- resetting scores */

  const reset = await page.evaluate(async () => {
    const e = window.__E;
    window.RDF.store.pocketScore('prism', 1234);
    window.RDF.store.chase(9876);
    const before = window.RDF.store.pocketBest('prism').best;
    const found = window.RDF.store.discovered();

    document.getElementById('btn-help').click();
    await new Promise(r => setTimeout(r, 250));
    const btn = document.getElementById('btn-reset');
    btn.click();                                   // arms it
    await new Promise(r => setTimeout(r, 120));
    const armed = btn.textContent;
    const stillThere = window.RDF.store.pocketBest('prism').best;
    btn.click();                                   // confirms
    await new Promise(r => setTimeout(r, 200));
    const after = window.RDF.store.pocketBest('prism').best;
    const said = (document.getElementById('reset-said') || {}).textContent;
    document.getElementById('help').querySelector('.close').click();
    await new Promise(r => setTimeout(r, 250));
    return {
      before, stillThere, after, armed, said,
      foundBefore: found, foundAfter: window.RDF.store.discovered(),
      doorsFresh: (e.sings || []).every(s => !s.done)
    };
  });
  A('there is a way to clear your scores', reset.before === 1234);
  A('one press only arms it', /sure/i.test(reset.armed) && reset.stillThere === 1234,
    JSON.stringify(reset.armed));
  A('a second press clears them', reset.after === 0, reset.said);
  A('and it leaves the rainbows you have read alone',
    reset.foundAfter === reset.foundBefore,
    reset.foundBefore + ' found before, ' + reset.foundAfter + ' after');
  A('the doors go back to being new', reset.doorsFresh);

  /* -------------------------------------------- the browser gets out of the way

     Reported from Opera: the page zoomed, the controls stopped answering, and
     a copy/paste bar kept appearing over the game. Three separate things — page
     zoom, a stranded canvas, and the text-selection callout — and the middle
     one was self-inflicted: once the canvas was pinned to an exact pixel size
     for sharpness, measuring the canvas to decide its size became circular, so
     a viewport change with no resize event left it stranded. */

  const gestures = await page.evaluate(() => {
    const cv = document.getElementById('sky');
    const ctxEv = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const selEv = new Event('selectstart', { bubbles: true, cancelable: true });
    const e = window.__E;
    const before = e.cam.zt;
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, ctrlKey: true, bubbles: true, cancelable: true }));
    const afterCtrl = e.cam.zt;
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true, cancelable: true }));
    const meta = (document.querySelector('meta[name=viewport]') || {}).content || '';
    return {
      contextMenu: !cv.dispatchEvent(ctxEv),
      selection: !cv.dispatchEvent(selEv),
      userSelect: getComputedStyle(cv).userSelect || getComputedStyle(cv).webkitUserSelect,
      ctrlHeld: afterCtrl === before,
      plainWorks: e.cam.zt !== afterCtrl,
      noUserScale: /user-scalable=no/.test(meta) && /maximum-scale=1/.test(meta)
    };
  });
  A('right-click menu is refused on the canvas', gestures.contextMenu);
  A('and text selection with it', gestures.selection && gestures.userSelect === 'none',
    gestures.userSelect);
  A('ctrl-wheel does not fly the camera', gestures.ctrlHeld);
  A('but a plain wheel still zooms the game', gestures.plainWorks);
  A('pinch zoom is turned off', gestures.noUserScale);

  const typable = await page.evaluate(async () => {
    document.getElementById('btn-leave').click();
    await new Promise(r => setTimeout(r, 400));
    const m = document.getElementById('msg');
    m.value = 'a kind sentence typed into the box';
    m.dispatchEvent(new Event('input', { bubbles: true }));
    m.focus(); m.setSelectionRange(2, 8);
    const cs = getComputedStyle(m);
    const out = {
      userSelect: cs.userSelect || cs.webkitUserSelect,
      selected: m.value.substring(m.selectionStart, m.selectionEnd),
      sendEnabled: !document.getElementById('btn-send').disabled
    };
    document.getElementById('compose').querySelector('.close').click();
    await new Promise(r => setTimeout(r, 300));
    return out;
  });
  A('but you can still type and select in the message box',
    typable.userSelect === 'text' && typable.selected === 'kind s' && typable.sendEnabled,
    JSON.stringify(typable.selected));

  const heals = await page.evaluate(async () => {
    const cv = document.getElementById('sky'), e = window.__E;
    // strand it the way a zoom with no resize event does
    cv.style.width = '420px'; cv.style.height = '260px';
    cv.width = 420; cv.height = 260; e.W = 420; e.H = 260;
    const stranded = [Math.round(e.W), Math.round(e.H)];
    await new Promise(r => setTimeout(r, 1500));   // no events at all
    const de = document.documentElement.getBoundingClientRect();
    return {
      stranded,
      healed: [Math.round(e.W), Math.round(e.H)],
      viewport: [Math.round(de.width), Math.round(de.height)],
      ratio: +(cv.width / cv.getBoundingClientRect().width).toFixed(3)
    };
  });
  A('a stranded canvas repairs itself with no events',
    heals.healed[0] === heals.viewport[0] && heals.healed[1] === heals.viewport[1],
    heals.stranded.join('x') + ' → ' + heals.healed.join('x') +
    ', viewport ' + heals.viewport.join('x'));
  A('and comes back at an exact pixel ratio', Math.abs(heals.ratio - view.dsf) < 0.01,
    'ratio ' + heals.ratio);

  /* ------------------------------------------------------------ resizing */

  /* Resize the real viewport, not the canvas. The canvas is pinned to an exact
     pixel size now, so poking its style tells resize() nothing — the viewport
     is the input, which is the entire point of the Opera fix. */
  const resized = [];
  for (const [w, h] of [[320, 568], [768, 1024], [1440, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(350);
    resized.push(await page.evaluate(() => {
      const e = window.__E, cv = document.getElementById('sky');
      const de = document.documentElement.getBoundingClientRect();
      return {
        w: Math.round(de.width), h: Math.round(de.height),
        W: Math.round(e.W), H: Math.round(e.H),
        ratio: +(cv.width / cv.getBoundingClientRect().width).toFixed(3),
        dpr: e.dpr
      };
    }));
  }
  await page.setViewportSize(view.viewport);
  await page.waitForTimeout(350);
  A('it follows every viewport it is given',
    resized.every(s => s.W === s.w && s.H === s.h),
    resized.map(s => s.w + '×' + s.h + '→' + s.W + '×' + s.H).join(', '));
  A('at an exact pixel ratio each time',
    resized.every(s => Math.abs(s.ratio - s.dpr) < 0.01),
    resized.map(s => s.ratio).join(', '));

  /* ------------------------------------------------------------- storage */

  const persisted = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => /rdf|rainbow/i.test(k));
    const found = window.RDF.store.discovered();
    return { keys: keys.length, found };
  });
  A('progress is stored locally', persisted.keys > 0 && persisted.found > 0,
    persisted.keys + ' keys, ' + persisted.found + ' found');

  // the reset above cleared the bests on purpose, so put one back to prove it
  // is the storage that survives a reload rather than a leftover value
  await page.evaluate(() => window.RDF.store.pocketScore('prism', 777));
  const reload = await page.reload().then(() =>
    page.waitForFunction(() => window.RDF && window.RDF.film, null, { timeout: 25000 }))
    .then(() => page.evaluate(() => ({
      found: window.RDF.store.discovered(),
      best: window.RDF.store.pocketBest('prism').best
    })));
  A('and survives a reload', reload.found > 0 && reload.best === 777,
    reload.found + ' found, prism best ' + reload.best);

  A('no runtime errors in the whole pass', errs.length === 0,
    [...new Set(errs)].slice(0, 3).join(' | '));

  await browser.close();
}

(async () => {
  for (const v of VIEWS) {
    try { await run(v); }
    catch (e) { check(v.name, 'the pass completed', false, e.message.split('\n')[0]); }
  }

  const areas = [...new Set(results.map(r => r.area))];
  let bad = 0;
  for (const area of areas) {
    const rows = results.filter(r => r.area === area);
    const fails = rows.filter(r => !r.ok).length;
    bad += fails;
    console.log('\n  ' + area.toUpperCase() + '  ' + (rows.length - fails) + '/' + rows.length);
    console.log('  ' + '─'.repeat(70));
    for (const r of rows) {
      console.log('  ' + (r.ok ? '✓ ' : '✗ ') + r.name + (r.detail ? ' — ' + r.detail : ''));
    }
  }
  console.log('\n  ' + (bad ? 'FAIL — ' + bad + ' broken' : 'PASS — ' + results.length + ' checks')
    + ' across ' + areas.length + ' viewport' + (areas.length === 1 ? '' : 's') + '\n');
  process.exit(bad ? 1 : 0);
})();
