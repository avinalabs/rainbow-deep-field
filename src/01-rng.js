/* Rainbow Deep Field — deterministic hashing + PRNG
   Every visitor must see the identical galaxy, so nothing here may use Math.random(). */
(function (RDF) {
  'use strict';

  // FNV-1a 32-bit, returns unsigned
  function hashStr(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  // Second, decorrelated hash so one string can seed several independent streams
  function hashStr2(str) {
    var h = 0x1000193;
    for (var i = str.length - 1; i >= 0; i--) {
      h = (h ^ str.charCodeAt(i)) >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
      h = (h ^ (h >>> 15)) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32 — small, fast, good enough distribution for visuals
  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Short, URL-safe, human-readable id from a seed (used for permalinks)
  var ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/1/i/l/o — unambiguous when read aloud
  function shortId(seed, len) {
    len = len || 6;
    var r = prng(seed >>> 0);
    var out = '';
    for (var i = 0; i < len; i++) out += ALPHABET[Math.floor(r() * ALPHABET.length)];
    return out;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  RDF.hashStr = hashStr;
  RDF.hashStr2 = hashStr2;
  RDF.prng = prng;
  RDF.shortId = shortId;
  RDF.clamp = clamp;
  RDF.lerp = lerp;
  RDF.smoothstep = smoothstep;
  RDF.easeOutCubic = easeOutCubic;
  RDF.easeInOutCubic = easeInOutCubic;
})(window.RDF = window.RDF || {});
