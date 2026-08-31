/* Rainbow Deep Field — thirteen more pockets.

   Held to the same rule as the first seven: if a pocket could be lifted out and
   dropped into any other game unchanged, it does not belong here. So each of
   these is built from something the sky actually does, and each asks for a verb
   none of the others ask for. Thirteen variations on "fly at the glowing thing"
   would be one minigame with thirteen colours on it.

     OCCULTATION  predict      be at the star at the moment something crosses it
     PARALLAX     triangulate  fix a distance by seeing it from two places
     SAIL         tack         no engine; the light pushes and you angle across it
     ROCHE        risk         the richest material sits where you get torn apart
     AURORA       conduct      bend the field lines and walk the particles home
     INTERFERENCE phase        be equidistant from both dishes when the signal lands
     SHOCK        ride         stay on the front of an expanding shell
     DUSTLANE     infer        you cannot see them; you can see what they hide
     DISK         match        dock by matching orbital velocity, not by charging
     EXPANSION    outrun       space stretches; the far prizes flee fastest
     LAGRANGE     balance      hold the points where two pulls cancel
     MAGNETAR     restraint    it scores you for stillness and punishes thrust
     RING         align        put three bodies in a line and the light bends round

   The flight model is untouched inside all of them, except the Sail — where
   taking the engine away is the entire idea. */
