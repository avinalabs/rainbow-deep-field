/* Rainbow Deep Field — flying by tilting the phone.

   Holding a thumb on the glass covers part of a screen that is mostly one
   picture, and on a phone that picture is small. Tilting frees the whole
   display and turns the device into the thing you are steering, which suits a
   field you are supposed to drift around in rather than operate.

   Four things this has to get right, and they are all easy to get wrong:

   · iOS 13 and later will not deliver orientation events at all until you ask,
     and the ask only works from inside a real user gesture. So it is a button,
     not a setting applied at load.
   · Level is not flat. Nobody holds a phone at zero degrees; they hold it at
     forty-something in the hand and nearer zero on a table. So the neutral is
     whatever the device was doing the moment it was switched on, and it can be
     re-taken at any time.
   · Landscape swaps the axes and can invert them. screen.orientation.angle
     says which way round the phone is, and beta/gamma get rotated to match.
   · Not everybody can hold and tilt a phone steadily. This is off by default,
     it is one tap to turn off, and every other control keeps working while it
     is on — a finger on the glass overrides the tilt for as long as it is
     down. */
(function (RDF) {
  'use strict';

  var DEAD = 3.5;      // degrees of slack around neutral, so a still hand drifts nowhere
  var FULL = 26;       // degrees past the deadzone for full deflection
  var SMOOTH = 9;      // how fast the reading is allowed to move, per second
  var BOOST_AT = 0.86; // deflection past which the throttle opens on its own

  function Tilt(engine) {
    this.engine = engine;
    this.on = false;
    this.supported = ('DeviceOrientationEvent' in window);
    this.needsAsk = !!(window.DeviceOrientationEvent &&
      typeof window.DeviceOrientationEvent.requestPermission === 'function');
    this.zero = null;             // the pose we call level
    this.raw = { b: 0, g: 0 };
    this.x = 0; this.y = 0;       // smoothed, -1..1
    this.live = false;            // have we actually received an event
    this.onChange = null;
    this._bound = null;
  }

  Tilt.prototype._handler = function () {
    var self = this;
    return function (e) {
      if (e.beta === null && e.gamma === null) return;
      self.live = true;
      var b = e.beta || 0, g = e.gamma || 0;

      /* Rotate into screen space. In portrait, beta is the front-back tilt and
         gamma the left-right one; a quarter turn swaps them and flips a sign,
         and getting this wrong means the phone steers sideways when held
         sideways, which reads as the feature being broken rather than
         mis-mapped. */
      var a = 0;
      if (window.screen && window.screen.orientation &&
          typeof window.screen.orientation.angle === 'number') {
        a = window.screen.orientation.angle;
      } else if (typeof window.orientation === 'number') {
        a = (window.orientation + 360) % 360;
      }
      var sx, sy;
      if (a === 90) { sx = b; sy = -g; }
      else if (a === 180) { sx = -g; sy = -b; }
      else if (a === 270) { sx = -b; sy = g; }
      else { sx = g; sy = b; }

      self.raw.g = sx; self.raw.b = sy;
      if (!self.zero) self.zero = { g: sx, b: sy };
    };
  };

  /** Turn it on. Must be called from a tap — iOS refuses otherwise. */
  Tilt.prototype.enable = function (cb) {
    var self = this;
    function attach(ok) {
      if (!ok) { if (cb) cb(false, 'denied'); return; }
      if (!self._bound) {
        self._bound = self._handler();
        window.addEventListener('deviceorientation', self._bound);
      }
      self.on = true;
      self.zero = null;          // whatever pose it is in now becomes level
      self.x = self.y = 0;
      if (self.onChange) self.onChange(true);
      if (cb) cb(true);
      /* If nothing arrives, the device has no sensor whatever the feature test
         said — a desktop browser will happily report DeviceOrientationEvent and
         then never fire it. Better to switch back off and say so than to leave
         somebody tilting a laptop at a screen that ignores them. */
      setTimeout(function () {
        if (self.on && !self.live) { self.disable(); if (cb) cb(false, 'nosensor'); }
      }, 1400);
    }

    if (!this.supported) { if (cb) cb(false, 'unsupported'); return; }
    if (this.needsAsk) {
      window.DeviceOrientationEvent.requestPermission()
        .then(function (state) { attach(state === 'granted'); })
        .catch(function () { attach(false); });
    } else {
      attach(true);
    }
  };

  Tilt.prototype.disable = function () {
    if (this._bound) {
      window.removeEventListener('deviceorientation', this._bound);
      this._bound = null;
    }
    this.on = false; this.live = false; this.zero = null;
    this.x = this.y = 0;
    if (this.onChange) this.onChange(false);
  };

  Tilt.prototype.toggle = function (cb) {
    if (this.on) { this.disable(); if (cb) cb(false, 'off'); }
    else this.enable(cb);
  };

  /** Take the current pose as level again. */
  Tilt.prototype.recentre = function () {
    this.zero = { g: this.raw.g, b: this.raw.b };
    this.x = this.y = 0;
  };

  /** Called every frame by the engine. Returns null when it has nothing to say. */
  Tilt.prototype.read = function (dt) {
    if (!this.on || !this.live || !this.zero) return null;

    var dg = this.raw.g - this.zero.g;
    var db = this.raw.b - this.zero.b;

    var tx = axis(dg), ty = axis(db);
    var k = Math.min(1, dt * SMOOTH);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;

    var mag = Math.hypot(this.x, this.y);
    if (mag < 0.02) return null;
    if (mag > 1) { this.x /= mag; this.y /= mag; mag = 1; }
    return { x: this.x, y: this.y, mag: mag, boost: mag > BOOST_AT };
  };

  /* Deadzone, then a squared ramp. Linear from the deadzone felt twitchy in the
     hand: the first degree of tilt past level should barely do anything, and
     the last few should do a lot. */
  function axis(deg) {
    var s = deg < 0 ? -1 : 1;
    var m = Math.abs(deg) - DEAD;
    if (m <= 0) return 0;
    var f = Math.min(1, m / FULL);
    return s * f * f;
  }

  Tilt.DEAD = DEAD;
  Tilt.FULL = FULL;
  RDF.Tilt = Tilt;
})(window.RDF = window.RDF || {});
