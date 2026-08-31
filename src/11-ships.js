/* Rainbow Deep Field — traffic.

   Every so often something crosses the view a long way off: a ship, running
   lights on, going somewhere else entirely. It never stops, you cannot catch
   it, and nothing you do changes its course.

   That is the point. This field is a very large empty place with a couple of
   hundred strangers' sentences in it, and the one thing it did not have was any
   sense that the emptiness was inhabited. A shooting star does that for a real
   sky in one second flat — you see it, you feel briefly lucky, and it is gone
   before you can point at it. These do the same job and cost the same: nothing
   to learn, nothing to miss, no button.

   They live in parallax screen space rather than world space, like the star
   layers do. A ship is not somewhere you could fly to; it is something passing
   between you and the far stars, and pinning it to a world coordinate would
   invite people to chase a thing that is deliberately uncatchable. */
(function (RDF) {
  'use strict';

  var TAU = Math.PI * 2;

  /* Silhouettes. Small on purpose — these read at ten or twelve pixels across,
     and anything more detailed becomes a smudge at that size while costing the
     same. `.` is empty, `h` hull, `l` a lit window, `e` the engine. */
  var HULLS = [
    [ // a long hauler
      '..............',
      '....hhhhhhh...',
      '.ehhhhllhhhh..',
      '.ehhhhhhhhhhh.',
      '..hhhhhhhhh...',
      '..............'
    ],
    [ // something with a bubble canopy
      '..............',
      '.....hhhh.....',
      '...hhllllhh...',
      '.ehhhhhhhhhh..',
      '..hh......hh..',
      '..............'
    ],
    [ // a blunt little tug
      '..............',
      '.....hhhhhh...',
      '..eehhllhhhh..',
      '..eehhhhhhhh..',
      '.....hhhhhh...',
      '..............'
    ],
    [ // a long-range thing with a spine
      '..............',
      '..hh..........',
      '.ehhhhhhhhhl..',
      '.ehhhhhhhhhl..',
      '..hh..........',
      '..............'
    ]
  ];

  /* Seeded, not Math.random.

     Nothing else in this project rolls a live die — the whole field is a pure
     function of its messages, so two people opening the same link see the same
     sky and the trailer renders the same film twice. Traffic is only scenery,
     but there is no reason for it to be the one thing that breaks that, and a
     seeded stream costs exactly the same. */
  function Ships(seed) {
    this.rnd = RDF.prng(seed || 0x51175);
    this.list = [];
    /* The first one turns up early — somebody who spends two minutes here
       should still see one — and then they settle to a much longer interval. */
    this.next = 14 + this.rnd() * 16;
    this.seen = 0;
  }

  Ships.prototype.spawn = function (engine) {
    var W = engine.W, H = engine.H;
    var r = this.rnd;

    // depth: far ships are smaller, dimmer, slower across the glass
    var depth = 0.25 + r() * 0.75;
    var scale = 0.9 + depth * 1.5;
    var par = 0.10 + depth * 0.30;          // matches the star layers' range

    // come in from a side, at a shallow angle, going somewhere
    var fromLeft = r() < 0.5;
    var speed = (14 + depth * 46) * (0.7 + r() * 0.6);   // screen px/sec
    var drift = (r() - 0.5) * 0.5;                       // radians off horizontal
    var ang = (fromLeft ? 0 : Math.PI) + drift;

    var margin = 90;
    var s = {
      x: fromLeft ? -margin : W + margin,
      y: H * (0.08 + r() * 0.84),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      ang: ang,
      /* Only the drift, not the heading. `flip` already turns a right-to-left
         ship around, so rotating by the full angle as well stood the
         right-to-left ones on their tails at sixty degrees. */
      tilt: drift * 0.5,
      flip: !fromLeft,
      scale: scale,
      par: par,
      alpha: 0.30 + depth * 0.5,
      hull: HULLS[(r() * HULLS.length) | 0],
      hue: r(),
      blink: r() * TAU,
      life: 0,
      // where the camera was when it appeared, so parallax is relative to that
      cx: engine.cam.x, cy: engine.cam.y
    };
    this.list.push(s);
    this.seen++;
    return s;
  };

  Ships.prototype.update = function (dt, engine) {
    // not inside a pocket — that is not this sky — and not if motion is unwanted
    if (engine.pocket || engine.reduceMotion) return;

    this.next -= dt;
    if (this.next <= 0) {
      // never more than two at once: three is a fleet, and a fleet is an event
      if (this.list.length < 2) this.spawn(engine);
      this.next = 26 + this.rnd() * 54;
    }

    var W = engine.W, H = engine.H;
    for (var i = this.list.length - 1; i >= 0; i--) {
      var s = this.list[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life += dt;
      var z = engine.zEff || engine.cam.z;
      var px = s.x - (engine.cam.x - s.cx) * z * s.par;
      var py = s.y - (engine.cam.y - s.cy) * z * s.par;
      // gone when it is properly off the glass, allowing for a long pan
      if (px < -400 || px > W + 400 || py < -400 || py > H + 400 || s.life > 240) {
        this.list.splice(i, 1);
      }
    }
  };

  /** Screen space, so this is drawn outside the world transform. */
  Ships.prototype.draw = function (ctx, engine) {
    if (!this.list.length) return;
    var W = engine.W, H = engine.H;
    var z = engine.zEff || engine.cam.z;

    for (var i = 0; i < this.list.length; i++) {
      var s = this.list[i];
      var px = s.x - (engine.cam.x - s.cx) * z * s.par;
      var py = s.y - (engine.cam.y - s.cy) * z * s.par;
      if (px < -120 || px > W + 120 || py < -120 || py > H + 120) continue;

      // fade in and out at the edges so nothing ever pops
      var edge = Math.min(1, Math.min(px + 90, W + 90 - px) / 110);
      var a = s.alpha * RDF.clamp(edge, 0, 1) * RDF.clamp(s.life / 1.4, 0, 1);
      if (a <= 0.01) continue;

      var g = s.hull;
      var cell = s.scale;
      var wpx = g[0].length * cell, hpx = g.length * cell;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(s.tilt);                 // a hint of heading, not a full rotate
      if (s.flip) ctx.scale(-1, 1);
      ctx.translate(-wpx / 2, -hpx / 2);

      // the engine's wash, behind it
      var col = RDF.spectrum.lutColor(s.hue);
      ctx.globalCompositeOperation = 'lighter';
      var flick = 0.75 + 0.25 * Math.sin(s.life * 9 + s.blink);
      var tl = ctx.createLinearGradient(-wpx * 1.8, hpx / 2, wpx * 0.28, hpx / 2);
      var cs = col[0] + ',' + col[1] + ',' + col[2];
      tl.addColorStop(0, 'rgba(' + cs + ',0)');
      tl.addColorStop(0.72, 'rgba(' + cs + ',' + (a * 0.14 * flick).toFixed(3) + ')');
      tl.addColorStop(1, 'rgba(' + cs + ',' + (a * 0.42 * flick).toFixed(3) + ')');
      ctx.fillStyle = tl;
      // narrow, and only as tall as the engine block itself
      ctx.fillRect(-wpx * 1.8, hpx * 0.40, wpx * 2.08, hpx * 0.20);

      // the hull itself
      ctx.globalCompositeOperation = 'source-over';
      for (var row = 0; row < g.length; row++) {
        var line = g[row];
        for (var cx2 = 0; cx2 < line.length; cx2++) {
          var ch = line[cx2];
          if (ch === '.') continue;
          if (ch === 'h') ctx.fillStyle = 'rgba(150,156,186,' + (a * 0.92).toFixed(3) + ')';
          else if (ch === 'l') ctx.fillStyle = 'rgba(255,244,206,' + (a * flick).toFixed(3) + ')';
          else ctx.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' +
            (a * flick).toFixed(3) + ')';
          ctx.fillRect(cx2 * cell, row * cell, cell + 0.5, cell + 0.5);
        }
      }

      // a navigation light, because every real thing in the sky has one
      var beat = (s.life * 0.9) % 1;
      if (beat < 0.14) {
        ctx.globalCompositeOperation = 'lighter';
        var lg = ctx.createRadialGradient(wpx * 0.5, hpx * 0.3, 0, wpx * 0.5, hpx * 0.3, cell * 4);
        lg.addColorStop(0, 'rgba(255,120,130,' + (a * 0.9) + ')');
        lg.addColorStop(1, 'rgba(255,120,130,0)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(wpx * 0.5, hpx * 0.3, cell * 4, 0, TAU);
        ctx.fill();
      }

      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  RDF.Ships = Ships;
})(window.RDF = window.RDF || {});
