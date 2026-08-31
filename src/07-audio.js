/* Rainbow Deep Field — sound.
   Silent until you touch the screen, because autoplay policies are correct. */
(function (RDF) {
  'use strict';

  var ctx = null, master = null, padGain = null, started = false, muted = true;
  var padOscs = [], padFilt = null, noiseBuf = null;

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return ctx;
  }

  function pad() {
    if (!ctx || padGain) return;
    padGain = ctx.createGain();
    padGain.gain.value = 0.10;
    var filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 620;
    filt.Q.value = 0.6;
    padGain.connect(filt); filt.connect(master);
    padFilt = filt;

    // A very slow, very quiet drone. Three fifths, detuned.
    var freqs = [55, 82.41, 110, 164.81];
    for (var i = 0; i < freqs.length; i++) {
      var o = ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = freqs[i];
      o.detune.value = (i - 1.5) * 6;
      padOscs.push({ osc: o, base: (i - 1.5) * 6 });
      var g = ctx.createGain();
      g.gain.value = 0.24 / (i + 1);
      // breathe
      var lfo = ctx.createOscillator();
      lfo.frequency.value = 0.035 + i * 0.011;
      var lg = ctx.createGain();
      lg.gain.value = 0.12 / (i + 1);
      lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(padGain);
      o.start(); lfo.start();
    }
  }

  function unlock() {
    if (started) return;
    if (!ensure()) return;
    started = true;
    if (ctx.state === 'suspended') ctx.resume();
    pad();
    setMuted(muted);
  }

  function setMuted(m) {
    muted = m;
    if (!ctx || !master) return;
    var now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(m ? 0 : 0.5, now, 0.5);
  }

  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  /* ---------------------------------------------------------------- thrust

     The drone answers the throttle. Under boost the whole pad lifts about a
     semitone and the filter opens, which does more for the sensation of speed
     than anything on screen — you hear yourself accelerating. It slides rather
     than steps, so cruising at half throttle sits somewhere in between. */

  var thrustNow = 0;
  function thrust(v) {
    if (!ctx || !padFilt) return;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (Math.abs(v - thrustNow) < 0.02) return;
    thrustNow = v;
    var now = ctx.currentTime;
    padFilt.frequency.setTargetAtTime(620 + v * 900, now, 0.25);
    for (var i = 0; i < padOscs.length; i++) {
      padOscs[i].osc.detune.setTargetAtTime(padOscs[i].base + v * 105, now, 0.3);
    }
  }

  function noise() {
    if (noiseBuf) return noiseBuf;
    var n = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    // one deterministic pass — this is a texture, not a random event
    var s = 22222;
    for (var i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      d[i] = (s / 4294967296) * 2 - 1;
    }
    return noiseBuf;
  }

  /** The rush of hitting full throttle. Filtered noise, swept open then shut. */
  var lastWhoosh = -9;
  function whoosh() {
    if (!ctx || muted) return;
    var now = ctx.currentTime;
    if (now - lastWhoosh < 0.5) return;      // don't stack on a stuttering key
    lastWhoosh = now;
    var src = ctx.createBufferSource();
    src.buffer = noise();
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(240, now);
    f.frequency.exponentialRampToValueAtTime(2600, now + 0.28);
    f.frequency.exponentialRampToValueAtTime(700, now + 0.9);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.075, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(now); src.stop(now + 1.0);
  }

  /** Falling through the middle of the galaxy. Down, then up the other side. */
  function fall() {
    if (!ctx || muted) return;
    var now = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(320, now);
    o.frequency.exponentialRampToValueAtTime(38, now + 0.55);
    o.frequency.exponentialRampToValueAtTime(700, now + 1.5);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(2600, now);
    f.frequency.exponentialRampToValueAtTime(200, now + 0.55);
    f.frequency.exponentialRampToValueAtTime(5200, now + 1.5);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.11, now + 0.12);
    g.gain.exponentialRampToValueAtTime(0.05, now + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(now); o.stop(now + 2.0);
    // a shimmer coming out the far side
    var s = ctx.createBufferSource();
    s.buffer = noise();
    var sf = ctx.createBiquadFilter();
    sf.type = 'highpass'; sf.frequency.value = 2400;
    var sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, now + 0.6);
    sg.gain.exponentialRampToValueAtTime(0.05, now + 0.95);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    s.connect(sf); sf.connect(sg); sg.connect(master);
    s.start(now + 0.6); s.stop(now + 1.9);
  }

  /** A squeak. Two quick blips, high and rude. */
  function squeak() {
    if (!ctx || muted) return;
    var now = ctx.currentTime;
    for (var i = 0; i < 2; i++) {
      var t0 = now + i * 0.09;
      var o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(1500 + i * 320, t0);
      o.frequency.exponentialRampToValueAtTime(2300 + i * 300, t0 + 0.05);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.035, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      var f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 2;
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + 0.1);
    }
  }

  /** A rising arpeggio for a milestone. Same pentatonic world as everything else. */
  function fanfare(step) {
    if (!ctx || muted) return;
    var now = ctx.currentTime;
    var PENT = [0, 4, 7, 12, 16, 19, 24];
    var root = 52 + Math.min(step, 4) * 2;
    for (var i = 0; i < 5; i++) {
      var t0 = now + i * 0.11;
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midi(root + PENT[i]);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.10, t0 + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 5200;
      o.connect(g); g.connect(f); f.connect(master);
      o.start(t0); o.stop(t0 + 1.7);
    }
  }

  /** A chord derived from the comet's own spectrum. */
  function chime(spec, vol) {
    if (!ctx || muted) return;
    vol = vol === undefined ? 1 : vol;
    var now = ctx.currentTime;
    // brilliant spectra ring a high bell over the top of their own chord
    if (spec.rare) {
      var bo = ctx.createOscillator();
      bo.type = 'sine';
      bo.frequency.value = midi(spec.bell + 24);
      var bg = ctx.createGain();
      bg.gain.setValueAtTime(0, now);
      bg.gain.linearRampToValueAtTime(0.085 * vol, now + 0.008);
      bg.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
      bo.connect(bg); bg.connect(master);
      bo.start(now); bo.stop(now + 3.3);
    }
    for (var i = 0; i < spec.notes.length; i++) {
      var t0 = now + i * 0.055;
      var o = ctx.createOscillator();
      o.type = i === 2 ? 'sine' : 'triangle';
      o.frequency.value = midi(spec.notes[i] + 24);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.16 * vol / (i + 1), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9);
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 4200;
      o.connect(g); g.connect(f); f.connect(master);
      o.start(t0); o.stop(t0 + 2.0);
    }
  }

  /** Launch sound for when your own message goes out. */
  function launch() {
    if (!ctx || muted) return;
    var now = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, now);
    o.frequency.exponentialRampToValueAtTime(880, now + 1.1);
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(300, now);
    f.frequency.exponentialRampToValueAtTime(4000, now + 1.1);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.09, now + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(now); o.stop(now + 1.5);
  }

  RDF.audio = {
    unlock: unlock,
    chime: chime,
    launch: launch,
    thrust: thrust,
    whoosh: whoosh,
    fanfare: fanfare,
    fall: fall,
    squeak: squeak,
    setMuted: setMuted,
    isMuted: function () { return muted; }
  };
})(window.RDF = window.RDF || {});
