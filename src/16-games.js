/* Rainbow Deep Field — the seven pockets.

   One rule held all of them to account: if a pocket could be lifted out and
   dropped into any other game unchanged, it does not belong in this one. So
   there is no pocket where you shoot things and no pocket where you dodge
   asteroids. There is a prism, a pulsar, a Doppler shift, a star nursery, a
   gravitational lens, a set of absorption lines and the cosmic microwave
   background — and each of them asks for a different verb, because seven
   variations on "fly at the glowing thing" would be one minigame with seven
   colours on it.

     PRISM       sort         tow split light to the band it belongs in
     PULSAR      time         collect in the dark between the sweeps
     DOPPLER     manage speed score only while you are closing on it
     NURSERY     herd         push newborn light together until it merges
     LENS        navigate     nothing travels straight; use the wells
     ABSORPTION  thread       cross the dark lines and a sentence assembles
     RELIC       perceive     the oldest light, almost too faint to see

   Every one of them still uses the flight model, because flying is the best
   thing this project has and each of these should be an excuse to do more of
   it, not a place where it gets taken away. */
(function (RDF) {
  'use strict';

  var TAU = Math.PI * 2;
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

  /** Shared: a glowing dot, drawn the same way everywhere so the seven feel
      like one family rather than seven student projects. */
  function orb(ctx, s, r, rgb, a, core) {
    var col = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
    var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    g.addColorStop(0, 'rgba(' + col + ',' + a + ')');
    g.addColorStop(0.4, 'rgba(' + col + ',' + (a * 0.35) + ')');
    g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    if (core !== false) {
      var cr = Math.max(1, r * 0.15);
      var cg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, cr);
      cg.addColorStop(0, 'rgba(255,255,255,' + (a * 0.95) + ')');
      cg.addColorStop(0.6, 'rgba(255,255,255,' + (a * 0.7) + ')');
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cg;
      ctx.fillRect(s.x - cr, s.y - cr, cr * 2, cr * 2);
    }
  }

  /* ===================================================================== 1 */

  var PRISM = {
    key: 'prism',
    aim: function (p, e) {
      if (p.carried.length) { var b = p.bands[p.carried[0].band]; return [b.x, b.y]; }
      var cx = p.catX(e), cy = p.catY(e), best = null, bd = Infinity;
      for (var i = 0; i < p.motes.length; i++) {
        var o = p.motes[i];
        if (o.held) continue;
        var d = dist(o.x, o.y, cx, cy);
        if (d < bd) { bd = d; best = o; }
      }
      return best ? [best.x, best.y] : [0, 0];
    },
    scale: 2.5,
    name: 'The Prism',
    tint: [186, 140, 255],
    ground: ['#06040f', '#120a24'],
    blurb: 'White light comes in. Take each colour to the wavelength it belongs to.',
    init: function (p) {
      p.motes = [];
      p.carried = [];
      p.bands = [];
      // six collectors round the rim, one per stretch of the visible band
      for (var i = 0; i < 6; i++) {
        var a = -Math.PI / 2 + (i / 6) * TAU;
        var t = i / 5;
        p.bands.push({
          a: a, t: t,
          x: Math.cos(a) * p.R * 0.86, y: Math.sin(a) * p.R * 0.86,
          rgb: RDF.spectrum.lutColor(t), lit: 0
        });
      }
      p.next = 0;
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);

      p.next -= dt;
      if (p.next <= 0 && p.motes.length < 16) {
        p.next = 0.42;
        var i = Math.floor(rnd(0, 6));
        var a = rnd(0, TAU);
        var sp = rnd(150, 260);
        p.motes.push({
          x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          band: i, rgb: RDF.spectrum.lutColor(i / 5), held: false, age: 0
        });
      }

      for (var m = p.motes.length - 1; m >= 0; m--) {
        var o = p.motes[m];
        o.age += dt;
        if (o.held) {
          // towed: it trails behind you rather than sticking to you, so a full
          // load is visibly a load
          var idx = p.carried.indexOf(o);
          var want = 90 + idx * 70;
          var dx = cx - o.x, dy = cy - o.y;
          var d = Math.hypot(dx, dy) || 1;
          var pull = (d - want) * 5;
          o.vx += (dx / d) * pull * dt * 6;
          o.vy += (dy / d) * pull * dt * 6;
          o.vx *= 0.94; o.vy *= 0.94;
        } else {
          o.vx *= 0.995; o.vy *= 0.995;
          if (dist(o.x, o.y, cx, cy) < 150 && p.carried.length < 4) {
            o.held = true; p.carried.push(o);
            if (RDF.audio) RDF.audio.squeak();
          }
        }
        o.x += o.vx * dt; o.y += o.vy * dt;
        var rr = Math.hypot(o.x, o.y);
        if (rr > p.R) { o.x *= p.R / rr; o.y *= p.R / rr; o.vx *= -0.4; o.vy *= -0.4; }

        // delivered?
        for (var b = 0; b < p.bands.length; b++) {
          var bd = p.bands[b];
          if (dist(o.x, o.y, bd.x, bd.y) > 240) continue;
          if (!o.held) continue;
          p.carried.splice(p.carried.indexOf(o), 1);
          p.motes.splice(m, 1);
          if (bd === p.bands[o.band]) {
            p.combo++;
            var pts = 10 + Math.min(p.combo, 8) * 5;
            p.add(pts, bd.x, bd.y, bd.rgb);
            bd.lit = 1;
            p.say('+' + pts + (p.combo > 2 ? '  ×' + p.combo : ''), 1);
          } else {
            p.combo = 0;
            p.spark(bd.x, bd.y, [120, 120, 140], 6);
            p.say('wrong wavelength', 1);
          }
          break;
        }
      }
      for (var q = 0; q < p.bands.length; q++) p.bands[q].lit *= Math.pow(0.02, dt);
    },
    draw: function (p, ctx, engine, z) {
      var c = p.screen(engine, z, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // the beam and the prism at the middle
      var pr = 150 * z;
      var beam = ctx.createLinearGradient(c.x - p.R * z, c.y, c.x, c.y);
      beam.addColorStop(0, 'rgba(255,255,255,0.05)');
      beam.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.strokeStyle = beam;
      ctx.lineWidth = Math.max(2, 26 * z);
      ctx.beginPath();
      ctx.moveTo(c.x - p.R * z, c.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
      // and the split light leaving the far side, which is where the motes come from
      for (var f = 0; f < 7; f++) {
        var fr = f / 6;
        var fc = RDF.spectrum.lutColor(fr);
        var fa = -0.30 + fr * 0.60;
        ctx.strokeStyle = 'rgba(' + fc.join(',') + ',0.5)';
        ctx.lineWidth = Math.max(1, 9 * z);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x + Math.cos(fa) * p.R * z, c.y + Math.sin(fa) * p.R * z);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(235,228,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - pr); ctx.lineTo(c.x + pr, c.y + pr);
      ctx.lineTo(c.x - pr, c.y + pr); ctx.closePath(); ctx.fill();

      for (var b = 0; b < p.bands.length; b++) {
        var bd = p.bands[b];
        var s = p.screen(engine, z, bd.x, bd.y);
        var r = 300 * z * (1 + bd.lit * 0.5);
        orb(ctx, s, r, bd.rgb, 0.30 + bd.lit * 0.5, false);
        ctx.strokeStyle = 'rgba(' + bd.rgb.join(',') + ',' + (0.55 + bd.lit * 0.45) + ')';
        ctx.lineWidth = Math.max(1, 5 * z);
        ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.62, 0, TAU); ctx.stroke();
      }
      for (var m = 0; m < p.motes.length; m++) {
        var o = p.motes[m];
        var s2 = p.screen(engine, z, o.x, o.y);
        orb(ctx, s2, (o.held ? 120 : 96) * z, o.rgb, o.held ? 1 : 0.8);
      }
      ctx.restore();
    }
  };

  /* ===================================================================== 2 */

  var PULSAR = {
    key: 'pulsar',
    aim: function (p, e) {
      var cx = p.catX(e), cy = p.catY(e), best = null, bd = Infinity;
      for (var i = 0; i < p.photons.length; i++) {
        var d = dist(p.photons[i].x, p.photons[i].y, cx, cy);
        if (d < bd) { bd = d; best = p.photons[i]; }
      }
      return best ? [best.x, best.y] : null;
    },
    scale: 0.6,
    name: 'The Pulsar',
    tint: [150, 210, 255],
    ground: ['#03060f', '#071426'],
    blurb: 'It sweeps every two seconds. Gather in the dark; the beam will not have you.',
    init: function (p) {
      p.beam = 0;
      p.rate = 0.85;
      p.dazzle = 0;
      p.photons = [];
      for (var i = 0; i < 26; i++) p.photons.push(newPhoton(p));
    },
    update: function (p, dt, engine) {
      p.beam += p.rate * dt;
      p.rate = 0.85 + (p.t / RDF.pockets.LENGTH) * 0.5;   // it speeds up
      if (p.dazzle > 0) p.dazzle -= dt;
      var cx = p.catX(engine), cy = p.catY(engine);
      var ca = Math.atan2(cy, cx);

      // caught in the beam? two arms, opposite each other
      var lit = false;
      for (var k = 0; k < 2; k++) {
        var d = Math.abs(((ca - (p.beam + k * Math.PI) + Math.PI * 3) % TAU) - Math.PI);
        if (d < 0.16) lit = true;
      }
      if (lit && p.dazzle <= 0) {
        p.dazzle = 1.5;
        var dd = Math.hypot(cx, cy) || 1;
        engine.cat.vx += (cx / dd) * 900;   // an impulse, not a force
        engine.cat.vy += (cy / dd) * 900;
        engine.shake = Math.max(engine.shake, 9);
        /* Being caught used to cost a second and a half of stun and nothing
           else, which is why it read as the beam doing nothing at all. It takes
           seconds off the clock now: the bar jumps back where you can see it,
           and hiding in the dark becomes a decision instead of scenery. */
        p.penalty(0.07, 'dazzled');
        p.spark(cx, cy, [255, 250, 220], 18);
        if (RDF.audio && RDF.audio.squeak) RDF.audio.squeak();
      }

      for (var i = p.photons.length - 1; i >= 0; i--) {
        var o = p.photons[i];
        o.x += o.vx * dt; o.y += o.vy * dt;
        var rr = Math.hypot(o.x, o.y);
        if (rr > p.R * 0.96) { o.vx *= -1; o.vy *= -1; }
        if (p.dazzle <= 0 && dist(o.x, o.y, cx, cy) < 130) {
          p.combo++;
          var pts = 8 + Math.min(p.combo, 10) * 3;
          p.add(pts, o.x, o.y, [190, 225, 255]);
          p.photons[i] = newPhoton(p);
        }
      }
    },
    draw: function (p, ctx, engine, z) {
      var c = p.screen(engine, z, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // the two arms
      for (var k = 0; k < 2; k++) {
        var a = p.beam + k * Math.PI;
        var L = p.R * 1.3 * z;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(a);
        var g = ctx.createLinearGradient(0, 0, L, 0);
        g.addColorStop(0, 'rgba(210,235,255,0.55)');
        g.addColorStop(1, 'rgba(150,200,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(L, -L * 0.17);
        ctx.lineTo(L, L * 0.17);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      orb(ctx, c, 250 * z, [220, 240, 255], 0.9);

      for (var i = 0; i < p.photons.length; i++) {
        var o = p.photons[i];
        var s = p.screen(engine, z, o.x, o.y);
        orb(ctx, s, 88 * z, [180, 220, 255], p.dazzle > 0 ? 0.3 : 0.85);
      }
      ctx.restore();

      if (p.dazzle > 0) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,' + (0.22 * (p.dazzle / 1.5)) + ')';
        ctx.fillRect(0, 0, engine.W, engine.H);
        ctx.restore();
      }
    }
  };
  function newPhoton(p) {
    var a = rnd(0, TAU), r = rnd(p.R * 0.2, p.R * 0.9);
    var s = rnd(30, 90), va = rnd(0, TAU);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: Math.cos(va) * s, vy: Math.sin(va) * s };
  }

  /* ===================================================================== 3 */

  var DOPPLER = {
    key: 'doppler',
    aim: function (p) { return [p.src.x, p.src.y]; },
    scale: 0.35,
    name: 'The Doppler',
    tint: [255, 120, 120],
    ground: ['#0b0406', '#180810'],
    blurb: 'You only score while you are closing on it. Chase, do not orbit.',
    init: function (p) {
      p.src = { x: rnd(-1200, 1200), y: rnd(-1200, 1200), vx: 0, vy: 0 };
      p.shift = 0;
      p.turn = 0;
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);

      // it wanders, and it leans away from you, so a steady orbit earns nothing
      p.turn += dt * rnd(0.6, 1.4);
      var away = Math.atan2(p.src.y - cy, p.src.x - cx);
      var wander = Math.sin(p.turn) * 1.6;
      var want = away + wander;
      var sp = 520 + (p.t / RDF.pockets.LENGTH) * 420;
      p.src.vx += (Math.cos(want) * sp - p.src.vx) * Math.min(1, dt * 1.4);
      p.src.vy += (Math.sin(want) * sp - p.src.vy) * Math.min(1, dt * 1.4);
      p.src.x += p.src.vx * dt; p.src.y += p.src.vy * dt;
      var rr = Math.hypot(p.src.x, p.src.y);
      if (rr > p.R * 0.9) {
        p.src.x *= p.R * 0.9 / rr; p.src.y *= p.R * 0.9 / rr;
        p.src.vx *= -0.5; p.src.vy *= -0.5;
      }

      /* Radial velocity, which is the entire game. Closing is blue and scores;
         receding is red and does not. You cannot cheat it by going fast — going
         fast past it is receding a moment later. */
      var dx = p.src.x - cx, dy = p.src.y - cy;
      var d = Math.hypot(dx, dy) || 1;
      var closing = (engine.cat.vx * dx + engine.cat.vy * dy) / d;
      p.shift += (RDF.clamp(closing / 1800, -1, 1) - p.shift) * Math.min(1, dt * 5);

      if (p.shift > 0.12) {
        var near = RDF.clamp(1 - d / (p.R * 1.2), 0.2, 1);
        p.gain(p.shift * near * 34 * dt);
      }
      if (d < 220) {
        p.add(120, p.src.x, p.src.y, [255, 200, 200]);
        p.say('caught the source  +120', 1.6);
        p.src.x = rnd(-p.R * 0.7, p.R * 0.7);
        p.src.y = rnd(-p.R * 0.7, p.R * 0.7);
      }
    },
    draw: function (p, ctx, engine, z) {
      // the whole sky tints with your radial velocity — that IS the readout.
      // Two gradients, built once and faded with globalAlpha: rebuilding a
      // full-screen gradient every frame cost more than the rest of the pocket
      // put together.
      var s = p.shift;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var W = engine.W, H = engine.H;
      var col = s > 0 ? '120,170,255' : '255,110,110';
      if (!p.tint2 || p.tintW !== W || p.tintH !== H) {
        p.tintW = W; p.tintH = H; p.tint2 = {};
        ['120,170,255', '255,110,110'].forEach(function (c) {
          var gg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.15,
            W / 2, H / 2, Math.max(W, H) * 0.75);
          gg.addColorStop(0, 'rgba(' + c + ',0)');
          gg.addColorStop(1, 'rgba(' + c + ',0.30)');
          p.tint2[c] = gg;
        });
      }
      ctx.globalAlpha = Math.abs(s);
      ctx.fillStyle = p.tint2[col];
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;

      var ss = p.screen(engine, z, p.src.x, p.src.y);
      var rgb = s > 0 ? [150, 190, 255] : [255, 130, 120];
      orb(ctx, ss, 300 * z * (1 + Math.abs(s) * 0.4), rgb, 0.9);

      // a line to it, coloured by what you are doing
      var c = p.screen(engine, z, p.catX(engine), p.catY(engine));
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.15 + 0.35 * Math.abs(s)) + ')';
      ctx.lineWidth = Math.max(1, 4 * z);
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(ss.x, ss.y); ctx.stroke();
      ctx.restore();
    }
  };

  /* ===================================================================== 4 */

  var NURSERY = {
    key: 'nursery',
    aim: function (p) {
      if (!p.eggs.length) return null;
      var big = p.eggs[0];
      for (var i = 1; i < p.eggs.length; i++) if (p.eggs[i].m > big.m) big = p.eggs[i];
      return [big.x, big.y];
    },
    scale: 2.0,
    name: 'The Nursery',
    tint: [255, 168, 205],
    ground: ['#0d0510', '#1d0c1c'],
    blurb: 'Newborn light, cooling. Push them together before they go out.',
    init: function (p) {
      p.eggs = [];
      for (var i = 0; i < 12; i++) p.eggs.push(newEgg(p));
      p.spawn = 0;
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      p.spawn -= dt;
      if (p.spawn <= 0 && p.eggs.length < 18) { p.spawn = 1.6; p.eggs.push(newEgg(p)); }

      for (var i = p.eggs.length - 1; i >= 0; i--) {
        var e = p.eggs[i];
        e.heat -= dt * (0.055 / Math.sqrt(e.m));
        if (e.heat <= 0) {
          p.spark(e.x, e.y, [90, 70, 90], 6);
          p.eggs.splice(i, 1);
          continue;
        }
        // you shove them: a push, not a grab, so herding is genuinely fiddly
        var dx = e.x - cx, dy = e.y - cy;
        var d = Math.hypot(dx, dy) || 1;
        if (d < 260) {
          var f = (1 - d / 260) * 2600 / e.m;
          e.vx += (dx / d) * f * dt;
          e.vy += (dy / d) * f * dt;
        }
        e.vx *= 0.985; e.vy *= 0.985;
        e.x += e.vx * dt; e.y += e.vy * dt;
        var rr = Math.hypot(e.x, e.y);
        if (rr > p.R * 0.95) { e.x *= p.R * 0.95 / rr; e.y *= p.R * 0.95 / rr; e.vx *= -0.5; e.vy *= -0.5; }
      }

      // merges
      for (var a = 0; a < p.eggs.length; a++) {
        for (var b = a + 1; b < p.eggs.length; b++) {
          var A = p.eggs[a], B = p.eggs[b];
          if (dist(A.x, A.y, B.x, B.y) > (rad(A) + rad(B))) continue;
          var m = A.m + B.m;
          A.x = (A.x * A.m + B.x * B.m) / m;
          A.y = (A.y * A.m + B.y * B.m) / m;
          A.vx = (A.vx * A.m + B.vx * B.m) / m;
          A.vy = (A.vy * A.m + B.vy * B.m) / m;
          A.m = m;
          A.heat = Math.min(1, Math.max(A.heat, B.heat) + 0.3);
          A.rgb = RDF.spectrum.lutColor(RDF.clamp(1 - m / 9, 0, 1));
          p.eggs.splice(b, 1);
          p.combo++;
          var pts = Math.round(14 * m);
          p.add(pts, A.x, A.y, A.rgb);
          p.say(m >= 6 ? 'a star  +' + pts : '+' + pts, 1.2);
          if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('nursery ' + Math.round(m)), 0.5);
          b--;
        }
      }
    },
    draw: function (p, ctx, engine, z) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < p.eggs.length; i++) {
        var e = p.eggs[i];
        var s = p.screen(engine, z, e.x, e.y);
        orb(ctx, s, rad(e) * z * 2.8, e.rgb, 0.35 + 0.6 * e.heat);
      }
      ctx.restore();
    }
  };
  function newEgg(p) {
    var a = rnd(0, TAU), r = rnd(200, p.R * 0.85);
    return {
      x: Math.cos(a) * r, y: Math.sin(a) * r,
      vx: rnd(-40, 40), vy: rnd(-40, 40),
      m: 1, heat: 1, rgb: RDF.spectrum.lutColor(rnd(0.55, 1))
    };
  }
  function rad(e) { return 70 * Math.pow(e.m, 0.42); }

  /* ===================================================================== 5 */

  var LENS = {
    key: 'lens',
    aim: function (p) { return [p.gate.x, p.gate.y]; },
    scale: 0.9,
    name: 'The Lens',
    tint: [130, 240, 190],
    ground: ['#030b08', '#071c15'],
    blurb: 'Nothing here travels straight. Use the wells; the gates move.',
    init: function (p) {
      p.wells = [];
      for (var i = 0; i < 5; i++) {
        var a = (i / 5) * TAU + rnd(-0.3, 0.3);
        var r = rnd(p.R * 0.25, p.R * 0.62);
        p.wells.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, m: rnd(0.7, 1.5), ph: rnd(0, TAU) });
      }
      p.gate = newGate(p);
      p.gates = 0;
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      for (var i = 0; i < p.wells.length; i++) {
        var w = p.wells[i];
        var dx = w.x - cx, dy = w.y - cy;
        var d = Math.hypot(dx, dy) || 1;
        if (d > 1500) continue;
        var acc = 2400 * w.m * Math.pow(160 / Math.max(d, 160), 1.4);
        engine.cat.vx += (dx / d) * acc * dt;
        engine.cat.vy += (dy / d) * acc * dt;
        if (d < 120) {                       // fall in and you are spat back out
          engine.cat.vx = -engine.cat.vx * 0.6;
          engine.cat.vy = -engine.cat.vy * 0.6;
          engine.shake = Math.max(engine.shake, 6);
          p.combo = 0;
          p.say('too close', 1.2);
        }
      }
      p.gate.spin += dt * 0.8;
      if (dist(cx, cy, p.gate.x, p.gate.y) < 190) {
        p.gates++;
        p.combo++;
        var pts = 25 + Math.min(p.combo, 8) * 10;
        p.add(pts, p.gate.x, p.gate.y, [140, 255, 200]);
        p.say('+' + pts + (p.combo > 1 ? '  ×' + p.combo : ''), 1.2);
        p.gate = newGate(p);
      }
    },
    draw: function (p, ctx, engine, z) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // the wells are drawn as the distortion they are: rings pulled inward
      for (var i = 0; i < p.wells.length; i++) {
        var w = p.wells[i];
        var s = p.screen(engine, z, w.x, w.y);
        for (var k = 0; k < 4; k++) {
          var rr = (150 + k * 150) * w.m * z;
          ctx.strokeStyle = 'rgba(120,230,190,' + (0.20 - k * 0.04) + ')';
          ctx.lineWidth = Math.max(0.8, 4 * z);
          ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, TAU); ctx.stroke();
        }
        orb(ctx, s, 130 * w.m * z, [90, 220, 170], 0.5, false);
      }
      var g = p.screen(engine, z, p.gate.x, p.gate.y);
      ctx.strokeStyle = 'rgba(150,255,210,0.9)';
      ctx.lineWidth = Math.max(1.5, 10 * z);
      ctx.beginPath();
      for (var a = 0; a < 3; a++) {
        ctx.arc(g.x, g.y, 190 * z, p.gate.spin + a * 2.1, p.gate.spin + a * 2.1 + 1.5);
      }
      ctx.stroke();
      orb(ctx, g, 150 * z, [140, 255, 205], 0.5, false);
      ctx.restore();
    }
  };
  function newGate(p) {
    var a = rnd(0, TAU), r = rnd(p.R * 0.35, p.R * 0.88);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, spin: 0 };
  }

  /* ===================================================================== 6 */

  var ABSORPTION = {
    key: 'absorption',
    aim: function (p) {
      for (var i = 0; i < p.lines.length; i++)
        if (!p.lines[i].crossed) return [p.lines[i].x, p.lines[i].gap];
      return null;
    },
    scale: 1.2,
    name: 'The Dark Lines',
    tint: [255, 214, 140],
    ground: ['#0c0803', '#1c1206'],
    blurb: 'A sentence, written as the gaps. Cross each line to read a word.',
    init: function (p) {
      var text = RDF.SEEDS[Math.floor(Math.random() * RDF.SEEDS.length)];
      p.words = String(text).split(/\s+/).slice(0, 12);
      p.said = [];
      p.lines = [];
      for (var i = 0; i < p.words.length; i++) {
        p.lines.push({
          x: -p.R * 0.85 + (i / Math.max(1, p.words.length - 1)) * p.R * 1.7,
          gap: rnd(-p.R * 0.5, p.R * 0.5),
          speed: rnd(0.5, 1.1) * (i % 2 ? 1 : -1),
          w: 150 + i * 6, crossed: false, ph: rnd(0, TAU)
        });
      }
      p.lastSide = null;
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      for (var i = 0; i < p.lines.length; i++) {
        var L = p.lines[i];
        L.gap += L.speed * 320 * dt;
        if (L.gap > p.R * 0.62) { L.gap = p.R * 0.62; L.speed *= -1; }
        if (L.gap < -p.R * 0.62) { L.gap = -p.R * 0.62; L.speed *= -1; }

        if (L.crossed) continue;
        // through the gap, or into the dark?
        if (Math.abs(cx - L.x) < 70) {
          if (Math.abs(cy - L.gap) < 300) {
            L.crossed = true;
            p.said.push(p.words[i]);
            p.combo++;
            var pts = 20 + Math.min(p.combo, 10) * 8;
            p.add(pts, L.x, L.gap, [255, 226, 160]);
            p.say(p.said.join(' '), 3);
            if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse(p.words[i] + ' line'), 0.45);
            if (p.said.length === p.words.length) {
              p.add(200, 0, 0, [255, 240, 190]);
              p.say('the whole sentence  +200', 4);
              // a fresh sentence, immediately. The break matters: init has just
              // replaced p.lines out from under this loop.
              ABSORPTION.init(p);
              return;
            }
          } else {
            p.combo = 0;
            engine.cat.vx *= -0.5; engine.cat.vy *= -0.5;
            engine.shake = Math.max(engine.shake, 5);
          }
        }
      }
    },
    draw: function (p, ctx, engine, z) {
      ctx.save();
      for (var i = 0; i < p.lines.length; i++) {
        var L = p.lines[i];
        var top = p.screen(engine, z, L.x, -p.R);
        var gapA = p.screen(engine, z, L.x, L.gap - 300);
        var gapB = p.screen(engine, z, L.x, L.gap + 300);
        var bot = p.screen(engine, z, L.x, p.R);
        var w = Math.max(2, L.w * z * 0.5);
        ctx.fillStyle = L.crossed ? 'rgba(255,214,140,0.16)' : 'rgba(6,4,2,0.94)';
        ctx.fillRect(top.x - w / 2, top.y, w, gapA.y - top.y);
        ctx.fillRect(gapB.x - w / 2, gapB.y, w, bot.y - gapB.y);
        // the edges of the gap glow, so the way through reads instantly
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,214,140,' + (L.crossed ? 0.3 : 0.75) + ')';
        ctx.fillRect(gapA.x - w / 2, gapA.y - 3, w, 4);
        ctx.fillRect(gapB.x - w / 2, gapB.y - 1, w, 4);
        ctx.restore();
      }
      ctx.restore();
    }
  };

  /* ===================================================================== 7 */

  var RELIC = {
    key: 'relic',
    aim: null,
    scale: 0.7,
    name: 'The Relic',
    tint: [255, 186, 120],
    ground: ['#070508', '#100c12'],
    blurb: 'The oldest light there is, and almost too faint to see. Be quick.',
    init: function (p) {
      p.spots = [];
      p.found = 0;
      p.next = 0.4;
      p.grid = [];
      for (var i = 0; i < 420; i++) {
        var a = rnd(0, TAU), r = Math.sqrt(Math.random()) * p.R;
        p.grid.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, ph: rnd(0, TAU) });
      }
      p.mapped = [];
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      p.next -= dt;
      // it gets meaner: they appear faster and last less long
      var pace = 1 - (p.t / RDF.pockets.LENGTH) * 0.55;
      if (p.next <= 0 && p.spots.length < 3) {
        p.next = rnd(0.6, 1.5) * pace;
        var a = rnd(0, TAU), r = rnd(300, p.R * 0.92);
        p.spots.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, life: 2.6 * pace, max: 2.6 * pace });
      }
      for (var i = p.spots.length - 1; i >= 0; i--) {
        var s = p.spots[i];
        s.life -= dt;
        if (s.life <= 0) { p.spots.splice(i, 1); p.combo = 0; continue; }
        if (dist(s.x, s.y, cx, cy) < 190) {
          p.combo++;
          // the faster you got there, the more it was worth
          var speed = s.life / s.max;
          var pts = Math.round((18 + 40 * speed) * (1 + Math.min(p.combo, 8) * 0.14));
          p.add(pts, s.x, s.y, [255, 200, 150]);
          p.mapped.push({ x: s.x, y: s.y });
          p.found++;
          p.say('+' + pts, 1);
          p.spots.splice(i, 1);
        }
      }
    },
    draw: function (p, ctx, engine, z) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // the background radiation: almost uniform, which is the whole point
      for (var i = 0; i < p.grid.length; i++) {
        var gp = p.grid[i];
        var s = p.screen(engine, z, gp.x, gp.y);
        if (s.x < -4 || s.x > engine.W + 4 || s.y < -4 || s.y > engine.H + 4) continue;
        var a = 0.06 + 0.05 * Math.sin(p.t * 0.7 + gp.ph);
        ctx.fillStyle = 'rgba(255,190,140,' + a + ')';
        ctx.fillRect(s.x, s.y, 2.4, 2.4);
      }
      for (var m = 0; m < p.mapped.length; m++) {
        var ms = p.screen(engine, z, p.mapped[m].x, p.mapped[m].y);
        ctx.fillStyle = 'rgba(255,214,170,0.55)';
        ctx.fillRect(ms.x - 1.5, ms.y - 1.5, 3, 3);
      }
      for (var k = 0; k < p.spots.length; k++) {
        var sp = p.spots[k];
        var ss = p.screen(engine, z, sp.x, sp.y);
        var f = sp.life / sp.max;
        // faint on purpose — this one is about noticing, not reacting
        orb(ctx, ss, 250 * z, [255, 205, 155], 0.16 + 0.30 * f, false);
        ctx.strokeStyle = 'rgba(255,214,170,' + (0.22 + 0.4 * f) + ')';
        ctx.lineWidth = Math.max(0.8, 3 * z);
        ctx.beginPath(); ctx.arc(ss.x, ss.y, 200 * z * (1.3 - f * 0.3), 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
  };

  /* A second sentence once you finish the first, so the good players do not run
     out of dark lines with thirty seconds left. */

  RDF.POCKETS = [PRISM, PULSAR, DOPPLER, NURSERY, LENS, ABSORPTION, RELIC];

  /* Shared with any later set of pockets. The glowing dot is the one piece of
     drawing every pocket has in common, and it is what stops twenty of these
     from looking like twenty different people's homework. */
  RDF.pocketArt = { orb: orb, rnd: rnd, dist: dist };
})(window.RDF = window.RDF || {});
