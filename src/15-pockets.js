/* Rainbow Deep Field — the pockets, and the coloured singularities that lead
   to them.

   The site opens by telling you about the Hubble Deep Field: point the best
   telescope ever built at a patch of sky chosen because it looked completely
   empty, stare for ten days, find ten thousand galaxies. That is the whole
   premise of the place, and it is also the licence for these.

   Seven coloured singularities are scattered through the field. Each one drops
   you into a pocket of sky that looks empty until you are inside it, for sixty
   seconds, with something to do that could only happen there. They are not
   levels and they are not an arcade cabinet bolted to the side of a reading
   app — every one of them is made out of this field's own materials. Light,
   wavelength, Doppler shift, absorption lines, gravitational lensing, the
   oldest photons in the universe. If a pocket could be dropped into any other
   game unchanged, it does not belong in this one.

   The framework is here; the seven are in 16-games.js. Everything a pocket
   needs is on the run object it is handed — position is relative to the arena
   centre, scoring is a number, and the flight model is untouched, because
   flying is the best thing this project has and every pocket should be an
   excuse to do more of it. */
(function (RDF) {
  'use strict';

  var TAU = Math.PI * 2;

  /* Sized against the camera, not picked. At 3400 with the old fixed zoom the
     arena was four screens across: the first screenshots of all seven showed a
     cat alone in the dark with the actual game somewhere off the bottom edge,
     which read as broken rather than as sparse. The arena is now a bit smaller
     than one screenful, and the zoom is fitted to the viewport so a phone in
     portrait sees the same share of it a laptop does. */
  var ARENA = 2000;          // world units, radius
  var LENGTH = 60;           // seconds in a pocket
  var ENDING = 6;            // seconds of "hurry up" at the end
  var HORIZON = 150;         // the singularity's event horizon
  var PULL = 7;              // horizons of reach, same rule as the big one
  var PULL_AGAIN = 3.2;      // once you have been through it
  var PULL_ACC = 5200;

  /* The pockets live a long way from the galaxy rather than in their own
     coordinate system. Everything — camera, flight, particles, the readout —
     already speaks world coordinates, and moving the arena somewhere nothing
     else has ever been is eight characters of offset against rewriting all of
     that for no visible gain. */
  var ORIGIN = { x: 0, y: -9000000 };

  /* ------------------------------------------------------- the singularities */

  function Singularity(def, x, y, i) {
    this.def = def;
    this.x = x; this.y = y;
    this.rs = HORIZON;
    this.i = i;
    this.spin = i * 0.7;
    /* Read once here rather than per door per frame: drawSing asked the store
       whether each of the seven had been visited on every single frame, which
       is seven localStorage reads and seven JSON parses sixty times a second
       to decide whether to print a caption. */
    this.done = RDF.store.pocketBest(def.key).n > 0;
  }

  function place(world) {
    var out = [];
    var defs = RDF.POCKETS || [];
    var r = RDF.prng(0x5EC2E7);
    for (var i = 0; i < defs.length; i++) {
      /* Spread round the field and out past the busy part, so finding one is a
         thing that happens while you are exploring rather than something you
         trip over on the way to your first message. */
      var a = (i / defs.length) * TAU + (r() - 0.5) * 0.5;
      var rad = world.R * (0.46 + r() * 0.46);
      out.push(new Singularity(defs[i], Math.cos(a) * rad, Math.sin(a) * rad * 0.94, i));
    }
    return out;
  }

  /** Zoom that puts the whole arena on the screen, whatever shape it is. */
  function zoomFor(engine) {
    var W = engine.W || 1280, H = engine.H || 800;
    var m = Math.min(W, H);
    /* On a desktop the arena is a window onto a bigger space and half the short
       side is plenty. On a phone the short side IS the play area, and half of
       390px left the arena 230px wide with the rest of the glass doing nothing
       — a postage stamp you are asked to fly precisely inside. It gets most of
       the screen instead. */
    var frac = W < 640 ? 0.80 : 0.5;
    return RDF.clamp(m * frac / (ARENA * 0.95), 0.115, 0.30);
  }

  /* ------------------------------------------------------------------- run */

  function Run(def, engine, ret) {
    this.def = def;
    this.t = 0;
    this.left = LENGTH;
    this.score = 0;
    this.combo = 0;
    this.best = 0;
    this.ret = ret;                 // where to put them back
    this.ox = ORIGIN.x; this.oy = ORIGIN.y;
    this.R = ARENA;
    this.things = [];               // whatever the pocket wants
    this.bits = [];                 // shared particle pool
    this.flash = 0;
    this.timeHit = 0;               // fades the clock red after a time penalty
    this.note = '';                 // a line the HUD shows
    this.noteFor = 0;
    this.ended = false;
    if (def.init) def.init(this, engine);
  }

  /** Arena-relative helpers, so a pocket never has to think about the offset. */
  Run.prototype.toWorld = function (x, y) { return { x: this.ox + x, y: this.oy + y }; };
  Run.prototype.catX = function (engine) { return engine.cat.x - this.ox; };
  Run.prototype.catY = function (engine) { return engine.cat.y - this.oy; };

  Run.prototype.say = function (msg, secs) { this.note = msg; this.noteFor = secs || 1.6; };

  /* Cost somebody time.

     A pocket that punishes you with a stun teaches nothing: you sit still for a
     second and carry on, and the mistake has no weight. Taking seconds off the
     clock is the only currency a sixty-second run actually has, and it shows up
     in the one place the player is already watching — the bar visibly jumps
     back. `frac` is a share of the full minute rather than of what is left, so
     a hit late in a run hurts exactly as much as an early one and the number
     stays predictable. */
  Run.prototype.penalty = function (frac, label) {
    var lost = LENGTH * frac;
    if (this.left < lost) lost = this.left;
    this.left -= lost;
    this.timeHit = 1;
    this.combo = 0;
    if (label) this.say(label + ' · −' + Math.max(1, Math.round(lost)) + 's', 1.6);
    return lost;
  };

  /* Every pocket scores through here, and every pocket has a scale on it.

     They were built independently and it showed: sixty good seconds in the
     Prism came out at 400 and sixty good seconds in the Doppler at 4778, off
     the same clock. One shared number on the HUD has to mean the same thing in
     all seven, or the stingy ones read as broken rather than as different. The
     scales below were measured, not guessed — a bot that plays each one
     properly, then shaded for the ones the bot is unfairly good at (perfect
     pursuit, instant perception) or unfairly bad at (towing, herding). A good
     minute is about two thousand anywhere. */
  Run.prototype.gain = function (n) { this.score += n * (this.def.scale || 1); };

  Run.prototype.add = function (n, x, y, rgb) {
    this.gain(n);
    if (x !== undefined) this.spark(x, y, rgb || [255, 240, 200], 10);
  };

  Run.prototype.spark = function (x, y, rgb, n) {
    if (this.bits.length > 600) return;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU + Math.random() * 0.4;
      var v = 90 + Math.random() * 320;
      this.bits.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.5 + Math.random() * 0.5, max: 1,
        r: rgb[0], g: rgb[1], b: rgb[2], s: 2.2
      });
    }
  };

  Run.prototype.stepBits = function (dt) {
    var b = this.bits;
    for (var i = b.length - 1; i >= 0; i--) {
      var q = b[i];
      q.life -= dt;
      if (q.life <= 0) { b[i] = b[b.length - 1]; b.pop(); continue; }
      q.vx *= 0.97; q.vy *= 0.97;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
  };

  Run.prototype.drawBits = function (ctx, engine, z) {
    var b = this.bits;
    if (!b.length) return;
    var cam = engine.cam, W = engine.W, H = engine.H;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < b.length; i++) {
      var q = b[i];
      var sx = (this.ox + q.x - cam.x) * z + W / 2;
      var sy = (this.oy + q.y - cam.y) * z + H / 2;
      if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) continue;
      var a = q.life / q.max;
      ctx.fillStyle = 'rgba(' + q.r + ',' + q.g + ',' + q.b + ',' + (a * 0.9) + ')';
      var s = q.s * (0.5 + a);
      ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    }
    ctx.restore();
  };

  /** Screen position of an arena point, for pockets that draw their own things. */
  Run.prototype.screen = function (engine, z, x, y) {
    return {
      x: (this.ox + x - engine.cam.x) * z + engine.W / 2,
      y: (this.oy + y - engine.cam.y) * z + engine.H / 2
    };
  };

  /* ----------------------------------------------------------------- engine */

  function enter(engine, def, sing) {
    /* Where to put them back, and this is not "where they were standing".

       Where they were standing is inside the horizon of the door they just fell
       through, so returning them there returns them to the fall — the first
       fly-in test came out of the Prism and went straight back into it, over
       and over, with the banner never getting far enough through its animation
       to notice. They come out alongside the door instead, past its reach, on
       the heading they arrived on, and the doors are shut for a few seconds
       afterwards so leaving is possible under your own steam. */
    var ret;
    if (sing) {
      var ax = engine.cat.x - sing.x, ay = engine.cat.y - sing.y;
      var ad = Math.hypot(ax, ay);
      if (ad < 1) { ax = Math.cos(engine.cat.dir + Math.PI); ay = Math.sin(engine.cat.dir + Math.PI); ad = 1; }
      var out = sing.rs * PULL * 2.2;
      ret = { x: sing.x + (ax / ad) * out, y: sing.y + (ay / ad) * out, z: engine.cam.zt, ax: ax / ad, ay: ay / ad };
    } else {
      ret = { x: engine.cat.x, y: engine.cat.y, z: engine.cam.zt };
    }
    var run = new Run(def, engine, ret);
    run.sing = sing || null;
    engine.pocket = run;
    engine.warp(ORIGIN.x, ORIGIN.y);
    var pz = zoomFor(engine);
    engine.cam.zt = pz; engine.cam.z = pz; engine.zEff = pz;
    engine.focused = null; engine.reading = null;
    engine._wasReading = null; engine._readUntil = 0;
    engine._fading.length = 0;
    engine.shake = Math.max(engine.shake, 8);
    if (engine.hole) { engine.hole.flash = 1; engine.hole.grip = 0; }
    run.was = RDF.store.pocketBest(def.key);
    if (RDF.audio && RDF.audio.fall) RDF.audio.fall();
    if (engine.onPocketEnter) engine.onPocketEnter(run);
    return run;
  }

  function leave(engine) {
    var run = engine.pocket;
    if (!run) return;
    engine.pocket = null;
    engine.warp(run.ret.x, run.ret.y);
    engine.cam.zt = run.ret.z || RDF.Engine.Z_DEF;
    engine.shake = Math.max(engine.shake, 8);
    // thrown clear, and the doors stay shut long enough to fly off
    if (run.ret.ax) {
      engine.cat.vx = run.ret.ax * 900;
      engine.cat.vy = run.ret.ay * 900;
      engine.cat.dir = Math.atan2(run.ret.ay, run.ret.ax);
    }
    engine.singCool = 4;
    if (run.sing) run.sing.done = true;
    if (engine.hole) { engine.hole.flash = 1; engine.hole.cool = 3; }
    var rec = RDF.store.pocketScore(run.def.key, Math.round(run.score));
    if (RDF.audio && RDF.audio.fall) RDF.audio.fall();
    if (engine.onPocketLeave) engine.onPocketLeave(run, rec);
  }

  /** Runs instead of the whole field while you are inside one. */
  function update(engine, dt) {
    var run = engine.pocket;
    run.t += dt;
    run.left -= dt;
    if (run.timeHit > 0) run.timeHit = Math.max(0, run.timeHit - dt * 1.6);
    run.flash *= Math.pow(0.02, dt);
    if (run.noteFor > 0) run.noteFor -= dt;

    // the arena wall: a push rather than a fence, so it never feels like a bug
    var cx = run.catX(engine), cy = run.catY(engine);
    var d = Math.hypot(cx, cy);
    if (d > run.R) {
      var push = Math.min(1, (d - run.R) / 400);
      engine.cat.vx -= (cx / d) * push * 4200 * dt;
      engine.cat.vy -= (cy / d) * push * 4200 * dt;
      if (d > run.R * 1.25) {
        engine.cat.x = run.ox + (cx / d) * run.R * 1.25;
        engine.cat.y = run.oy + (cy / d) * run.R * 1.25;
      }
    }

    // the fit is the fit; a pocket is not somewhere you go looking with the wheel
    var want = zoomFor(engine);
    if (Math.abs(engine.cam.zt - want) > 0.001) engine.cam.zt = want;

    if (run.def.update) run.def.update(run, dt, engine);
    run.stepBits(dt);

    if (run.left <= 0 && !run.ended) { run.ended = true; leave(engine); }
  }

  function draw(engine, ctx, z) {
    var run = engine.pocket;
    var W = engine.W, H = engine.H;

    // each pocket paints its own sky. Cached: it is identical every frame, and
    // a full-screen gradient rebuilt sixty times a second is pure waste
    if (!run._bg || run._bgW !== W || run._bgH !== H) {
      var g = run.def.ground || ['#05040c', '#0a0714'];
      var bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
      bg.addColorStop(0, g[1]);
      bg.addColorStop(1, g[0]);
      run._bg = bg; run._bgW = W; run._bgH = H;
    }
    ctx.fillStyle = run._bg;
    ctx.fillRect(0, 0, W, H);

    if (run.def.draw) run.def.draw(run, ctx, engine, z);
    run.drawBits(ctx, engine, z);

    // the wall, visible only as you approach it
    var cx = run.catX(engine), cy = run.catY(engine);
    var near = RDF.clamp((Math.hypot(cx, cy) - run.R * 0.72) / (run.R * 0.3), 0, 1);
    if (near > 0.01) {
      var c = run.screen(engine, z, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(' + run.def.tint.join(',') + ',' + (0.30 * near) + ')';
      ctx.lineWidth = Math.max(1, 26 * z);
      ctx.beginPath();
      ctx.arc(c.x, c.y, run.R * z, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    /* Whatever this pocket wants you looking at, if it is not on the screen.

       Every one of the seven had the same hole in it and it only showed up in
       the screenshots: the arena is about a screenful, the camera follows the
       cat, so the thing you are meant to be flying at spends a good part of the
       minute just off the bottom edge. In the Lens the gate was invisible, in
       the Doppler there was a line drawn to a source you could not see. One
       marker in the framework fixes it for all seven, and it is the same
       chevron-at-the-edge idea the field itself uses, which is the point. */
    if (run.def.aim) {
      var a = run.def.aim(run, engine);
      if (a) {
        var ap = run.screen(engine, z, a[0], a[1]);
        var mg = 54;
        if (ap.x < mg || ap.x > W - mg || ap.y < mg || ap.y > H - mg) {
          var ang = Math.atan2(ap.y - H / 2, ap.x - W / 2);
          var ex = W / 2 + Math.cos(ang) * Math.min(
            (W / 2 - mg) / Math.abs(Math.cos(ang) || 1e-4),
            (H / 2 - mg) / Math.abs(Math.sin(ang) || 1e-4));
          var ey = H / 2 + Math.sin(ang) * Math.min(
            (W / 2 - mg) / Math.abs(Math.cos(ang) || 1e-4),
            (H / 2 - mg) / Math.abs(Math.sin(ang) || 1e-4));
          var pl = 0.6 + 0.4 * Math.sin(run.t * 5);
          ctx.save();
          ctx.translate(ex, ey);
          ctx.rotate(ang);
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(' + run.def.tint.join(',') + ',' + (0.45 + 0.4 * pl) + ')';
          ctx.beginPath();
          ctx.moveTo(15, 0); ctx.lineTo(-9, -9); ctx.lineTo(-9, 9);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
    }

    // the last few seconds get loud
    if (run.left < ENDING) {
      var pulse = engine.reduceMotion ? 0.7 : 0.5 + 0.5 * Math.sin(run.t * 12);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3,
        W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, 'rgba(255,120,120,0)');
      vg.addColorStop(1, 'rgba(255,110,110,' + (0.16 * pulse * (1 - run.left / ENDING)) + ')');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /* --------------------------------------------------- drawing a singularity */

  function drawSing(s, ctx, engine, z) {
    var cam = engine.cam, W = engine.W, H = engine.H;
    var sx = (s.x - cam.x) * z + W / 2, sy = (s.y - cam.y) * z + H / 2;
    var r = s.rs * z;
    var vis = Math.max(s.rs * PULL, s.rs * 9) * z;
    if (sx + vis < 0 || sx - vis > W || sy + vis < 0 || sy - vis > H) return;
    var tint = s.def.tint;
    var col = tint[0] + ',' + tint[1] + ',' + tint[2];
    var done = s.done;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.globalCompositeOperation = 'lighter';

    // far out it is just a coloured ember, but it is always SOMETHING — these
    // are the only landmarks in the field besides the middle, and a landmark
    // you cannot see from a distance is not a landmark
    if (r < 1.4) {
      var gr = Math.max(7, vis * 0.6);
      var g0 = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
      g0.addColorStop(0, 'rgba(' + col + ',' + (done ? 0.30 : 0.5) + ')');
      g0.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = g0;
      ctx.fillRect(-gr, -gr, gr * 2, gr * 2);
      ctx.restore();
      return;
    }

    // a ring of its own colour, turning
    var t = engine.t;
    for (var i = 0; i < 5; i++) {
      var f = i / 4;
      var rr = r * (1.6 + f * 2.2);
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.34 * (1 - f * 0.5)) + ')';
      ctx.lineWidth = Math.max(0.8, r * 0.3);
      ctx.beginPath();
      ctx.arc(0, 0, rr, t * (0.5 + i * 0.13) + s.spin, t * (0.5 + i * 0.13) + s.spin + 2.1);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = '#000';
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    var pr = r * 1.11;
    var pg = ctx.createRadialGradient(0, 0, pr * 0.93, 0, 0, pr * 1.2);
    pg.addColorStop(0, 'rgba(' + col + ',0)');
    pg.addColorStop(0.5, 'rgba(' + col + ',0.95)');
    pg.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = pg;
    ctx.fillRect(-pr * 1.3, -pr * 1.3, pr * 2.6, pr * 2.6);

    var hr = r * 6;
    var hg = ctx.createRadialGradient(0, 0, r, 0, 0, hr);
    hg.addColorStop(0, 'rgba(' + col + ',0.14)');
    hg.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = hg;
    ctx.fillRect(-hr, -hr, hr * 2, hr * 2);
    ctx.restore();

    // one you have not been through yet wears its name
    if (!done && z > 0.12) {
      ctx.save();
      ctx.font = '10px "Space Grotesk", ui-sans-serif, sans-serif';
      ctx.letterSpacing = '0.14em';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(' + col + ',0.85)';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 10;
      // just under the outermost arc, and never wandering off down the screen:
      // at close zoom 4.4 disc-radii put the caption 350px below the door,
      // which on an 800px canvas meant the doors were flying round unnamed
      ctx.fillText(s.def.name.toUpperCase(), sx, sy + Math.min(r * 3.2, 96) + 15);
      ctx.restore();
    }
  }

  /** Gravity and swallowing, for all seven at once. */
  function stepSings(list, dt, engine) {
    if (!engine.live || engine.pocket) return null;
    if (engine.singCool > 0) { engine.singCool -= dt; return null; }

    /* A mouse has one of our sentences and you are chasing it.

       This used to `return null` — every one of the twenty doors switched off
       for as long as the chase lasted, which is up to a hundred and ten
       seconds, with nothing on screen saying so. Fly into one and it did
       nothing at all. That is how a door becomes scenery, and it is exactly
       what a tester reported: the pulsar refused him, and a page refresh —
       which quietly ends the chase — "fixed" it.

       The worry behind the old rule was real, though: being dragged off a
       chase you are winning, by a door you flew near, would be the game taking
       the chase away from you. So the pull goes and the door stays. You will
       not be caught by one during a chase, and you can still go through one on
       purpose, because flying into the core of a black hole is not something
       anybody does by accident. */
    var chasing = !!(engine.mouse && engine.mouse.active);

    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var dx = s.x - engine.cat.x, dy = s.y - engine.cat.y;
      var d = Math.hypot(dx, dy) || 1;
      if (d < s.rs) return s;                 // through the horizon, always
      if (chasing) {                          // but no reeling you in mid-chase
        // and say why, once, rather than letting it feel broken
        if (d < s.rs * PULL && engine.onDoorHeldOff) engine.onDoorHeldOff(s);
        continue;
      }
      /* A door you have already been through does not reach as far. You can go
         back — beating your own best is the whole reason the number is kept —
         but it has to be on purpose. Full reach on a visited door meant parking
         anywhere near one put you in a loop of sixty-second pockets. */
      var reach = s.rs * (s.done ? PULL_AGAIN : PULL);
      if (d > reach) continue;
      var k = s.rs / Math.max(d, s.rs);
      var edge = RDF.clamp((reach - d) / (reach * 0.35), 0, 1);
      var acc = PULL_ACC * Math.pow(k, 1.5) * edge;
      engine.cat.vx += (dx / d) * acc * dt;
      engine.cat.vy += (dy / d) * acc * dt;
    }
    return null;
  }

  /* A compass for the doors.

     Twenty singularities are scattered across a galaxy tens of thousands of
     units wide, and a phone at default zoom can see about seven hundred units
     of it. So on a small screen you could fly for a long time without ever
     learning there was anything to fly toward — which is exactly what happened,
     and the doors read as scenery you happened to pass.

     This draws a small chevron at the edge of the screen for the nearest few,
     in the door's own colour, with its distance under it. It is drawn in screen
     space, outside the world transform, so it does not drift with the camera. */
  function drawCompass(list, ctx, engine, z) {
    if (!engine.live || engine.pocket) return;
    var W = engine.W, H = engine.H;
    var pad = Math.max(26, Math.min(46, W * 0.075));
    var top = (engine.reserveTop || engine.hudBottom || 60) + 20;
    var bot = H - (engine.footTop || 28) - 22;
    // and out of the stick's way, or the corner becomes a pile of overlapping
    // circles that all look like controls
    var sh = engine.coarse ? engine.stickHome() : null;
    var sr = engine.coarse ? engine.stickRadius() * 1.9 : 0;

    var near = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var sx = (s.x - engine.cam.x) * z + W / 2;
      var sy = (s.y - engine.cam.y) * z + H / 2;
      // already on screen and legible? then it speaks for itself
      if (sx > -20 && sx < W + 20 && sy > -20 && sy < H + 20) continue;
      var d = Math.hypot(s.x - engine.cat.x, s.y - engine.cat.y);
      near.push({ s: s, d: d, sx: sx, sy: sy });
    }
    if (!near.length) return;
    near.sort(function (a, b) { return a.d - b.d; });
    near = near.slice(0, engine.coarse ? 3 : 4);

    ctx.save();
    for (var j = 0; j < near.length; j++) {
      var n = near[j], t = n.s.def.tint;
      var col = t[0] + ',' + t[1] + ',' + t[2];
      var ang = Math.atan2(n.sy - H / 2, n.sx - W / 2);
      // park it on the rim of the safe box, in the direction of the door
      var cx = W / 2 + Math.cos(ang) * W, cy = H / 2 + Math.sin(ang) * H;
      cx = RDF.clamp(cx, pad, W - pad);
      cy = RDF.clamp(cy, top + pad * 0.5, bot);
      // below the open message, never across it
      var rb = engine.readoutBox;
      if (rb && rb.until > engine.t && cy - 16 < rb.y + rb.h &&
          cy + 16 > rb.y && cx + 26 > rb.x && cx - 26 < rb.x + rb.w) {
        cy = Math.min(bot, rb.y + rb.h + 24);
      }
      if (sh) {
        var ox = cx - sh.x, oy = cy - sh.y, od = Math.hypot(ox, oy);
        if (od < sr) { if (od < 0.5) { ox = 0; oy = -1; od = 1; } cy = sh.y + (oy / od) * sr; }
        if (cy > bot) { cy = bot; cx = Math.min(cx, sh.x - sr * 0.75); }
      }
      // the closer it is the more it insists
      var a = RDF.clamp(1 - n.d / 9000, 0.16, 0.85) * (n.s.done ? 0.5 : 1);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
      g.addColorStop(0, 'rgba(' + col + ',' + (a * 0.55) + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.fill();

      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(7, 0); ctx.lineTo(-4, -5.5); ctx.lineTo(-1.5, 0); ctx.lineTo(-4, 5.5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(' + col + ',' + a + ')';
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = 'rgba(' + col + ',1)';
      ctx.font = '600 9px "Space Grotesk", ui-sans-serif, sans-serif';
      ctx.textAlign = 'center';
      ctx.letterSpacing = '0.08em';
      ctx.fillText(
        (n.d > 1000 ? (n.d / 1000).toFixed(1) + 'k' : Math.round(n.d / 10) * 10) + '',
        cx, cy + 20);
      ctx.letterSpacing = '0px';
      ctx.restore();
    }
    ctx.restore();
  }

  RDF.pockets = {
    ARENA: ARENA, LENGTH: LENGTH, ORIGIN: ORIGIN,
    place: place, enter: enter, leave: leave,
    update: update, draw: draw,
    drawSing: drawSing, drawCompass: drawCompass, stepSings: stepSings
  };
})(window.RDF = window.RDF || {});