(function (RDF) {
  'use strict';

  var TAU = Math.PI * 2;
  var A = RDF.pocketArt || {};
  var orb = A.orb;
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function ring(ctx, x, y, r, col, w) {
    ctx.strokeStyle = col; ctx.lineWidth = w || 1.5;
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, TAU); ctx.stroke();
  }
  /** A point somewhere in the arena, never right on top of the player. */
  function spot(p, engine, minFromCat) {
    var cx = engine ? p.catX(engine) : 0, cy = engine ? p.catY(engine) : 0;
    for (var i = 0; i < 24; i++) {
      var a = Math.random() * TAU, r = Math.sqrt(Math.random()) * p.R * 0.86;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (!minFromCat || dist(x, y, cx, cy) > minFromCat) return { x: x, y: y };
    }
    return { x: 0, y: 0 };
  }

  /* ===================================================================== 1 */

  var OCCULTATION = {
    key: 'occultation',
    name: 'The Occultation',
    tint: [180, 170, 255],
    ground: ['#05040d', '#100c22'],
    blurb: 'Something is about to cross that star. Be there when it does.',
    scale: 0.362,
    aim: function (p) {
      var best = null, bt = Infinity;
      for (var i = 0; i < p.stars.length; i++) {
        var s = p.stars[i];
        if (s.next < bt) { bt = s.next; best = s; }
      }
      return best ? [best.x, best.y] : null;
    },
    init: function (p) {
      p.stars = [];
      for (var i = 0; i < 5; i++) {
        var s = spot(p);
        s.next = 3 + i * 2.4;      // when the next transit begins
        s.open = 0;                // how long it stays covered
        s.taken = false;
        p.stars.push(s);
      }
      p.body = { a: Math.random() * TAU };
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      for (var i = 0; i < p.stars.length; i++) {
        var s = p.stars[i];
        if (s.open > 0) {
          s.open -= dt;
          if (!s.taken && dist(cx, cy, s.x, s.y) < 240) {
            s.taken = true;
            p.combo++;
            var pts = 90 + Math.min(p.combo, 8) * 22;
            p.add(pts, s.x, s.y, [200, 190, 255]);
            p.say('caught the transit  +' + pts, 1.3);
            if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('transit ' + i), 0.5);
          }
          if (s.open <= 0) {
            if (!s.taken) { p.combo = 0; p.say('missed it', 1.1); }
            s.next = rnd(3.4, 6.4);
            s.taken = false;
          }
        } else {
          s.next -= dt;
          if (s.next <= 0) { s.open = 1.5; s.taken = false; }
        }
      }
    },
    draw: function (p, ctx, engine, z) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < p.stars.length; i++) {
        var s = p.stars[i], sc = p.screen(engine, z, s.x, s.y);
        if (s.open > 0) {
          // covered: a dark disc with a bright rim, and the window to be inside
          orb(ctx, sc, 300 * z, [190, 180, 255], 0.5 * (s.open / 1.5));
          ring(ctx, sc.x, sc.y, 240 * z, 'rgba(200,190,255,0.75)', Math.max(1, 3 * z));
        } else {
          orb(ctx, sc, 150 * z, [255, 246, 220], 0.75);
          // a countdown ring closing in — this is the whole game, so it is legible
          var f = RDF.clamp(1 - s.next / 4, 0, 1);
          ring(ctx, sc.x, sc.y, (250 - 90 * f) * z,
            'rgba(180,170,255,' + (0.18 + 0.5 * f) + ')', Math.max(0.8, (1 + 2 * f) * z));
        }
      }
      ctx.restore();

      // the occulting body, sweeping across
      ctx.save();
      p.body.a += 0;
      ctx.restore();
    }
  };

  /* ===================================================================== 2 */

  var PARALLAX = {
    key: 'parallax',
    name: 'The Parallax',
    tint: [140, 230, 210],
    ground: ['#03100e', '#062421'],
    blurb: 'One look tells you nothing. Sight it from both posts to fix the distance.',
    scale: 0.249,
    aim: function (p) {
      var t = p.armed ? p.b : p.a;
      return t ? [t.x, t.y] : null;
    },
    init: function (p) { newBaseline(p); },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      if (p.armed > 0) {
        p.armed -= dt;
        if (p.armed <= 0) { p.say('lost the baseline', 1.2); p.combo = 0; }
      }
      if (!p.armed && dist(cx, cy, p.a.x, p.a.y) < 190) {
        p.armed = 7;
        p.say('first sighting — now the other post', 1.6);
        p.spark(p.a.x, p.a.y, [140, 230, 210], 10);
        if (RDF.audio) RDF.audio.squeak();
      } else if (p.armed > 0 && dist(cx, cy, p.b.x, p.b.y) < 190) {
        // a longer baseline is a better measurement, and worth more
        var base = dist(p.a.x, p.a.y, p.b.x, p.b.y);
        var pts = Math.round(60 + base * 0.13);
        p.combo++;
        p.add(pts, p.target.x, p.target.y, [170, 245, 225]);
        p.say('distance fixed  +' + pts, 1.4);
        if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('parallax ' + pts), 0.55);
        newBaseline(p);
      }
    },
    draw: function (p, ctx, engine, z) {
      var a = p.screen(engine, z, p.a.x, p.a.y);
      var b = p.screen(engine, z, p.b.x, p.b.y);
      var t = p.screen(engine, z, p.target.x, p.target.y);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // the target is faint until you have both sightings
      orb(ctx, t, 210 * z, [200, 255, 240], p.armed > 0 ? 0.5 : 0.16);

      // sight lines, drawn only once the first post is taken
      if (p.armed > 0) {
        ctx.strokeStyle = 'rgba(140,230,210,0.5)';
        ctx.setLineDash([6, 8]);
        ctx.lineWidth = Math.max(0.8, 2 * z);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        ctx.setLineDash([]);
      }

      orb(ctx, a, 170 * z, [140, 230, 210], p.armed > 0 ? 0.35 : 0.9);
      orb(ctx, b, 170 * z, [140, 230, 210], p.armed > 0 ? 0.9 : 0.35);
      ring(ctx, (p.armed > 0 ? b : a).x, (p.armed > 0 ? b : a).y, 190 * z,
        'rgba(170,245,225,0.7)', Math.max(1, 2 * z));
      ctx.restore();

      if (p.armed > 0) {
        // the window you have left, drawn as an arc round the post you want
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = Math.max(1.5, 3 * z);
        ctx.beginPath();
        ctx.arc(b.x, b.y, 215 * z, -Math.PI / 2, -Math.PI / 2 + TAU * (p.armed / 7));
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  function newBaseline(p) {
    p.armed = 0;
    p.target = spot(p);
    for (var i = 0; i < 20; i++) {
      p.a = spot(p); p.b = spot(p);
      if (dist(p.a.x, p.a.y, p.b.x, p.b.y) > p.R * 0.7) break;
    }
  }

  /* ===================================================================== 3 */

  var SAIL = {
    key: 'sail',
    name: 'The Solar Sail',
    tint: [255, 214, 140],
    ground: ['#100a02', '#241606'],
    blurb: 'The engine is off. Light does the pushing — angle across it.',
    scale: 0.163,
    aim: function (p) {
      var best = null, bd = Infinity;
      for (var i = 0; i < p.motes.length; i++) {
        var d = Math.hypot(p.motes[i].x, p.motes[i].y);
        if (d < bd) { bd = d; best = p.motes[i]; }
      }
      return best ? [best.x, best.y] : null;
    },
    init: function (p) {
      p.motes = [];
      for (var i = 0; i < 14; i++) p.motes.push(spot(p));
      p.warned = 0;
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      var r = Math.hypot(cx, cy) || 1;

      /* Light pressure: outward, falling off with distance, and always on. The
         engine still works — taking the controls away entirely makes a pocket
         you watch rather than play — but the star is stronger than it is near
         in, so getting anywhere close is a matter of coming in at an angle and
         letting the push carry you across rather than fighting it head on. */
      var press = 260000 / (r * 0.6 + 400);
      engine.cat.vx += (cx / r) * press * dt;
      engine.cat.vy += (cy / r) * press * dt;

      for (var i = p.motes.length - 1; i >= 0; i--) {
        var m = p.motes[i];
        if (dist(m.x, m.y, cx, cy) < 170) {
          p.combo++;
          // the closer in it was, the harder it was to reach
          var near = 1 - RDF.clamp(Math.hypot(m.x, m.y) / p.R, 0, 1);
          var pts = Math.round(40 + near * 150 + Math.min(p.combo, 8) * 10);
          p.add(pts, m.x, m.y, [255, 224, 160]);
          p.say('+' + pts, 1);
          if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('sail ' + i), 0.45);
          p.motes[i] = spot(p, engine, 500);
        }
      }
      if (r > p.R * 0.93 && p.warned <= 0) {
        p.warned = 3;
        p.say('the light is carrying you out', 1.6);
      }
      if (p.warned > 0) p.warned -= dt;
    },
    draw: function (p, ctx, engine, z) {
      var c = p.screen(engine, z, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // rays, to make the direction of the push legible without a tutorial
      for (var k = 0; k < 18; k++) {
        var a = (k / 18) * TAU + p.t * 0.05;
        var g = ctx.createLinearGradient(
          c.x + Math.cos(a) * 200 * z, c.y + Math.sin(a) * 200 * z,
          c.x + Math.cos(a) * p.R * z, c.y + Math.sin(a) * p.R * z);
        g.addColorStop(0, 'rgba(255,220,150,0.20)');
        g.addColorStop(1, 'rgba(255,190,110,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = Math.max(1, 10 * z);
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a) * 200 * z, c.y + Math.sin(a) * 200 * z);
        ctx.lineTo(c.x + Math.cos(a) * p.R * z, c.y + Math.sin(a) * p.R * z);
        ctx.stroke();
      }
      orb(ctx, c, 420 * z, [255, 236, 190], 0.95);
      for (var i = 0; i < p.motes.length; i++) {
        var s = p.screen(engine, z, p.motes[i].x, p.motes[i].y);
        orb(ctx, s, 150 * z, [255, 224, 160], 0.8);
      }
      ctx.restore();
    }
  };

  /* ===================================================================== 4 */

  var ROCHE = {
    key: 'roche',
    name: 'The Roche Limit',
    tint: [255, 130, 120],
    ground: ['#120306', '#26070d'],
    blurb: 'The best material is inside the limit, where you come apart. Your call.',
    scale: 0.423,
    aim: function (p) {
      var best = null, bd = Infinity;
      for (var i = 0; i < p.shards.length; i++) {
        var s = p.shards[i], d = Math.hypot(s.x, s.y);
        if (d < bd) { bd = d; best = s; }
      }
      return best ? [best.x, best.y] : null;
    },
    init: function (p) {
      p.limit = p.R * 0.42;
      p.stress = 0;
      p.shards = [];
      for (var i = 0; i < 20; i++) p.shards.push(newShard(p));
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      var r = Math.hypot(cx, cy);

      /* Stress builds the deeper you go and bleeds off outside. Nothing stops
         you going in — the pocket is a bet, not a wall. */
      if (r < p.limit) p.stress += dt * (0.30 + (1 - r / p.limit) * 0.85);
      else p.stress = Math.max(0, p.stress - dt * 0.55);

      if (p.stress >= 1) {
        p.stress = 0;
        p.penalty(0.08, 'torn apart');
        engine.shake = Math.max(engine.shake || 0, 11);
        var d = r || 1;
        engine.cat.vx += (cx / d) * 1300;
        engine.cat.vy += (cy / d) * 1300;
        p.spark(cx, cy, [255, 130, 120], 22);
        if (RDF.audio && RDF.audio.fall) RDF.audio.fall();
      }

      for (var i = p.shards.length - 1; i >= 0; i--) {
        var s = p.shards[i];
        s.a += s.w * dt;
        s.x = Math.cos(s.a) * s.r; s.y = Math.sin(s.a) * s.r * 0.96;
        if (dist(s.x, s.y, cx, cy) < 150) {
          // worth what it costs to reach: deep shards pay several times over
          var deep = RDF.clamp(1 - s.r / p.limit, 0, 1);
          var pts = Math.round(22 + deep * 230);
          p.combo++;
          p.add(pts, s.x, s.y, deep > 0.3 ? [255, 170, 120] : [220, 200, 210]);
          p.say(deep > 0.5 ? 'deep  +' + pts : '+' + pts, 1);
          if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('roche ' + pts), 0.5);
          p.shards[i] = newShard(p);
        }
      }
    },
    draw: function (p, ctx, engine, z) {
      var c = p.screen(engine, z, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      orb(ctx, c, 520 * z, [255, 150, 130], 0.85);
      ctx.restore();

      // the limit itself, drawn as the boundary it is
      ctx.save();
      ctx.setLineDash([10, 9]);
      ctx.strokeStyle = 'rgba(255,130,120,' + (0.28 + 0.4 * p.stress) + ')';
      ctx.lineWidth = Math.max(1, 2.5 * z);
      ctx.beginPath(); ctx.arc(c.x, c.y, p.limit * z, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < p.shards.length; i++) {
        var s = p.shards[i], sc = p.screen(engine, z, s.x, s.y);
        var deep = RDF.clamp(1 - s.r / p.limit, 0, 1);
        orb(ctx, sc, (90 + deep * 70) * z, deep > 0.3 ? [255, 180, 130] : [225, 205, 215], 0.8);
      }
      ctx.restore();

      // stress, on the player rather than in a corner — you feel it closing in
      if (p.stress > 0.02) {
        var cat = p.screen(engine, z, p.catX(engine), p.catY(engine));
        ctx.save();
        ctx.strokeStyle = 'rgba(255,120,110,' + (0.35 + 0.55 * p.stress) + ')';
        ctx.lineWidth = Math.max(1.5, 3 * z);
        ctx.beginPath();
        ctx.arc(cat.x, cat.y, 44, -Math.PI / 2, -Math.PI / 2 + TAU * p.stress);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  function newShard(p) {
    var r = rnd(p.R * 0.14, p.R * 0.9);
    var a = Math.random() * TAU;
    return { r: r, a: a, w: (0.55 / Math.sqrt(r / 400)) * (Math.random() < 0.5 ? 1 : -1) * 0.4,
      x: Math.cos(a) * r, y: Math.sin(a) * r * 0.96 };
  }

  /* ===================================================================== 5 */

  var AURORA = {
    key: 'aurora',
    name: 'The Aurora',
    tint: [120, 255, 190],
    ground: ['#03120c', '#07261a'],
    blurb: 'Charged particles follow the field. Bend it, and walk them to a pole.',
    scale: 0.222,
    aim: function (p) {
      var best = null, bd = Infinity;
      for (var i = 0; i < p.parts.length; i++) {
        var d = Math.hypot(p.parts[i].x, p.parts[i].y);
        if (d < bd) { bd = d; best = p.parts[i]; }
      }
      return best ? [best.x, best.y] : null;
    },
    init: function (p) {
      p.poles = [{ x: 0, y: -p.R * 0.72 }, { x: 0, y: p.R * 0.72 }];
      p.parts = [];
      for (var i = 0; i < 9; i++) p.parts.push(newPart(p));
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      for (var i = p.parts.length - 1; i >= 0; i--) {
        var q = p.parts[i];
        // the field carries it toward its pole; you deflect it by being near
        var pole = p.poles[q.pole];
        var dx = pole.x - q.x, dy = pole.y - q.y;
        var d = Math.hypot(dx, dy) || 1;
        q.vx += (dx / d) * 130 * dt;
        q.vy += (dy / d) * 130 * dt;

        var ax = q.x - cx, ay = q.y - cy;
        var ad = Math.hypot(ax, ay) || 1;
        if (ad < 420) {
          // a push, so herding it is steering rather than carrying
          var f = (1 - ad / 420) * 900;
          q.vx += (ax / ad) * f * dt;
          q.vy += (ay / ad) * f * dt;
        }
        q.vx *= 0.985; q.vy *= 0.985;
        q.x += q.vx * dt; q.y += q.vy * dt;
        q.trail.push({ x: q.x, y: q.y });
        if (q.trail.length > 22) q.trail.shift();

        var rr = Math.hypot(q.x, q.y);
        if (rr > p.R * 0.98) { q.x *= p.R * 0.98 / rr; q.y *= p.R * 0.98 / rr; q.vx *= -0.4; q.vy *= -0.4; }

        if (dist(q.x, q.y, pole.x, pole.y) < 200) {
          p.combo++;
          var pts = 70 + Math.min(p.combo, 10) * 16;
          p.add(pts, pole.x, pole.y, [120, 255, 190]);
          p.say('grounded  +' + pts, 1.2);
          if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('aurora ' + p.combo), 0.5);
          p.parts[i] = newPart(p);
        }
      }
    },
    draw: function (p, ctx, engine, z) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // field lines: arcs between the poles, the shape the particles want
      for (var k = -3; k <= 3; k++) {
        if (!k) continue;
        var bow = k * p.R * 0.26;
        ctx.strokeStyle = 'rgba(120,255,190,0.13)';
        ctx.lineWidth = Math.max(0.7, 1.6 * z);
        ctx.beginPath();
        for (var s = 0; s <= 24; s++) {
          var tt = s / 24;
          var y = -p.R * 0.72 + tt * p.R * 1.44;
          var x = Math.sin(tt * Math.PI) * bow;
          var pt = p.screen(engine, z, x, y);
          if (!s) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      }

      for (var i = 0; i < p.parts.length; i++) {
        var q = p.parts[i];
        ctx.strokeStyle = 'rgba(150,255,205,0.4)';
        ctx.lineWidth = Math.max(0.8, 2.2 * z);
        ctx.beginPath();
        for (var t2 = 0; t2 < q.trail.length; t2++) {
          var tp = p.screen(engine, z, q.trail[t2].x, q.trail[t2].y);
          if (!t2) ctx.moveTo(tp.x, tp.y); else ctx.lineTo(tp.x, tp.y);
        }
        ctx.stroke();
        orb(ctx, p.screen(engine, z, q.x, q.y), 110 * z, [150, 255, 205], 0.85);
      }

      for (var j = 0; j < 2; j++) {
        var ps = p.screen(engine, z, p.poles[j].x, p.poles[j].y);
        orb(ctx, ps, 260 * z, [120, 255, 190], 0.5);
        ring(ctx, ps.x, ps.y, 200 * z, 'rgba(120,255,190,0.55)', Math.max(1, 2.5 * z));
      }
      ctx.restore();
    }
  };

  function newPart(p) {
    var s = spot(p);
    return { x: s.x, y: s.y, vx: 0, vy: 0, pole: Math.random() < 0.5 ? 0 : 1, trail: [] };
  }

  /* ===================================================================== 6 */

  var INTERFERENCE = {
    key: 'interference',
    name: 'The Interferometer',
    tint: [170, 190, 255],
    ground: ['#04060f', '#0b1024'],
    blurb: 'Two dishes, one signal. Be the same distance from both when it lands.',
    scale: 0.462,
    aim: function (p) {
      // the nearest point on the perpendicular bisector is the honest target
      var mx = (p.d1.x + p.d2.x) / 2, my = (p.d1.y + p.d2.y) / 2;
      return [mx, my];
    },
    init: function (p) {
      p.d1 = { x: -p.R * 0.5, y: -p.R * 0.2, a: 0 };
      p.d2 = { x: p.R * 0.5, y: p.R * 0.2, a: Math.PI };
      p.ping = 3;
      p.flash = 0;
    },
    update: function (p, dt, engine) {
      // the dishes drift, so the line you have to stand on keeps moving
      p.d1.a += dt * 0.28; p.d2.a += dt * 0.23;
      p.d1.x = Math.cos(p.d1.a) * p.R * 0.55;
      p.d1.y = Math.sin(p.d1.a) * p.R * 0.4;
      p.d2.x = Math.cos(p.d2.a + Math.PI) * p.R * 0.55;
      p.d2.y = Math.sin(p.d2.a + Math.PI) * p.R * 0.4;

      if (p.flash > 0) p.flash -= dt;
      p.ping -= dt;
      if (p.ping <= 0) {
        p.ping = 2.6;
        p.flash = 0.6;
        var cx = p.catX(engine), cy = p.catY(engine);
        var diff = Math.abs(dist(cx, cy, p.d1.x, p.d1.y) - dist(cx, cy, p.d2.x, p.d2.y));
        if (diff < 190) {
          p.combo++;
          // dead on the line is worth far more than nearly on it
          var acc = 1 - diff / 190;
          var pts = Math.round(50 + acc * acc * 220 + Math.min(p.combo, 8) * 14);
          p.add(pts, cx, cy, [190, 210, 255]);
          p.say(acc > 0.85 ? 'in phase  +' + pts : '+' + pts, 1.3);
          if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('phase ' + pts), 0.55);
        } else {
          p.combo = 0;
          p.say('out of phase', 1);
        }
      }
    },
    draw: function (p, ctx, engine, z) {
      var a = p.screen(engine, z, p.d1.x, p.d1.y);
      var b = p.screen(engine, z, p.d2.x, p.d2.y);
      ctx.save();

      /* The bisector, drawn. Making the player derive it in their head would be
         a maths test rather than a game; the skill is holding the line while it
         swings, not finding it. */
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var dx = b.x - a.x, dy = b.y - a.y;
      var L = Math.hypot(dx, dy) || 1;
      var nx = -dy / L, ny = dx / L;
      var far = Math.max(engine.W, engine.H);
      var grad = ctx.createLinearGradient(mx - nx * far, my - ny * far, mx + nx * far, my + ny * far);
      grad.addColorStop(0, 'rgba(170,190,255,0)');
      grad.addColorStop(0.5, 'rgba(170,190,255,' + (0.42 + p.flash * 0.5) + ')');
      grad.addColorStop(1, 'rgba(170,190,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1.5, 4 * z);
      ctx.beginPath();
      ctx.moveTo(mx - nx * far, my - ny * far);
      ctx.lineTo(mx + nx * far, my + ny * far);
      ctx.stroke();

      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(170,190,255,0.22)';
      ctx.lineWidth = Math.max(0.8, 1.6 * z);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

      orb(ctx, a, 210 * z, [170, 190, 255], 0.8);
      orb(ctx, b, 210 * z, [170, 190, 255], 0.8);

      // the signal, arriving
      if (p.flash > 0) {
        var f = p.flash / 0.6;
        ring(ctx, a.x, a.y, (1 - f) * 900 * z, 'rgba(210,225,255,' + (f * 0.6) + ')', Math.max(1, 3 * z));
        ring(ctx, b.x, b.y, (1 - f) * 900 * z, 'rgba(210,225,255,' + (f * 0.6) + ')', Math.max(1, 3 * z));
      } else {
        // and the countdown to the next one
        var cd = 1 - p.ping / 2.6;
        ring(ctx, mx, my, 40 + 26 * cd, 'rgba(190,210,255,' + (0.2 + 0.5 * cd) + ')', Math.max(1, 2 * z));
      }
      ctx.restore();
    }
  };

  /* ===================================================================== 7 */

  var SHOCK = {
    key: 'shock',
    name: 'The Shockwave',
    tint: [255, 180, 90],
    ground: ['#10060a', '#280f10'],
    blurb: 'A shell going outward, getting faster. Score only while you are on the front.',
    scale: 0.926,
    aim: function (p, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      var d = Math.hypot(cx, cy) || 1;
      return [(cx / d) * p.rad, (cy / d) * p.rad];
    },
    init: function (p) { p.rad = 200; p.speed = 190; p.on = 0; p.held = 0; },
    update: function (p, dt, engine) {
      p.rad += p.speed * dt;
      p.speed += 26 * dt;                 // it accelerates, so riding it gets harder
      if (p.rad > p.R * 0.99) { p.rad = 180; p.speed = 190; p.held = 0; p.say('a new shell', 1.2); }

      var cx = p.catX(engine), cy = p.catY(engine);
      var r = Math.hypot(cx, cy);
      var off = Math.abs(r - p.rad);
      p.on = off < 170 ? 1 : 0;
      if (p.on) {
        p.held += dt;
        // riding it is worth more the longer you hold on
        p.gain((26 + Math.min(p.held, 8) * 9) * dt);
        if (Math.floor(p.held * 2) !== Math.floor((p.held - dt) * 2)) {
          p.spark(cx, cy, [255, 200, 120], 4);
        }
        if (p.held > 3 && Math.floor(p.held) !== Math.floor(p.held - dt)) {
          p.say('riding it · ' + Math.floor(p.held) + 's', 1);
        }
      } else if (p.held > 0) {
        if (p.held > 2) p.say('fell off', 1);
        p.held = 0;
      }
    },
    draw: function (p, ctx, engine, z) {
      var c = p.screen(engine, z, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      orb(ctx, c, 300 * z, [255, 210, 150], 0.6);

      // the front, thick enough to aim at
      var g = ctx.createRadialGradient(c.x, c.y, Math.max(0, (p.rad - 200) * z),
        c.x, c.y, (p.rad + 200) * z);
      g.addColorStop(0, 'rgba(255,150,60,0)');
      g.addColorStop(0.5, 'rgba(255,190,110,' + (p.on ? 0.42 : 0.26) + ')');
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(c.x - (p.rad + 200) * z, c.y - (p.rad + 200) * z,
        (p.rad + 200) * z * 2, (p.rad + 200) * z * 2);
      ring(ctx, c.x, c.y, p.rad * z, 'rgba(255,215,160,' + (p.on ? 0.9 : 0.5) + ')',
        Math.max(1.5, 4 * z));
      ctx.restore();
    }
  };

  /* ===================================================================== 8 */

  var DUSTLANE = {
    key: 'dustlane',
    name: 'The Dust Lane',
    tint: [190, 150, 120],
    ground: ['#0a0806', '#171008'],
    blurb: 'You cannot see them. You can see the stars they are covering up.',
    scale: 0.183,
    aim: function (p) {
      var best = null, bd = Infinity;
      for (var i = 0; i < p.clumps.length; i++) {
        var d = Math.hypot(p.clumps[i].x, p.clumps[i].y);
        if (d < bd) { bd = d; best = p.clumps[i]; }
      }
      return best ? [best.x, best.y] : null;
    },
    init: function (p) {
      p.field = [];
      var r = RDF.prng(0xD0571);
      for (var i = 0; i < 260; i++) {
        var a = r() * TAU, rr = Math.sqrt(r()) * p.R;
        p.field.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, s: 0.6 + r() * 1.6 });
      }
      p.clumps = [];
      for (var k = 0; k < 7; k++) p.clumps.push(newClump(p));
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      for (var i = p.clumps.length - 1; i >= 0; i--) {
        var c = p.clumps[i];
        c.x += c.vx * dt; c.y += c.vy * dt;
        var rr = Math.hypot(c.x, c.y);
        if (rr > p.R * 0.94) { c.vx *= -1; c.vy *= -1; }
        if (dist(c.x, c.y, cx, cy) < c.r * 0.8) {
          p.combo++;
          var pts = Math.round(60 + c.r * 0.35 + Math.min(p.combo, 8) * 14);
          p.add(pts, c.x, c.y, [230, 200, 170]);
          p.say('found one  +' + pts, 1.2);
          if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('dust ' + pts), 0.5);
          p.clumps[i] = newClump(p);
        }
      }
    },
    draw: function (p, ctx, engine, z) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < p.field.length; i++) {
        var f = p.field[i], s = p.screen(engine, z, f.x, f.y);
        ctx.fillStyle = 'rgba(226,232,255,0.75)';
        ctx.fillRect(s.x, s.y, f.s, f.s);
      }
      ctx.restore();

      /* The clumps are drawn as nothing at all — they simply take the stars out.
         Painting them over the background in the ground colour is the whole
         trick: you find them by noticing an absence. */
      ctx.save();
      for (var k = 0; k < p.clumps.length; k++) {
        var c = p.clumps[k], sc = p.screen(engine, z, c.x, c.y);
        var g = ctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, c.r * z);
        g.addColorStop(0, 'rgba(10,8,6,1)');
        g.addColorStop(0.72, 'rgba(10,8,6,0.96)');
        g.addColorStop(1, 'rgba(10,8,6,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sc.x - c.r * z, sc.y - c.r * z, c.r * z * 2, c.r * z * 2);
      }
      ctx.restore();
    }
  };

  function newClump(p) {
    var s = spot(p);
    var a = Math.random() * TAU, sp = rnd(25, 70);
    return { x: s.x, y: s.y, r: rnd(190, 330), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp };
  }

  /* ===================================================================== 9 */

  var DISK = {
    key: 'disk',
    name: 'The Accretion Disk',
    tint: [255, 160, 220],
    ground: ['#0d0410', '#1e0a22'],
    blurb: 'Charging at it bounces you off. Match its orbit and it comes quietly.',
    scale: 0.293,
    aim: function (p) {
      var best = null, bd = Infinity;
      for (var i = 0; i < p.rocks.length; i++) {
        var d = Math.hypot(p.rocks[i].x, p.rocks[i].y);
        if (d < bd) { bd = d; best = p.rocks[i]; }
      }
      return best ? [best.x, best.y] : null;
    },
    init: function (p) {
      p.rocks = [];
      for (var i = 0; i < 16; i++) p.rocks.push(newRock(p));
      p.lastBounce = 0;
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      if (p.lastBounce > 0) p.lastBounce -= dt;

      for (var i = p.rocks.length - 1; i >= 0; i--) {
        var k = p.rocks[i];
        k.a += k.w * dt;
        var px = k.x, py = k.y;
        k.x = Math.cos(k.a) * k.r;
        k.y = Math.sin(k.a) * k.r * 0.94;
        k.vx = (k.x - px) / Math.max(dt, 1e-4);
        k.vy = (k.y - py) / Math.max(dt, 1e-4);

        if (dist(k.x, k.y, cx, cy) < 175) {
          // the only question that matters: are you travelling with it?
          var rel = Math.hypot(engine.cat.vx - k.vx, engine.cat.vy - k.vy);
          if (rel < 620) {
            p.combo++;
            var pts = Math.round(70 + (1 - rel / 620) * 130 + Math.min(p.combo, 8) * 16);
            p.add(pts, k.x, k.y, [255, 190, 230]);
            p.say(rel < 200 ? 'docked clean  +' + pts : 'docked  +' + pts, 1.2);
            if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('dock ' + pts), 0.5);
            p.rocks[i] = newRock(p);
          } else if (p.lastBounce <= 0) {
            p.lastBounce = 0.8;
            p.combo = 0;
            var dx = cx - k.x, dy = cy - k.y, d = Math.hypot(dx, dy) || 1;
            engine.cat.vx += (dx / d) * 700;
            engine.cat.vy += (dy / d) * 700;
            engine.shake = Math.max(engine.shake || 0, 5);
            p.say('too fast — matched orbit only', 1.4);
            p.spark(k.x, k.y, [255, 160, 220], 8);
          }
        }
      }
    },
    draw: function (p, ctx, engine, z) {
      var c = p.screen(engine, z, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      orb(ctx, c, 340 * z, [255, 190, 230], 0.75);
      for (var b = 1; b <= 4; b++) {
        ring(ctx, c.x, c.y, p.R * 0.2 * b * z, 'rgba(255,160,220,0.10)', Math.max(0.6, 1.4 * z));
      }
      for (var i = 0; i < p.rocks.length; i++) {
        var k = p.rocks[i], s = p.screen(engine, z, k.x, k.y);
        orb(ctx, s, 120 * z, [255, 190, 230], 0.8);
        // its heading, so "match this" is something you can read at a glance
        var vl = Math.hypot(k.vx, k.vy) || 1;
        ctx.strokeStyle = 'rgba(255,210,240,0.5)';
        ctx.lineWidth = Math.max(0.8, 2 * z);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + (k.vx / vl) * 40, s.y + (k.vy / vl) * 40);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  function newRock(p) {
    var r = rnd(p.R * 0.22, p.R * 0.86);
    var a = Math.random() * TAU;
    return { r: r, a: a, w: 1.9 / Math.sqrt(r / 300) * 0.28, x: Math.cos(a) * r, y: Math.sin(a) * r * 0.94, vx: 0, vy: 0 };
  }

  /* ==================================================================== 10 */

  var EXPANSION = {
    key: 'expansion',
    name: 'The Expansion',
    tint: [200, 140, 255],
    ground: ['#08040f', '#150a26'],
    blurb: 'Space is stretching. The far ones are worth more and running faster.',
    scale: 0.163,
    aim: function (p, engine) {
      var cx = p.catX(engine), cy = p.catY(engine), best = null, bs = -Infinity;
      for (var i = 0; i < p.motes.length; i++) {
        var m = p.motes[i];
        // worth chasing = value against how far it already is
        var s = m.worth - dist(m.x, m.y, cx, cy) * 0.06;
        if (s > bs) { bs = s; best = m; }
      }
      return best ? [best.x, best.y] : null;
    },
    init: function (p) {
      p.motes = [];
      for (var i = 0; i < 15; i++) p.motes.push(newFleeing(p, p.R * (0.1 + Math.random() * 0.5)));
      p.H = 0.30;                        // the expansion rate
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      p.H = 0.30 + (p.t / 60) * 0.22;    // it speeds up as the run goes on

      for (var i = p.motes.length - 1; i >= 0; i--) {
        var m = p.motes[i];
        // Hubble flow: recession proportional to distance, which is the point
        var r = Math.hypot(m.x, m.y) || 1;
        m.x += (m.x / r) * r * p.H * dt;
        m.y += (m.y / r) * r * p.H * dt;
        m.worth = 20 + Math.round(r * 0.12);

        if (r > p.R * 1.02) {
          p.motes[i] = newFleeing(p, p.R * (0.08 + Math.random() * 0.25));
          if (p.combo > 0) p.say('over the horizon', 1);
          continue;
        }
        if (dist(m.x, m.y, cx, cy) < 165) {
          p.combo++;
          var pts = m.worth + Math.min(p.combo, 8) * 12;
          p.add(pts, m.x, m.y, [215, 170, 255]);
          p.say('+' + pts, 1);
          if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('expand ' + pts), 0.5);
          p.motes[i] = newFleeing(p, p.R * (0.08 + Math.random() * 0.3));
        }
      }
    },
    draw: function (p, ctx, engine, z) {
      var c = p.screen(engine, z, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ring(ctx, c.x, c.y, p.R * z, 'rgba(200,140,255,0.22)', Math.max(1, 2 * z));
      for (var i = 0; i < p.motes.length; i++) {
        var m = p.motes[i], s = p.screen(engine, z, m.x, m.y);
        var far = RDF.clamp(Math.hypot(m.x, m.y) / p.R, 0, 1);
        // redder the further out, because that is what recession does to light
        var col = [200 + far * 55, 170 - far * 70, 255 - far * 120];
        orb(ctx, s, (110 + far * 70) * z, col, 0.85);
        if (far > 0.55) {
          ctx.fillStyle = 'rgba(255,210,255,0.75)';
          ctx.font = Math.max(9, 13 * z * 3) + 'px "Space Grotesk", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('+' + m.worth, s.x, s.y - 22);
        }
      }
      ctx.restore();
    }
  };

  function newFleeing(p, r) {
    var a = Math.random() * TAU;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, worth: 20 };
  }

  /* ==================================================================== 11 */

  var LAGRANGE = {
    key: 'lagrange',
    name: 'The Lagrange Points',
    tint: [255, 235, 150],
    ground: ['#0c0a03', '#1d1806'],
    blurb: 'Five places where the two pulls cancel. Three of them will not hold you.',
    scale: 0.834,
    aim: function (p, engine) {
      var cx = p.catX(engine), cy = p.catY(engine), best = null, bs = -Infinity;
      for (var i = 0; i < p.pts.length; i++) {
        var q = p.pts[i];
        var s = q.worth * 40 - dist(q.x, q.y, cx, cy) * 0.05;
        if (s > bs) { bs = s; best = q; }
      }
      return best ? [best.x, best.y] : null;
    },
    init: function (p) {
      p.a = 0;
      p.sep = p.R * 0.52;
      p.pts = [
        { k: 'L1', off: 0.0, ang: 0, worth: 3, stable: false },
        { k: 'L2', off: 1.45, ang: 0, worth: 3, stable: false },
        { k: 'L3', off: -1.0, ang: Math.PI, worth: 3, stable: false },
        { k: 'L4', off: 1.0, ang: Math.PI / 3, worth: 1, stable: true },
        { k: 'L5', off: 1.0, ang: -Math.PI / 3, worth: 1, stable: true }
      ];
      p.held = 0; p.at = null;
      for (var i = 0; i < p.pts.length; i++) { p.pts[i].x = 0; p.pts[i].y = 0; }
    },
    update: function (p, dt, engine) {
      p.a += dt * 0.34;
      var cx = p.catX(engine), cy = p.catY(engine);

      for (var i = 0; i < p.pts.length; i++) {
        var q = p.pts[i];
        var ang = p.a + q.ang;
        var d = q.k === 'L1' ? p.sep * 0.72
              : q.k === 'L2' ? p.sep * 1.28
              : q.k === 'L3' ? p.sep * 1.0
              : p.sep;
        q.x = Math.cos(ang) * d;
        q.y = Math.sin(ang) * d * 0.94;
      }

      var on = null;
      for (var j = 0; j < p.pts.length; j++) {
        if (dist(p.pts[j].x, p.pts[j].y, cx, cy) < 165) { on = p.pts[j]; break; }
      }
      if (on) {
        if (p.at !== on) { p.at = on; p.held = 0; }
        p.held += dt;
        p.gain((14 + on.worth * 16) * dt);
        /* The unstable three shove you off, and that is the whole difference:
           they pay triple because staying is work rather than parking. */
        if (!on.stable) {
          var dx = cx - on.x, dy = cy - on.y, dd = Math.hypot(dx, dy) || 1;
          var push = 260 + p.held * 130;
          engine.cat.vx += (dx / dd) * push * dt * 6;
          engine.cat.vy += (dy / dd) * push * dt * 6;
        }
        if (Math.floor(p.held) !== Math.floor(p.held - dt) && p.held >= 1) {
          p.say(on.k + ' · ' + Math.floor(p.held) + 's', 1);
        }
      } else {
        if (p.at && p.held > 1.5) p.say('drifted off ' + p.at.k, 1);
        p.at = null; p.held = 0;
      }
    },
    draw: function (p, ctx, engine, z) {
      var c = p.screen(engine, z, 0, 0);
      var m2 = p.screen(engine, z, Math.cos(p.a) * p.sep, Math.sin(p.a) * p.sep * 0.94);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      orb(ctx, c, 340 * z, [255, 240, 190], 0.9);
      orb(ctx, m2, 200 * z, [190, 210, 255], 0.85);
      ctx.strokeStyle = 'rgba(255,235,150,0.16)';
      ctx.lineWidth = Math.max(0.7, 1.4 * z);
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();

      for (var i = 0; i < p.pts.length; i++) {
        var q = p.pts[i], s = p.screen(engine, z, q.x, q.y);
        var col = q.stable ? [170, 255, 200] : [255, 205, 120];
        orb(ctx, s, 150 * z, col, p.at === q ? 0.95 : 0.5);
        ring(ctx, s.x, s.y, 160 * z,
          'rgba(' + col.join(',') + ',' + (p.at === q ? 0.9 : 0.4) + ')', Math.max(1, 2 * z));
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.font = Math.max(9, 34 * z) + 'px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(q.k, s.x, s.y - 175 * z);
      }
      ctx.restore();
    }
  };

  /* ==================================================================== 12 */

  var MAGNETAR = {
    key: 'magnetar',
    name: 'The Magnetar',
    tint: [150, 160, 255],
    ground: ['#04050e', '#0a0c1e'],
    blurb: 'The field reads every movement. It pays for stillness and bites at speed.',
    scale: 0.701,
    aim: function (p) { return p.mote ? [p.mote.x, p.mote.y] : null; },
    init: function (p) {
      p.mote = spot(p);
      p.charge = 0;
      p.calm = 0;
    },
    update: function (p, dt, engine) {
      var cx = p.catX(engine), cy = p.catY(engine);
      var sp = Math.hypot(engine.cat.vx, engine.cat.vy);

      /* Inverted on purpose. Every other pocket rewards flying hard; this one
         is the pause in the middle of the set, and the whole set is better for
         having one place where the answer is to stop. */
      var fast = sp > 1100;
      if (fast) {
        p.charge += dt * (0.35 + (sp - 1100) / 3500);
        p.calm = 0;
      } else {
        p.charge = Math.max(0, p.charge - dt * 0.5);
        p.calm += dt;
        // stillness itself is the score, and it compounds
        p.gain((7 + Math.min(p.calm, 10) * 5) * dt);
      }

      if (p.charge >= 1) {
        p.charge = 0;
        p.calm = 0;
        p.penalty(0.06, 'discharge');
        engine.shake = Math.max(engine.shake || 0, 10);
        engine.cat.vx *= 0.2; engine.cat.vy *= 0.2;
        p.spark(cx, cy, [170, 180, 255], 20);
        if (RDF.audio && RDF.audio.fall) RDF.audio.fall();
      }

      if (p.mote && dist(p.mote.x, p.mote.y, cx, cy) < 170) {
        var pts = Math.round(60 + Math.min(p.calm, 12) * 14);
        p.add(pts, p.mote.x, p.mote.y, [180, 190, 255]);
        p.say(p.calm > 4 ? 'quietly done  +' + pts : '+' + pts, 1.2);
        if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('magnetar ' + pts), 0.5);
        p.mote = spot(p, engine, 700);
      }
    },
    draw: function (p, ctx, engine, z) {
      var c = p.screen(engine, z, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      orb(ctx, c, 260 * z, [150, 160, 255], 0.7);
      for (var k = 0; k < 6; k++) {
        var a = (k / 6) * TAU + p.t * 0.12;
        ctx.strokeStyle = 'rgba(150,160,255,0.14)';
        ctx.lineWidth = Math.max(0.7, 1.5 * z);
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, p.R * 0.6 * z, p.R * 0.22 * z, a, 0, TAU);
        ctx.stroke();
      }
      if (p.mote) orb(ctx, p.screen(engine, z, p.mote.x, p.mote.y), 150 * z, [190, 200, 255], 0.9);
      ctx.restore();

      // the charge, on the player, so the warning is where you are looking
      var cat = p.screen(engine, z, p.catX(engine), p.catY(engine));
      if (p.charge > 0.02) {
        ctx.save();
        ctx.strokeStyle = 'rgba(170,180,255,' + (0.4 + 0.6 * p.charge) + ')';
        ctx.lineWidth = Math.max(1.5, 3 * z);
        ctx.beginPath();
        ctx.arc(cat.x, cat.y, 48, -Math.PI / 2, -Math.PI / 2 + TAU * p.charge);
        ctx.stroke();
        ctx.restore();
      } else if (p.calm > 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var g = Math.min(0.35, p.calm * 0.03);
        var gr = ctx.createRadialGradient(cat.x, cat.y, 0, cat.x, cat.y, 90);
        gr.addColorStop(0, 'rgba(150,255,220,' + g + ')');
        gr.addColorStop(1, 'rgba(150,255,220,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(cat.x - 90, cat.y - 90, 180, 180);
        ctx.restore();
      }
    }
  };

  /* ==================================================================== 13 */

  var RING = {
    key: 'ring',
    name: 'The Einstein Ring',
    tint: [255, 200, 255],
    ground: ['#0a0410', '#180a20'],
    blurb: 'Source, lens, you. Put the three in a line and the light comes round.',
    scale: 0.491,
    aim: function (p) {
      // stand directly behind the lens as seen from the source
      var dx = p.lens.x - p.src.x, dy = p.lens.y - p.src.y;
      var d = Math.hypot(dx, dy) || 1;
      return [p.lens.x + (dx / d) * 520, p.lens.y + (dy / d) * 520];
    },
    init: function (p) {
      p.src = { x: -p.R * 0.62, y: -p.R * 0.3, a: 0 };
      p.lens = { x: 0, y: 0, a: 1.2 };
      p.held = 0;
      p.best = 0;
    },
    update: function (p, dt, engine) {
      p.src.a += dt * 0.19;
      p.lens.a += dt * 0.31;
      p.src.x = Math.cos(p.src.a) * p.R * 0.66;
      p.src.y = Math.sin(p.src.a) * p.R * 0.5;
      p.lens.x = Math.cos(p.lens.a) * p.R * 0.26;
      p.lens.y = Math.sin(p.lens.a) * p.R * 0.2;

      var cx = p.catX(engine), cy = p.catY(engine);
      // how close the three are to collinear, from the player's side of the lens
      var ax = p.lens.x - p.src.x, ay = p.lens.y - p.src.y;
      var bx = cx - p.lens.x, by = cy - p.lens.y;
      var la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      var cosang = (ax * bx + ay * by) / (la * lb);
      var behind = lb > 220 && lb < 1400;
      p.align = behind ? RDF.clamp((cosang - 0.955) / 0.045, 0, 1) : 0;

      if (p.align > 0) {
        p.held += dt;
        p.gain((10 + p.align * p.align * 88) * dt);
        if (p.align > 0.75 && Math.floor(p.held * 2) !== Math.floor((p.held - dt) * 2)) {
          p.spark(cx, cy, [255, 210, 255], 5);
        }
        if (p.held > 2 && Math.floor(p.held) !== Math.floor(p.held - dt)) {
          p.say('the ring holds · ' + Math.floor(p.held) + 's', 1);
          if (RDF.audio) RDF.audio.chime(RDF.spectrum.analyse('ring ' + Math.floor(p.held)), 0.4);
        }
      } else {
        if (p.held > 2) p.say('lost the line', 1);
        p.held = 0;
      }
    },
    draw: function (p, ctx, engine, z) {
      var s = p.screen(engine, z, p.src.x, p.src.y);
      var l = p.screen(engine, z, p.lens.x, p.lens.y);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // the line you are trying to stand on, extended past the lens
      var dx = l.x - s.x, dy = l.y - s.y, d = Math.hypot(dx, dy) || 1;
      var far = Math.max(engine.W, engine.H);
      var g = ctx.createLinearGradient(l.x, l.y, l.x + (dx / d) * far, l.y + (dy / d) * far);
      g.addColorStop(0, 'rgba(255,200,255,' + (0.22 + p.align * 0.5) + ')');
      g.addColorStop(1, 'rgba(255,200,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(1.5, 5 * z);
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(l.x + (dx / d) * far, l.y + (dy / d) * far);
      ctx.stroke();

      orb(ctx, s, 240 * z, [255, 240, 210], 0.9);
      orb(ctx, l, 190 * z, [180, 150, 220], 0.7);

      // and the ring itself, which only closes when you are on the line
      if (p.align > 0) {
        var rr = 150 * z + 40 * z * Math.sin(p.t * 3);
        ctx.strokeStyle = 'rgba(255,215,255,' + (0.25 + p.align * 0.7) + ')';
        ctx.lineWidth = Math.max(1.5, (2 + p.align * 6) * z);
        ctx.beginPath();
        ctx.arc(l.x, l.y, rr, 0, TAU * (0.25 + p.align * 0.75));
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  /* ---------------------------------------------------------------- export */

  RDF.POCKETS = (RDF.POCKETS || []).concat([
    OCCULTATION, PARALLAX, SAIL, ROCHE, AURORA, INTERFERENCE, SHOCK,
    DUSTLANE, DISK, EXPANSION, LAGRANGE, MAGNETAR, RING
  ]);
})(window.RDF = window.RDF || {});
