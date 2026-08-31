/* Rainbow Deep Field — text → spectrum
   Every message is split into light. Same words always give the same rainbow,
   and no two different messages give the same one. */
(function (RDF) {
  'use strict';

  var TAU = Math.PI * 2;

  // Wavelength (nm) → approximate sRGB. Used so the spectra read as real light,
  // not as arbitrary hues. Classic Bruton approximation.
  function nmToRGB(nm) {
    var r = 0, g = 0, b = 0;
    if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
    else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
    else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
    else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
    else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
    else if (nm <= 781) { r = 1; }
    // intensity falloff at the edges of human vision
    var f = 1;
    if (nm >= 380 && nm < 420) f = 0.3 + 0.7 * (nm - 380) / 40;
    else if (nm > 700 && nm <= 781) f = 0.3 + 0.7 * (780 - nm) / 80;
    var gamma = 0.8;
    return [
      Math.round(255 * Math.pow(Math.max(0, r) * f, gamma)),
      Math.round(255 * Math.pow(Math.max(0, g) * f, gamma)),
      Math.round(255 * Math.pow(Math.max(0, b) * f, gamma))
    ];
  }

  // Precompute the visible spectrum so we are not calling nmToRGB in the draw loop
  var LUT = [];
  for (var i = 0; i <= 256; i++) LUT.push(nmToRGB(390 + (i / 256) * 360));

  function lutColor(t) { // t 0..1 across the visible band
    var i = Math.round(RDF.clamp(t, 0, 1) * 256);
    return LUT[i];
  }

  function rgbCss(c, a) {
    return a === undefined
      ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'
      : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  // Roman numeral for the ionisation state, purely for flavour on the readout
  var ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  var ELEMENTS = ['H', 'He', 'Li', 'C', 'N', 'O', 'Ne', 'Na', 'Mg', 'Si', 'S', 'Ca', 'Fe', 'Ti', 'Kr'];

  /**
   * Build the full spectral signature for a piece of text.
   * Deterministic: analyse('hello') is byte-identical on every machine, forever.
   */
  function analyse(text) {
    var norm = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
    var h1 = RDF.hashStr(norm);
    var h2 = RDF.hashStr2(norm);
    var r = RDF.prng(h1 ^ 0x9e3779b9);

    // --- the rainbow itself -------------------------------------------------
    // Every comet is a whole rainbow — that is the non-negotiable part. What
    // varies is where the wheel starts, which way it turns, how many bands it
    // breaks into, and how saturated it burns. The wavelength axis is cyclic, so
    // a rainbow can begin at green, run to violet, wrap through red and come
    // home, and still be a complete rainbow.
    var VIS0 = 396, VISW = 348;                // the visible band, as a loop
    var offset = r();                          // where on the wheel we start
    var spanNm = VISW * (0.80 + r() * 0.30);   // never less than four fifths of it
    var reversed = r() < 0.45;                 // red-leading or violet-leading
    var bandCount = 6 + Math.floor(r() * 6);   // 6..11 discrete bands
    var sat = 0.80 + r() * 0.20;
    var lift = r() * 0.14;                     // how much white is mixed in
    var startNm = VIS0 + offset * VISW;

    var bands = [];
    for (var b = 0; b < bandCount; b++) {
      var t = bandCount === 1 ? 0.5 : b / (bandCount - 1);
      var tt = reversed ? 1 - t : t;
      var nm = VIS0 + (((offset * VISW) + tt * spanNm) % VISW);
      var c = nmToRGB(nm);
      // lift toward white so nothing reads as muddy on black
      c = [
        Math.round(RDF.lerp(c[0], 255, lift) * sat + 255 * (1 - sat) * 0.35),
        Math.round(RDF.lerp(c[1], 255, lift) * sat + 255 * (1 - sat) * 0.35),
        Math.round(RDF.lerp(c[2], 255, lift) * sat + 255 * (1 - sat) * 0.35)
      ];
      c = [RDF.clamp(c[0], 0, 255), RDF.clamp(c[1], 0, 255), RDF.clamp(c[2], 0, 255)];
      bands.push({ t: t, nm: nm, rgb: c, css: rgbCss(c) });
    }

    // One signature colour, kept aside. When the whole comet is three pixels
    // long there is no room for a gradient, and averaging the bands together
    // just produces white. Picking the "most saturated" band always lands on
    // yellow, so instead it comes straight off the hash — that spreads the
    // far-away field evenly across the whole rainbow — and then gets pushed to
    // full brightness so it survives being two pixels wide.
    var hotNm = VIS0 + r() * VISW;
    var hot = nmToRGB(hotNm);
    var peak = Math.max(hot[0], hot[1], hot[2]) || 1;
    hot = [
      Math.min(255, Math.round(hot[0] * 255 / peak)),
      Math.min(255, Math.round(hot[1] * 255 / peak)),
      Math.min(255, Math.round(hot[2] * 255 / peak))
    ];

    // --- absorption / emission lines, read straight out of the letters -------
    // This is the part that makes the readout feel like real spectroscopy: the
    // dark lines are literally the characters of the message.
    var lines = [];
    var seen = {};
    var chars = norm.replace(/[^a-z0-9]/g, '');
    for (var ci = 0; ci < chars.length && lines.length < 16; ci++) {
      var code = chars.charCodeAt(ci);
      var pos = ((code * 7919 + ci * 104729 + h2) % 10000) / 10000;
      var key = Math.round(pos * 220);
      if (seen[key]) continue;
      seen[key] = 1;
      lines.push({
        t: pos,
        depth: 0.42 + ((code * 31 + ci * 17) % 58) / 100,
        px: 1 + ((code * 13 + ci) % 3),   // real spectral lines are hairline, not barcode
        el: ELEMENTS[(code + ci) % ELEMENTS.length] + ' ' + ROMAN[(code >> 2) % ROMAN.length]
      });
    }
    lines.sort(function (a, c) { return a.t - c.t; });

    // --- physical character of the comet ------------------------------------
    var lum = 0.55 + r() * 0.45;
    var size = 0.8 + r() * 1.5;
    var tail = 0.75 + r() * 1.9;
    var wobble = 0.4 + r() * 1.4;
    var spin = (r() - 0.5) * 1.3;   // enough scatter that the field isn't marching in step

    // --- a chord you can hear ------------------------------------------------
    // Pentatonic so anything you land on is consonant with anything else.
    var PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    var root = 48 + Math.floor(r() * 12);
    var notes = [];
    for (var n = 0; n < 3; n++) {
      notes.push(root + PENT[Math.floor(r() * PENT.length)] + (n === 2 ? 12 : 0));
    }
    // a fourth note, two octaves up, only on the brilliant ones — you learn to
    // recognise the sound of finding one before you have looked at the screen
    var bell = root + 24;

    // --- flavour text --------------------------------------------------------
    var CLASS = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];
    var cls = CLASS[Math.floor(RDF.clamp((750 - (startNm + spanNm / 2)) / 330, 0, 0.999) * 7)];

    /* --- brilliance ----------------------------------------------------------
       Some spectra come out burning: near-total luminance, near-total
       saturation, and a span covering almost the whole visible band at once.
       Rare on purpose — about one in forty — and worth crossing the field for.
       The measure is built from three properties that already existed rather
       than a separate random roll, so a brilliant comet genuinely is a brighter,
       wider, purer rainbow than its neighbours, and the same sentence comes out
       brilliant on every machine, forever. */
    var brilliance = lum * sat * (spanNm / VISW);
    var rare = brilliance > 0.93;
    var designation = cls + (Math.floor(r() * 10)) + ' · ' + (lines.length) + ' lines';

    return {
      text: text,
      bands: bands,
      hot: hot,
      lines: lines,
      startNm: startNm,
      endNm: VIS0 + (((offset * VISW) + spanNm) % VISW),
      reversed: reversed,
      lum: lum,
      size: size,
      tail: tail,
      wobble: wobble,
      spin: spin,
      notes: notes,
      bell: bell,
      brilliance: brilliance,
      rare: rare,
      cls: cls,
      designation: designation,
      hash: h1,
      hash2: h2
    };
  }

  /** Paint the spectrum as a horizontal band. Used by the readout and the share card. */
  function paintBand(ctx, spec, x, y, w, h, opts) {
    opts = opts || {};
    var reveal = opts.reveal === undefined ? 1 : RDF.clamp(opts.reveal, 0, 1);
    if (reveal <= 0) return;
    var ww = w * reveal;

    var g = ctx.createLinearGradient(x, 0, x + w, 0);
    for (var i = 0; i < spec.bands.length; i++) {
      // hard edges between bands so the rainbow reads as discrete stripes, the
      // way a diffraction grating actually splits light
      var b0 = spec.bands[i];
      var lo = i === 0 ? 0 : (spec.bands[i - 1].t + b0.t) / 2;
      var hi = i === spec.bands.length - 1 ? 1 : (b0.t + spec.bands[i + 1].t) / 2;
      g.addColorStop(RDF.clamp(lo + 0.0001, 0, 1), b0.css);
      g.addColorStop(RDF.clamp(hi, 0, 1), b0.css);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, ww, h);
    ctx.clip();

    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    // vertical falloff so the band has body instead of reading as a flat swatch
    var vg = ctx.createLinearGradient(0, y, 0, y + h);
    vg.addColorStop(0, 'rgba(255,255,255,0.22)');
    vg.addColorStop(0.35, 'rgba(255,255,255,0.02)');
    vg.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = vg;
    ctx.fillRect(x, y, w, h);

    // the letters, as dark lines
    if (opts.lines !== false) {
      for (var l = 0; l < spec.lines.length; l++) {
        var ln = spec.lines[l];
        var lx = x + ln.t * w;
        ctx.fillStyle = 'rgba(3,3,12,' + (ln.depth * 0.9) + ')';
        ctx.fillRect(lx, y, ln.px * (opts.lineScale || 1), h);
      }
    }
    ctx.restore();
  }

  RDF.spectrum = {
    analyse: analyse,
    paintBand: paintBand,
    nmToRGB: nmToRGB,
    lutColor: lutColor,
    rgbCss: rgbCss
  };
})(window.RDF = window.RDF || {});
