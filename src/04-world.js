/* Rainbow Deep Field — the galaxy itself.
   Positions are a pure function of a comet's own hash, never of its index, so
   adding a million new messages never moves anybody's existing star. */
(function (RDF) {
  'use strict';

  var TAU = Math.PI * 2;

  // The field grows as people fill it. Radius is set from the population so the
  // density on screen stays the same whether there are two hundred messages out
  // here or two hundred thousand — and so the galaxy visibly gets bigger.
  var SPACING = 980;      // ~world units of elbow room per comet
  var R_FLOOR = 4200;
  var ARMS = 2;
  var TURNS = 1.15;       // half-turns of sweep from core to rim
  var ARM_SPREAD = 0.46;  // angular scatter within an arm
  var HALO_FRAC = 0.10;   // share flung outside the arms, so wandering pays off
  var CELL = 1500;        // spatial hash cell size
  var WOBBLE_R = 120;     // how far a comet drifts from its anchor point

  function World() {
    this.comets = [];
    this.byId = {};
    this.grid = {};
    this.R = R_FLOOR;
    this.Rmin = R_FLOOR * 0.07;
  }

  /** Size the galaxy to its population before placing anything in it. */
  World.prototype.setScale = function (n) {
    this.R = Math.max(R_FLOOR, SPACING * Math.sqrt(Math.max(n, 1)));
    this.Rmin = this.R * 0.07;
    return this;
  };

  World.prototype.key = function (cx, cy) { return cx + ':' + cy; };

  /**
   * One point in a two-armed barred spiral: a dense bulge, two trailing arms,
   * a thin halo. Shared by the comets and by the galaxy's background stars so
   * the two agree about where the arms are.
   * @param r a seeded prng — the caller controls determinism
   */
  function galaxyPoint(r, R) {
    var Rmin = R * 0.07;
    var roll = r(), u = r();
    var rad, theta;

    if (roll < 0.17) {
      // central bulge — the bright heart of the thing
      var g = (r() + r() + r()) / 3;
      rad = Rmin + g * R * 0.20;
      theta = r() * TAU;
    } else if (roll < 1 - HALO_FRAC) {
      // arms — exponent above 1 crowds them inward, which is what a galaxy does
      rad = Rmin + Math.pow(u, 1.25) * (R - Rmin);
      var arm = Math.floor(r() * ARMS);
      var s = (r() + r() + r() - 1.5) / 1.5;
      theta = arm * (TAU / ARMS) + (rad / R) * TURNS * Math.PI
            + s * ARM_SPREAD * (1 - 0.4 * (rad / R));
    } else {
      rad = Rmin + Math.sqrt(r()) * R * 1.05;
      theta = r() * TAU;
    }
    return { rad: rad, theta: theta, x: Math.cos(theta) * rad, y: Math.sin(theta) * rad * 0.94 };
  }

  World.prototype.place = function (comet) {
    var r = RDF.prng(comet.spec.hash ^ 0x5bf03635);
    var p = galaxyPoint(r, this.R);

    comet.rad = p.rad;
    comet.x = p.x;
    comet.y = p.y;                                        // slight ellipse reads as tilt
    comet.dir = p.theta + Math.PI / 2 + comet.spec.spin;  // tails sweep along the arm
    comet.ph = r() * TAU;
    comet.ph2 = r() * TAU;
    comet.wob = WOBBLE_R * (0.4 + r());
    comet.halo = p.rad > this.R * 0.98;
    return comet;
  };

  World.prototype.makeComet = function (rec) {
    var spec = RDF.spectrum.analyse(rec.text);
    var comet = {
      id: rec.id,
      text: rec.text,
      ts: rec.ts || 0,
      lights: rec.lights || 0,
      seed: rec.seed || false,
      mine: rec.mine || false,
      spec: spec,
      focus: 0,        // 0..1 unfurl amount
      seen: false
    };
    return this.place(comet);
  };

  World.prototype.add = function (rec) {
    if (this.byId[rec.id]) return this.byId[rec.id];
    var c = this.makeComet(rec);
    this.comets.push(c);
    this.byId[c.id] = c;
    var cx = Math.floor(c.x / CELL), cy = Math.floor(c.y / CELL);
    var k = this.key(cx, cy);
    (this.grid[k] || (this.grid[k] = [])).push(c);
    return c;
  };

  World.prototype.addAll = function (recs) {
    for (var i = 0; i < recs.length; i++) this.add(recs[i]);
    return this;
  };

  /** Live position, including the slow drift that keeps the field breathing. */
  World.prototype.pos = function (c, t) {
    var w = c.wob;
    return {
      x: c.x + Math.cos(t * 0.06 + c.ph) * w + Math.cos(t * 0.017 + c.ph2) * w * 0.6,
      y: c.y + Math.sin(t * 0.048 + c.ph * 1.3) * w + Math.sin(t * 0.021 + c.ph2) * w * 0.6
    };
  };

  /** Everything whose cell overlaps the rectangle, plus a margin for drift + tails. */
  World.prototype.query = function (x0, y0, x1, y1, out) {
    out = out || [];
    out.length = 0;
    var m = WOBBLE_R * 2 + 900;
    var cx0 = Math.floor((x0 - m) / CELL), cx1 = Math.floor((x1 + m) / CELL);
    var cy0 = Math.floor((y0 - m) / CELL), cy1 = Math.floor((y1 + m) / CELL);
    // Guard against pathological queries when zoomed all the way out
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 40000) return this.comets;
    for (var cy = cy0; cy <= cy1; cy++) {
      for (var cx = cx0; cx <= cx1; cx++) {
        var b = this.grid[this.key(cx, cy)];
        if (b) for (var i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  };

  World.prototype.nearest = function (x, y, maxDist, t) {
    var best = null, bd = maxDist * maxDist;
    // reuses one buffer — this runs every frame and must not allocate
    var cand = this.query(x - maxDist, y - maxDist, x + maxDist, y + maxDist,
      this._nbuf || (this._nbuf = []));
    for (var i = 0; i < cand.length; i++) {
      var p = this.pos(cand[i], t);
      var dx = p.x - x, dy = p.y - y;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = cand[i]; }
    }
    return best;
  };

  World.SPACING = SPACING;
  RDF.World = World;
  RDF.galaxyPoint = galaxyPoint;
})(window.RDF = window.RDF || {});
