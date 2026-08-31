/* Rainbow Deep Field — the couriers.

   Until now exactly one thing in this field moved under its own will, and it
   was you. Everything else drifted. These are the others: cats in their own
   colours, each carrying one sentence from somewhere in the field to somewhere
   else in it, stopping at comets on the way to read them — which is to say,
   doing what you are doing.

   They are couriers and nothing more. They are NOT other people, the interface
   never suggests they are, and that restraint is deliberate: this whole site
   is built on being straight about what is real, and a cat that implies a
   stranger is online right now would be the first lie in it. What is true is
   what they carry — each one prefers a message a real person actually left,
   newest first, and only falls back to a founding message when there aren't
   enough. So the letters really are being ferried, and they really are ours.

   Loaded after 09-main.js — the filename sorts last. That is fine: every
   module here only registers on RDF, and nothing is constructed until boot(),
   which waits for DOMContentLoaded. */
(function (RDF) {
  'use strict';

  var TAU = Math.PI * 2;
  var COUNT = 9;
  var SPEED = 210;            // world units/sec — a good deal slower than you
  var READ_MIN = 3.0, READ_MAX = 7.0;
  var HOP = 5200;             // how far they'll travel for the next comet
  var MEET_PX = 300;          // screen px at which one notices you
  var HANDOVER = 2.4;         // seconds alongside before it gives you the letter

  /* Nine cats. A coat and a ribbon are one object here, not two lists indexed
     in parallel — they WERE two lists of different lengths under the same
     modulo, so the pale blue cat flew a gold trail and the band underneath her
     called her "the ice one" in gold text. The entire point of naming her by
     her colour is that her colour identifies her, and a cat whose coat and
     trail disagree cannot be identified by either.

     None of the nine is close to the player's cool lavender-white: two
     near-white cats is two cats you cannot tell apart at the distance you
     actually meet one from. The player keeps the classic six-stripe rainbow and
     everybody else flies four stripes in their own key. */
  var CATS = [
    { name: 'ginger', b: '#f0b070', s: '#cc8442', p: '#ffb3a0',
      ribbon: [[255, 226, 140], [255, 176, 74], [255, 122, 92], [230, 130, 120]] },
    { name: 'charcoal', b: '#6f6889', s: '#4d4760', p: '#ff9dc6',
      ribbon: [[214, 150, 255], [255, 138, 224], [230, 140, 200], [180, 158, 255]] },
    { name: 'sage', b: '#cfe0c8', s: '#98b394', p: '#ffc0a8',
      ribbon: [[196, 255, 150], [120, 226, 160], [80, 206, 190], [188, 246, 210]] },
    { name: 'ice', b: '#a8cdec', s: '#7099be', p: '#d6ecff',
      ribbon: [[222, 248, 255], [140, 226, 255], [96, 172, 255], [160, 176, 255]] },
    { name: 'calico', b: '#f2cf9e', s: '#c4844c', p: '#ffa8c0',
      ribbon: [[255, 210, 130], [255, 150, 90], [255, 120, 130], [255, 176, 190]] },
    { name: 'dusk', b: '#4a4368', s: '#2e2947', p: '#b49cff',
      ribbon: [[168, 200, 255], [140, 160, 255], [176, 136, 255], [214, 168, 255]] },
    { name: 'rose', b: '#f2b6cb', s: '#cc8099', p: '#ffe0ea',
      ribbon: [[255, 198, 220], [255, 152, 194], [244, 140, 224], [214, 164, 255]] },
    { name: 'copper', b: '#c9784e', s: '#96522f', p: '#ffb090',
      ribbon: [[255, 196, 150], [242, 138, 96], [214, 100, 110], [255, 168, 140]] },
    { name: 'storm', b: '#8f9aad', s: '#626c80', p: '#ffb0c4',
      ribbon: [[214, 230, 248], [156, 186, 228], [124, 146, 208], [190, 180, 238]] }
  ];

  /* Pixel emotes, 7x7, in the same grid language as the cats.

     Real emoji were the obvious choice and they are the wrong one: the glyph
     comes from whatever emoji font the machine happens to have, so the same
     heart is three different pictures on Windows, a Mac and a phone, and none
     of the three belongs anywhere near a sixteen-pixel cat. These are drawn. */

  /* 9x9, not 7x7. At seven the note and the paw both collapsed into the same
     unreadable white blob — there simply is not room for a shape with two
     parts in it. Two more pixels each way is the difference between a symbol
     and a smudge. */
  var EMOTES = {
    heart: ['.XX...XX.', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.',
            '..XXXXX..', '...XXX...', '....X....', '.........'],
    spark: ['....X....', '....X....', '...XXX...', '...XXX...', 'XXXXXXXXX',
            '...XXX...', '...XXX...', '....X....', '....X....'],
    note:  ['......XXX', '......XXX', '......X.X', '......X..', '......X..',
            '.XXX..X..', 'XXXXX.X..', 'XXXXX....', '.XXX.....'],
    paw:   ['.XX...XX.', '.XX...XX.', '.........', 'XX.....XX', 'XX.....XX',
            '..XXXXX..', '.XXXXXXX.', '.XXXXXXX.', '..XXXXX..']
  };
  var EMOTE_COL = { heart: '#ff8fb4', spark: '#fff0b8', note: '#cbb4ff', paw: '#ffffff' };
  var EMOTE_CACHE = {};

  function emoteSprite(kind) {
    if (EMOTE_CACHE[kind]) return EMOTE_CACHE[kind];
    var pal = { '.': null, X: EMOTE_COL[kind] };
    EMOTE_CACHE[kind] = RDF.art.buildSprite(EMOTES[kind], pal, 4);
    return EMOTE_CACHE[kind];
  }

  /* Her likeness, for the band that shows what she is carrying. Which cat is
     talking should never be a guess. */
  var PORTRAITS = {};
  function portrait(coat) {
    if (!PORTRAITS[coat.name]) {
      PORTRAITS[coat.name] = RDF.art.cat(0, coat).canvas.toDataURL();
    }
    return PORTRAITS[coat.name];
  }

  /* The ribbon colour, lifted until it is safe to set a paragraph in. Some of
     these ribbons are deep reds and violets that are lovely as a two-pixel
     stripe and unreadable as body text. */
  function speech(ribbon) {
    var best = ribbon[0], bl = -1;
    for (var i = 0; i < ribbon.length; i++) {
      var c = ribbon[i], l = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
      if (l > bl) { bl = l; best = c; }
    }
    return [
      Math.round(best[0] + (255 - best[0]) * 0.42),
      Math.round(best[1] + (255 - best[1]) * 0.42),
      Math.round(best[2] + (255 - best[2]) * 0.42)
    ];
  }

  /* ------------------------------------------------------------------ flock */

  function Couriers(world) {
    this.world = world;
    this.list = [];
    this.aurora = { r: 0, g: 0, b: 0, a: 0 };   // what the sky is doing about it
    this.near = null;
    this.onDeliver = null;
    var r = RDF.prng(0xC0FFEE);
    var letters = pickLetters(world, COUNT);
    for (var i = 0; i < COUNT; i++) {
      var seat = world.comets[Math.floor(r() * world.comets.length)];
      this.list.push({
        i: i,
        coat: CATS[i % CATS.length],
        ribbon: CATS[i % CATS.length].ribbon,
        x: seat.x, y: seat.y, vx: 0, vy: 0, dir: r() * TAU,
        trail: [], tail: RDF.art.makeTail(), step: r() * 4,
        letter: letters[i % letters.length],
        target: null, pause: r() * READ_MAX, state: 'read',
        emote: null, hold: 0, greeted: false, blink: 0, blinkIn: 2 + r() * 4,
        ph: r() * TAU
      });
    }
  }

  /* What they carry. Anything a real person left comes first, newest first —
     the couriers should be ferrying this week's actual kindness, not filler.
     Founding messages only make up the shortfall. */
  function pickLetters(world, n) {
    var real = [], seeds = [];
    for (var i = 0; i < world.comets.length; i++) {
      var c = world.comets[i];
      (c.ts ? real : seeds).push(c);
    }
    real.sort(function (a, b) { return b.ts - a.ts; });
    var out = real.slice(0, n);
    var r = RDF.prng(0x1E77E45);
    while (out.length < n && seeds.length) {
      out.push(seeds[Math.floor(r() * seeds.length)]);
    }
    return out.length ? out : world.comets.slice(0, 1);
  }

  /** Re-pick everyone's cargo once the whole field has finished loading. The
      world may have been only partly built when these were created. */
  Couriers.prototype.refill = function () {
    var letters = pickLetters(this.world, this.list.length);
    for (var i = 0; i < this.list.length; i++) {
      var c = this.list[i];
      if (!c.greeted && !c.delivered) c.letter = letters[i % letters.length];
    }
  };

  /** Swap in a fresh letter after a handover, preferring one you haven't read. */
  Couriers.prototype._reletter = function (c, t) {
    var w = this.world, best = null, bt = -1;
    for (var i = 0; i < w.comets.length; i++) {
      var m = w.comets[i];
      if (m === c.letter || m.found) continue;
      var score = (m.ts || 0) + (m.spec.rare ? 1e12 : 0);
      if (score > bt) { bt = score; best = m; }
    }
    c.letter = best || c.letter;
    void t;
  };

  /* ----------------------------------------------------------------- update */

  Couriers.prototype.update = function (dt, engine) {
    var t = engine.t, cam = engine.cam;
    var meetR = MEET_PX / cam.z;
    var nearest = null, nearD = meetR;

    for (var i = 0; i < this.list.length; i++) {
      var c = this.list[i];

      if (c.state === 'read') {
        c.pause -= dt;
        c.vx *= Math.max(0, 1 - dt * 2.4);
        c.vy *= Math.max(0, 1 - dt * 2.4);
        if (c.pause <= 0) { c.target = this._nextComet(c, t); c.state = 'travel'; }
      } else {
        var p = this.world.pos(c.target, t);
        var dx = p.x - c.x, dy = p.y - c.y;
        var d = Math.hypot(dx, dy) || 1;
        if (d < 150) {
          c.state = 'read';
          c.pause = READ_MIN + (READ_MAX - READ_MIN) * frac(c.i * 7.3 + t * 0.11);
          this._emote(c, 'spark', t);
        } else {
          var want = Math.min(1, d / 900);
          c.vx += ((dx / d) * SPEED * want - c.vx) * Math.min(1, dt * 1.6);
          c.vy += ((dy / d) * SPEED * want - c.vy) * Math.min(1, dt * 1.6);
        }
      }

      c.x += c.vx * dt; c.y += c.vy * dt;
      var sp = Math.hypot(c.vx, c.vy);
      if (sp > 2) c.dir = Math.atan2(c.vy, c.vx);
      c.step += (sp / SPEED) * dt * 7;

      c.blinkIn -= dt;
      if (c.blinkIn <= 0) { c.blink = 0.13; c.blinkIn = 2.4 + frac(c.i * 3.1 + t) * 5; }
      if (c.blink > 0) c.blink -= dt;

      if (!engine.reduceMotion) {
        RDF.art.stepTail(c.tail, Math.min(dt, 0.033),
          { x: -c.vx * 0.004, y: -c.vy * 0.004 }, t + c.ph);
      }

      // trail, spaced in world units like the player's
      var last = c.trail[c.trail.length - 1];
      if (!last || Math.hypot(c.x - last.x, c.y - last.y) > 26) {
        c.trail.push({ x: c.x, y: c.y });
        while (c.trail.length > 20) c.trail.shift();
      }
      if (sp < 4 && c.trail.length > 1 && t % 0.7 < dt) c.trail.shift();

      if (c.emote) { c.emote.t += dt; if (c.emote.t > 1.9) c.emote = null; }

      /* ------------------------------------------------------- the encounter */

      var pdx = c.x - engine.cat.x, pdy = c.y - engine.cat.y;
      var pd = Math.hypot(pdx, pdy);
      if (pd < nearD) { nearD = pd; nearest = c; }

      // same rule as discovery: nobody greets you through the intro screen
      if (pd < meetR && engine.live) {
        if (!c.greeted) {
          c.greeted = true;
          this._emote(c, frac(c.i * 11.7) > 0.5 ? 'paw' : 'heart', t);
          RDF.audio && RDF.audio.chime(c.letter.spec, 0.55);
          // she slows to your pace rather than making you chase her
          c.state = 'read';
          c.pause = Math.max(c.pause, 2.2);
          if (this.onGreet) this.onGreet(c);
        }
        // stay alongside and she hands it over
        c.hold += dt;
        if (c.hold >= HANDOVER && !c.delivered) {
          c.delivered = true;
          this._emote(c, 'heart', t);
          if (this.onDeliver) this.onDeliver(c, c.letter);
        }
      } else if (c.greeted && pd > meetR * 1.5) {
        c.greeted = false; c.hold = 0;
        if (this.onPart) this.onPart(c);
        if (c.delivered) { c.delivered = false; this._reletter(c, t); }
      }
    }

    /* The sky answers. Getting near one of them warms the whole field toward
       her colours — the loudest thing in the build, and it lasts four seconds
       and only ever happens when somebody else is beside you. */
    this.near = nearest;
    var tr = { r: 0, g: 0, b: 0, a: 0 };
    if (nearest) {
      var w = RDF.clamp(1 - nearD / meetR, 0, 1);
      var rib = nearest.ribbon;
      var mid = rib[1], hot = rib[2];
      tr.r = (mid[0] + hot[0]) / 2; tr.g = (mid[1] + hot[1]) / 2; tr.b = (mid[2] + hot[2]) / 2;
      tr.a = w * w * (engine.reduceMotion ? 0.5 : 1);
    }
    var au = this.aurora, k = Math.min(1, dt * 2.2);
    au.a += (tr.a - au.a) * k;
    if (tr.a > 0.001) { au.r = tr.r; au.g = tr.g; au.b = tr.b; }
  };

  Couriers.prototype._emote = function (c, kind, t) {
    c.emote = { kind: kind, t: 0 };
    void t;
  };

  Couriers.prototype._nextComet = function (c, t) {
    var w = this.world;
    var cand = w.query(c.x - HOP, c.y - HOP, c.x + HOP, c.y + HOP, this._buf || (this._buf = []));
    if (!cand.length) return c.target || w.comets[0];
    // deterministic pick, varied per courier and per trip
    var pick = cand[Math.floor(frac(c.i * 5.7 + t * 0.37 + c.x * 0.0001) * cand.length)];
    return pick || w.comets[0];
  };

  function frac(x) { var s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); }

  /* ------------------------------------------------------------------- draw */

  /** The sky warming up. Drawn over the nebulae, under everything that matters. */
  Couriers.prototype.drawAurora = function (ctx, W, H, t) {
    var au = this.aurora;
    if (au.a < 0.004) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var col = au.r + ',' + au.g + ',' + au.b;
    for (var i = 0; i < 2; i++) {
      var px = W * (i ? 0.82 : 0.18) + Math.sin(t * 0.31 + i * 2.1) * W * 0.1;
      var py = H * (i ? 0.24 : 0.78) + Math.cos(t * 0.26 + i) * H * 0.1;
      var r = Math.max(W, H) * (0.62 + 0.1 * Math.sin(t * 0.4 + i));
      var g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(' + col + ',' + (au.a * 0.16) + ')');
      g.addColorStop(0.5, 'rgba(' + col + ',' + (au.a * 0.05) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
    ctx.restore();
  };

  Couriers.prototype.draw = function (ctx, engine, z) {
    var cam = engine.cam, W = engine.W, H = engine.H, t = engine.t;
    var tiny = z < 0.06;
    for (var i = 0; i < this.list.length; i++) {
      var c = this.list[i];
      var sx = (c.x - cam.x) * z + W / 2, sy = (c.y - cam.y) * z + H / 2;
      var m = tiny ? 40 : 340;
      if (sx < -m || sx > W + m || sy < -m || sy > H + m) continue;
      if (tiny) { this._dot(ctx, c, sx, sy); continue; }
      this._trail(ctx, c, cam, z, W, H);
      this._body(ctx, c, sx, sy, z, engine);
    }
  };

  /** Pulled all the way back they are still worth seeing: four moving lights
      in a field where nothing else moves. */
  Couriers.prototype._dot = function (ctx, c, sx, sy) {
    var col = c.ribbon[1];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.95)';
    ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    ctx.restore();
  };

  Couriers.prototype._trail = function (ctx, c, cam, z, W, H) {
    var tr = c.trail;
    if (tr.length < 3) return;
    var RB = c.ribbon;
    var wpx = Math.max(2.4, Math.min(18, 15 * Math.pow(z / 0.52, 0.35)));
    var sw = wpx / RB.length;
    var head = tr[tr.length - 1], tail = tr[0];
    var hx = (head.x - cam.x) * z + W / 2, hy = (head.y - cam.y) * z + H / 2;
    var tx = (tail.x - cam.x) * z + W / 2, ty = (tail.y - cam.y) * z + H / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var b = 0; b < RB.length; b++) {
      var col = RB[b];
      var off = (b - (RB.length - 1) / 2) * sw;
      ctx.beginPath();
      for (var i = 0; i < tr.length; i++) {
        var q = tr[i];
        var px = (q.x - cam.x) * z + W / 2, py = (q.y - cam.y) * z + H / 2;
        var r = tr[Math.min(i + 1, tr.length - 1)], l = tr[Math.max(i - 1, 0)];
        var ax = r.x - l.x, ay = r.y - l.y;
        var mm = Math.hypot(ax, ay) || 1;
        var nx = -ay / mm, ny = ax / mm;
        if (i === 0) ctx.moveTo(px + nx * off, py + ny * off);
        else ctx.lineTo(px + nx * off, py + ny * off);
      }
      var g = ctx.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
      g.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.85)');
      ctx.strokeStyle = g;
      ctx.lineWidth = sw * 1.06;
      ctx.stroke();
    }
    ctx.restore();
  };

  Couriers.prototype._body = function (ctx, c, sx, sy, z, engine) {
    var spr = RDF.art.cat(Math.floor(c.step), c.coat);
    var cell = spr.scale;
    var scale = Math.max(1, Math.min(3.1, 2.35 * Math.pow(z / 0.52, 0.3))) * (engine.W < 640 ? 0.8 : 1);
    var dw = spr.canvas.width / cell * scale;
    var dh = spr.canvas.height / cell * scale;

    ctx.save();
    ctx.translate(sx, sy);
    var flip = Math.cos(c.dir) < -0.05;
    ctx.rotate(Math.sin(c.dir) * 0.28 * (flip ? -1 : 1));
    if (flip) ctx.scale(-1, 1);

    ctx.save();
    ctx.translate(-dw * 0.42, -dh / 2);
    if (!engine.reduceMotion) RDF.art.drawTail(ctx, c.tail, scale, 1);
    ctx.restore();

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr.canvas, -dw * 0.42, -dh / 2, dw, dh);

    var EYE = RDF.art.EYE;
    var ox = -dw * 0.42, oy = -dh / 2;
    if (c.blink > 0) {
      ctx.fillStyle = c.coat.b;
      ctx.fillRect(ox + EYE.x * scale, oy + EYE.y * scale, scale * 2, scale);
      ctx.fillStyle = RDF.art.PAL.o;
      ctx.fillRect(ox + EYE.x * scale, oy + (EYE.y + 0.4) * scale, scale * 2, scale * 0.45);
    } else if (c.greeted) {
      // she looks back at you
      var la = Math.atan2(engine.cat.y - c.y, engine.cat.x - c.x) - c.dir;
      var lx = RDF.clamp(Math.cos(la) * 0.85, -0.85, 0.85) * (flip ? -1 : 1);
      var ly = RDF.clamp(Math.sin(la) * 0.7, -0.7, 0.7);
      ctx.fillStyle = RDF.art.PAL.w;
      ctx.fillRect(ox + EYE.x * scale, oy + EYE.y * scale, scale * 2, scale);
      ctx.fillStyle = RDF.art.PAL.k;
      ctx.fillRect(ox + (EYE.x + 0.6 + lx * 0.5) * scale, oy + (EYE.y + ly * 0.25) * scale, scale, scale);
    }

    ctx.beginPath();
    ctx.arc(dw * 0.30, -dh * 0.10, dh * 0.36, 0, TAU);
    ctx.strokeStyle = 'rgba(190,225,255,0.34)';
    ctx.lineWidth = Math.max(0.8, scale * 0.42);
    ctx.stroke();
    ctx.restore();

    if (c.emote) this._drawEmote(ctx, c, sx, sy, dh);
    if (c.greeted) this._speaking(ctx, c, sx, sy, dh, engine);
  };

  /* The cat and the words have to be visibly the same event.

     The band at the top says what she is carrying, but the band is at the top
     and she is wherever she happens to be, so on the first build people read
     the sentence without ever connecting it to the cat they were flying next
     to. She now sits in a halo of her own ribbon colour and sends a thin
     stream of motes up toward the band — screen space, deliberately, because
     the point is the line between her and those words on that screen. */
  Couriers.prototype._speaking = function (ctx, c, sx, sy, dh, engine) {
    /* The glow takes the ribbon raw. speech() lifts a colour toward white so it
       is safe to set a paragraph in, and a paragraph is exactly what a halo is
       not — lifted, all nine of them glow the same pale grey and identify
       nobody. */
    var raw = c.ribbon[1];
    var rgb = raw[0] + ',' + raw[1] + ',' + raw[2];
    var t = engine.t;
    var warm = RDF.clamp(c.hold / 0.45, 0, 1);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    var r = dh * (1.5 + 0.12 * Math.sin(t * 3.1));
    var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, 'rgba(' + rgb + ',' + (0.30 * warm) + ')');
    g.addColorStop(0.45, 'rgba(' + rgb + ',' + (0.10 * warm) + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);

    if (!engine.reduceMotion) {
      // motes rising from her toward the band, drifting as they climb
      var bandY = 110;
      var rise = sy - dh * 0.7 - bandY;
      if (rise > 40) {
        // Each mote gets a soft halo as well as a core. A bare two-pixel square
        // simply vanishes when the thing behind it is a comet at full
        // brightness, which is most of the time out here.
        for (var i = 0; i < 9; i++) {
          var k = ((t * 0.4 + i / 9) % 1);
          var y = sy - dh * 0.7 - rise * k;
          var x = sx + Math.sin(k * 5.2 + i * 1.7) * (14 + k * 30);
          var a = Math.sin(k * Math.PI) * warm;
          var s = 3.4 - k * 1.4;
          var hr = s * 2.6;
          var hg = ctx.createRadialGradient(x, y, 0, x, y, hr);
          hg.addColorStop(0, 'rgba(' + rgb + ',' + (a * 0.5) + ')');
          hg.addColorStop(1, 'rgba(' + rgb + ',0)');
          ctx.fillStyle = hg;
          ctx.fillRect(x - hr, y - hr, hr * 2, hr * 2);
          ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.55) + ')';
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      }
    }
    ctx.restore();
  };

  Couriers.prototype._drawEmote = function (ctx, c, sx, sy, dh) {
    var e = c.emote;
    var spr = emoteSprite(e.kind);
    var k = e.t / 1.9;
    var pop = k < 0.16 ? RDF.easeOutCubic(k / 0.16) : 1;
    var a = k > 0.62 ? 1 - (k - 0.62) / 0.38 : 1;
    var s = (dh * 0.52) * pop;
    ctx.save();
    ctx.globalAlpha = RDF.clamp(a, 0, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr.canvas, sx - s / 2, sy - dh * 0.78 - k * dh * 0.7 - s / 2, s, s);
    ctx.restore();
  };

  /* What she is carrying is rendered in the DOM, not on the canvas, and that is
     a fix rather than a preference. A courier's whole job is to stop at comets
     and read them, so the overwhelmingly common case is that she is beside a
     comet whose own readout is already unfurling under it — two blocks of serif
     text drawn at the same place, over each other, both unreadable. Out here in
     its own band it can never collide with anything. */

  Couriers.COUNT = COUNT;
  Couriers.portrait = portrait;
  Couriers.speech = speech;
  RDF.Couriers = Couriers;
})(window.RDF = window.RDF || {});
