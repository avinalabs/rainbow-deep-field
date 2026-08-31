/* Rainbow Deep Field — the thing at the middle.

   Every galaxy this size has a supermassive black hole at its centre, so this
   one does too, sitting at the origin the arms already wind out from. It is the
   only fixed landmark in the field: the bulge glow around it is visible from
   the far halo, which makes it the one place you can always steer for when you
   have flown out past everything and lost your bearings.

   Fall in and it puts you down somewhere else in the field, well inside the
   arms where the messages are. That is the point of it. Getting lost out in the
   empty halo used to mean a long dull flight back; now the way home is a
   landmark you can see, and the trip is three seconds and a good noise.

   It is drawn the way the real ones photograph: a black disc, a bright thin
   photon ring, and an accretion disc that is noticeably brighter on the side
   turning toward you. That asymmetry is relativistic beaming and it is the
   single detail that makes the picture read as a black hole rather than a
   donut, which is why it is here in a field that already cares about getting
   its spectroscopy right. */
(function (RDF) {
  'use strict';

  var TAU = Math.PI * 2;

  var HORIZON = 0.011;      // event horizon, as a fraction of the galaxy radius
  /* Six horizons, and the number is not a taste call.

     The innermost a comet can ever be placed is Rmin, which is 6.4 horizons out
     — so a reach of six is the largest radius that touches NO message. At the
     26 it started on, 141 of the 349 comets sat inside the pull and the hole
     spent its time hauling you off things you were trying to read, in the
     densest and best part of the whole field. The rule is worth keeping if the
     geometry ever changes: gravity must not reach a rainbow. */
  var PULL = 6;             // gravity reaches this many horizons out
  var PULL_ACC = 7000;      // strength scale, world units/sec²
  var PULL_FALLOFF = 1.5;   // exponent on (horizon / distance)
  var PULL_EDGE = 0.35;     // outer fraction of the reach the pull fades in over
  var TILT = 0.30;          // how far the accretion disc is tipped from edge-on
  var COOLDOWN = 2.6;       // seconds before it will take you again

  function Hole(world) {
    this.world = world;
    this.x = 0; this.y = 0;
    this.rs = world.R * HORIZON;
    this.flash = 0;         // 0..1, the transit bloom
    this.cool = 0;
    this.grip = 0;             // 0..1, how hard it currently has you
    this.onTransit = null;
    this.trips = 0;
  }

  /** Pull, and swallow. Returns true on the frame it takes you. */
  Hole.prototype.update = function (dt, engine) {
    if (this.cool > 0) this.cool -= dt;
    this.flash *= Math.pow(0.02, dt);
    if (this.flash < 0.002) this.flash = 0;

    if (!engine.live) return false;      // the intro should not be dragged anywhere

    var cat = engine.cat;
    var dx = this.x - cat.x, dy = this.y - cat.y;
    var d = Math.hypot(dx, dy) || 1;
    var reach = this.rs * PULL;
    this.grip = 0;
    if (d > reach) return false;

    /* Falloff of 1.5 rather than a true inverse square, and a big coefficient.

       Real gravity was tried and it does not survive contact with this engine:
       with no input, glide bleeds velocity at 0.85/sec, so an inverse square
       that has already fallen to a fiftieth of its strength by nine horizons
       out reaches a terminal velocity of about twenty units a second against
       that drag — a cruise is a thousand. It read as nothing at all. A gentler
       exponent keeps the pull legible across the whole approach, which is the
       part you are supposed to feel.

       Still escapable, deliberately. Full throttle accelerates at roughly
       9900/sec², which beats the pull out to about two horizons — so you can
       always turn around if you commit early, and past that you are going
       through. The middle of the galaxy is the densest, best part of the field;
       making it a trap you cannot leave would be the wrong lesson. */
    var k = this.rs / Math.max(d, this.rs);
    // faded in across the outer third, so the edge is a tug and not a trapdoor
    var edge = RDF.clamp((reach - d) / (reach * PULL_EDGE), 0, 1);
    var acc = PULL_ACC * Math.pow(k, PULL_FALLOFF) * edge;
    this.grip = RDF.clamp(1 - (d - this.rs) / (reach - this.rs), 0, 1) * edge;
    cat.vx += (dx / d) * acc * dt;
    cat.vy += (dy / d) * acc * dt;

    if (d < this.rs && this.cool <= 0) {
      this.take(engine);
      return true;
    }
    return false;
  };

  /** Put them down somewhere worth arriving: well inside the arms, never in
      the empty halo, and never so close to the centre that they fall straight
      back in. */
  Hole.prototype.take = function (engine) {
    var R = this.world.R;
    var a = Math.random() * TAU;
    var rad = R * (0.28 + Math.random() * 0.55);
    var x = Math.cos(a) * rad, y = Math.sin(a) * rad * 0.94;

    engine.warp(x, y);
    engine.cam.zt = Math.max(engine.cam.zt, RDF.Engine.Z_DEF * 0.85);
    engine.focused = null;
    engine.reading = null;
    engine._wasReading = null;
    engine._readUntil = 0;
    engine._fading.length = 0;
    engine.shake = Math.max(engine.shake, 9);
    this.flash = 1;
    this.cool = COOLDOWN;
    this.trips++;
    if (RDF.audio && RDF.audio.fall) RDF.audio.fall();
    if (this.onTransit) this.onTransit(this.trips);
  };

  /* ------------------------------------------------------------------ draw */

  Hole.prototype.draw = function (ctx, engine, z) {
    var cam = engine.cam, W = engine.W, H = engine.H, t = engine.t;
    var sx = (this.x - cam.x) * z + W / 2;
    var sy = (this.y - cam.y) * z + H / 2;
    var r = this.rs * z;
    // cull on what is DRAWN, not on what pulls — the disc is wider than the reach
    var vis = Math.max(this.rs * PULL, this.rs * 10) * z;
    if (sx + vis < 0 || sx - vis > W || sy + vis < 0 || sy - vis > H) return;

    // Too far out to be more than a dark grain, but it must still be THERE —
    // the whole point is that you can see the middle from anywhere.
    if (r < 1.2) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var gr = Math.max(6, vis * 0.5);
      var g0 = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
      g0.addColorStop(0, 'rgba(255,214,170,0.30)');
      g0.addColorStop(1, 'rgba(255,180,120,0)');
      ctx.fillStyle = g0;
      ctx.fillRect(sx - gr, sy - gr, gr * 2, gr * 2);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(sx, sy);

    /* The accretion disc, in three passes, and the order is the whole trick.

       Drawn in one pass behind the shadow it reads as a flat target with a ball
       sitting on it. What makes the picture three-dimensional is that a disc
       tipped toward you passes IN FRONT of the shadow along its near edge while
       its far edge is lensed up over the top — so: the whole ellipse goes down
       first, the shadow covers the middle of it, and then the near half is laid
       back over the shadow's lower edge. Same arcs, three passes, and suddenly
       the thing has a front and a back.

       Bands of the field's own spectrum, and the half turning toward you burns
       brighter than the half turning away. That asymmetry is relativistic
       beaming, and it is the detail that says black hole rather than donut. */

    var spin = t * 0.42;
    var rings = 13;
    var self = this;

    function disc(halfOnly, gain) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.scale(1, TILT);
      if (halfOnly) {
        // clip to the near side, in the disc's own squashed space
        ctx.beginPath();
        ctx.rect(-r * 9, 0, r * 18, r * 9 / TILT);
        ctx.clip();
      }
      for (var i = 0; i < rings; i++) {
        var f = i / (rings - 1);
        var rr = r * (1.7 + f * 3.1);
        var col = RDF.spectrum.lutColor(0.08 + f * 0.72);
        for (var s = 0; s < 2; s++) {
          var a0 = spin + (s ? Math.PI : 0);
          var beam = s ? 0.25 : 1;
          ctx.strokeStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' +
            (0.30 * gain * beam * (1 - f * 0.4)) + ')';
          ctx.lineWidth = Math.max(0.9, r * 0.44);
          ctx.beginPath();
          ctx.arc(0, 0, rr, a0, a0 + Math.PI);
          ctx.stroke();
        }
      }
      ctx.restore();
      void self;
    }

    disc(false, 1);                     // the far side, and the lensed top

    // the shadow — everything behind it stops here
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = '#000';
    ctx.fill();

    // photon ring: light that went round the back and came out again. Thin, on
    // purpose — fat, it stops being a ring and becomes a glowing tyre.
    ctx.globalCompositeOperation = 'lighter';
    var pr = r * 1.09;
    var pg = ctx.createRadialGradient(0, 0, pr * 0.95, 0, 0, pr * 1.16);
    pg.addColorStop(0, 'rgba(255,236,196,0)');
    pg.addColorStop(0.5, 'rgba(255,242,214,0.9)');
    pg.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.fillStyle = pg;
    ctx.fillRect(-pr * 1.3, -pr * 1.3, pr * 2.6, pr * 2.6);

    // brighter, because this pass lands on pure black and it is the pass that
    // sells the perspective — it must not be a whisper
    disc(true, 1.9);                    // and the near side, over the top of it

    // and the haze it sits in
    var hr = r * 7;
    var hg = ctx.createRadialGradient(0, 0, r, 0, 0, hr);
    hg.addColorStop(0, 'rgba(255,206,150,0.16)');
    hg.addColorStop(0.4, 'rgba(255,170,110,0.05)');
    hg.addColorStop(1, 'rgba(255,150,90,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(-hr, -hr, hr * 2, hr * 2);

    ctx.restore();
  };

  /** The white-out, drawn over everything on the way through. */
  Hole.prototype.drawFlash = function (ctx, engine) {
    if (this.flash < 0.004) return;
    var W = engine.W, H = engine.H;
    var f = this.flash;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(255,252,244,' + (0.92 * f) + ')');
    g.addColorStop(0.45, 'rgba(214,226,255,' + (0.5 * f) + ')');
    g.addColorStop(1, 'rgba(120,150,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };

  Hole.HORIZON = HORIZON;
  RDF.Hole = Hole;
})(window.RDF = window.RDF || {});
