/* Rainbow Deep Field — camera, input, and the draw loop. */
(function (RDF) {
  'use strict';

  var TAU = Math.PI * 2;
  var Z_MIN = 0.0055, Z_MAX = 1.7, Z_DEF = 0.52;
  var DOOR_NEAR = 5200;      // how close an unvisited door has to be to be worth saying
  var SCREEN_SPEED = 520;      // px/sec of apparent motion, so it feels equal at every zoom
  var FAST_AFTER = 2.0;        // seconds flat out before she visibly lights up
  var READ_ZOOM = 0.17;        // below this you are too far out to read anything

  /* ---------------------------------------------------------------- flight

     Two flight models, live-switchable, because how a thing feels to fly is not
     something anybody can judge from a description.

       glide — the original: you point, she goes there. Momentum and a throttle
               that spools up have been added underneath, and sideways velocity
               now bleeds off slower than forward velocity, so changing your mind
               mid-flight carves an arc instead of a corner.

       pilot — you steer a heading and she carries her own momentum. Turning is
               rate-limited and gets wider the faster you go, so cutting a tight
               line around a comet is a thing you can be good at.

     Both share one throttle: hold and it spools to cruise, keep holding and it
     goes to full. Shift or space is the instant version. */

  var BOOST_MUL = 2.75;        // top speed as a multiple of cruise
  var BOOST_HOLD = 1.05;       // seconds of held input before the throttle opens
  var BOOST_UP = 1 / 0.55, BOOST_DOWN = 1 / 0.4;
  var BOOST_BRAKE = 1 / 0.16;  // throttle release when a message catches you

  var GLIDE = { along: 3.6, perp: 1.45, coast: 0.85, brake: 3.2 };
  var PILOT = { turn: 3.5, turnBoost: 2.05, thrust: 2.4, drag: 0.82 };

  /* ---------------------------------------------------------------- reading

     The field is not evenly spaced and it should not be — the bulge is dense
     because a galaxy's bulge is dense. But density plus travel speed was
     strobing the messages.

     Measured before this existed: in the bulge, the median comet's nearest
     neighbour sits 298 units away and one in ten sits 68 units away, while the
     read radius is 404 and cruise covers 1000 units a second. The median
     message therefore held focus for 400ms — and the unfurl takes 400ms to
     reach nine tenths opacity. Every message finished appearing at the exact
     moment it began to leave, and under boost it never got past two thirds.

     So focus is sticky now. It is harder to leave a message than to arrive at
     one, a nearby rival has to be clearly nearer to steal it, nothing can steal
     it at all for the first stretch, and hard thrust stops you picking anything
     up — boost becomes travel and cruising becomes browsing. */

  var READ_R = 210;            // acquire radius, px at zoom 1
  var READ_HOLD = 1.7;         // you have to get this much further out to drop it
  var READ_SLOW = 0.72;        // travel speed while a message is open

  /* And the readout does not slam shut behind you.

     Chasing "how long is it the nearest comet" turned out to be chasing the
     wrong number, because it is bounded by geometry: at any speed worth
     travelling you cross a 400-unit radius in well under a second, and widening
     that radius until the numbers look good just means the words hang around
     while their comet is off the side of the screen.

     What matters is how long the sentence is legible. So losing focus starts a
     grace period instead of a fade — the message stays up, whole, for a beat
     after you have gone past, then furls. You always get a readable moment even
     at speed, and if you want longer you stop, which is the correct way to ask
     for longer. */
  var READ_GRACE = 1.15;       // seconds the words stay up after you leave
  var READ_STEAL = 0.6;        // a rival must be this much closer to take over
  var READ_DWELL = 0.9;        // seconds before anything is allowed to take over
  var READ_UNREAD = 0.72;      // one you haven't read counts as this much nearer
  var READ_NARROW = 0.55;      // how much full throttle shrinks the acquire radius

  var CONST_Z = 0.20;          // your constellation fades in below this zoom
  var PATH_CAP = 400;          // lines drawn between your most recent finds
  var MILESTONES = [1, 5, 25, 100, 250, 500];

  function Engine(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.dpr = 1;
    this.W = 0; this.H = 0;

    this.cam = { x: 0, y: 0, z: Z_DEF, zt: Z_DEF };
    this.zEff = Z_DEF;         // what actually gets drawn — boost widens the view
    this.cat = {
      x: 0, y: 0, vx: 0, vy: 0, dir: 0, trail: [], boost: 0,
      turn: 0, bank: 0, step: 0, blink: 0, blinkIn: 3,
      tail: RDF.art.makeTail(), ax: 0, ay: 0
    };
    this.t = 0;
    this.paused = false;
    this.autopilot = null;     // {x, y, cb}
    this.focused = null;        // the comet you are beside
    this.reading = null;        // the comet whose words are on screen
    this._wasReading = null;
    this._readUntil = 0;
    this.hover = null;
    this.pointer = { down: false, x: 0, y: 0, active: false, movedAt: 0, heldFor: 0 };
    this.keys = {};
    this.buf = [];
    this._fading = [];

    /* Touch steering. A thumb pressed into the middle of a phone screen covers
       the thing it is steering toward, which is the whole problem with
       fly-to-where-you-touch on a small screen. So on a touch device the bottom
       corner becomes a stick: it appears under your thumb wherever you put it
       down inside that corner, and the rest of the glass is left alone for
       looking at. */
    this.stick = { on: false, x: 0, y: 0, mag: 0, bx: 0, by: 0, kx: 0, ky: 0, id: -1 };
    this.coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
      || ('ontouchstart' in window && !window.matchMedia('(pointer: fine)').matches);
    this._pending = null;
    this.readDim = 0;
    this.lock = null;
    this.idle = 0;

    this.flight = 'glide';
    this.throttle = 0;         // 0..1, what the input is asking for
    this.boost = 0;            // 0..1, smoothed, what the world reacts to
    this.held = 0;             // seconds held flat out
    this.fast = 0;             // 0..1, the sustained-speed tell
    this.shake = 0;
    this.parts = [];           // particle pool
    this.streaks = [];
    this.path = [];            // comets you have found, in the order you found them
    this.found = 0;
    this.rareFound = 0;
    this._nextMile = 0;
    this._guide = null;        // nearest brilliant comet you have not read yet
    this._guideAt = -9;

    // Quality governor. Phones and old laptops get the same field, drawn more
    // cheaply, rather than the same drawing at four frames a second.
    this.quality = 1;          // 1 = waved ribbons + bloom, 0 = flat and cheap
    this._slow = 0;
    this.reduceMotion = !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.bloom = null;
    this.bloomOK = supportsFilter();
    this.couriers = null;      // set by main once the field is populated
    this.hole = null;          // the thing at the middle, likewise
    this.tilt = null;          // phone-tilt steering, when it is switched on
    this.mouse = null;         // the one that got away, when it is out
    this.sings = null;         // the seven coloured doors
    this.pocket = null;        // the run you are inside, if you are inside one
    this.singCool = 0;         // the doors stay shut briefly after one lets you out
    // The field runs behind the intro so the opening screen is alive, but
    // nothing is credited, nothing chimes and nothing pops up until you enter.
    this.live = false;
    // px of screen the DOM bands are occupying at the top; the readout keeps out
    this.reserveTop = 0;
    this.onFocus = null;
    this.onBlur = null;
    this.onDiscover = null;
    this.onMilestone = null;

    this._bind();
    this.resize();
    this.warp(0, 0);
  }

  function supportsFilter() {
    try {
      var c = document.createElement('canvas').getContext('2d');
      c.filter = 'blur(2px)';
      return c.filter === 'blur(2px)';
    } catch (e) { return false; }
  }

  Engine.prototype.warp = function (x, y) {
    this.cat.x = x; this.cat.y = y; this.cat.vx = 0; this.cat.vy = 0;
    this.cam.x = x; this.cam.y = y;
    this.cat.trail.length = 0;
  };

  Engine.prototype.resize = function () {
    /* Phones are where the type is smallest and the screens are densest, and
       capping every device at 2× was quietly rendering a 3× phone's serif at
       two thirds of its real resolution — which is exactly what "a bit blurry"
       looks like. A narrow viewport has few enough CSS pixels that the extra
       depth is affordable, and the quality governor is there if it is not. */
    /* Measure in fractions, not integers.

       `clientWidth`/`clientHeight` are specified to return rounded integers.
       iOS Safari's viewport is fractional almost all the time — it lands on
       heights like 659.5 and 739.297 as the address bar slides — so sizing the
       backing store from the rounded value gives a canvas whose pixel ratio is
       3.0023 rather than 3. The browser then resamples every pixel on its way
       to the screen, and everything drawn on it, text most visibly, goes soft.

       That is the entire "text looks blurry on mobile" report, and it is why
       raising the device pixel ratio did not fix it: the resample happens at
       whatever ratio you pick. So: measure the real box, round the backing
       store, and then pin the CSS size to exactly backing ÷ dpr so the ratio is
       exact and no resample happens at all. */
    var rect = this.canvas.getBoundingClientRect();
    var wCss = rect.width || window.innerWidth;
    var hCss = rect.height || window.innerHeight;

    var want = wCss < 700 ? 3 : 2;
    if (this.dprCap) want = Math.min(want, this.dprCap);
    var dpr = Math.min(window.devicePixelRatio || 1, want);
    this.dpr = dpr;

    var bw = Math.max(1, Math.round(wCss * dpr));
    var bh = Math.max(1, Math.round(hCss * dpr));
    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;

    var w = bw / dpr, h = bh / dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.W = w; this.H = h;
    /* The home indicator on a modern phone. The canvas fills the viewport, so
       without this the stick sits under the bar you swipe up from — which is
       both hard to press and easy to leave the page with. */
    this.safeBottom = readSafeBottom();
    this.bloom = null;         // rebuilt at the new size on the next frame
  };

  var safeProbe = null;
  function readSafeBottom() {
    try {
      if (!safeProbe) {
        safeProbe = document.createElement('div');
        safeProbe.style.cssText =
          'position:fixed;left:-9999px;bottom:0;height:env(safe-area-inset-bottom);' +
          'width:1px;pointer-events:none;visibility:hidden';
        document.body.appendChild(safeProbe);
      }
      return Math.min(48, safeProbe.getBoundingClientRect().height || 0);
    } catch (e) { return 0; }
  }

  /* The zoom floor has to follow the field. Z_MIN was fixed, and past about
     eight thousand messages the galaxy outgrows it — the wide view clamps
     before the whole thing is on screen, so the one feature whose entire job is
     "see all of it" silently stops being able to. */
  Engine.prototype.minZoom = function () {
    var fit = Math.min(this.W || 800, this.H || 600) / (this.world.R * 2.5);
    return Math.min(Z_MIN, fit);
  };

  Engine.prototype.toWorld = function (sx, sy) {
    var z = this.zEff || this.cam.z;
    return {
      x: (sx - this.W / 2) / z + this.cam.x,
      y: (sy - this.H / 2) / z + this.cam.y
    };
  };

  /** Switch flight model without losing the run you are in the middle of. */
  Engine.prototype.setFlight = function (mode) {
    if (mode !== 'glide' && mode !== 'pilot') return this.flight;
    this.flight = mode;
    // carry momentum across so the swap is felt rather than seen
    var sp = Math.hypot(this.cat.vx, this.cat.vy);
    if (sp > 1) this.cat.dir = Math.atan2(this.cat.vy, this.cat.vx);
    return this.flight;
  };

  /* Small. With a fixed base the radius IS the distance your thumb must travel
     to reach full tilt, so a big ring is a slow ring — and a slow ring is an
     inaccurate one, because every correction costs the same long drag. Started
     at a third of the screen wide, which was hopeless; this is the third cut
     down and it is now roughly a thumb-tip of travel. */
  /* SCREEN_SPEED is pixels per second of APPARENT motion, which keeps the field
     feeling the same at every zoom — and quietly means a narrow screen is
     crossed in a fraction of the time a wide one is. In the open field that is
     fine and arguably right: there is always more field. Inside a pocket the
     arena is the screen, and a phone was crossing the whole thing in 0.44s
     against a desktop's 0.81s, in a third of the space. Every correction
     overshot, which is exactly what "moving is very hard" describes.

     So a pocket on a small screen is paced to match, and only a pocket — the
     field keeps its stride. */
  Engine.prototype.pocketPace = function () {
    /* The floor is not a taste call. With the arena now fitted to 80% of a
       phone's short side, a phone crosses it in 0.63s where a desktop takes
       0.81s; 0.78 makes those equal. Matching rather than undershooting matters
       — the first attempt used 0.62, and playing all twenty with a bot showed
       the slower ones falling off a cliff (the Lens went from 4320 to 302),
       because these are timed games and a slower cat simply reaches less. Same
       crossing time as a desktop, on 43% more screen area than before, is the
       honest target: easier to aim, no harder to win. */
    return RDF.clamp(this.W / 900, 0.78, 1);
  };

  Engine.prototype.stickRadius = function () {
    return Math.max(26, Math.min(38, this.W * 0.088));
  };

  /* Where the stick lives. Bottom right, always, at a constant inset.

     It used to sit above a floor measured off the button row — which moved,
     because that row grows a "Share this one" bar whenever you are next to a
     message. So the stick rode up to the middle of the screen while you were
     reading and dropped back down when you left, and a control that will not
     hold still is worse than one in a slightly imperfect place. The buttons are
     centred and the stick is in the corner; they do not collide. */
  Engine.prototype.stickHome = function () {
    var r = this.stickRadius();
    return { x: this.W - r - 18, y: this.H - r - 22 - (this.safeBottom || 0) };
  };

  /** Generous, because thumbs are imprecise — but bounded, so the rest of the
      glass still belongs to the player. */
  Engine.prototype.inStickZone = function (x, y) {
    var h = this.stickHome(), r = this.stickRadius() * 1.65;
    return (x - h.x) * (x - h.x) + (y - h.y) * (y - h.y) < r * r;
  };

  /* Point the stick at a screen position. The knob is clamped to the rim, so a
     thumb that wanders past the edge keeps steering at full tilt rather than
     jamming — and the base stays where it is drawn. */
  Engine.prototype.aimStick = function (px, py) {
    var st = this.stick, r = this.stickRadius();
    var dx = px - st.bx, dy = py - st.by;
    var d = Math.hypot(dx, dy);
    if (d > r) { dx = (dx / d) * r; dy = (dy / d) * r; d = r; }
    st.kx = st.bx + dx; st.ky = st.by + dy;
    var dead = r * 0.12;
    if (d < dead) { st.x = 0; st.y = 0; st.mag = 0; }
    else {
      st.x = dx / d; st.y = dy / d;
      var lin = RDF.clamp((d - dead) / (r - dead), 0, 1);
      /* Curved, not linear. Half a deflection now asks for about a third of the
         throttle, so the bottom of the range — where you are lining something
         up rather than crossing the field — gets most of the travel. The rim
         still means full tilt, so nothing is lost at the top. Reported as
         "still hard to move accurately", which a linear stick on a small arena
         genuinely is. */
      st.mag = Math.pow(lin, 1.7);
    }
  };

  Engine.prototype._bind = function () {
    var self = this;
    var el = this.canvas;

    function pos(e) {
      var r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    el.addEventListener('pointerdown', function (e) {
      /* Capture is a nicety — it keeps a drag alive if the finger leaves the
         element. It is not worth losing the whole gesture over, and it throws
         in more situations than you would expect (synthetic events, a pointer
         already released, some embedded webviews). */
      try { el.setPointerCapture && el.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
      var p = pos(e);
      if (self.coarse && self.stick.id === -1 && self.inStickZone(p.x, p.y)) {
        /* The stick keeps your hand out of the picture, which is the whole
           reason it exists on a small screen. Its base is fixed where it is
           drawn, so what you press and what you see are the same object. */
        var sh = self.stickHome();
        self.stick.on = true; self.stick.id = e.pointerId;
        self.stick.bx = sh.x; self.stick.by = sh.y;
        self.pointer.heldFor = 0;
        self.aimStick(p.x, p.y);
        self.pointer.x = p.x; self.pointer.y = p.y; self.pointer.active = true;
        self.autopilot = null;
        RDF.audio && RDF.audio.unlock();
        return;
      }
      /* Everywhere else on the glass, hold-to-fly still works exactly as it
         does under a mouse. An earlier build gave the stick the whole bottom
         half of the screen and gave hold-to-fly nothing, so a thumb held on a
         singularity did nothing at all and the doors read as scenery. Both
         gestures now, and the stick is the one you reach for when your thumb
         would be covering what you are aiming at. */
      self.pointer.down = true; self.pointer.active = true;
      self.pointer.heldFor = 0;
      self.pointer.x = p.x; self.pointer.y = p.y;
      self.autopilot = null;
      RDF.audio && RDF.audio.unlock();
    });
    el.addEventListener('pointermove', function (e) {
      var p = pos(e);
      if (self.stick.on && e.pointerId === self.stick.id) {
        self.aimStick(p.x, p.y);
        return;
      }
      self.pointer.x = p.x; self.pointer.y = p.y;
      self.pointer.active = true;
    });
    function up(e) {
      if (self.stick.on && (!e || e.pointerId === self.stick.id)) {
        self.stick.on = false; self.stick.id = -1;
        self.stick.x = 0; self.stick.y = 0; self.stick.mag = 0;
      }
      self.pointer.down = false; self.pointer.heldFor = 0;
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', function () {
      if (self.stick.on) { self.stick.on = false; self.stick.id = -1; self.stick.mag = 0; }
      self.pointer.down = false; self.pointer.active = false; self.pointer.heldFor = 0;
    });

    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      var f = Math.exp(-e.deltaY * 0.0016);
      self.cam.zt = RDF.clamp(self.cam.zt * f, self.minZoom(), Z_MAX);
    }, { passive: false });

    // pinch
    var pts = {};
    var pinch0 = null;
    el.addEventListener('pointerdown', function (e) { pts[e.pointerId] = pos(e); });
    el.addEventListener('pointermove', function (e) {
      if (!(e.pointerId in pts)) return;
      pts[e.pointerId] = pos(e);
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        var a = pts[ids[0]], b = pts[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 === null) pinch0 = { d: d, z: self.cam.zt };
        else if (pinch0.d > 8) self.cam.zt = RDF.clamp(pinch0.z * (d / pinch0.d), self.minZoom(), Z_MAX);
        self.pointer.down = false;
      }
    });
    function clearPt(e) { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) pinch0 = null; }
    el.addEventListener('pointerup', clearPt);
    el.addEventListener('pointercancel', clearPt);

    window.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      self.keys[e.key.toLowerCase()] = true;
      if (e.key === '+' || e.key === '=') self.cam.zt = RDF.clamp(self.cam.zt * 1.25, Z_MIN, Z_MAX);
      if (e.key === '-' || e.key === '_') self.cam.zt = RDF.clamp(self.cam.zt / 1.25, self.minZoom(), Z_MAX);
      if (/^(arrow|w$|a$|s$|d$| $)/i.test(e.key)) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { self.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', function () {
      self.keys = {}; self.pointer.down = false;
      self.stick.on = false; self.stick.id = -1; self.stick.mag = 0;
    });
    window.addEventListener('resize', function () { self.resize(); });
  };

  Engine.prototype.flyTo = function (x, y, cb) {
    this.autopilot = { x: x, y: y, cb: cb };
    this.cam.zt = Math.max(this.cam.zt, 0.5);
  };

  /** Restore a returning visitor's finds before the first frame is drawn. */
  Engine.prototype.restoreFound = function (ids, priorRare) {
    for (var i = 0; i < ids.length; i++) {
      var c = this.world.byId[ids[i]];
      if (!c || c.found) continue;
      c.found = true; c.seen = true;
      this.path.push(c);
    }
    this.found = RDF.store ? RDF.store.discovered() : this.path.length;
    this.rareFound = priorRare || 0;
    while (this._nextMile < MILESTONES.length && MILESTONES[this._nextMile] <= this.found) {
      this._nextMile++;
    }
  };

  /* ---------------------------------------------------------------- update */

  Engine.prototype.update = function (dt) {
    this.t += dt;
    var cam = this.cam, cat = this.cat;

    // Drop to cheap ribbons after a run of slow frames, and climb back out of it
    // once things are comfortable again.
    if (dt > 0.034) {
      this._slow++;
      if (this._slow > 24) this.quality = 0;
      /* Still struggling with the ribbons already flattened? Then it is not the
         ribbons — it is fill rate, and the only real lever left is how many
         pixels there are.

         Phones under 700 CSS px render at 3x so the serif stays crisp, which is
         2.96 megapixels on a 390-wide screen against 1.32 at 2x. On a phone
         that cannot feed that through a canvas doing additive blending and a
         bloom pass, the frame rate goes and takes the chase clock with it.
         Crisp text nobody can play through is the wrong trade, so a device that
         has proved it cannot hold the pace gets its pixels back. It is one-way
         within a session: flapping between two resolutions would be worse than
         either. */
      if (this._slow > 90 && this.dpr > 2 && !window.RDF_FILM) {
        this.dprCap = 2;
        this.resize();
        this._slow = 0;
      }
    }
    else if (this._slow > 0) this._slow--;
    else if (this.quality === 0 && this.t > 6) { this.quality = 1; this._slow = 8; }

    cam.z += (cam.zt - cam.z) * Math.min(1, dt * 7);

    /* ------------------------------------------------------------- steering */

    var tx = 0, ty = 0, want = 0;
    var k = this.keys;
    if (k.w || k.arrowup) ty -= 1;
    if (k.s || k.arrowdown) ty += 1;
    if (k.a || k.arrowleft) tx -= 1;
    if (k.d || k.arrowright) tx += 1;
    var keyed = tx !== 0 || ty !== 0;
    if (keyed) want = 1;

    var arriving = 0;
    if (this.autopilot) {
      var dx0 = this.autopilot.x - cat.x, dy0 = this.autopilot.y - cat.y;
      var dd = Math.hypot(dx0, dy0);
      if (dd < 120 / cam.z) {
        var cb = this.autopilot.cb; this.autopilot = null; if (cb) cb();
      } else {
        tx = dx0 / dd; ty = dy0 / dd;
        want = RDF.clamp(dd / (420 / cam.z), 0.35, 1);
        arriving = 1 - want;
      }
    } else if (this.stick.on && this.stick.mag > 0 && !keyed) {
      tx = this.stick.x; ty = this.stick.y;
      want = this.stick.mag;
      // held at the rim, it boosts — the same gesture the desktop hold has
      if (this.stick.mag > 0.92) this.pointer.heldFor += dt;
      else this.pointer.heldFor = 0;
    } else if (this.pointer.down && !keyed) {
      this.pointer.heldFor += dt;
      var w = this.toWorld(this.pointer.x, this.pointer.y);
      var dx = w.x - cat.x, dy = w.y - cat.y;
      var d = Math.hypot(dx, dy);
      if (d > 4 / cam.z) {
        // ease off as you arrive so you settle next to a comet instead of
        // sailing past it — but never all the way to zero, or the throttle
        // dies every time you happen to point somewhere close
        var g = RDF.clamp(d / (190 / cam.z), 0.12, 1);
        tx = dx / d; ty = dy / d; want = g;
        arriving = 1 - g;
      }
    }

    /* Tilt is a third way into the same steering, below the two that involve
       touching the screen. A finger down beats it outright — reaching for the
       glass is an unambiguous statement of intent, and fighting somebody's
       thumb with their own wrist would be miserable. */
    var tilted = null;
    if (!keyed && !this.pointer.down && !this.stick.on && !this.autopilot && this.tilt) {
      tilted = this.tilt.read(dt);
      if (tilted) {
        tx = tilted.x; ty = tilted.y;
        want = Math.min(1, tilted.mag * 1.15);
        this.pointer.heldFor = tilted.boost ? BOOST_HOLD + 1 : 0;
      }
    }

    var mag = Math.hypot(tx, ty);
    if (mag > 0.0001) { tx /= mag; ty /= mag; } else { want = 0; }

    /* ------------------------------------------------------------- throttle */

    // Held input spools the throttle up. Shift or space skips the queue.
    var held = (keyed || tilted) ? (this.pointer.heldFor = this.pointer.heldFor + dt) : this.pointer.heldFor;
    var fast = !!(k.shift || k[' '] || k.spacebar);

    /* The throttle spools itself when you hold a direction, and that quietly
       broke reading: hold W for a second and you are at full boost, so anybody
       simply travelling was travelling too fast to ever open a message.

       So the auto-spool waits while you have something open. Arrive at a
       message, it opens, the throttle stops climbing and you settle beside it.
       Shift is untouched — it is the deliberate override, and holding it past a
       message you are reading is a clear statement that you would rather move
       on. Intent, read off the controls, without asking anybody to learn a
       rule. */
    var autoFast = held > BOOST_HOLD && !this.reading;
    var asking = (want > 0.35) && (fast || autoFast) ? 1 : 0;
    if (this.autopilot) asking = 0;
    /* And when something does open, the throttle comes off briskly rather than
       coasting down over half a second — long enough, at 2.75x, to sail
       straight back out the far side of the message that just caught you. */
    var spool = asking ? BOOST_UP : (this.reading && !fast ? BOOST_BRAKE : BOOST_DOWN);
    this.throttle += (asking - this.throttle) * Math.min(1, dt * spool);
    var prevBoost = this.boost;
    this.boost = this.throttle * RDF.clamp(want * 1.4, 0, 1);
    if (this.boost > 0.45 && prevBoost <= 0.45) {
      this.shake = Math.max(this.shake, 5.5);
      RDF.audio && RDF.audio.whoosh && RDF.audio.whoosh();
    }
    if (RDF.audio && RDF.audio.thrust) RDF.audio.thrust(this.boost);

    /* How long she has been flat out without letting up.

       The existing tell for speed is a field of streaks blowing past the
       camera, which reads as "the sky is moving" more than "you are moving
       fast" — on a phone, next to a rainbow trail that looks the same at every
       speed, it barely registers at all. So sustained boost earns a real one:
       after a couple of seconds held down she lights up and gets a shock cone,
       and it fades the moment you come off the throttle. Sustained, not
       instantaneous, because a badge that flickers on every twitch of the
       thumb is just noise. */
    if (this.boost > 0.55) this.held = (this.held || 0) + dt;
    else this.held = Math.max(0, (this.held || 0) - dt * 2.6);
    this.fast = RDF.clamp((this.held - FAST_AFTER) / 0.6, 0, 1);

    var speed = (SCREEN_SPEED / cam.z) * (1 + this.boost * (BOOST_MUL - 1));
    if (this.pocket) speed *= this.pocketPace();
    // "drift close to a rainbow to read it" — made true. With a message open
    // the field runs a speed limit, so passing one turns into lingering beside
    // it. Shift lifts the limit, because holding Shift past something you are
    // reading says plainly that you would rather be somewhere else.
    if (this.focused && !fast) speed *= READ_SLOW;

    // Left alone, she keeps drifting. A still screen looks broken, and the field
    // should feel like somewhere you are rather than something you paused.
    if (want === 0 && !this.autopilot) {
      this.idle += dt;
      // ...but not while something is pulling on her. A wander that fights the
      // black hole turns a fall into a wobble.
      var gripped = (this.hole && this.hole.grip > 0.05) || (this.tilt && this.tilt.on);
      if (this.idle > 2.2 && !this.reduceMotion && !gripped) {
        var wanderA = this.t * 0.07 + Math.sin(this.t * 0.031) * 2.4;
        tx = Math.cos(wanderA); ty = Math.sin(wanderA);
        want = RDF.clamp((this.idle - 2.2) / 2.5, 0, 1) * 0.19;
      }
    } else this.idle = 0;

    var vx0 = cat.vx, vy0 = cat.vy;
    // captured before the step: in pilot mode the heading is changed by the
    // step itself, and reading it afterwards makes every turn measure as zero
    var prevDir = cat.dir;

    if (this.flight === 'pilot' && !this.autopilot) this._pilot(dt, tx, ty, want, speed);
    else this._glide(dt, tx, ty, want, speed, arriving);

    if (Math.abs(cat.vx) < 0.01) cat.vx = 0;
    if (Math.abs(cat.vy) < 0.01) cat.vy = 0;

    cat.x += cat.vx * dt;
    cat.y += cat.vy * dt;

    // acceleration, in screen units — the tail and the squash both read from it
    cat.ax = (cat.vx - vx0) / Math.max(dt, 0.0001) * cam.z;
    cat.ay = (cat.vy - vy0) / Math.max(dt, 0.0001) * cam.z;

    // keep the explorer inside the field — except in a pocket, which is a very
    // long way outside it and keeps its own wall
    if (!this.pocket) {
      var rr = Math.hypot(cat.x, cat.y), lim = this.world.R * 1.22;
      if (rr > lim) { cat.x *= lim / rr; cat.y *= lim / rr; cat.vx *= 0.4; cat.vy *= 0.4; }
    }

    var sp = Math.hypot(cat.vx, cat.vy);
    if (this.flight !== 'pilot' && sp > 1) cat.dir = Math.atan2(cat.vy, cat.vx);
    var dd2 = ((cat.dir - prevDir + Math.PI * 3) % TAU) - Math.PI;
    cat.turn += (dd2 / Math.max(dt, 0.0001) - cat.turn) * Math.min(1, dt * 8);
    cat.bank += (RDF.clamp(cat.turn * 0.10, -0.55, 0.55) - cat.bank) * Math.min(1, dt * 7);
    var cruise = SCREEN_SPEED / cam.z;
    cat.boost += ((sp / cruise) - cat.boost) * Math.min(1, dt * 6);

    this._animateCat(dt, sp, cruise);
    this._trail(dt, sp, cruise);

    // camera follows, a touch ahead of travel — unless something has locked it.
    // The lead grows with the throttle, which is most of why boosting reads as
    // fast: the world starts arriving before she does.
    var leadX, leadY;
    var lead = 0.22 + this.boost * 0.30;
    if (this.lock) { leadX = this.lock.x; leadY = this.lock.y; }
    else { leadX = cat.x + cat.vx * lead; leadY = cat.y + cat.vy * lead; }
    var f = Math.min(1, dt * (this.lock ? 1.8 : 3.2 - this.boost * 0.9));
    cam.x += (leadX - cam.x) * f;
    cam.y += (leadY - cam.y) * f;

    // and the view opens up a little at speed
    this.zEff = cam.z * (1 - 0.115 * this.boost);
    this.shake *= Math.pow(0.0026, dt);

    if (this.pocket) {
      /* Inside one, the field itself does not run. No comets to focus, no
         couriers to meet, no hole to fall down — the flight model above is the
         only thing the two places have in common, deliberately. */
      RDF.pockets.update(this, dt);
      this._steps(dt);
      return;
    }

    if (this.hole) this.hole.update(dt, this);
    if (this.mouse) this.mouse.update(dt, this);
    if (this.sings) {
      var door = RDF.pockets.stepSings(this.sings, dt, this);
      if (door) RDF.pockets.enter(this, door.def, door);
    }
    this._focusPass(dt, sp);
    this._steps(dt);
    if (this.couriers) this.couriers.update(dt, this);
  };

  /** Point-and-go, with momentum underneath it. */
  Engine.prototype._glide = function (dt, tx, ty, want, speed, arriving) {
    var cat = this.cat;
    if (want > 0.001) {
      // split velocity into "along where I'm pointing" and "everything else".
      // The along part responds quickly; the sideways part bleeds off slowly,
      // and that difference is the whole feeling of carving a turn.
      var along = cat.vx * tx + cat.vy * ty;
      var px = cat.vx - along * tx, py = cat.vy - along * ty;
      along += (speed * want - along) * Math.min(1, dt * GLIDE.along);
      var bleed = GLIDE.perp + arriving * GLIDE.brake;
      var pk = Math.max(0, 1 - Math.min(1, dt * bleed));
      cat.vx = along * tx + px * pk;
      cat.vy = along * ty + py * pk;
    } else {
      var kk = Math.max(0, 1 - Math.min(1, dt * GLIDE.coast));
      cat.vx *= kk; cat.vy *= kk;
    }
  };

  /** A heading you turn and a throttle you hold. Momentum is yours to manage. */
  Engine.prototype._pilot = function (dt, tx, ty, want, speed) {
    var cat = this.cat;
    if (want > 0.001) {
      var target = Math.atan2(ty, tx);
      var diff = ((target - cat.dir + Math.PI * 3) % TAU) - Math.PI;
      // turning gets wider the faster you are going, so speed costs you agility
      var rate = RDF.lerp(PILOT.turn, PILOT.turnBoost, this.boost);
      var step = RDF.clamp(diff, -rate * dt, rate * dt);
      cat.dir += step;
      var ux = Math.cos(cat.dir), uy = Math.sin(cat.dir);
      // no thrust while the nose is still swinging round — that is what stops
      // it feeling like a mouse cursor and starts it feeling like a ship
      var facing = RDF.clamp(1 - Math.abs(diff) / 1.9, 0, 1);
      var acc = speed * PILOT.thrust * want * (0.35 + 0.65 * facing);
      cat.vx += ux * acc * dt;
      cat.vy += uy * acc * dt;
    }
    var drag = Math.max(0, 1 - Math.min(1, dt * PILOT.drag));
    cat.vx *= drag; cat.vy *= drag;
    var sp = Math.hypot(cat.vx, cat.vy);
    if (sp > speed) { cat.vx *= speed / sp; cat.vy *= speed / sp; }
  };

  /* -------------------------------------------------------------- the cat */

  Engine.prototype._animateCat = function (dt, sp, cruise) {
    var cat = this.cat;
    // the leg cycle runs off distance covered, not off the clock, so she never
    // moonwalks
    cat.step += (sp / cruise) * dt * 9;
    if (cat.step > 1e6) cat.step = 0;

    cat.blinkIn -= dt;
    if (cat.blinkIn <= 0) { cat.blink = 0.14; cat.blinkIn = 2.6 + (cat.step % 1) * 4.5; }
    if (cat.blink > 0) cat.blink -= dt;

    if (!this.reduceMotion) {
      // the tail is pulled by acceleration, in sprite cells
      var pull = { x: -cat.ax * 0.00055, y: -cat.ay * 0.00055 };
      pull.x = RDF.clamp(pull.x, -2.2, 2.2);
      pull.y = RDF.clamp(pull.y, -2.2, 2.2);
      RDF.art.stepTail(cat.tail, Math.min(dt, 0.033), pull, this.t);
    }
  };

  Engine.prototype._trail = function (dt, sp, cruise) {
    var cat = this.cat, cam = this.cam;
    var trail = cat.trail;
    var last = trail[trail.length - 1];
    var step = 9 / cam.z;
    var cap = Math.round(34 + this.boost * 34);      // it streams out at speed
    if (!last || Math.hypot(cat.x - last.x, cat.y - last.y) > step) {
      trail.push({ x: cat.x, y: cat.y });
      while (trail.length > cap) trail.shift();
    }
    if (sp < 2 && trail.length > 1 && this.t % 1 < dt) trail.shift();
    while (trail.length > cap) trail.shift();

    // sparks off the back under hard thrust
    if (this.boost > 0.35 && this.quality === 1 && !this.reduceMotion && this.parts.length < 420) {
      var n = sp > 1 ? 2 : 0;
      for (var i = 0; i < n; i++) {
        var a = cat.dir + Math.PI + (rnd(this.t * 91 + i) - 0.5) * 0.9;
        var v = (120 + rnd(this.t * 37 + i) * 220) / cam.z;
        this.parts.push({
          x: cat.x, y: cat.y,
          vx: Math.cos(a) * v - cat.vx * 0.1, vy: Math.sin(a) * v - cat.vy * 0.1,
          life: 0.34 + rnd(this.t * 13 + i) * 0.3, max: 0.64,
          r: 255, g: 210 + Math.floor(rnd(i + this.t) * 45), b: 255, s: 1.6, drag: 1.6
        });
      }
    }
  };

  // a cheap deterministic scatter — no Math.random anywhere in this project
  function rnd(x) { var s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); }

  /* ------------------------------------------------------------- particles */

  Engine.prototype.burst = function (x, y, spec, n, power) {
    if (this.quality === 0 || this.reduceMotion) return;
    var bands = spec.bands;
    for (var i = 0; i < n && this.parts.length < 520; i++) {
      var a = (i / n) * TAU + rnd(i * 3.3 + this.t) * 0.5;
      var v = (60 + rnd(i * 7.7 + this.t) * 190) * (power || 1) / this.cam.z;
      var col = bands[i % bands.length].rgb;
      this.parts.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.7 + rnd(i + 5) * 0.7, max: 1.4,
        r: col[0], g: col[1], b: col[2], s: 2.1, drag: 1.1
      });
    }
  };

  Engine.prototype._steps = function (dt) {
    var p = this.parts;
    for (var i = p.length - 1; i >= 0; i--) {
      var q = p[i];
      q.life -= dt;
      if (q.life <= 0) { p[i] = p[p.length - 1]; p.pop(); continue; }
      var d = Math.max(0, 1 - dt * q.drag);
      q.vx *= d; q.vy *= d;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
  };

  /* ---------------------------------------------------------- focus + wake */

  Engine.prototype._focusPass = function (dt, sp) {
    var cam = this.cam;
    var next = null;
    var R = READ_R / cam.z;
    var WR = 620 / cam.z;                    // how far her wake disturbs things

    /* Nothing is focused until the field is live, and that has to be decided
       HERE rather than further down where the crediting happens.

       The bug it fixes: the focus pass ran behind the intro, latched
       this.focused onto the comet she spawns beside, and skipped crediting it
       because the field wasn't live yet. From then on `next !== this.focused`
       was false forever, so that comet could never be discovered, never
       chimed, and never opened its bar — you could sit directly on top of a
       message and have the site do nothing at all. Refusing to latch in the
       first place means the pass runs clean the moment you enter. */
    var cur = this.focused;
    next = cur;

    if (this.live && cam.z > READ_ZOOM) {
      var cand = this.world.query(this.cat.x - WR, this.cat.y - WR,
        this.cat.x + WR, this.cat.y + WR, this._nbuf || (this._nbuf = []));
      var moving = sp > 40 / cam.z;
      var best = null, bestScore = Infinity, bestDist = Infinity, curDist = Infinity;

      for (var i = 0; i < cand.length; i++) {
        var c = cand[i];
        var p = this.world.pos(c, this.t);
        var dx = p.x - this.cat.x, dy = p.y - this.cat.y;
        var d2 = dx * dx + dy * dy;
        var d = Math.sqrt(d2);
        if (c.taken) continue;              // a mouse has run off with this one
        if (c === cur) curDist = d;
        // one you haven't read counts as nearer than one you have, so flying
        // through a crowded patch surfaces something new rather than reopening
        // the message you just finished
        var score = d * (c.found ? 1 : READ_UNREAD);
        if (score < bestScore) { bestScore = score; best = c; bestDist = d; }

        // fly past something and it should notice — the ribbon kicks and
        // settles, which is what makes the field feel like a place rather
        // than a picture with a cursor on it
        if (moving && d2 < WR * WR) {
          var k = 1 - d / WR;
          var amt = k * k * (0.55 + this.boost * 0.9);
          if (amt > (c.wake || 0) * Math.exp(-(this.t - (c.wakeT || 0)) * 2.4)) {
            c.wake = amt; c.wakeT = this.t;
            c.wakeSide = (dx * this.cat.vy - dy * this.cat.vx) > 0 ? 1 : -1;
          }
        }
      }

      // let go only once you are well clear — leaving is harder than arriving
      if (cur && curDist > R * READ_HOLD) next = null;

      /* Speed narrows what you can catch rather than switching it off. A hard
         cutoff was tried and it is the wrong shape: the throttle spools on its
         own, so a cutoff silently stops a travelling player from ever seeing
         anything. Shrinking the net means going fast makes you miss things,
         which is what going fast should mean. */
      var Racq = R * (1 - READ_NARROW * this.boost);
      if (!next) {
        if (best && bestDist < Racq) next = best;
      } else if (best && best !== next) {
        // a rival needs to be clearly nearer, and it has to wait its turn
        var dwelt = this.t - (this._focusAt || 0);
        if (dwelt > READ_DWELL && bestDist < Racq && bestDist < curDist * READ_STEAL) {
          next = best;
        }
      }
    } else if (!this.live || cam.z <= READ_ZOOM) {
      next = null;
    }

    if (next !== this.focused) {
      this._focusAt = this.t;
      this.focused = next;
      // next is only ever non-null once the field is live, so by the time
      // anything gets here it is a real find made by a real visitor
      if (next && !next.seen) {
        next.seen = true;
        this._discover(next);
      }
    }

    /* What is on screen, as opposed to what is nearest. They are the same thing
       while you are beside a message and differ for a beat afterwards. The bar
       follows this rather than the focus, so the heart and the share button
       stay usable for exactly as long as the words are up. */
    if (next) { this.reading = next; this._readUntil = this.t + READ_GRACE; }
    else if (this.reading && this.t > this._readUntil) this.reading = null;

    if (this.reading !== this._wasReading) {
      if (this._wasReading && this.onBlur) this.onBlur(this._wasReading);
      if (this.reading && this.onFocus) this.onFocus(this.reading);
      this._wasReading = this.reading;
    }

    // unfurl / furl — only ever touches the handful currently in transition
    var show = this.reading;
    if (show && this._fading.indexOf(show) === -1) this._fading.push(show);
    for (var j = this._fading.length - 1; j >= 0; j--) {
      var fc = this._fading[j];
      var target = fc === show ? 1 : 0;
      // opens faster than it used to (400ms to nine tenths was slower than the
      // time a message used to survive), closes at the same gentle rate
      fc.focus += (target - fc.focus) * Math.min(1, dt * (target ? 8 : 4));
      if (target === 0 && fc.focus < 0.004) { fc.focus = 0; this._fading.splice(j, 1); }
    }
  };

  Engine.prototype._discover = function (c) {
    var p = this.world.pos(c, this.t);
    if (!c.found) {
      c.found = true;
      c.foundAt = this.t;
      this.path.push(c);
      this.found++;
      if (c.spec.rare) this.rareFound++;
      this.burst(p.x, p.y, c.spec, c.spec.rare ? 34 : 18, c.spec.rare ? 1.7 : 1);
      this.shake = Math.max(this.shake, c.spec.rare ? 4 : 1.6);
      if (this._guide === c) { this._guide = null; this._guideAt = -9; }
    }
    if (this.onDiscover) this.onDiscover(c);
    if (this._nextMile < MILESTONES.length && this.found >= MILESTONES[this._nextMile]) {
      var n = MILESTONES[this._nextMile];
      this._nextMile++;
      if (this.onMilestone) this.onMilestone(n, this._nextMile - 1);
    }
  };

  /** Credit a message as read without having flown to it — a courier handing
      one over. Same path as finding it yourself, so it lands in your
      constellation and counts toward the milestones. */
  Engine.prototype.credit = function (c) {
    if (!c || c.found) return false;
    c.seen = true;
    this._discover(c);
    return true;
  };

  /* What to point at, in order of what is worth pointing at.

       brilliant — the nearest burning spectrum you have not read, nearby
       nearest  — failing that, simply the nearest rainbow at all
       centre   — and if there is nothing within reach in any direction, the
                  middle of the galaxy, which is always there and always has
                  everything around it

     The third tier is the one that matters out past the rim. You can fly far
     enough that the field is a smudge behind you and every direction looks the
     same, and before this the screen offered nothing at all in that situation.
     Now something is always pointing somewhere. */

  var GUIDE_NEAR = 5200;       // px at zoom 1 — the brilliant-hunting radius
  var GUIDE_FAR = 30000;       // beyond this we stop looking and point home

  /** The nearest door you have not been through, or null. */
  Engine.prototype._nearestDoor = function (cx, cy) {
    if (!this.sings || this.found < 2) return null;
    var best = null, bd = Infinity;
    for (var i = 0; i < this.sings.length; i++) {
      var s = this.sings[i];
      if (s.done) continue;
      var d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { s: best, d: bd } : null;
  };

  Engine.prototype._findGuide = function () {
    if (this.t - this._guideAt < 0.55) return this._guide;
    this._guideAt = this.t;
    if (this.cam.z < READ_ZOOM) { this._guide = null; return null; }

    var cx = this.cat.x, cy = this.cat.y;

    /* A mouse has one of our sentences and is running with it. The mouse draws
       its own marker, in red, with the distance on it — so this one gets out of
       the way entirely rather than adding a second arrow pointing somewhere
       else.

       It used to carry on suggesting rainbows throughout, which is how the one
       moment this place asks you to do something specific became the one moment
       it was pointing at something else. Reported from a phone as "hard to know
       what is happening". */
    if (this.mouse && this.mouse.active) { this._guide = null; return null; }
    var R = GUIDE_NEAR / this.cam.z;
    var cand = this.world.query(cx - R, cy - R, cx + R, cy + R,
      this._gbuf || (this._gbuf = []));

    var rare = null, rd = Infinity;
    var near = null, nd = Infinity;
    var i, c, dx, dy, d2;
    for (i = 0; i < cand.length; i++) {
      c = cand[i];
      dx = c.x - cx; dy = c.y - cy;
      d2 = dx * dx + dy * dy;
      if (d2 > R * R) continue;
      if (c.taken) continue;
      if (!c.found && d2 < nd) { nd = d2; near = c; }
      if (c.spec.rare && !c.found && d2 < rd) { rd = d2; rare = c; }
    }

    /* A door you have not been through outranks any rainbow, and this ordering
       was measured rather than assumed. Slotted below the rainbows, the door
       pointer only ever fired when you had flown clean out past the rim of the
       galaxy — inside the field there is always an unread comet nearer than a
       door, so it never once got named. That is the mouse arrow all over again:
       a pointer that only appears where nobody goes.

       So it goes first, but on a tight leash. Hundreds of rainbows and seven
       doors means a door within a couple of screens is genuinely rarer than a
       brilliant spectrum at the same range, and rare enough that being told
       about it reads as an invitation rather than as nagging. Beyond that
       radius it drops back to the bottom of the list, where it is only what
       you get told about when there is nothing else out there at all. */
    var door = this._nearestDoor(cx, cy);
    if (door && door.d < DOOR_NEAR) {
      this._guide = { c: null, sing: door.s, kind: 'door', d: door.d };
      return this._guide;
    }
    if (rare) { this._guide = { c: rare, kind: 'rare', d: Math.sqrt(rd) }; return this._guide; }
    if (near) { this._guide = { c: near, kind: 'near', d: Math.sqrt(nd) }; return this._guide; }
    if (door) { this._guide = { c: null, sing: door.s, kind: 'door', d: door.d }; return this._guide; }

    /* Nothing within a good few screens — so you are out in the empty, which is
       exactly when a coloured door is the most useful thing to be told about.

       This is the mouse-arrow lesson applied before it costs anything. Seven
       doors in a field eighteen thousand units across is seven needles: without
       a pointer most people would finish a session having never met one, and a
       feature nobody meets is a feature that does not exist. It only offers
       doors you have not been through, and only once you have read a couple of
       messages, so nobody's first thirty seconds are spent chasing a minigame
       instead of finding out what this place is. */
    var all = this.world.comets;
    var far = null, fd = (GUIDE_FAR / this.cam.z) * (GUIDE_FAR / this.cam.z);
    for (i = 0; i < all.length; i++) {
      c = all[i];
      dx = c.x - cx; dy = c.y - cy;
      d2 = dx * dx + dy * dy;
      if (d2 < fd) { fd = d2; far = c; }
    }
    if (far) { this._guide = { c: far, kind: 'near', d: Math.sqrt(fd) }; return this._guide; }

    // truly nowhere: point at the middle, which is always somewhere
    this._guide = { c: null, kind: 'centre', d: Math.hypot(cx, cy) };
    return this._guide;
  };

  /* ------------------------------------------------------------------ draw */

  Engine.prototype.draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H, z = this.zEff || this.cam.z;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    ctx.fillStyle = '#03030a';
    ctx.fillRect(0, 0, W, H);

    var sh = this.shake;
    if (sh > 0.05 && !this.reduceMotion) {
      ctx.translate(Math.sin(this.t * 91) * sh, Math.cos(this.t * 77) * sh);
    }

    if (this.pocket) {
      RDF.pockets.draw(this, ctx, z);
      this._drawParticles(ctx, z);
      this._drawCat(ctx, z);
      ctx.restore();
      this._bloomPass();
      this._drawStick();
      return;
    }

    this._drawClouds(ctx, z);
    // the sky warming toward whoever is beside you — over the nebulae, under
    // everything you are actually looking at
    if (this.couriers) this.couriers.drawAurora(ctx, W, H, this.t);
    this._drawStars(ctx, z);
    this._drawCore(ctx, z);
    if (this.hole) this.hole.draw(ctx, this, z);
    this._drawDust(ctx, z);
    this._drawConstellation(ctx, z);
    this._drawComets(ctx, z);
    if (this.sings) for (var si = 0; si < this.sings.length; si++) RDF.pockets.drawSing(this.sings[si], ctx, this, z);
    if (this.couriers) this.couriers.draw(ctx, this, z);
    if (this.mouse) this.mouse.draw(ctx, this, z);
    this._drawParticles(ctx, z);
    this._drawCat(ctx, z);

    if (this.hole) this.hole.drawFlash(ctx, this);
    ctx.restore();

    this._bloomPass();
    if (this.sings) this._drawCompass(z);
    this._drawStick();
    this._drawGuide();
  };

  /* Screen space, so it sits on the rim of the glass rather than drifting with
     the camera. Same dpr dance as the stick. */
  Engine.prototype._drawCompass = function (z) {
    var ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    RDF.pockets.drawCompass(this.sings, ctx, this, z);
    ctx.restore();
  };

  /* A cheap full-screen bloom. The scene is squared down at a sixth of the
     resolution, which throws away everything dark and keeps the highlights,
     blurred once, then added back. Against a near-black sky that reads as real
     light spill, and it costs three draws on a small canvas rather than a
     shader.

     It also times itself. The final composite is a full-screen additive draw,
     and on a machine with no GPU-accelerated canvas that alone can cost more
     than the entire rest of the frame — so after a dozen samples, if the pass
     is eating more than a quarter of the frame budget, it switches itself off
     for good and the field goes back to being merely beautiful. That check is
     the difference between this looking great on good hardware and being a
     slideshow on bad hardware, and it must not be removed. */

  var BLOOM_DIV = 6;
  var BLOOM_BUDGET = 4.0;    // ms; a quarter of a 60fps frame

  Engine.prototype._bloomPass = function () {
    if (!this.bloomOK || this.quality === 0 || this.W < 2) return;
    var t0 = performance.now();
    this._bloomDraw();
    // The trailer harness renders frame by frame with no clock pressure at all,
    // so the budget means nothing there and would only strip the glow out of
    // the film. Let it keep bloom whatever the wall time says.
    if (window.RDF_FILM) return;
    var ms = performance.now() - t0;
    this._bloomMs = this._bloomMs === undefined ? ms : this._bloomMs * 0.85 + ms * 0.15;
    if ((this._bloomN = (this._bloomN || 0) + 1) > 12 && this._bloomMs > BLOOM_BUDGET) {
      this.bloomOK = false;
      this.bloom = null;
      this._slow = 0;          // this was our cost, not the field's — don't also
      this.quality = 1;        // punish the ribbons for it
    }
  };

  Engine.prototype._bloomDraw = function () {
    var W = this.W, H = this.H, dpr = this.dpr;
    var bw = Math.max(2, Math.round(W * dpr / BLOOM_DIV));
    var bh = Math.max(2, Math.round(H * dpr / BLOOM_DIV));
    var b = this.bloom;
    if (!b || b.a.width !== bw || b.a.height !== bh) {
      var a = document.createElement('canvas'), c = document.createElement('canvas');
      a.width = c.width = bw; a.height = c.height = bh;
      b = this.bloom = { a: a, c: c, ac: a.getContext('2d'), cc: c.getContext('2d') };
    }
    var ac = b.ac, cc = b.cc, ctx = this.ctx;

    ac.globalCompositeOperation = 'copy';
    ac.filter = 'none';
    ac.drawImage(this.canvas, 0, 0, bw, bh);
    // square the image against itself: darks collapse, highlights survive
    ac.globalCompositeOperation = 'multiply';
    ac.drawImage(b.a, 0, 0);

    cc.globalCompositeOperation = 'copy';
    cc.filter = 'blur(2.5px)';
    cc.drawImage(b.a, 0, 0);
    cc.filter = 'none';

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.66;
    ctx.imageSmoothingEnabled = true;
    if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(b.c, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  };

  Engine.prototype._drawClouds = function (ctx, z) {
    var cam = this.cam, W = this.W, H = this.H;
    var cl = RDF.art.clouds(this.world.R);
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < cl.length; i++) {
      var c = cl[i];
      var sx = (c.x - cam.x) * z + W / 2;
      var sy = (c.y - cam.y) * z + H / 2;
      var r = c.r * z;
      if (r < 6 || sx + r < 0 || sx - r > W || sy + r < 0 || sy - r > H) continue;
      var col = c.rgb;
      var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + c.a + ')');
      g.addColorStop(0.55, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + c.a * 0.28 + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);

      // a brighter knot inside, offset — thirteen identical soft circles read as
      // a gradient artefact; a cloud with a core reads as a cloud
      var kx = sx + c.kx * r, ky = sy + c.ky * r, kr = r * c.kr;
      if (kr > 5) {
        var g2 = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
        g2.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + c.a * 1.25 + ')');
        g2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g2;
        ctx.fillRect(kx - kr, ky - kr, kr * 2, kr * 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  Engine.prototype._drawStars = function (ctx, z) {
    var cam = this.cam, W = this.W, H = this.H, T = RDF.art.TILE;
    var layers = RDF.art.starLayers();
    var t = this.t;
    ctx.globalCompositeOperation = 'lighter';

    /* And the stars, for the third time: batched into alpha lanes rather than
       a parsed colour string per star per tile. The coloured minority keep
       their own lanes so the field stays polychrome. */
    var STEPS = 7, HUES = 6;
    var lanes = this._starL;
    if (!lanes) {
      lanes = this._starL = { w: [], c: [], wc: [], cc: [] };
      for (var q = 0; q < STEPS; q++) {
        lanes.w.push([]);
        lanes.wc.push('rgba(226,232,255,' + (((q + 0.5) / STEPS)).toFixed(3) + ')');
      }
      for (q = 0; q < HUES * STEPS; q++) {
        lanes.c.push([]);
        var cc = RDF.spectrum.lutColor(((q / STEPS | 0) + 0.5) / HUES);
        lanes.cc.push('rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',' +
          ((((q % STEPS) + 0.5) / STEPS)).toFixed(3) + ')');
      }
    }
    for (var z2 = 0; z2 < lanes.w.length; z2++) lanes.w[z2].length = 0;
    for (z2 = 0; z2 < lanes.c.length; z2++) lanes.c[z2].length = 0;

    for (var l = 0; l < layers.length; l++) {
      var L = layers[l];
      var ox = ((-cam.x * z * L.par) % T + T) % T;
      var oy = ((-cam.y * z * L.par) % T + T) % T;
      var cols = Math.ceil(W / T) + 1, rows = Math.ceil(H / T) + 1;
      for (var gy = -1; gy < rows; gy++) {
        for (var gx = -1; gx < cols; gx++) {
          var bx = ox + gx * T, by = oy + gy * T;
          for (var i = 0; i < L.pts.length; i++) {
            var p = L.pts[i];
            var sx = bx + p.x, sy = by + p.y;
            if (sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue;
            var tw = 0.72 + 0.28 * Math.sin(t * 1.1 + p.tw);
            var av = p.a * tw;
            var step = (av * STEPS) | 0;
            if (step > STEPS - 1) step = STEPS - 1;
            if (p.hue >= 0) {
              var hb = (p.hue * HUES) | 0;
              if (hb > HUES - 1) hb = HUES - 1;
              lanes.c[hb * STEPS + step].push(sx, sy, p.s);
            } else {
              lanes.w[step].push(sx, sy, p.s);
            }
          }
        }
      }
    }
    function flush(list, css) {
      for (var k = 0; k < list.length; k++) {
        var pts = list[k];
        if (!pts.length) continue;
        ctx.beginPath();
        for (var j = 0; j < pts.length; j += 3) ctx.rect(pts[j], pts[j + 1], pts[j + 2], pts[j + 2]);
        ctx.fillStyle = css[k];
        ctx.fill();
      }
    }
    flush(lanes.w, lanes.wc);
    flush(lanes.c, lanes.cc);
    ctx.globalCompositeOperation = 'source-over';
  };

  Engine.prototype._drawCore = function (ctx, z) {
    var cam = this.cam, W = this.W, H = this.H;
    var sx = (0 - cam.x) * z + W / 2, sy = (0 - cam.y) * z + H / 2;
    var r = this.world.R * 0.3 * z;
    if (r < 4) return;
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, 'rgba(255,244,222,0.16)');
    g.addColorStop(0.25, 'rgba(255,212,172,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
  };

  /** The galaxy's own stars. Only worth drawing once you are far enough out
      that the shape of the thing matters more than any single message. */
  Engine.prototype._drawDust = function (ctx, z) {
    var fade = RDF.clamp((0.20 - z) / 0.13, 0, 1);
    if (fade <= 0.01) return;
    var cam = this.cam, W = this.W, H = this.H;
    var d = RDF.art.galaxyDust(this.world.R);
    ctx.globalCompositeOperation = 'lighter';

    /* Same lesson as the grains: this is 5200 points and it was setting a
       freshly built rgba string on every one of them, every frame, purely to
       vary the alpha. Six alpha steps, batched, is visually identical and
       costs six fillStyle changes instead of five thousand two hundred. */
    var STEPS = 6;
    var lanes = this._dustL || (this._dustL = []);
    for (var s = 0; s < STEPS; s++) { lanes[s] = lanes[s] || []; lanes[s].length = 0; }

    for (var i = 0; i < d.length; i += 3) {
      var sx = (d[i] - cam.x) * z + W / 2;
      if (sx < -2 || sx > W + 2) continue;
      var sy = (d[i + 1] - cam.y) * z + H / 2;
      if (sy < -2 || sy > H + 2) continue;
      var lane = (d[i + 2] * STEPS) | 0;
      lanes[lane > STEPS - 1 ? STEPS - 1 : lane].push(sx, sy);
    }
    for (s = 0; s < STEPS; s++) {
      var pts = lanes[s];
      if (!pts.length) continue;
      ctx.beginPath();
      for (var j = 0; j < pts.length; j += 2) ctx.rect(pts[j], pts[j + 1], 1.25, 1.25);
      ctx.fillStyle = 'rgba(206,214,255,' + (((s + 0.5) / STEPS) * fade).toFixed(3) + ')';
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  /* Your constellation.

     Every rainbow you have read stays lit, and the ones you found are joined in
     the order you found them. Pull back and the evening you spent out here is
     drawn across the galaxy in a line only you have. This is the whole reason
     the wide view is worth opening twice. */
  Engine.prototype._drawConstellation = function (ctx, z) {
    var fade = RDF.clamp((CONST_Z - z) / (CONST_Z * 0.55), 0, 1);
    if (fade <= 0.01 || this.path.length < 2) return;
    var cam = this.cam, W = this.W, H = this.H, t = this.t;
    var from = Math.max(0, this.path.length - PATH_CAP);

    /* Drawn as a smoothed curve through the finds rather than straight hops,
       which is the difference between a constellation and a spider's web.

       Jumps longer than a good fraction of the galaxy are left out entirely.
       Those are not journeys — they are somebody arriving on a share link or
       using "fly to it", and joining them up would draw a line straight across
       the field that says nothing about where anyone went. */
    var MAXHOP = this.world.R * 0.42;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    var open = false, prev = null, prevW = null;
    for (var i = from; i < this.path.length; i++) {
      var pw = this.world.pos(this.path[i], t);
      var sx = (pw.x - cam.x) * z + W / 2, sy = (pw.y - cam.y) * z + H / 2;
      var on = sx > -600 && sx < W + 600 && sy > -600 && sy < H + 600;
      var hop = prevW ? Math.hypot(pw.x - prevW.x, pw.y - prevW.y) : 0;
      if (!prev || hop > MAXHOP || (!on && !prev.on)) {
        open = false;
      } else if (!open) {
        ctx.moveTo(prev.sx, prev.sy); ctx.lineTo(sx, sy); open = true;
      } else {
        // curve through the midpoint of each hop, so corners round off
        ctx.quadraticCurveTo(prev.sx, prev.sy, (prev.sx + sx) / 2, (prev.sy + sy) / 2);
      }
      prev = { sx: sx, sy: sy, on: on };
      prevW = pw;
    }
    ctx.strokeStyle = 'rgba(150,178,255,' + (0.32 * fade) + ')';
    ctx.stroke();

    // and a node on each one, so the line has stations rather than just corners
    for (var j = from; j < this.path.length; j++) {
      var q = this.world.pos(this.path[j], t);
      var qx = (q.x - cam.x) * z + W / 2, qy = (q.y - cam.y) * z + H / 2;
      if (qx < -6 || qx > W + 6 || qy < -6 || qy > H + 6) continue;
      var c = this.path[j];
      var col = c.spec.hot;
      ctx.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + (0.85 * fade) + ')';
      var s = c.spec.rare ? 2.6 : 1.8;
      ctx.fillRect(qx - s / 2, qy - s / 2, s, s);
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  };

  Engine.prototype._drawParticles = function (ctx, z) {
    var p = this.parts;
    if (!p.length) return;
    var cam = this.cam, W = this.W, H = this.H;
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < p.length; i++) {
      var q = p[i];
      var sx = (q.x - cam.x) * z + W / 2, sy = (q.y - cam.y) * z + H / 2;
      if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) continue;
      var a = RDF.clamp(q.life / q.max, 0, 1);
      ctx.fillStyle = 'rgba(' + q.r + ',' + q.g + ',' + q.b + ',' + (a * 0.9) + ')';
      var s = q.s * (0.5 + a);
      ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  Engine.prototype._drawComets = function (ctx, z) {
    var cam = this.cam, W = this.W, H = this.H, t = this.t;
    var pad = 700 / z;
    var x0 = cam.x - W / 2 / z - pad, x1 = cam.x + W / 2 / z + pad;
    var y0 = cam.y - H / 2 / z - pad, y1 = cam.y + H / 2 / z + pad;
    var list = this.world.query(x0, y0, x1, y1, this.buf);

    var far = z < 0.022;
    var mid = !far && z < 0.16;

    // When you are actually reading something, everything else steps back. A
    // dense field is beautiful right up until there are words on top of it.
    var dimTarget = this.reading ? 0.48 : 0;
    this.readDim += (dimTarget - this.readDim) * 0.075;
    this._pending = null;

    ctx.globalCompositeOperation = 'lighter';

    if (far) {
      this._drawFar(ctx, list, cam, z, W, H);
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    for (var j = 0; j < list.length; j++) {
      this._drawComet(ctx, list[j], t, z, mid);
    }
    ctx.globalCompositeOperation = 'source-over';

    // The scrim and the message go last so nothing can be drawn across the words.
    if (this.readDim > 0.01) {
      ctx.fillStyle = 'rgba(3,3,10,' + this.readDim + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (this._pending) {
      var q = this._pending;
      // Back on top of its own scrim, but softly — it is the anchor telling you
      // which comet you are reading, not the thing you are looking at. Drawn at
      // full strength it punches straight back through the dimming and you are
      // reading words on a rainbow again.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6;
      this._drawComet(ctx, q.c, t, z, false);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      this._drawUnfurl(ctx, q.c, q.sx, q.sy, z);
      this._pending = null;
    }
  };

  /* The whole-field view, and the one place in this project where the naive
     loop does not survive a real number of messages.

     Every message is one grain of coloured light and together they have to read
     as a galaxy — but setting fillStyle to a freshly built 'rgba(...)' string
     per grain means the browser parses a CSS colour once per message per frame,
     and that, not the pixels, is the entire cost. Measured on 8000 grains:
     6.4ms building a string each time, 3.7ms with the strings pre-built, and
     1.1ms with one fillStyle for the lot. The rasterising was never the
     problem; at 2px a grain it is thirty thousand pixels.

     So grains are bucketed by hue and drawn as one path per bucket. Sixteen
     buckets, doubled for the ones you have already read, is at worst
     thirty-two fills instead of sixteen thousand — and the field looks
     identical, because nobody can tell two adjacent hues apart at two pixels
     across.

     Above the cap it also strides: past twenty thousand on screen the shape of
     the galaxy is carried by the density, not by any individual grain, so it
     draws every Nth one slightly brighter and stops. */

  var FAR_HUES = 16;
  var FAR_CAP = 20000;

  Engine.prototype._drawFar = function (ctx, list, cam, z, W, H) {
    var buckets = this._farB;
    if (!buckets) {
      buckets = this._farB = [];
      for (var q = 0; q < FAR_HUES * 2; q++) buckets.push([]);
      this._farC = [];
      for (q = 0; q < FAR_HUES; q++) {
        var col = RDF.spectrum.lutColor((q + 0.5) / FAR_HUES);
        this._farC.push([
          'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.72)',   // unread
          'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',1)'       // found
        ]);
      }
    }
    for (var k = 0; k < buckets.length; k++) buckets[k].length = 0;

    var n = list.length;
    var stride = n > FAR_CAP ? Math.ceil(n / FAR_CAP) : 1;
    var grow = stride > 1 ? Math.min(2.2, 1 + (stride - 1) * 0.35) : 1;

    for (var i = 0; i < n; i += stride) {
      var c = list[i];
      var sx = (c.x - cam.x) * z + W / 2, sy = (c.y - cam.y) * z + H / 2;
      if (sx < -3 || sx > W + 3 || sy < -3 || sy > H + 3) continue;
      // hue bucket, worked out once per comet and kept
      if (c._fb === undefined) {
        var bd = c.spec.bands;
        var nm = bd[bd.length >> 1].nm;
        c._fb = RDF.clamp(Math.floor((nm - 396) / 348 * FAR_HUES), 0, FAR_HUES - 1);
      }
      var arr = buckets[c._fb * 2 + (c.found ? 1 : 0)];
      arr.push(sx, sy);
    }

    var s = 2 * grow;
    for (var bkt = 0; bkt < buckets.length; bkt++) {
      var pts = buckets[bkt];
      if (!pts.length) continue;
      ctx.beginPath();
      for (var j = 0; j < pts.length; j += 2) {
        ctx.rect(pts[j] - s / 2, pts[j + 1] - s / 2, s, s);
      }
      ctx.fillStyle = this._farC[bkt >> 1][bkt & 1];
      ctx.fill();
    }
  };

  Engine.prototype._drawComet = function (ctx, c, t, z, mid) {
    var cam = this.cam, W = this.W, H = this.H;
    var p = this.world.pos(c, t);
    var sx = (p.x - cam.x) * z + W / 2, sy = (p.y - cam.y) * z + H / 2;
    if (c.taken) return;                    // a mouse has run off with this one
    var spec = c.spec;
    var rare = spec.rare;

    /* Reading a message used to make its ribbon 4.4× wider and 1.7× longer — a
       slab of saturated colour lying across the whole screen, with the readout's
       own spectrum painted on top of it and a serif sentence on top of that.
       Three competing rainbows in the same square inch.

       So it goes the other way now. The comet pulls its tail IN and steps back
       to about half brightness while you read, and the light it loses turns up
       in the readout, which is the same rainbow drawn properly with its
       wavelengths under it. The message opens: the light moves out of the sky
       and into the words. Only the head stays bright, because something has to
       say which comet you are reading. */
    var len = (150 + 150 * spec.tail) * z * (1 - c.focus * 0.34) * (rare ? 1.28 : 1);
    var wid = (17 + 11 * spec.size) * z * (1 + c.focus * 0.75);
    var head = (6.5 + 4.5 * spec.size) * z * (1 + c.focus * 0.85) * (rare ? 1.2 : 1);

    if (sx + len < -60 || sx - len > W + 60 || sy + len < -60 || sy - len > H + 60) return;

    // the wake she left going past, decaying — a kick sideways, then a settle
    var wake = 0;
    if (c.wake) {
      var age = t - (c.wakeT || 0);
      wake = c.wake * Math.exp(-age * 2.4) * Math.cos(age * 7.5) * (c.wakeSide || 1);
      if (age > 3) c.wake = 0;
    }

    var dir = c.dir + Math.sin(t * 0.09 + c.ph) * 0.06 * spec.wobble + wake * 0.32;
    var pulse = 0.86 + 0.14 * Math.sin(t * (0.8 + spec.wobble) + c.ph2);
    if (rare) pulse = 0.9 + 0.24 * Math.sin(t * 1.6 + c.ph2);
    var alpha = (0.55 + 0.45 * spec.lum) * pulse;
    if (c.found) alpha = Math.min(1, alpha * 1.14);
    alpha *= 1 - c.focus * 0.58;          // step back while you read it

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(dir);

    var bands = spec.bands, n = bands.length;
    var sw = wid / n;

    if (mid) {
      // Far enough out that the whole comet is a handful of pixels — flat fills
      // only, because there can be thousands of these on screen at once.
      if (sw < 1.15) {
        var ht = spec.hot;
        ctx.fillStyle = 'rgba(' + ht[0] + ',' + ht[1] + ',' + ht[2] + ',' + Math.min(1, alpha * 1.15) + ')';
        ctx.fillRect(-Math.max(len, 3), -0.7, Math.max(len, 3), 1.4);
      } else {
        for (var mi = 0; mi < n; mi++) {
          var mb = bands[mi];
          ctx.fillStyle = 'rgba(' + mb.rgb[0] + ',' + mb.rgb[1] + ',' + mb.rgb[2] + ',' + (alpha * 0.78) + ')';
          ctx.fillRect(-len, (mi - (n - 1) / 2) * sw - sw / 2, len, sw + 0.4);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,' + (0.6 * pulse) + ')';
      ctx.fillRect(-head * 0.8, -head * 0.8, Math.max(1.4, head * 1.8), Math.max(1.4, head * 1.8));
      ctx.restore();
      return;
    }

    // the trail: parallel stripes, the way a certain cat taught us to draw them
    for (var i = 0; i < n; i++) {
      var b = bands[i];
      var oy = (i - (n - 1) / 2) * sw;
      var g = ctx.createLinearGradient(0, 0, -len, 0);
      g.addColorStop(0, 'rgba(' + b.rgb[0] + ',' + b.rgb[1] + ',' + b.rgb[2] + ',' + alpha + ')');
      g.addColorStop(0.55, 'rgba(' + b.rgb[0] + ',' + b.rgb[1] + ',' + b.rgb[2] + ',' + alpha * 0.5 + ')');
      g.addColorStop(1, 'rgba(' + b.rgb[0] + ',' + b.rgb[1] + ',' + b.rgb[2] + ',0)');
      ctx.fillStyle = g;
      if (this.quality === 0 || this.reduceMotion) {
        ctx.fillRect(-len, oy - sw / 2, len, sw + 0.4);
      } else {
        // a soft wave through the ribbon so it reads as moving, not printed —
        // and the wake she leaves rides on the same wave
        var segs = 7;
        var amp = sw * 0.5 * spec.wobble * (1 - c.focus) + Math.abs(wake) * sw * 2.2;
        ctx.beginPath();
        var k;
        for (k = 0; k <= segs; k++) {
          var f = k / segs, x = -len * f;
          var y = oy + Math.sin(t * 1.5 + f * 3.2 + c.ph + i * 0.5) * amp * f;
          if (k === 0) ctx.moveTo(x, y - sw / 2); else ctx.lineTo(x, y - sw / 2);
        }
        for (k = segs; k >= 0; k--) {
          var f2 = k / segs, x2 = -len * f2;
          var y2 = oy + Math.sin(t * 1.5 + f2 * 3.2 + c.ph + i * 0.5) * amp * f2;
          ctx.lineTo(x2, y2 + sw / 2);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    // head
    var hb = bands[0].rgb;
    var hg = ctx.createRadialGradient(0, 0, 0, 0, 0, head * 3.4);
    hg.addColorStop(0, 'rgba(255,255,255,' + (0.95 * pulse) + ')');
    hg.addColorStop(0.22, 'rgba(' + hb[0] + ',' + hb[1] + ',' + hb[2] + ',' + (0.7 * pulse) + ')');
    hg.addColorStop(1, 'rgba(' + hb[0] + ',' + hb[1] + ',' + hb[2] + ',0)');
    ctx.fillStyle = hg;
    ctx.fillRect(-head * 3.4, -head * 3.4, head * 6.8, head * 6.8);

    // Close up, the head splits its own light: the red end of this comet's own
    // spectrum lands a hair off the violet end. It is a two-pixel detail and it
    // is the difference between a glowing dot and a prism.
    if (z > 0.34 && this.quality === 1) {
      var d0 = bands[0].rgb, d1 = bands[n - 1].rgb;
      var off = head * 0.34;
      ctx.fillStyle = 'rgba(' + d0[0] + ',' + d0[1] + ',' + d0[2] + ',' + (0.45 * pulse) + ')';
      ctx.fillRect(-off - head * 0.5, -head * 0.5, head, head);
      ctx.fillStyle = 'rgba(' + d1[0] + ',' + d1[1] + ',' + d1[2] + ',' + (0.45 * pulse) + ')';
      ctx.fillRect(off - head * 0.5, -head * 0.5, head, head);
    }

    ctx.restore();

    // A brilliant one wears a slow prismatic halo. You can pick them out from
    // most of a screen away, which is the point — they are what you steer for.
    if (rare) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(t * 0.25 + c.ph);
      var hr = head * 4.6;
      for (var ri = 0; ri < n; ri++) {
        var rb = bands[ri].rgb;
        ctx.strokeStyle = 'rgba(' + rb[0] + ',' + rb[1] + ',' + rb[2] + ',' + (0.30 * pulse) + ')';
        ctx.lineWidth = Math.max(0.6, head * 0.13);
        ctx.beginPath();
        ctx.arc(0, 0, hr, (ri / n) * TAU, (ri / n) * TAU + TAU / n * 0.72);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Something you have already read keeps a quiet ring, so the field you have
    // been through looks different from the field you have not.
    if (c.found && z > 0.16 && c.focus < 0.5) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.strokeStyle = 'rgba(186,204,255,' + (0.24 * (1 - c.focus * 2)) + ')';
      ctx.lineWidth = Math.max(0.5, head * 0.1);
      ctx.beginPath();
      ctx.arc(0, 0, head * 2.5, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (c.lights > 0 && z > 0.25) {
      ctx.save();
      ctx.translate(sx, sy);
      var lr = head * (2.4 + Math.min(c.lights, 40) * 0.05);
      var lg = ctx.createRadialGradient(0, 0, lr * 0.4, 0, 0, lr);
      lg.addColorStop(0, 'rgba(255,214,232,0.16)');
      lg.addColorStop(1, 'rgba(255,214,232,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(-lr, -lr, lr * 2, lr * 2);
      ctx.restore();
    }

    if (c.focus > 0.02) this._pending = { c: c, sx: sx, sy: sy };
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** The moment of discovery: the ribbon opens into a readable spectrum + the words. */
  Engine.prototype._drawUnfurl = function (ctx, c, sx, sy, z) {
    var f = RDF.easeOutCubic(RDF.clamp(c.focus, 0, 1));

    /* A courier handing you a sentence outranks a rainbow you happen to be
       drifting past. Two panels of prose at once is two things asking to be
       read and neither of them getting read, so this one steps aside while a
       courier is talking and comes back when she has finished.

       It yields rather than vanishing: the readout fades out over a third of a
       second, so what you see is one thing replacing another rather than a
       panel blinking off. */
    if (this.carryHold) {
      // 1 while she is talking, easing back to 0 over a third of a second after
      var since = this.t - this.carryHold;
      f *= RDF.clamp(since / 0.34, 0, 1);
      if (f <= 0.002) return;
    }

    var W = this.W, H = this.H;
    // uiScale lets the trailer harness size the readout for a vertical frame,
    // where a browser-sized caption would be unreadable on a phone.
    var ui = this.uiScale || 1;

    /* Where it goes, and why it stopped following the comet.

       It used to sit beside the head, flipping above or below to dodge the
       tail. That works geometrically and fails visually: the plate lands in the
       busiest part of the screen, right where the cat, the tail and the
       unfurled ribbon already are, and the whole frame reads as clutter at the
       exact moment it is asking to be read.

       So the reading happens in one fixed, quiet place — pinned to the top,
       centred, always. The discovery still happens out in space: the comet
       blooms, the field dims around it. The words just aren't fighting the
       picture for the same square inches any more. A fixed home also means your
       eye knows where to go before the text arrives, instead of hunting for it
       somewhere new each time. */

    var phone = W < 640;
    var bw = Math.min(560 * ui, W - (phone ? 28 : 64));
    var bh = (phone ? 11 : 13) * ui;                 // a slim bar, not a slab
    /* On a wide screen the panel is a small thing in the corner of your eye and
       can afford to be quiet. On a phone it is the only thing you are looking
       at, held a foot from your face — so it is sized off the viewport rather
       than clamped down to the same 15px it would take on a desktop. */
    var fs = (phone ? Math.max(17.5, W * 0.047) : Math.max(15, Math.min(22, W * 0.0165))) * ui;
    var lineH = fs * 1.42;
    var padX = (phone ? 18 : 26) * ui, padY = (phone ? 16 : 18) * ui;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '400 ' + fs + 'px Newsreader, Georgia, "Times New Roman", serif';
    var lines = wrap(ctx, c.text, bw - 10);

    var labelH = (phone ? 13 : 15) * ui;
    var textH = (lines.length - 1) * lineH + fs * 1.06;
    var blockH = labelH + 13 * ui + textH + 16 * ui + bh + 15 * ui;
    var plateH = blockH + padY * 2;
    var plateW = bw + padX * 2;

    var cx = W / 2;
    var px = cx - plateW / 2;

    /* It gets out of the way of a milestone if it can, but not at any price.
       The cat sits at the middle of the screen by construction, so a panel that
       keeps sliding down to dodge a banner ends up parked on top of the player —
       which is the exact complaint that moved it up here. The ceiling wins: a
       milestone lasts five seconds and the cat is there the whole time. */
    var hardTop = Math.max(this.hudBottom || 62, (this.reserveTop || 0) + 12);
    var softTop = Math.max(hardTop, (this.reserveSoft || 0) + 12);
    var ceiling = Math.max(14, H * 0.42 - plateH);
    /* The hard floor wins outright. The ceiling used to win, and because it is
       measured DOWN from a fraction of the screen it shrinks as the message
       grows — so a long message next to a courier carrying a long message got
       shoved back up underneath the courier's panel and the two sets of words
       landed on top of each other. Reported from a phone, with a screenshot.
       A panel slightly close to the cat is awkward; two paragraphs in the same
       pixels is broken. */
    var py = Math.max(hardTop, Math.min(softTop, ceiling)) + (1 - f) * -10 * ui;
    this.readoutTop = py;      // so the layout can be asserted rather than eyeballed
    /* The box it occupies, so the things drawn on top of the world — the door
       compass most of all — can get out of its way. A chevron labelled "8.3k"
       landing in the middle of somebody's sentence is the same failure as the
       courier panel overlapping it, just from a different direction. */
    this.readoutBox = { x: px, y: py, w: plateW, h: plateH, until: this.t + 0.25 };

    ctx.globalAlpha = f;

    /* Its own ground. Behind any given message is whatever happens to be
       drifting there — often a comet at full brightness — and no amount of text
       shadow makes a serif sentence survive that. */
    ctx.save();
    var gg = ctx.createLinearGradient(0, py - 30 * ui, 0, py + plateH + 40 * ui);
    gg.addColorStop(0, 'rgba(3,3,10,0.55)');
    gg.addColorStop(0.55, 'rgba(3,3,10,0.30)');
    gg.addColorStop(1, 'rgba(3,3,10,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(0, py - 30 * ui, W, plateH + 70 * ui);

    roundRect(ctx, px, py, plateW, plateH, 16 * ui);
    ctx.fillStyle = 'rgba(7,7,17,0.82)';
    ctx.fill();
    ctx.strokeStyle = c.spec.rare ? 'rgba(255,224,170,0.26)' : 'rgba(180,176,220,0.13)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    var y = py + padY;

    // Provenance. A founding message and one a visitor left are different
    // things and the field shouldn't blur them.
    ctx.font = '500 ' + ((phone ? 10.5 : 9.5) * ui) + 'px "Space Grotesk", ui-sans-serif, sans-serif';
    ctx.letterSpacing = '0.18em';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = c.spec.rare ? 'rgba(255,214,150,0.92)' : 'rgba(146,152,184,0.8)';
    var label = originLabel(c);
    if (c.spec.rare) label = 'brilliant · ' + label;
    ctx.fillText(label.toUpperCase(), cx, y);
    ctx.letterSpacing = '0px';
    y += labelH + 13 * ui;

    // the words, which are the point
    ctx.font = '400 ' + fs + 'px Newsreader, Georgia, "Times New Roman", serif';
    ctx.fillStyle = 'rgba(247,246,255,0.97)';
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, y + i * lineH);
    y += textH + 16 * ui;

    // the spectrum, reduced to a slim rule under the text
    var bx = cx - bw / 2;
    RDF.spectrum.paintBand(ctx, c.spec, bx, y, bw, bh, { reveal: f });
    ctx.strokeStyle = c.spec.rare ? 'rgba(255,224,170,0.45)' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, y + 0.5, bw * f - 1, bh - 1);
    y += bh + 11 * ui;

    // wavelength ticks — the science tell, kept quiet
    ctx.font = ((phone ? 10 : 9) * ui) + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = 'rgba(150,158,190,0.55)';
    ctx.textAlign = 'left';
    ctx.fillText(Math.round(c.spec.startNm) + 'nm', bx, y);
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(c.spec.endNm) + 'nm', bx + bw, y);
    if (W > 520) {
      ctx.textAlign = 'center';
      ctx.fillText(c.spec.designation, cx, y);
    }

    ctx.restore();
  };

  /* A chevron at the edge of the screen pointing at the nearest brilliant
     spectrum you have not read. Without it "go and look" has no direction in
     it; with it there is always somewhere to be going. */
  Engine.prototype._drawGuide = function () {
    // reading normally silences the pointer — but not while your message is
    // being carried away by something with a clock on it
    var chasing = !!(this.mouse && this.mouse.active);
    if ((this.reading && !chasing) || this.cam.z < READ_ZOOM) return;
    var g = this._findGuide();
    if (!g) return;
    var ctx = this.ctx, W = this.W, H = this.H, z = this.zEff;

    var wx, wy;
    if (g.c) { var p = this.world.pos(g.c, this.t); wx = p.x; wy = p.y; }
    else if (g.sing) { wx = g.sing.x; wy = g.sing.y; }
    else { wx = 0; wy = 0; }
    var sx = (wx - this.cam.x) * z + W / 2, sy = (wy - this.cam.y) * z + H / 2;
    var m = 62;
    if (sx > m && sx < W - m && sy > m && sy < H - m) return;   // already on screen

    var ang = Math.atan2(sy - H / 2, sx - W / 2);
    var rx = (W / 2 - m) / Math.abs(Math.cos(ang) || 1e-4);
    var ry = (H / 2 - m) / Math.abs(Math.sin(ang) || 1e-4);
    var r = Math.min(rx, ry);
    var ex = W / 2 + Math.cos(ang) * r, ey = H / 2 + Math.sin(ang) * r;
    var near = RDF.clamp(1 - g.d / (GUIDE_NEAR / this.cam.z), 0, 1);
    var pulse = 0.55 + 0.45 * Math.sin(this.t * 2.4);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(ang);
    ctx.globalCompositeOperation = 'lighter';

    /* A brilliant one is drawn in its own spectrum, because that is what it is
       promising you. Everything else gets a single plain chevron — the point of
       those is legibility, not seduction, and a second prism on screen would
       just teach people to ignore prisms. */
    if (g.kind === 'rare') {
      var bands = g.c.spec.bands;
      for (var i = 0; i < bands.length; i++) {
        var b = bands[i].rgb;
        var o = (i - (bands.length - 1) / 2) * 1.7;
        chevron(ctx, o, 'rgba(' + b[0] + ',' + b[1] + ',' + b[2] + ',' +
          (0.30 + 0.5 * near * pulse) + ')');
      }
    } else if (g.kind === 'door') {
      // its own colour, and doubled, so it never gets mistaken for a rainbow
      var dt3 = g.sing.def.tint;
      chevron(ctx, -2.4, 'rgba(' + dt3.join(',') + ',' + (0.30 + 0.45 * pulse) + ')', 1.9);
      chevron(ctx, 2.4, 'rgba(' + dt3.join(',') + ',' + (0.30 + 0.45 * pulse) + ')', 1.9);
    } else if (g.kind === 'near') {
      chevron(ctx, 0, 'rgba(198,214,255,' + (0.5 + 0.35 * near) + ')', 1.7);
    } else {
      chevron(ctx, 0, 'rgba(255,216,168,' + (0.55 + 0.3 * pulse) + ')', 1.9);
    }
    ctx.restore();

    /* Out past everything, a chevron alone is not enough — it points, but it
       does not say whether the thing it points at is one second away or thirty.
       So when you are properly out in the empty it says so in words. */
    if (g.kind !== 'rare' && (near < 0.62 || g.kind === 'door')) {
      var label = g.kind === 'centre' ? 'the middle of the galaxy'
        : g.kind === 'door' ? g.sing.def.name
        : 'nearest rainbow';
      var lx = RDF.clamp(ex - Math.cos(ang) * 34, 74, W - 74);
      var ly = RDF.clamp(ey - Math.sin(ang) * 30, 26, H - 22);
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '10px "Space Grotesk", ui-sans-serif, sans-serif';
      ctx.letterSpacing = '0.1em';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = g.kind === 'door'
        ? 'rgba(' + g.sing.def.tint.join(',') + ',0.9)'
        : 'rgba(150,158,190,0.85)';
      ctx.shadowColor = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur = 10;
      ctx.fillText(label.toUpperCase(), lx, ly);
      ctx.letterSpacing = '0px';
    }
    ctx.restore();
  };

  function chevron(ctx, o, fill, scale) {
    var s = scale || 1;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(9 * s, o);
    ctx.lineTo(-6 * s, o - 5.5 * s);
    ctx.lineTo(-6 * s, o + 5.5 * s);
    ctx.closePath();
    ctx.fill();
  }

  function originLabel(c) {
    if (c.mine) return 'yours';
    if (!c.ts) return 'founding message';
    var days = Math.floor((Date.now() - c.ts) / 86400000);
    if (days <= 0) return 'left today';
    if (days === 1) return 'left yesterday';
    if (days < 31) return 'left ' + days + ' days ago';
    var mo = Math.round(days / 30.4);
    return 'left ' + mo + (mo === 1 ? ' month ago' : ' months ago');
  }

  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = words[i]; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /* The stick, drawn rather than built out of DOM so it lives in the same
     visual language as everything else — and so it can sit under the cat's own
     colours without a stacking context to argue with.

     At rest it is a faint ring in the corner: enough to say "put your thumb
     here", quiet enough to ignore. Under a thumb it is a ring and a knob and
     nothing else, because anything more would be decoration on top of the one
     control the player actually needs. */
  Engine.prototype._drawStick = function () {
    if (!this.coarse) return;
    var ctx = this.ctx, st = this.stick, r = this.stickRadius();
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    var home = this.stickHome();
    var bx = st.on ? st.bx : home.x, by = st.on ? st.by : home.y;

    /* At rest it is the same ring in the same place, just quieter. It never
       disappears: a stick that fades out after first use is a stick you have to
       remember the position of, and nobody should have to. */
    if (!st.on) {
      var idle = this.stickUsed ? 0.30 : 0.30 + 0.16 * Math.sin(this.t * 1.5);
      ctx.save();
      ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU);
      ctx.fillStyle = 'rgba(8,8,20,0.22)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(180,176,220,' + idle + ')';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // a resting knob, so the shape reads as a stick rather than a target
      ctx.beginPath(); ctx.arc(bx, by, r * 0.34, 0, TAU);
      ctx.fillStyle = 'rgba(214,209,240,' + (idle * 0.55) + ')';
      ctx.fill();
      if (!this.stickUsed) {
        ctx.fillStyle = 'rgba(200,196,240,' + (idle * 1.5) + ')';
        ctx.font = '500 9.5px "Space Grotesk", ui-sans-serif, sans-serif';
        ctx.textAlign = 'center';
        ctx.letterSpacing = '0.16em';
        ctx.fillText('DRIVE', bx, by + r + 15);
        ctx.letterSpacing = '0px';
      }
      ctx.restore();
      ctx.restore();
      return;
    }

    this.stickUsed = true;
    ctx.save();
    // base
    ctx.beginPath(); ctx.arc(st.bx, st.by, r, 0, TAU);
    ctx.fillStyle = 'rgba(8,8,20,0.36)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,176,220,0.30)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // how hard you are pushing, as an arc round the rim
    if (st.mag > 0.02) {
      ctx.beginPath();
      ctx.arc(st.bx, st.by, r, -Math.PI / 2, -Math.PI / 2 + TAU * st.mag);
      ctx.strokeStyle = 'rgba(220,216,255,0.55)';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
    // knob
    var kr = r * 0.42;
    var g = ctx.createRadialGradient(st.kx, st.ky, 0, st.kx, st.ky, kr);
    g.addColorStop(0, 'rgba(255,255,255,0.92)');
    g.addColorStop(0.6, 'rgba(214,209,240,0.72)');
    g.addColorStop(1, 'rgba(190,186,225,0.30)');
    ctx.beginPath(); ctx.arc(st.kx, st.ky, kr, 0, TAU);
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    ctx.restore();
  };

  Engine.prototype._drawCat = function (ctx, z) {
    var cam = this.cam, W = this.W, H = this.H, cat = this.cat;
    var sx = (cat.x - cam.x) * z + W / 2, sy = (cat.y - cam.y) * z + H / 2;
    var boost = this.boost;

    // Streaks past the camera at speed. They are drawn in screen space on
    // purpose — the point is not that the field is moving, it is that you are.
    if (boost > 0.25 && !this.reduceMotion) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(190,205,255,' + (0.16 * boost) + ')';
      ctx.lineWidth = 1;
      var ang = Math.atan2(cat.vy, cat.vx);
      var ca = Math.cos(ang), sa = Math.sin(ang);
      for (var s = 0; s < 22; s++) {
        var ph = (this.t * 1.4 + s * 0.31) % 1;
        var rad = 90 + ph * Math.max(W, H) * 0.9;
        var a2 = s * 2.399;                       // golden-angle scatter
        var px0 = W / 2 + Math.cos(a2) * rad, py0 = H / 2 + Math.sin(a2) * rad * 0.7;
        var ln = 26 + boost * 70 * (0.4 + ph);
        ctx.beginPath();
        ctx.moveTo(px0, py0);
        ctx.lineTo(px0 - ca * ln, py0 - sa * ln);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* Flat out for a couple of seconds: a shock cone ahead of her and a corona
       around her, both in her own rainbow so it reads as her going fast rather
       than as another object arriving. */
    if (this.fast > 0.01 && !this.reduceMotion) {
      var fa = this.fast;
      var dir = Math.atan2(cat.vy, cat.vx);
      var shimmer = 0.82 + 0.18 * Math.sin(this.t * 22);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(sx, sy);

      // corona
      var cr = 26 + 16 * fa;
      var cg = ctx.createRadialGradient(0, 0, cr * 0.15, 0, 0, cr);
      cg.addColorStop(0, 'rgba(255,255,255,' + (0.30 * fa * shimmer) + ')');
      cg.addColorStop(0.45, 'rgba(160,205,255,' + (0.20 * fa * shimmer) + ')');
      cg.addColorStop(1, 'rgba(120,150,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(0, 0, cr, 0, TAU); ctx.fill();

      // shock cone, opening backwards from her nose
      ctx.rotate(dir);
      for (var q = 0; q < 3; q++) {
        var ph = ((this.t * 2.6 + q / 3) % 1);
        var reach = 16 + ph * 34;
        ctx.globalAlpha = fa * (1 - ph) * 0.55 * shimmer;
        ctx.strokeStyle = 'rgba(210,232,255,1)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(reach * 0.55, -reach * 0.62);
        ctx.quadraticCurveTo(reach * 1.15, 0, reach * 0.55, reach * 0.62);
        ctx.stroke();
      }
      ctx.restore();
    }

    // rainbow trail — the classic six, because of course
    var RB = [[255, 70, 84], [255, 158, 45], [255, 232, 62], [90, 226, 118], [70, 168, 255], [172, 116, 255]];
    var tr = cat.trail;
    if (tr.length > 2) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var wpx = Math.max(3, Math.min(26, 22 * Math.pow(z / 0.52, 0.35))) * (1 + boost * 0.45);
      var sw = wpx / RB.length;
      var head = tr[tr.length - 1], tail = tr[0];
      var hx = (head.x - cam.x) * z + W / 2, hy = (head.y - cam.y) * z + H / 2;
      var txp = (tail.x - cam.x) * z + W / 2, typ = (tail.y - cam.y) * z + H / 2;
      for (var b = 0; b < RB.length; b++) {
        var col = RB[b];
        var off = (b - (RB.length - 1) / 2) * sw;
        ctx.beginPath();
        for (var i = 0; i < tr.length; i++) {
          var q = tr[i];
          var px = (q.x - cam.x) * z + W / 2, py = (q.y - cam.y) * z + H / 2;
          // offset perpendicular to the local heading
          var r = tr[Math.min(i + 1, tr.length - 1)], l = tr[Math.max(i - 1, 0)];
          var ax = (r.x - l.x), ay = (r.y - l.y);
          var m = Math.hypot(ax, ay) || 1;
          var nx = -ay / m, ny = ax / m;
          if (i === 0) ctx.moveTo(px + nx * off, py + ny * off);
          else ctx.lineTo(px + nx * off, py + ny * off);
        }
        ctx.lineWidth = sw * 1.06;
        ctx.lineCap = 'butt';
        var g = ctx.createLinearGradient(txp, typ, hx, hy);
        g.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
        g.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0.92)');
        ctx.strokeStyle = g;
        ctx.stroke();
      }
      // a white core down the middle of the ribbon when she is really moving
      if (boost > 0.15) {
        ctx.beginPath();
        for (var w2 = 0; w2 < tr.length; w2++) {
          var qq = tr[w2];
          var qx = (qq.x - cam.x) * z + W / 2, qy = (qq.y - cam.y) * z + H / 2;
          if (w2 === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
        }
        var cg = ctx.createLinearGradient(txp, typ, hx, hy);
        cg.addColorStop(0, 'rgba(255,255,255,0)');
        cg.addColorStop(1, 'rgba(255,255,255,' + (0.5 * boost) + ')');
        ctx.strokeStyle = cg;
        ctx.lineWidth = Math.max(1, sw * 0.9);
        ctx.stroke();
      }
      ctx.restore();
    }

    var spr = RDF.art.cat(boost > 0.4 ? 'tuck' : Math.floor(cat.step));
    var cell = spr.scale;
    var scale = Math.max(1.1, Math.min(3.4, 2.6 * Math.pow(z / 0.52, 0.3))) * (this.W < 640 ? 0.8 : 1);
    var dw = spr.canvas.width / cell * scale;
    var dh = spr.canvas.height / cell * scale;
    var unit = scale;                    // one grid cell, in screen px

    ctx.save();
    ctx.translate(sx, sy);
    var flip = Math.cos(cat.dir) < -0.05;
    // pitch from the heading, bank from how hard she is turning
    var tilt = (Math.sin(cat.dir) * 0.3 + cat.bank) * (flip ? -1 : 1);
    ctx.rotate(tilt);
    if (flip) ctx.scale(-1, 1);
    // stretch along travel under thrust — the oldest trick there is
    if (boost > 0.02) ctx.scale(1 + boost * 0.10, 1 - boost * 0.07);

    // the sprite is drawn with its origin here, so put the tail in the same frame
    ctx.save();
    ctx.translate(-dw * 0.42, -dh / 2);
    if (!this.reduceMotion) RDF.art.drawTail(ctx, cat.tail, unit, 1);
    ctx.restore();

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr.canvas, -dw * 0.42, -dh / 2, dw, dh);

    // Eyes. She looks at whatever she is nearest, and blinks on her own clock.
    var EYE = RDF.art.EYE, PAL = RDF.art.PAL;
    var ox = -dw * 0.42, oy = -dh / 2;
    if (cat.blink > 0) {
      ctx.fillStyle = PAL.b;
      ctx.fillRect(ox + EYE.x * unit, oy + EYE.y * unit, unit * 2, unit);
      ctx.fillStyle = PAL.o;
      ctx.fillRect(ox + EYE.x * unit, oy + (EYE.y + 0.4) * unit, unit * 2, unit * 0.45);
    } else if (this.reading) {
      var fp = this.world.pos(this.reading, this.t);
      var la = Math.atan2(fp.y - cat.y, fp.x - cat.x) - cat.dir;
      var lx = RDF.clamp(Math.cos(la) * 0.85, -0.85, 0.85) * (flip ? -1 : 1);
      var ly = RDF.clamp(Math.sin(la) * 0.7, -0.7, 0.7);
      ctx.fillStyle = PAL.w;
      ctx.fillRect(ox + EYE.x * unit, oy + EYE.y * unit, unit * 2, unit);
      ctx.fillStyle = PAL.k;
      ctx.fillRect(ox + (EYE.x + 0.6 + lx * 0.5) * unit, oy + (EYE.y + ly * 0.25) * unit, unit, unit);
    }

    // helmet — a thin ring around the head only, not the whole animal
    ctx.beginPath();
    ctx.arc(dw * 0.30, -dh * 0.10, dh * 0.36, 0, TAU);
    ctx.strokeStyle = 'rgba(190,225,255,' + (0.42 + boost * 0.3) + ')';
    ctx.lineWidth = Math.max(0.8, scale * 0.45);
    ctx.stroke();
    ctx.fillStyle = 'rgba(150,205,255,0.06)';
    ctx.fill();
    ctx.restore();

    // just enough glow that she never gets lost against a bright arm
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var gr = dh * (1.1 + boost * 0.6);
    var gg = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
    var ga = 0.10 + boost * 0.13;
    gg.addColorStop(0, 'rgba(170,190,255,' + ga + ')');
    gg.addColorStop(0.5, 'rgba(170,190,255,' + (ga * 0.3) + ')');
    gg.addColorStop(1, 'rgba(170,190,255,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(sx - gr, sy - gr, gr * 2, gr * 2);
    ctx.restore();
  };

  Engine.READ_ZOOM = READ_ZOOM;
  Engine.Z_MIN = Z_MIN;
  Engine.Z_MAX = Z_MAX;
  Engine.Z_DEF = Z_DEF;
  Engine.MILESTONES = MILESTONES;
  RDF.Engine = Engine;
  RDF.wrapText = wrap;
})(window.RDF = window.RDF || {});
