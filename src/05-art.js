/* Rainbow Deep Field — sprite + backdrop painting.
   The explorer is an original character. It is deliberately NOT Nyan Cat:
   no pop-tart, different silhouette, different palette. Same spirit, our cat.

   She is drawn in three pieces so that she can actually move:
     · a body frame from a small set of pixel grids (leg cycle + a tucked pose)
     · a procedural tail, simulated, so it whips on turns instead of being printed
     · overlays for the blink and for pupils that follow whatever she is nearest
   Everything is cached; the per-frame cost is one drawImage plus a few rects. */
(function (RDF) {
  'use strict';

  var PAL = {
    '.': null,
    o: '#241a2e',      // outline
    b: '#d7d1e4',      // fur
    s: '#a79dbe',      // shade
    p: '#ff9dc6',      // ear + nose pink
    k: '#241a2e',      // pupil
    w: '#ffffff',      // eye white
    y: '#ffd98a'       // collar light
  };

  // 16 x 12, in profile, facing right. The tail is deliberately absent from the
  // grid — it is simulated separately so it can lag and flick.
  var BODY = [
    '................',
    '...........o..o.',
    '..........opoopo',
    '.........obbbbbo',
    '....obbbbbbbbbbo',
    '.obbbbbbbbwkbbpo',
    'obbbbsbbbbbbbbbo',
    'obbbbsbbbbbbbbbo',
    '.obbbbbbbbbbbbo.',
    '................',   // legs, filled per frame
    '................',   // paws, filled per frame
    '................'
  ];

  // Three visible legs (the far pair is hidden in profile). Only the paw row
  // moves; at this size that is enough to read as a gallop.
  var LEGS = '..obo.obo.obo...';
  var PAWS = [
    '...o...o...o....',   // neutral
    '....o.o.....o...',   // reaching
    '..o.....o.o.....'    // pushing off
  ];
  var CYCLE = [0, 1, 0, 2];          // the order they play in

  // Boost: legs swept back, paws trailing. The squash comes from the transform,
  // not from a repainted head — repainting the head loses the character.
  var TUCK_LEGS = '..oo..oo..oo....';
  var TUCK_PAWS = '.o...o...o......';

  var SCALE = 6;
  var GW = 16, GH = 12;

  // Where things are, in grid cells, so the engine can put overlays on them.
  var EYE = { x: 10, y: 5, px: 11 };        // white at x, pupil at px
  var TAIL_ROOT = { x: 0.9, y: 6.4 };

  function paintGrid(g, grid, pal, scale) {
    for (var y = 0; y < grid.length; y++) {
      var row = grid[y];
      for (var x = 0; x < row.length; x++) {
        var col = pal[row[x]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }

  function buildSprite(grid, pal, scale) {
    var h = grid.length, w = grid[0].length;
    var c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale;
    paintGrid(c.getContext('2d'), grid, pal, scale);
    return { canvas: c, w: w, h: h, scale: scale };
  }

  /* Frames are cached per coat. The couriers are the same cat in somebody
     else's colours, so only the three fur entries in the palette change and
     everything else — outline, eye, the pixels themselves — stays shared. */

  var FRAMES = {};
  function frames(coat) {
    var key = coat ? coat.name : '_';
    if (FRAMES[key]) return FRAMES[key];
    var pal = PAL;
    if (coat) {
      pal = {};
      for (var k in PAL) if (Object.prototype.hasOwnProperty.call(PAL, k)) pal[k] = PAL[k];
      pal.b = coat.b; pal.s = coat.s; pal.p = coat.p;
    }
    var set = { run: [], tuck: null };
    for (var i = 0; i < PAWS.length; i++) {
      var g = BODY.slice();
      g[9] = LEGS; g[10] = PAWS[i];
      set.run.push(buildSprite(g, pal, SCALE));
    }
    var tg = BODY.slice();
    tg[9] = TUCK_LEGS; tg[10] = TUCK_PAWS;
    set.tuck = buildSprite(tg, pal, SCALE);
    FRAMES[key] = set;
    return set;
  }

  function cat(which, coat) {
    var F = frames(coat);
    if (which === 'tuck') return F.tuck;
    if (typeof which === 'number') return F.run[CYCLE[which % CYCLE.length]];
    return F.run[0];
  }

  /* -------------------------------------------------------------- the tail */

  /* A springy chain hanging off the back of her.

     A plain verlet rope was the obvious thing and it was wrong: with only a
     distance constraint holding it together it hangs dead straight, which reads
     as a stick rather than a tail. What a tail actually does is hold a curl and
     resist being straightened, so each link here is sprung toward a rest angle
     that curves further round than the last. Her acceleration bends the whole
     rest pose backwards, so it streams out flat under thrust and springs back
     into the curl the moment she stops — the cheapest secondary animation there
     is, and the one that does the most work in selling that she is alive. */

  var SEGS = 6;
  var SEG_LEN = 1.12;
  var BASE_A = -2.62;      // up and back, in sprite space (+x forward, +y down)
  var CURL = 0.26;         // extra radians of curve per link
  var MAX_BEND = 0.82;     // never fully straight — a straight tail is a stick

  function makeTail() {
    var pts = [];
    for (var i = 0; i < SEGS; i++) pts.push({ x: TAIL_ROOT.x, y: TAIL_ROOT.y, vx: 0, vy: 0 });
    return { pts: pts };
  }

  /**
   * @param tail  from makeTail
   * @param dt    seconds
   * @param pull  {x,y} in sprite cells — the negated acceleration
   * @param t     clock, for the idle sway
   */
  function stepTail(tail, dt, pull, t) {
    var pts = tail.pts;
    var k = Math.min(1, dt * 26);      // how hard it is pulled toward the pose
    var damp = Math.max(0, 1 - dt * 9);

    // The pose itself: a curl, swayed slowly, and bent toward whatever is
    // dragging on her. Strong acceleration straightens it out behind.
    var pmag = Math.hypot(pull.x, pull.y);
    var bend = Math.min(pmag * 0.5, MAX_BEND);
    var pullA = pmag > 0.001 ? Math.atan2(pull.y, pull.x) : BASE_A;
    var sway = Math.sin(t * 1.9) * 0.13 + Math.sin(t * 0.7) * 0.07;

    var ax = TAIL_ROOT.x, ay = TAIL_ROOT.y;
    var ang = angLerp(BASE_A + sway, pullA, bend);
    pts[0].x = ax; pts[0].y = ay;

    for (var i = 1; i < pts.length; i++) {
      ang += CURL * (1 - bend * 0.85);
      ax += Math.cos(ang) * SEG_LEN;
      ay += Math.sin(ang) * SEG_LEN;
      var p = pts[i];
      // spring toward the pose, with enough momentum left in it to overshoot
      p.vx = (p.vx + (ax - p.x) * k) * damp;
      p.vy = (p.vy + (ay - p.y) * k) * damp;
      p.x += p.vx; p.y += p.vy;
    }
  }

  function angLerp(a, b, w) {
    var d = RDF.angDiff(b, a);
    return a + d * w;
  }

  /** Draw the tail in sprite-local space. The caller has already applied the
      sprite's translate/rotate/flip, so this works in grid cells. */
  function drawTail(ctx, tail, cell, alpha) {
    var pts = tail.pts;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // outline underneath, fur over the top, both as one smoothed curve so the
    // links never show as a row of sausages
    for (var pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? PAL.o : PAL.b;
      for (var i = 1; i < pts.length; i++) {
        var taper = 1 - (i - 1) / (pts.length - 1) * 0.62;
        ctx.lineWidth = cell * (pass === 0 ? 2.6 : 1.55) * taper;
        var a = pts[i - 1], b = pts[i];
        var prev = pts[i - 2] || a;
        ctx.beginPath();
        ctx.moveTo(a.x * cell, a.y * cell);
        ctx.quadraticCurveTo(
          (a.x + (a.x - prev.x) * 0.28) * cell, (a.y + (a.y - prev.y) * 0.28) * cell,
          b.x * cell, b.y * cell);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------- backdrop */

  // Deep-field backdrop: a handful of enormous, very faint clouds. Drawn in world
  // space so they parallax naturally with everything else.
  var CLOUDS = null, CLOUD_R = 0;
  function clouds(R) {
    if (CLOUDS && CLOUD_R === R) return CLOUDS;
    CLOUD_R = R;
    var r = RDF.prng(0xC10D5);
    CLOUDS = [];
    // Cool nebulae only. Warm ones turn the whole field muddy brown behind the
    // comets, and the comets are the thing that should be carrying the colour.
    var TINTS = [
      [88, 132, 255], [140, 106, 255], [72, 186, 220],
      [190, 104, 220], [64, 148, 190], [122, 92, 235]
    ];
    for (var i = 0; i < 13; i++) {
      var a = r() * Math.PI * 2;
      var d = Math.pow(r(), 0.65) * R * 1.15;
      CLOUDS.push({
        x: Math.cos(a) * d,
        y: Math.sin(a) * d * 0.94,
        r: R * (0.16 + r() * 0.5),
        a: 0.030 + r() * 0.045,
        rgb: TINTS[Math.floor(r() * TINTS.length)],
        // a second, tighter knot inside each cloud so they have structure
        // instead of being thirteen identical soft circles
        kx: (r() - 0.5) * 0.5,
        ky: (r() - 0.5) * 0.5,
        kr: 0.30 + r() * 0.22
      });
    }
    return CLOUDS;
  }

  // The galaxy's own stars. Not messages — a galaxy has stars in it, and without
  // them the arms don't read as arms when you pull all the way back. Placed with
  // the same spiral maths as the comets so the structure agrees with itself.
  var DUST = null, DUST_R = 0;
  function galaxyDust(R) {
    if (DUST && DUST_R === R) return DUST;
    DUST_R = R;
    var r = RDF.prng(0xD057);
    var N = 5200;
    DUST = new Float32Array(N * 3);
    for (var i = 0; i < N; i++) {
      var p = RDF.galaxyPoint(r, R);
      DUST[i * 3] = p.x;
      DUST[i * 3 + 1] = p.y;
      DUST[i * 3 + 2] = 0.09 + r() * 0.40;
    }
    return DUST;
  }

  // Three parallax layers of fixed stars, tiled infinitely.
  var LAYERS = null;
  var TILE = 1400;
  function starLayers() {
    if (LAYERS) return LAYERS;
    LAYERS = [];
    var cfg = [
      { n: 170, par: 0.18, size: 1.0, a: 0.42 },
      { n: 120, par: 0.42, size: 1.4, a: 0.60 },
      { n: 60, par: 0.78, size: 2.0, a: 0.85 }
    ];
    for (var l = 0; l < cfg.length; l++) {
      var r = RDF.prng(0x51A25 + l * 7919);
      var pts = [];
      for (var i = 0; i < cfg[l].n; i++) {
        pts.push({
          x: r() * TILE,
          y: r() * TILE,
          s: cfg[l].size * (0.5 + r()),
          a: cfg[l].a * (0.4 + r() * 0.6),
          tw: r() * Math.PI * 2,
          hue: r() < 0.22 ? r() : -1
        });
      }
      LAYERS.push({ pts: pts, par: cfg[l].par });
    }
    return LAYERS;
  }

  RDF.art = {
    cat: cat, clouds: clouds, starLayers: starLayers, galaxyDust: galaxyDust,
    TILE: TILE, buildSprite: buildSprite,
    makeTail: makeTail, stepTail: stepTail, drawTail: drawTail,
    PAL: PAL, EYE: EYE, CELL: SCALE, GW: GW, GH: GH
  };
})(window.RDF = window.RDF || {});
