/* Rainbow Deep Field — the one that got away.

   A cat chasing a mouse is the only piece of this that was ever inevitable.

   It turns up occasionally, takes a sentence nobody has read yet, and runs with
   it. While it has the message the message is genuinely gone from the field —
   you cannot drift up to that rainbow and read it, because a mouse has it. Catch
   the mouse and you get it back, and it counts as a find like any other.

   That framing is doing real work. A timed chase with a clock on it is a
   different kind of game from a field you drift around reading strangers'
   kindness in, and bolting one onto the other usually produces something that
   is neither. Making the prize a message — the thing this whole place is about
   — is what keeps it the same game.

   It is also the only thing here that uses the black hole as anything other
   than scenery: cornered, the mouse dives through the middle of the galaxy and
   comes out somewhere else, and you have to follow it in. */
(function (RDF) {
  'use strict';

  var TAU = Math.PI * 2;

  /* Faster than your cruise (1000) and far slower than your boost (2750). That
     gap is the game: cruising, you never gain on it at all, so the throttle is
     not optional — and at 2.75x you overshoot every time it breaks, because
     glide bleeds sideways velocity slowly and that is exactly what a break turn
     punishes. Boost to close, come off it to turn, boost again. Catching this
     thing is the flight model's exam. */
  var SPEED = 1850;         // world units/sec
  var PANIC = 4200;         // it is already running flat out by this distance
  var JUKE_AT = 560;        // a hard break turn once you are this close
  var JUKE_FOR = 0.55;      // seconds it commits to the break
  var JUKE_COOL = 1.1;
  var TURN = 3.0;           // rad/sec — it out-turns you, which is how it survives
  var JINK = 0.9;           // how hard it weaves
  var CATCH = 95;           // world units. Touch it and it is yours
  var GIVE_UP = 110;        // seconds before it gets bored and drops the letter
  var TIRE = 0.24;          // how much of its speed a long chase costs it
  var DIVE_NEAR = 2200;     // it will run for the hole if you are this close
  var COOL = 2.2;           // seconds after a dive before it can dive again

  var GREY = {
    '.': null,
    o: '#241a2e',
    m: '#b9b3c6',
    s: '#8e879e',
    p: '#ffa8c4',
    k: '#241a2e'
  };

  // 16 x 12, facing right, tail simulated like the cat's
  var BODY = [
    '................',
    '................',
    '......oo........',
    '.....ommo.......',
    '....ommmmo......',
    '...ommmmmmoo....',
    '..ommmmmmmmmoo..',
    '.ommmmmmmmmkmmpo',
    '.ommmmmmmmmmmmo.',
    '..ommmmmmmmmmo..',
    '...o.oo..oo.o...',
    '................'
  ];
  var SCARED = [
    '................',
    '................',
    '.....oo.........',
    '....ommo........',
    '...ommmmo.......',
    '..ommmmmmoo.....',
    '..ommmmmmmmmoo..',
    '.ommmmmmmmmkmmpo',
    '.ommmmmmmmmmmmo.',
    '..ommmmmmmmmmo..',
    '..oo..oo..oo....',
    '................'
  ];

  var SPR = null;
  function sprite(scared) {
    if (!SPR) {
      SPR = {
        calm: RDF.art.buildSprite(BODY, GREY, 6),
        run: RDF.art.buildSprite(SCARED, GREY, 6)
      };
    }
    return scared ? SPR.run : SPR.calm;
  }

  function Mouse(world, hole) {
    this.world = world;
    this.hole = hole;
    this.active = false;
    this.letter = null;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.dir = 0;
    this.trail = [];
    this.tail = RDF.art.makeTail();
    this.step = 0;
    this.t0 = 0;
    this.elapsed = 0;
    this.diveCool = 0;
    this.juke = 0; this.jukeCool = 0; this.jukeDir = 0;
    this.flash = 0;
    this.onStart = null;
    this.onCatch = null;
    this.onLost = null;
    this.onDive = null;
  }

  /** Take a message nobody has read and run. */
  Mouse.prototype.start = function (engine) {
    if (this.active) return false;
    var w = this.world;

    /* Near enough that you watch it happen, far enough that it is a chase.
       Taking the very nearest unread message put it on top of you and the whole
       thing was over in under a second — a theft you see from across the way is
       a chase; a theft in your lap is a formality. */
    var NEAR = 900, FAR = 2600;
    var best = null, bd = Infinity, fallback = null, fd = Infinity;
    for (var i = 0; i < w.comets.length; i++) {
      var c = w.comets[i];
      if (c.found || c.taken) continue;
      var d = Math.hypot(c.x - engine.cat.x, c.y - engine.cat.y);
      if (d < fd) { fd = d; fallback = c; }
      if (d < NEAR || d > FAR) continue;
      if (d < bd) { bd = d; best = c; }
    }
    // out in a thin part of the field there may be nothing in the sweet spot;
    // better a slightly awkward theft than no chase at all
    best = best || fallback;
    if (!best) return false;

    var p = w.pos(best, engine.t);
    this.letter = best;
    best.taken = 1;
    this.x = p.x; this.y = p.y;
    var away = Math.atan2(p.y - engine.cat.y, p.x - engine.cat.x);
    this.dir = away;
    this.vx = Math.cos(away) * SPEED;
    this.vy = Math.sin(away) * SPEED;
    this.trail.length = 0;
    this.active = true;
    this.t0 = engine.t;
    this.elapsed = 0;
    this.diveCool = 0;
    this.juke = 0; this.jukeCool = 0;
    if (RDF.audio && RDF.audio.squeak) RDF.audio.squeak();
    if (this.onStart) this.onStart(this);
    return true;
  };

  Mouse.prototype.stop = function (caught, engine) {
    if (!this.active) return;
    this.active = false;
    if (this.letter) this.letter.taken = 0;
    var letter = this.letter;
    this.letter = null;
    if (caught) { if (this.onCatch) this.onCatch(this.elapsed, letter, engine); }
    else if (this.onLost) this.onLost(letter);
  };

  Mouse.prototype.update = function (dt, engine) {
    if (!this.active) return;
    /* A pocket is a different place. The mouse cannot be chased from inside one,
       so the clock is held rather than run down while you are in there —
       otherwise a singularity on your route costs you the message. */
    if (engine.pocket) return;

    /* Wall time, not simulation time.

       The frame delta this whole engine runs on is capped at 50ms so that a
       stutter cannot teleport anybody across the field. That cap is right for
       physics and wrong for a stopwatch: on a phone dropping below 20fps the
       chase clock ran slow in exact proportion to the dropped frames, so a
       tester watching it during a laggy chase reported that it "wasn't
       changing". It was — at about forty per cent of real speed.

       A number on screen counting seconds has to count seconds, and this one is
       also a personal best that would otherwise reward a slow device. */
    var rdt = engine.realDt;
    if (!(rdt >= 0) || rdt > 0.5) rdt = dt;      // film harness, or a huge stall
    this.elapsed += rdt;
    if (this.diveCool > 0) this.diveCool -= dt;
    this.flash *= Math.pow(0.05, dt);

    var cat = engine.cat;
    var dx = this.x - cat.x, dy = this.y - cat.y;
    var d = Math.hypot(dx, dy) || 1;

    if (d < CATCH) { this.stop(true, engine); return; }
    if (this.elapsed > GIVE_UP) { this.stop(false, engine); return; }

    /* Where it wants to be: away from you, weaving, and — if you are close and
       the middle of the galaxy is not far — straight down the hole. Running for
       the hole is the whole character of the thing. A mouse that only ran in a
       straight line would be a race, and you would win every time or never. */
    var want;
    var hole = this.hole;
    var hd = hole ? Math.hypot(this.x - hole.x, this.y - hole.y) : Infinity;
    var diving = hole && this.diveCool <= 0 && d < DIVE_NEAR && hd < this.world.R * 0.75;

    if (diving) {
      want = Math.atan2(hole.y - this.y, hole.x - this.x);
      if (hd < hole.rs * 1.2) {
        // through, and out the other side somewhere far from you
        var a = Math.random() * TAU;
        var rad = this.world.R * (0.3 + Math.random() * 0.5);
        this.x = Math.cos(a) * rad; this.y = Math.sin(a) * rad * 0.94;
        this.trail.length = 0;
        this.diveCool = COOL;
        this.flash = 1;
        hole.flash = Math.max(hole.flash, 0.55);
        if (RDF.audio && RDF.audio.squeak) RDF.audio.squeak();
        if (this.onDive) this.onDive(this);
        return;
      }
    } else {
      var flee = Math.atan2(dy, dx);
      var panic = RDF.clamp(1 - (d - CATCH) / PANIC, 0, 1);

      /* The break turn, which is the whole reason this is catchable but not
         trivial. A smooth sine weave is predictable and a boosting cat simply
         drives through it; what actually beats 2.75x is committing hard across
         the pursuer's line at the last moment and letting their own momentum
         carry them past. Glide bleeds sideways velocity slowly by design — that
         is what makes your turns feel good — and it is exactly what the mouse
         exploits here. */
      if (this.juke > 0) this.juke -= dt;
      if (this.jukeCool > 0) this.jukeCool -= dt;
      var closing = engine.cat.vx * (-dx) + engine.cat.vy * (-dy) > 0;
      if (this.juke <= 0 && this.jukeCool <= 0 && d < JUKE_AT && closing) {
        var side = (dx * engine.cat.vy - dy * engine.cat.vx) > 0 ? 1 : -1;
        this.jukeDir = Math.atan2(engine.cat.vy, engine.cat.vx) + side * Math.PI / 2;
        this.juke = JUKE_FOR;
        this.jukeCool = JUKE_COOL + JUKE_FOR;
        if (RDF.audio && RDF.audio.squeak) RDF.audio.squeak();
      }
      want = this.juke > 0
        ? this.jukeDir
        : flee + Math.sin(engine.t * 3.1 + this.x * 0.0007) * JINK * panic;
      // and it will not run out of the galaxy altogether
      var rr = Math.hypot(this.x, this.y);
      if (rr > this.world.R * 1.05) {
        var home = Math.atan2(-this.y, -this.x);
        want = home + (want - home) * 0.25;
      }
    }

    var diff = ((want - this.dir + Math.PI * 3) % TAU) - Math.PI;
    var turn = TURN * (this.juke > 0 ? 2.4 : 1);   // it snaps into a break
    this.dir += RDF.clamp(diff, -turn * dt, turn * dt);

    // flat out well before you are on top of it, not at the last moment, and a
    // scamper on the way out of a break so the break actually buys it something
    var scamper = this.juke > 0 ? 1.16 : 1;
    // and it tires, so a long chase always converges rather than going forever
    var tired = 1 - TIRE * RDF.clamp(this.elapsed / 75, 0, 1);
    var sp = SPEED * scamper * tired *
      (diving ? 1.18 : (0.6 + 0.4 * RDF.clamp(1 - (d - CATCH) / PANIC, 0, 1)));
    this.vx += (Math.cos(this.dir) * sp - this.vx) * Math.min(1, dt * 3.2);
    this.vy += (Math.sin(this.dir) * sp - this.vy) * Math.min(1, dt * 3.2);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.step += (Math.hypot(this.vx, this.vy) / SPEED) * dt * 12;

    if (!engine.reduceMotion) {
      RDF.art.stepTail(this.tail, Math.min(dt, 0.033),
        { x: -this.vx * 0.0035, y: -this.vy * 0.0035 }, engine.t * 1.4);
    }

    var last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(this.x - last.x, this.y - last.y) > 30) {
      this.trail.push({ x: this.x, y: this.y });
      while (this.trail.length > 16) this.trail.shift();
    }
  };

  /* ------------------------------------------------------------------ draw */

  Mouse.prototype.draw = function (ctx, engine, z) {
    if (!this.active) return;
    var cam = engine.cam, W = engine.W, H = engine.H;
    var sx = (this.x - cam.x) * z + W / 2, sy = (this.y - cam.y) * z + H / 2;

    // Off screen it becomes an arrow at the edge. Losing sight of the thing you
    // are chasing, with a clock running, is the single most annoying thing a
    // chase can do to you.
    var m = 46;
    if (sx < -m || sx > W + m || sy < -m || sy > H + m) {
      this._marker(ctx, engine, sx, sy);
      return;
    }

    var spec = this.letter && this.letter.spec;
    // the stolen light, streaming off it
    if (this.trail.length > 2 && spec) {
      var bands = spec.bands;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var wpx = Math.max(2, Math.min(13, 11 * Math.pow(z / 0.52, 0.35)));
      var sw = wpx / bands.length;
      var head = this.trail[this.trail.length - 1], tail = this.trail[0];
      var hx = (head.x - cam.x) * z + W / 2, hy = (head.y - cam.y) * z + H / 2;
      var tx = (tail.x - cam.x) * z + W / 2, ty = (tail.y - cam.y) * z + H / 2;
      for (var b = 0; b < bands.length; b++) {
        var col = bands[b].rgb;
        var off = (b - (bands.length - 1) / 2) * sw;
        ctx.beginPath();
        for (var i = 0; i < this.trail.length; i++) {
          var q = this.trail[i];
          var px = (q.x - cam.x) * z + W / 2, py = (q.y - cam.y) * z + H / 2;
          var r = this.trail[Math.min(i + 1, this.trail.length - 1)];
          var l = this.trail[Math.max(i - 1, 0)];
          var ax = r.x - l.x, ay = r.y - l.y;
          var mm = Math.hypot(ax, ay) || 1;
          if (i === 0) ctx.moveTo(px - ay / mm * off, py + ax / mm * off);
          else ctx.lineTo(px - ay / mm * off, py + ax / mm * off);
        }
        var g = ctx.createLinearGradient(tx, ty, hx, hy);
        g.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
        g.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.8)');
        ctx.strokeStyle = g;
        ctx.lineWidth = sw * 1.06;
        ctx.stroke();
      }
      ctx.restore();
    }

    var cd = Math.hypot(this.x - engine.cat.x, this.y - engine.cat.y);
    var scared = cd < PANIC * 0.6;
    var spr = sprite(scared);
    var scale = Math.max(0.9, Math.min(2.6, 2 * Math.pow(z / 0.52, 0.3))) * (W < 640 ? 0.85 : 1);
    var dw = spr.canvas.width / spr.scale * scale;
    var dh = spr.canvas.height / spr.scale * scale;

    /* A red ring, so the thing you are chasing is identifiable the moment it
       comes on screen. Grey mouse on a black sky, at a distance, over a field
       of coloured comets, is genuinely hard to pick out — and it is the one
       object here you are ever asked to find in a hurry. */
    var ring = dh * 0.95;
    var rbeat = (engine.t * 3.4 % 1) < 0.55 ? 1 : 0.35;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var rg = ctx.createRadialGradient(sx, sy, ring * 0.25, sx, sy, ring);
    rg.addColorStop(0, 'rgba(255,50,60,' + (0.30 * rbeat) + ')');
    rg.addColorStop(1, 'rgba(255,50,60,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(sx, sy, ring, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,92,102,' + (0.35 + 0.4 * rbeat) + ')';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(sx, sy, ring * 0.72, 0, TAU); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(sx, sy);
    var flip = Math.cos(this.dir) < -0.05;
    ctx.rotate(Math.sin(this.dir) * 0.26 * (flip ? -1 : 1));
    if (flip) ctx.scale(-1, 1);
    // scurrying bob
    ctx.translate(0, Math.sin(this.step * 1.7) * scale * 0.5);
    ctx.save();
    ctx.translate(-dw * 0.42, -dh / 2);
    if (!engine.reduceMotion) RDF.art.drawTail(ctx, this.tail, scale, 1);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr.canvas, -dw * 0.42, -dh / 2, dw, dh);
    ctx.restore();

    if (this.flash > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var fr = dh * 3 * this.flash;
      var fg = ctx.createRadialGradient(sx, sy, 0, sx, sy, fr);
      fg.addColorStop(0, 'rgba(230,240,255,' + (0.5 * this.flash) + ')');
      fg.addColorStop(1, 'rgba(180,200,255,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(sx - fr, sy - fr, fr * 2, fr * 2);
      ctx.restore();
    }
  };

  /* Off screen, it is an arrow — and an arrow on its own is not enough.

     A direction tells you which way to point and nothing about whether you are
     gaining. That matters most immediately after a dive, when it has come out
     up to eighty percent of a galaxy away and the only honest thing to do is
     say so; without a number you are flying at a triangle with no idea whether
     the chase is still alive. So the marker carries the distance, in screens,
     which is a unit you can feel because it is literally how many of these you
     would have to cross. It counts down as you close, and that is the whole
     point — it is the only feedback you get while the thing is out of sight. */
  Mouse.prototype._marker = function (ctx, engine, sx, sy) {
    var W = engine.W, H = engine.H;
    var ang = Math.atan2(sy - H / 2, sx - W / 2);
    var m = 62;
    var rx = (W / 2 - m) / Math.abs(Math.cos(ang) || 1e-4);
    var ry = (H / 2 - m) / Math.abs(Math.sin(ang) || 1e-4);
    var r = Math.min(rx, ry);
    var ex = W / 2 + Math.cos(ang) * r, ey = H / 2 + Math.sin(ang) * r;

    var world = Math.hypot(this.x - engine.cat.x, this.y - engine.cat.y);
    var screens = world * (engine.zEff || engine.cam.z) / W;
    var near = RDF.clamp(1 - screens / 4, 0, 1);
    /* Blinking, not breathing. A sine wave reads as ambient — the same slow
       glow every other pointer in this place has — and this marker was drawn in
       the same pale cream as all of them, so a mouse running off with your
       sentence looked exactly like a helpful suggestion. Reported from a phone:
       "hard to know what is happening."

       So: red, and a hard on/off blink that nothing else here does. It is the
       only urgent thing this place ever asks of you and it should be the only
       red thing on the screen. */
    var beat = engine.t * (2.4 + near * 2.2);
    var blink = (beat % 1) < 0.55 ? 1 : 0.28;
    var pulse = 0.55 + 0.45 * Math.sin(engine.t * (4 + near * 5));

    ctx.save();
    // the arrow, pointing the way, growing as you close
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(ang);
    ctx.globalCompositeOperation = 'lighter';
    var s = 1.15 + near * 0.85;
    // a red wash behind it, so it carries on a bright frame too
    var hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 34 * s);
    hg.addColorStop(0, 'rgba(255,50,60,' + (0.5 * blink) + ')');
    hg.addColorStop(1, 'rgba(255,50,60,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, 0, 34 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,86,96,' + (0.45 + 0.55 * blink) + ')';
    ctx.beginPath();
    ctx.moveTo(16 * s, 0); ctx.lineTo(-9 * s, -9 * s); ctx.lineTo(-9 * s, 9 * s);
    ctx.closePath();
    ctx.fill();
    // a pale core so the shape stays crisp against its own glow
    ctx.fillStyle = 'rgba(255,214,214,' + (0.35 + 0.5 * blink) + ')';
    ctx.beginPath();
    ctx.moveTo(11 * s, 0); ctx.lineTo(-4.5 * s, -5 * s); ctx.lineTo(-4.5 * s, 5 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // and how far, in screens, counting down
    var lx = RDF.clamp(ex - Math.cos(ang) * 46, 68, W - 68);
    var ly = RDF.clamp(ey - Math.sin(ang) * 38, 24, H - 20);
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '10px "Space Grotesk", ui-sans-serif, sans-serif';
    ctx.letterSpacing = '0.1em';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,138,144,' + (0.72 + 0.28 * blink) + ')';
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 10;
    ctx.fillText(screens < 0.15 ? 'RIGHT THERE'
      : (screens < 10 ? screens.toFixed(1) : Math.round(screens)) + ' SCREENS',
      lx, ly);
    ctx.letterSpacing = '0px';
    ctx.restore();
  };

  Mouse.SPEED = SPEED;
  Mouse.CATCH = CATCH;
  Mouse.GIVE_UP = GIVE_UP;
  RDF.Mouse = Mouse;
})(window.RDF = window.RDF || {});
