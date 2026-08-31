/* Rainbow Deep Field — boot, interface wiring, share card. */
(function (RDF) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  // The trailer harness strips the interface out of the page, so every DOM write
  // has to tolerate the element being absent.
  var $t = function (id, v) { var e = $(id); if (e) e.textContent = v; };
  var hideId = function (id) { var e = $(id); if (e) e.classList.add('hidden'); };
  var showId = function (id) { var e = $(id); if (e) e.classList.remove('hidden'); };
  var world, engine, total = 0, booted = false;
  var lastSent = null;

  /* ------------------------------------------------------------------ boot */

  /* Building the world is linear in the number of messages, and every one of
     them runs a full spectral analysis. Measured on a phone-class CPU: 18ms for
     the 349 founding messages, 672ms at eight thousand, 6.7 SECONDS at fifty —
     and all of it on the main thread, so it is not slow, it is frozen.

     So it is built in slices. The first slice is big enough that today's field
     lands in one go and nothing about the current experience changes; anything
     beyond it fills in over the following frames while the sky is already up
     and flyable. A large field now arrives the way a deep-field exposure
     actually does, which is a better thing to watch than a white page. */

  var FIRST = 2000, CHUNK = 500;

  function boot() {
    world = new RDF.World();

    RDF.store.load().then(function (res) {
      var recs = res.records;
      world.setScale(recs.length);
      RDF.__world = world;
      total = res.total || recs.length;
      $t('stat-total', total.toLocaleString());
      $t('stat-found', RDF.store.discovered());

      var i = Math.min(FIRST, recs.length);
      for (var k = 0; k < i; k++) world.add(recs[k]);

      /* Put back anything this visitor has personally read that the current
         slice of the field does not happen to contain. Without this, a
         constellation quietly loses nodes as the corpus grows past the window
         — measured, and it is brutal: sixteen down to one. */
      var kept = RDF.store.foundKept();
      for (var q = 0; q < kept.length; q++) {
        if (!world.byId[kept[q].id]) world.add(kept[q]);
      }

      start();

      if (i >= recs.length) return;
      (function more() {
        var end = Math.min(i + CHUNK, recs.length);
        for (; i < end; i++) world.add(recs[i]);
        if (i < recs.length) { requestAnimationFrame(more); return; }
        // everything is in: pick up any finds that belong to late arrivals, and
        // let the couriers choose from the whole field rather than the first slice
        engine.restoreFound(RDF.store.foundIds(), RDF.store.foundRare());
        paintFound();
        if (engine.couriers) engine.couriers.refill();
      })();
    });
  }

  function start() {
    engine = new RDF.Engine($('sky'), world);
    engine.restoreFound(RDF.store.foundIds(), RDF.store.foundRare());
    paintFound();

    engine.onDiscover = function (c) {
      RDF.store.markFound(c, !!c.spec.rare);
      paintFound();
      hideKeys();          // they have found one; they know how to fly
      if (c.spec.rare) hint('A brilliant one. Those are about one in forty.', 3600);
    };
    engine.onMilestone = function (n) {
      RDF.audio.fanfare(RDF.Engine.MILESTONES.indexOf(n));
      milestone(n);
    };
    engine.onFocus = function (c) {
      RDF.audio.chime(c.spec, 0.9);
      showBar(c);
      document.body.classList.add('reading');
    };
    engine.onBlur = function () {
      hideBar();
      document.body.classList.remove('reading');
    };

    /* The couriers. Nine cats in their own colours, each ferrying one sentence
       across the field and stopping at comets to read them on the way. Stay
       alongside one and she hands you what she's carrying. */
    engine.couriers = new RDF.Couriers(world);
    engine.couriers.onGreet = function (c) { carry(c, false); };
    engine.couriers.onPart = function () { carry(null); };
    engine.couriers.onDeliver = function (courier, letter) {
      var p = world.pos(letter, engine.t);
      engine.burst(p.x, p.y, letter.spec, 20, 0.9);
      carry(courier, true);
      if (engine.credit(letter)) RDF.audio.chime(letter.spec, 0.8);
    };

    /* The thing at the middle. Fall in and it puts you down somewhere else in
       the arms — which is the answer to flying out past the rim and finding
       nothing in any direction. */
    /* Traffic. Something crosses the view every minute or so, a long way off,
       going somewhere else. Purely ambient — see <11-ships.js>. */
    engine.ships = new RDF.Ships();

    engine.hole = new RDF.Hole(world);
    engine.hole.onTransit = function (n) {
      hint(n === 1
        ? 'Through the middle of the galaxy, and out somewhere else entirely.'
        : 'Somewhere else entirely.', 4200);
    };

    /* The seven coloured ones. Same physics as the middle — they reach seven
       horizons and they pull harder the closer you get — but they do not put
       you down elsewhere in the arms. They put you somewhere that is not the
       field at all, for one minute, and then they give you back. */
    engine.sings = RDF.pockets.place(world);

    /* Near a door while a mouse has one of our sentences. It will not pull you
       in — that would be the game stealing the chase — but it will still take
       you if you fly into it, and the difference has to be said out loud or it
       reads as a broken door. Once per chase; a repeating tip is nagging. */
    var heldOffFor = null;
    engine.onDoorHeldOff = function (s) {
      if (heldOffFor === s) return;
      heldOffFor = s;
      hint('Chase first — ' + s.def.name + ' won’t pull you in while a mouse ' +
        'has one of ours. Fly straight into it if you want it anyway.', 4200);
    };

    engine.onPocketEnter = function (run) {
      hideBar();
      hideKeys();
      carry(null);
      chaseHUD(0, false);
      hideId('btn-leave');
      // the field's own furniture means nothing in here — a count of rainbows
      // adrift, on a screen with no rainbows in it, is just noise
      hideId('stats');
      hideId('hint');
      pocketHUD(run, true);
      milestone2(run.def.name, run.def.blurb + (run.was.n
        ? '   ·   your best here: ' + run.was.best
        : ''));
      hint(run.was.n ? 'Sixty seconds.' : 'Sixty seconds, then it gives you back.', 5000);
    };
    engine.onPocketLeave = function (run, rec) {
      pocketHUD(null);
      showId('btn-leave');
      showId('stats');
      var n = Math.round(run.score);
      if (!n) {
        // nought is not a failure, it is a first look round. Say so.
        milestone2('Back', 'That was ' + run.def.name + '. It comes round again — ' +
          'the door is still out there, and now you know what is behind it.');
        return;
      }
      RDF.audio.fanfare(rec.fresh ? 2 : 1);
      milestone2(
        n + (n === 1 ? ' point' : ' points'),
        rec.fresh
          ? 'Out of ' + run.def.name + ', and that is your best there.'
          : 'Out of ' + run.def.name + '. Your best there is ' + rec.best + '.'
      );
    };

    // Drop the explorer partway out along an arm, never the same spot twice.
    // Start next to something: an empty first screen would be a wasted opening.
    var seed = world.comets[Math.floor(Math.random() * world.comets.length)];
    engine.warp(seed.x - 260, seed.y - 150);

    var route = parseHash();
    if (route && !route.bad) { ensureRouted(route); prepareArrival(route.id); }

    // The trailer harness drives the clock itself so every frame lands on an exact
    // timestamp — real-time capture drops frames and the result stutters.
    RDF.film = {
      engine: engine,
      world: world,
      step: function (dt) { engine.update(dt); engine.draw(); },
      find: function (text) {
        for (var i = 0; i < world.comets.length; i++) {
          if (world.comets[i].text.indexOf(text) === 0) return world.comets[i];
        }
        return null;
      }
    };
    if (window.RDF_FILM) {
      engine.draw();
    } else {
      var last = performance.now();
      (function frame(now) {
        requestAnimationFrame(frame);
        if (document.hidden) { last = now; return; }   // don't burn a phone in a pocket
        /* Two clocks. `dt` is capped so a stutter cannot fling anybody across
           the field; `realDt` is what actually elapsed, for the things that are
           measuring seconds rather than simulating them. */
        var real = (now - last) / 1000;
        var dt = Math.min(0.05, real);
        engine.realDt = Math.min(0.5, real);
        last = now;
        if (!engine.paused) engine.update(dt);
        engine.draw();
        // The mouse is out in the field. While you are inside a pocket you are
        // not, so the chase band comes down and its clock stops.
        if (engine.mouse && engine.mouse.active) chaseHUD(engine.mouse.elapsed, !engine.pocket);
        if (engine.pocket) pocketHUD(engine.pocket);
      })(last);
    }

    // iOS moves the viewport around as its chrome slides; the canvas has to follow
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () { engine.resize(); reserveTop(); });
    }
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { engine.resize(); }, 220);
    });

    /* Two different machines, two different sentences. Telling a phone user
       about WASD, or a desktop user about their thumb, is how an instruction
       stops being read at all. */
    document.body.classList.add(engine.coarse ? 'is-touch' : 'is-mouse');
    var ch = $('controls-hint');
    if (ch) {
      ch.innerHTML = engine.coarse
        ? 'Thumb on the circle, bottom right — or just hold anywhere · pinch to zoom<br>get close to a rainbow and it opens by itself'
        : 'Hold the mouse down and she flies that way · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> works too<br>scroll to zoom · get close to a rainbow and it opens by itself';
    }

    booted = true;
    wire();
  }

  /* --------------------------------------------------------------- routing */

  /* A share link has to work for somebody who has never been here, on a device
     that has never seen the message. With no server to ask, the link carries the
     message itself: everything about a comet — where it sits, what colour it is,
     what note it rings — is already a pure function of its text, so the text is
     the only thing that needs to travel.

       #/m/<ts36>.<base64url text>   any visitor, any device
       #/s/<id>                      shorthand for a comet this device knows

     Anything arriving this way is untrusted — it is a string a stranger put in a
     URL — so it goes through exactly the same moderation as the compose box
     before it is allowed to appear. */

  function b64urlEncode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function parseHash() {
    var h = location.hash || '';
    var m = /^#\/?m\/([0-9a-z]+)\.([A-Za-z0-9_-]+)$/.exec(h);
    if (m) {
      var text;
      try { text = b64urlDecode(m[2]); } catch (e) { return null; }
      if (!RDF.store.moderate(text).ok) return { bad: true };
      var ts = parseInt(m[1], 36) || 0;
      return { text: text, ts: ts, id: RDF.store.makeId(text, ts) };
    }
    var s = /^#\/?s\/(\w+)/.exec(h);
    return s ? { id: s[1] } : null;
  }

  /** Make sure a routed message is actually in this visitor's sky. */
  function ensureRouted(route) {
    if (!route || route.bad || world.byId[route.id]) return;
    // An #/s/ link only names a comet; if this device has never seen it there is
    // nothing to reconstruct, and inventing one would put the word "undefined"
    // in the sky. Only a link that carries its own text can add anything.
    if (typeof route.text !== 'string' || !route.text) return;
    world.add({ id: route.id, text: route.text, ts: route.ts, lights: 0 });
    total++;
    $t('stat-total', total.toLocaleString());
  }

  function prepareArrival(id) {
    var c = world.byId[id];
    var intro = $('intro');
    if (!c || !intro) return;
    intro.querySelector('.eyebrow').textContent = 'Somebody sent you here';
    intro.querySelector('h1').innerHTML = 'Someone left<br>this for you';
    var ledes = intro.querySelectorAll('.lede');
    if (ledes[0]) ledes[0].textContent = 'There is one particular rainbow out here, and somebody you have probably never met pointed you at it on purpose.';
    if (ledes[1]) ledes[1].textContent = 'We will fly you straight to it. Everything else out here belongs to somebody else — you can go and find those too.';
    if (ledes[2]) ledes[2].textContent = 'No account, nothing to install.';
    var b = $('btn-begin');
    if (b) b.textContent = 'Take me to it';
  }


  function goToId(id, opts) {
    var c = world.byId[id];
    if (!c) { toast('That rainbow isn’t in the field yet.'); return; }
    var p = world.pos(c, engine.t);
    if (opts && opts.warp) {
      engine.warp(p.x - 900, p.y - 500);
      engine.cam.zt = 0.62;
    }
    engine.flyTo(p.x, p.y);
  }

  /* -------------------------------------------------------------- the bar */

  var barComet = null;
  function showBar(c) {
    barComet = c;
    var btn = $('btn-light'), bar = $('bar');
    if (!btn || !bar) return;
    btn.classList.toggle('lit', RDF.store.isLit(c.id));
    $t('light-n', c.lights ? c.lights : '');
    bar.classList.remove('hidden');
    reserveFoot();
  }
  function hideBar() {
    var b = $('bar'); if (b) b.classList.add('hidden');
    barComet = null; reserveFoot();
  }

  /* ------------------------------------------------------- what you've found */

  function paintFound() {
    $t('stat-found', engine.found.toLocaleString());
    var r = $('stat-rare');
    if (r) {
      r.parentNode.classList.toggle('hidden', engine.rareFound < 1);
      r.textContent = engine.rareFound;
    }
  }

  /* Milestones. Not points — the field has no score. Just an acknowledgement,
     at the handful of moments where somebody has clearly decided to stay. */
  var MILE_COPY = {
    1: ['Your first one', 'Somebody wrote that for a stranger, and now the stranger is you.'],
    5: ['Five found', 'Pull all the way out when you have a minute. You are drawing a line.'],
    25: ['Twenty-five', 'That is more of this field than most people will ever see.'],
    100: ['One hundred', 'A hundred strangers, one at a time. Your constellation is getting good.'],
    250: ['Two hundred and fifty', 'You have properly explored this thing.'],
    500: ['Five hundred', 'Genuinely, thank you for spending your evening out here.']
  };

  var mileT = null;
  function milestone2(big, small) {
    var el = $('milestone');
    if (!el) return;
    el.querySelector('b').textContent = big;
    el.querySelector('span').textContent = small;
    el.classList.add('on');
    reserveTop();
    clearTimeout(mileT);
    mileT = setTimeout(function () { el.classList.remove('on'); reserveTop(); }, 5200);
  }

  function milestone(n) {
    var el = $('milestone');
    if (!el) return;
    var copy = MILE_COPY[n] || [n + ' found', 'Keep going.'];
    el.querySelector('b').textContent = copy[0];
    el.querySelector('span').textContent = copy[1];
    el.classList.add('on');
    reserveTop();
    clearTimeout(mileT);
    mileT = setTimeout(function () { el.classList.remove('on'); reserveTop(); }, 5200);
  }

  /* ----------------------------------------------------------------- wire */

  function wire() {
    if (!$('btn-begin')) return;
    $('btn-begin').addEventListener('click', function () {
      close('intro');
      $('hud').classList.remove('hidden');
      $('stats').classList.remove('hidden');
      $('btn-leave').classList.remove('hidden');
      RDF.audio.unlock();
      RDF.audio.setMuted(false);
      $('btn-sound').classList.add('on');
      var route = parseHash();
      if (route && route.bad) toast('That link carried something this place doesn\u2019t deliver.');
      else if (route) setTimeout(function () { goToId(route.id, { warp: true }); }, 260);
      hint(engine.coarse
        ? 'Thumb on the circle, bottom right — or hold anywhere · get close to a rainbow to read it'
        : 'Hold anywhere to fly · WASD works too · get close to a rainbow to read it', 7500);
      showKeys();
      // let the intro finish leaving before the field starts counting, so the
      // first banner lands on the sky rather than on the closing sheet
      setTimeout(function () { engine.live = true; reserveTop(); }, 420);
      // the second lesson, once the first has had time to land
      setTimeout(function () {
        if (engine && engine.found < 2) hint('Shift boosts. The ⤢ button shows you the whole field.', 5200);
      }, 15000);
    });

    $('btn-help').addEventListener('click', function () { open('help'); });

    /* Two presses, because it cannot be undone and a stray tap in a help sheet
       should not cost somebody their best minute in twenty games. */
    var resetArmed = 0;
    var resetBtn = $('btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      var now = Date.now();
      if (now - resetArmed > 6000) {
        resetArmed = now;
        resetBtn.textContent = 'Sure? Press again';
        $t('reset-said', 'This clears every best score. It cannot be undone.');
        setTimeout(function () {
          if (Date.now() - resetArmed >= 5900) {
            resetBtn.textContent = 'Reset my scores';
            $t('reset-said', '');
          }
        }, 6000);
        return;
      }
      resetArmed = 0;
      var ok = RDF.store.resetScores();
      resetBtn.textContent = 'Reset my scores';
      $t('reset-said', ok ? 'Cleared. Every door is new again.' : 'Could not clear them here.');
      if (engine && engine.sings) {
        // the doors reach further for a player who has not been through them,
        // and the wide view labels them — both read the store, so refresh both
        for (var i = 0; i < engine.sings.length; i++) engine.sings[i].done = false;
      }
    });
    $('btn-leave').addEventListener('click', openCompose);

    $('btn-sound').addEventListener('click', function () {
      RDF.audio.unlock();
      var m = !RDF.audio.isMuted();
      RDF.audio.setMuted(m);
      this.classList.toggle('on', !m);
    });

    var wide = false;
    $('btn-wide').addEventListener('click', function () {
      if (engine.pocket) { hint('Not from in here. Sixty seconds.', 2600); return; }
      wide = !wide;
      this.classList.toggle('on', wide);
      if (wide) {
        engine.lock = { x: 0, y: 0 };
        engine.cam.zt = fitZoom();
        hint(engine.found > 1
          ? 'The whole field. The line through it is yours — every rainbow you have read, in the order you read them.'
          : 'The whole field. Every dot is one sentence.', 6000);
      } else {
        engine.lock = null;
        engine.cam.zt = RDF.Engine.Z_DEF;
      }
    });

    /* The chase. A mouse takes a message and runs; catching it gives the
       message back and counts as a find. It waits until somebody has read a
       few — dropping a timed chase on a visitor in their first thirty seconds
       would teach them this is an arcade game, which it is not. */
    engine.mouse = new RDF.Mouse(world, engine.hole);
    engine.mouse.onStart = function () {
      RDF.audio.whoosh();
      hideKeys();   // the chase marker lives in that corner, and it wins
      hint('A mouse just took one. Follow the red arrow and catch it.', 4600);
      chaseHUD(0, true);
    };
    engine.mouse.onDive = function () {
      hint('It went down the middle of the galaxy. Follow the red arrow in.', 4000);
    };
    engine.mouse.onLost = function () {
      chaseHUD(0, false);
      hint('It dropped the message and vanished. That one is back in the field.', 4200);
    };
    engine.mouse.onCatch = function (secs, letter) {
      chaseHUD(0, false);
      var rec = RDF.store.chase(Math.round(secs * 1000));
      RDF.audio.fanfare(2);
      if (letter) {
        var p = world.pos(letter, engine.t);
        engine.burst(p.x, p.y, letter.spec, 40, 1.6);
        engine.credit(letter);
      }
      caught(secs, letter, rec);
    };

    /* When the first one turns up.

       It was five finds and then a 70-to-140 second countdown, which put the
       first chase three to six minutes into a session — so in practice nobody
       ever met the mouse — it was reported as a missing tracking arrow when
       what was missing was the mouse itself. A feature that takes six
       minutes to appear does not exist, and a judge playing for ninety seconds
       would never have known it was there.

       Three finds and twenty-odd seconds. Long enough that you have worked out
       what the field is before something runs off with part of it; short enough
       that it actually happens. After the first, it goes back to being an
       occasional event. */
    var nextChase = 18 + Math.random() * 14;
    setInterval(function () {
      if (!engine || !engine.live || engine.mouse.active) return;
      if (engine.found < 3) return;
      nextChase -= 1;
      if (nextChase > 0) return;
      nextChase = 90 + Math.random() * 80;
      engine.mouse.start(engine);
    }, 1000);

    // and a way to summon one on demand, for filming and for checking it works
    RDF.chase = function () { return engine.mouse.start(engine); };

    /* Same for the doors: by key, by index, or a random one. Used by the
       trailer harness and by the smoke tests, which have to be able to get
       into all seven without flying to seven different places first. */
    RDF.pocket = function (which) {
      if (engine.pocket) { RDF.pockets.leave(engine); return null; }
      var list = RDF.POCKETS;
      var def = null;
      if (typeof which === 'number') def = list[which % list.length];
      else if (which) { for (var i = 0; i < list.length; i++) if (list[i].key === which) def = list[i]; }
      else def = list[Math.floor(Math.random() * list.length)];
      return def ? RDF.pockets.enter(engine, def) : null;
    };
    RDF.doors = function () {
      return engine.sings.map(function (s) {
        return { key: s.def.key, name: s.def.name, x: Math.round(s.x), y: Math.round(s.y) };
      });
    };

    /* Tilt flying, on phones that actually have the sensor.

       The button only appears once we know there is something behind it: iOS
       will not even say whether it can do this until asked from a tap, and a
       desktop browser reports DeviceOrientationEvent and then never fires it —
       so it is offered on touch devices, and quietly withdraws itself if the
       first second and a half brings no readings. */
    engine.tilt = new RDF.Tilt(engine);
    var tiltBtn = $('btn-tilt');
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (tiltBtn && engine.tilt.supported && coarse) {
      tiltBtn.classList.remove('hidden');
      tiltBtn.addEventListener('click', function () {
        engine.tilt.toggle(function (ok, why) {
          tiltBtn.classList.toggle('on', ok);
          if (ok) {
            hint('Tilt to fly. However you are holding it right now is level — lean it further to speed up.', 6000);
          } else if (why === 'denied') {
            hint('Your phone said no to motion access. You can turn it on for this site in Settings.', 5200);
          } else if (why === 'nosensor') {
            tiltBtn.classList.add('hidden');
            hint('This device does not have a tilt sensor to read.', 3600);
          }
        });
      });
      // holding the button re-takes level, for when you have shifted in your seat
      tiltBtn.addEventListener('contextmenu', function (e) {
        if (!engine.tilt.on) return;
        e.preventDefault();
        engine.tilt.recentre();
        hint('Level re-taken.', 2200);
      });
    }
    // a phone that turns over needs its axes re-read, and its neutral is stale
    window.addEventListener('orientationchange', function () {
      if (engine.tilt && engine.tilt.on) {
        setTimeout(function () { engine.tilt.recentre(); }, 320);
      }
    });

    /* Glide is the flight model. Pilot — a rate-limited heading and a throttle
       you manage yourself — stays in the engine behind M, because it was built,
       it works, and somebody will enjoy finding it. It is not advertised: two
       flight models is a setting nobody asked for, and the one that won, won. */
    var FLIGHT_COPY = {
      glide: 'Glide — she flies where you point, and carries momentum through the turn.',
      pilot: 'Pilot — you steer a heading and hold the throttle. Turns get wider the faster you go.'
    };
    function setFlight(mode) {
      engine.setFlight(mode);
      hint(FLIGHT_COPY[mode], 4200);
    }
    window.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      if (e.key === 'm' || e.key === 'M') setFlight(engine.flight === 'glide' ? 'pilot' : 'glide');
    });
    RDF.setFlight = setFlight;

    $('btn-light').addEventListener('click', function () {
      if (!barComet) return;
      var c = barComet;
      if (RDF.store.isLit(c.id)) return;
      c.lights = (c.lights || 0) + 1;
      RDF.store.light(c.id);
      this.classList.add('lit');
      $('light-n').textContent = c.lights;
      RDF.audio.chime(c.spec, 0.5);
      var p = world.pos(c, engine.t);
      engine.burst(p.x, p.y, c.spec, 22, 0.8);
    });

    $('btn-share').addEventListener('click', function () {
      if (!barComet) return;
      copy(permalink(barComet), 'Link copied — that rainbow, exactly.');
    });

    $('btn-report').addEventListener('click', function () {
      if (!barComet) return;
      RDF.store.report(barComet.id);
      toast('Reported. Thank you for keeping it clean.');
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', function () { close(b.getAttribute('data-close')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.sheet'), function (s) {
      s.addEventListener('click', function (e) {
        if (e.target === s && s.id !== 'intro') close(s.id);
      });
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        Array.prototype.forEach.call(document.querySelectorAll('.sheet.open'), function (s) {
          if (s.id !== 'intro') close(s.id);
        });
      }
    });

    // compose
    var msg = $('msg');
    msg.addEventListener('input', onType);
    $('btn-send').addEventListener('click', send);
    msg.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
    });

    $('btn-copy').addEventListener('click', function () {
      copy($('permalink').value, 'Copied.');
    });
    $('btn-dl').addEventListener('click', downloadCard);
    $('btn-goto').addEventListener('click', function () {
      close('sent');
      if (lastSent) goToId(lastSent.id, { warp: true });
    });
  }

  function fitZoom() {
    var w = Math.min(window.innerWidth, window.innerHeight);
    return RDF.clamp(w / (world.R * 2.3), engine.minZoom(), RDF.Engine.Z_MAX);
  }

  /* --------------------------------------------------------------- compose */

  function openCompose() {
    open('compose');
    setTimeout(function () { $('msg').focus(); }, 320);
    onType();
  }

  function onType() {
    var t = $('msg').value;
    $('count').textContent = t.length + ' / 160';
    var ok = RDF.store.moderate(t);
    $('btn-send').disabled = !ok.ok;
    $('err').textContent = (t.length > 3 && !ok.ok) ? ok.why : '';

    var cv = $('prev'), g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    if (t.trim().length < 2) {
      $('prev-nm').textContent = '—';
      $('prev-cls').textContent = 'awaiting light';
      g.fillStyle = '#05050e'; g.fillRect(0, 0, cv.width, cv.height);
      return;
    }
    var spec = RDF.spectrum.analyse(t);
    RDF.spectrum.paintBand(g, spec, 0, 0, cv.width, cv.height);
    $('prev-nm').textContent = Math.round(spec.startNm) + '–' + Math.round(spec.endNm) + ' nm';
    $('prev-cls').textContent = 'class ' + spec.designation;
  }

  function send() {
    var t = $('msg').value.trim();
    RDF.store.submit(t).then(function (res) {
      lastSent = res.rec;
      var c = world.add({ id: res.rec.id, text: res.rec.text, ts: res.rec.ts, mine: true, lights: 0 });
      total++;
      $t('stat-total', total.toLocaleString());
      RDF.audio.launch();
      close('compose');
      $('msg').value = '';
      setTimeout(function () {
        drawCard(c, null);
        $('permalink').value = permalink(c);
        open('sent');
      }, 420);
      if (!res.remote && window.RDF_CONFIG && window.RDF_CONFIG.endpoint) {
        setTimeout(function () { toast('Saved on this device — the field couldn’t be reached just now.'); }, 900);
      }
    }).catch(function (e) {
      $('err').textContent = (e && e.why) || 'Something went wrong. Try again.';
    });
  }

  function permalink(c) {
    var base = location.origin + location.pathname;
    if (c && c.text) return base + '#/m/' + (c.ts || 0).toString(36) + '.' + b64urlEncode(c.text);
    return base + '#/s/' + (c && c.id ? c.id : c);
  }

  /* ------------------------------------------------------------ share card */

  function drawCard(c, chase) {
    var cv = $('card'), g = cv.getContext('2d');
    var W = cv.width, H = cv.height;

    g.fillStyle = '#04040c';
    g.fillRect(0, 0, W, H);

    // stars
    var r = RDF.prng(c.spec.hash);
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 190; i++) {
      var a = 0.15 + r() * 0.6;
      g.fillStyle = 'rgba(226,232,255,' + a + ')';
      var s = r() < 0.15 ? 2 : 1;
      g.fillRect(r() * W, r() * H, s, s);
    }
    // a wash of the message's own colour
    var mid = c.spec.bands[c.spec.bands.length >> 1].rgb;
    var wash = g.createRadialGradient(W * 0.5, H * 1.15, 0, W * 0.5, H * 1.15, H * 1.1);
    wash.addColorStop(0, 'rgba(' + mid[0] + ',' + mid[1] + ',' + mid[2] + ',0.20)');
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = wash; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';

    // message
    var fs = c.text.length > 105 ? 42 : c.text.length > 62 ? 50 : 58;
    g.font = '300 ' + fs + 'px Newsreader, Georgia, serif';
    g.fillStyle = '#f6f5ff';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    var lines = RDF.wrapText(g, c.text, W - 200);
    var blockH = lines.length * fs * 1.32;
    var ty = (H - blockH) / 2 - 46;
    for (var l = 0; l < lines.length; l++) g.fillText(lines[l], W / 2, ty + l * fs * 1.32);

    // spectrum
    var bw = W - 200, bx = 100, by = ty + blockH + 46;
    RDF.spectrum.paintBand(g, c.spec, bx, by, bw, 30);
    g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 1;
    g.strokeRect(bx + .5, by + .5, bw - 1, 29);
    g.font = '400 17px ui-monospace, Menlo, monospace';
    g.fillStyle = 'rgba(190,196,226,.8)';
    g.textAlign = 'left';
    g.fillText(Math.round(c.spec.startNm) + 'nm', bx, by + 44);
    g.textAlign = 'right';
    g.fillText(Math.round(c.spec.endNm) + 'nm', bx + bw, by + 44);
    g.textAlign = 'center';
    g.fillText('the dark lines are the letters', W / 2, by + 44);

    /* If this one was taken back off a mouse, the card says so. The time is
       the whole reason somebody posts it. */
    if (chase && chase.chase) {
      g.textAlign = 'center';
      g.font = '500 15px "Space Grotesk", sans-serif';
      g.letterSpacing = '0.16em';
      g.fillStyle = 'rgba(255,214,150,.92)';
      g.fillText('RECOVERED FROM THE MOUSE IN ' + chase.chase.toFixed(1) + 's', W / 2, by + 84);
      g.letterSpacing = '0px';
    }

    // footer
    g.textAlign = 'left';
    g.font = '500 19px "Space Grotesk", sans-serif';
    g.fillStyle = 'rgba(210,206,240,.95)';
    g.fillText('RAINBOW DEEP FIELD', 100, H - 78);
    g.font = '400 17px ui-monospace, Menlo, monospace';
    g.fillStyle = 'rgba(150,146,186,.9)';
    var host = (location.host || 'rainbow deep field') + location.pathname;
    g.fillText(host.replace(/\/$/, ''), 100, H - 52);

    // the cat, bottom right, trailing colour
    var spr = RDF.art.cat();
    var sc = 3.2;
    var cw = spr.canvas.width / spr.scale * sc, ch = spr.canvas.height / spr.scale * sc;
    var cx = W - 130, cy = H - 74;
    var RB = [[255, 70, 84], [255, 158, 45], [255, 232, 62], [90, 226, 118], [70, 168, 255], [172, 116, 255]];
    var sw = ch * 0.62 / RB.length;
    for (var b = 0; b < RB.length; b++) {
      var gg = g.createLinearGradient(cx - 190, 0, cx - 10, 0);
      var col = RB[b];
      gg.addColorStop(0, 'rgba(' + col + ',0)');
      gg.addColorStop(1, 'rgba(' + col + ',.95)');
      g.fillStyle = gg;
      g.fillRect(cx - 190, cy - ch * 0.31 + b * sw, 180, sw);
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(spr.canvas, cx - cw * 0.42, cy - ch / 2, cw, ch);
  }

  function downloadCard() {
    var cv = $('card');
    cv.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'rainbow-deep-field-' + (lastSent ? lastSent.id : 'card') + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }, 'image/png');
  }

  /* --------------------------------------------------------------- helpers */

  function open(id) { var e = $(id); if (e) e.classList.add('open'); }
  function close(id) { var e = $(id); if (e) e.classList.remove('open'); }

  var toastT = null;
  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.remove('on'); }, 2600);
  }

  /* The chase clock. Called every frame, so it does as little as it can get
     away with — a class toggle and a layout pass only when something changed. */
  var chaseOn = null;
  function chaseHUD(secs, on) {
    var el = $('chase');
    if (!el) return;
    on = !!on;
    if (on) {
      var txt = secs.toFixed(1);
      var t = el.querySelector('.chase-time');
      if (t.textContent !== txt) t.textContent = txt;
    }
    if (chaseOn === on) return;
    chaseOn = on;
    el.classList.toggle('on', on);
    reserveTop();
  }

  /* The pocket band: which one you are in, what you have, and how long is
     left. The clock is a bar rather than a number because you read it out of
     the corner of your eye while flying, and "is that bar nearly empty" is a
     glance where "is that 11.4 or 41.4" is a look. */
  function pocketHUD(run, entering) {
    var el = $('pocket');
    if (!el) return;
    if (!run) { el.classList.remove('on'); reserveTop(); return; }
    if (entering) {
      el.style.setProperty('--tint', 'rgb(' + run.def.tint.join(',') + ')');
      el.querySelector('.pocket-name').textContent = run.def.name;
      el.classList.add('on');
      reserveTop();
    }
    el.querySelector('.pocket-score').textContent = Math.round(run.score);
    var frac = Math.max(0, run.left) / RDF.pockets.LENGTH;
    el.querySelector('.pocket-clock i').style.width = (frac * 100).toFixed(1) + '%';
    el.classList.toggle('urgent', run.left < 6);
    // a time penalty has to be seen, not just deducted
    el.classList.toggle('hit', run.timeHit > 0.05);
    var note = el.querySelector('.pocket-note');
    var want = run.noteFor > 0 ? run.note : '';
    if (note.textContent !== want) note.textContent = want;
  }

  /* Caught it. The prize is the message, and the card is the bragging — a
     browser-timed leaderboard is forgeable by anyone who opens the console,
     and a card somebody posts travels further than a page they glance at. */
  function caught(secs, letter, rec) {
    var best = rec.best ? (rec.best / 1000) : secs;
    milestone2(
      secs.toFixed(1) + 's',
      rec.fresh
        ? 'Caught it, and that is your best yet. It gave the message back.'
        : 'Caught it. Your best is ' + best.toFixed(1) + 's. It gave the message back.'
    );
    if (letter) {
      lastSent = { id: letter.id, text: letter.text, ts: letter.ts };
      setTimeout(function () {
        drawCard(letter, { chase: secs, best: best });
        $('permalink').value = permalink(letter);
        var sent = $('sent');
        sent.querySelector('.eyebrow').textContent = 'Got it back';
        sent.querySelector('h2').textContent = 'Caught in ' + secs.toFixed(1) + ' seconds.';
        open('sent');
      }, 900);
    }
  }

  /* How much of the top of the screen the DOM bands are using, so the canvas
     readout can keep out from under them. A band is DOM and the readout is
     canvas, so the band always wins the paint — which means a plate placed
     under one gets a headline printed through the middle of the message.

     offsetTop/offsetHeight rather than getBoundingClientRect, because both
     bands animate in on a transform and the rect would be measured mid-flight. */
  /* The top strip is shared by several bands, and more than one can be up at
     once — you can be carrying a courier's line when a pocket opens. They used
     to be pinned to fixed offsets a few pixels apart, so any overlap printed one
     readout straight through another. They are stacked here instead, in order of
     what matters most right now, so any combination lands cleanly and the canvas
     readout knows how much of the top is spoken for. */
  var BANDS = ['pocket', 'chase', 'carry'];
  function reserveTop() {
    if (!engine) return;
    /* Measured rather than assumed. The button row sits under whatever notch or
       dynamic island the device has, so its real bottom edge is the only honest
       floor for anything below it. */
    var hud = $('hud');
    var hudBottom = (hud && !hud.classList.contains('hidden'))
      ? Math.round(hud.getBoundingClientRect().bottom) + 10 : 56;
    engine.hudBottom = hudBottom;
    var y = hudBottom, any = false;
    for (var i = 0; i < BANDS.length; i++) {
      var el = $(BANDS[i]);
      if (!el) continue;
      if (el.classList.contains('on')) {
        el.style.top = y + 'px';
        y += el.offsetHeight + 10;
        any = true;
      }
    }
    /* Two floors, because the two things below are not the same kind of thing.

       The bands — a pocket score, a chase clock, what a courier is carrying —
       stay up for as long as their situation lasts, and they are text. The
       message readout is also text. Text over text is the one outcome that is
       never acceptable, so `reserveTop` is a hard floor the readout always
       clears.

       A milestone is a five-second banner. Sliding the readout down past a tall
       one parks it on the cat, who is at the centre of the screen the whole
       time — so that one is a preference, not a rule, and it lives separately. */
    var top = any ? y : 0;
    engine.reserveTop = top ? top + 16 : 0;
    var m = $('milestone');
    if (m && m.classList.contains('on')) top = Math.max(top, m.offsetTop + m.offsetHeight);
    engine.reserveSoft = top ? top + 16 : 0;
    reserveFoot();
  }

  /* The same honesty at the other end. The thumb stick and the door compass are
     drawn on the canvas, and the buttons are DOM on top of it, so without a
     measured floor the stick ends up drawn straight through "Leave one" — which
     is what happened, and which makes both of them look broken. */
  function reserveFoot() {
    if (!engine) return;
    var lowest = 0;
    var ids = ['btn-leave', 'bar', 'hint'];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (!el || el.classList.contains('hidden')) continue;
      var r = el.getBoundingClientRect();
      if (r.height > 0) lowest = Math.max(lowest, Math.round(engine.H - r.top));
    }
    engine.footTop = lowest ? lowest + 14 : 28;
  }

  /* The courier band: her face, her name, her colour, her letter.

     On the first build this was white text in a white typeface at the top of a
     screen, and people read the sentence without ever connecting it to the cat
     they were flying beside. Now the band carries her portrait in her own coat,
     names her by it, and sets the sentence in her ribbon colour — the same
     colour as the trail streaming off her ten feet away. */
  var carryT = null, holdingCourier = false;
  var CARRY_HOLD = 3.0;          // seconds a courier keeps the screen

  function carry(c, delivered) {
    var el = $('carry');
    if (!el) return;
    holdingCourier = !!c && !delivered;
    if (!c) {
      clearTimeout(carryT);
      el.classList.remove('on');
      if (engine) engine.carryHold = 0;
      reserveTop();
      return;
    }
    var col = 'rgb(' + RDF.Couriers.speech(c.ribbon).join(',') + ')';
    var img = $('carry-cat');
    if (img) img.src = RDF.Couriers.portrait(c.coat);
    var head = el.querySelector('.carry-head');
    head.textContent = delivered
      ? 'The ' + c.coat.name + ' one gave you this'
      : 'The ' + c.coat.name + ' one is carrying';
    head.style.color = col;
    var txt = el.querySelector('.carry-text');
    txt.textContent = c.letter.text;
    txt.style.color = col;
    el.classList.add('on');
    reserveTop();

    /* Hold it for long enough to actually be read. A courier drawing alongside
       and handing something over used to share the screen with whatever rainbow
       you happened to be next to, and could be gone again before you had
       finished the first line. It gets the screen to itself, and it gets three
       seconds. */
    if (engine) engine.carryHold = engine.t + CARRY_HOLD;
    clearTimeout(carryT);
    carryT = setTimeout(function () {
      // she has said her piece; let the field have the screen back
      var e = $('carry');
      if (e && !holdingCourier) { e.classList.remove('on'); reserveTop(); }
    }, CARRY_HOLD * 1000 + 900);
  }

  /* The keyboard legend. Up while somebody is still working out the controls,
     gone once they clearly are not — whichever comes first, a first find or a
     good half minute of flying. */
  var keysT = null;
  function showKeys() {
    var el = $('keys');
    if (!el) return;
    el.classList.remove('hidden', 'out');
    clearTimeout(keysT);
    keysT = setTimeout(hideKeys, 34000);
  }
  function hideKeys() {
    var el = $('keys');
    if (!el || el.classList.contains('out')) return;
    clearTimeout(keysT);
    el.classList.add('out');
    setTimeout(function () { el.classList.add('hidden'); }, 1000);
  }

  var hintT = null;
  function hint(msg, ms) {
    // nothing the field wants to tell you applies in a pocket, and a timed
    // tip about the wide view landing over a minigame is just litter
    if (engine && engine.pocket) return;
    var el = $('hint');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(hintT);
    hintT = setTimeout(function () { el.classList.add('hidden'); }, ms || 5000);
  }

  function copy(text, ok) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(ok); },
        function () { fallbackCopy(text, ok); });
    } else fallbackCopy(text, ok);
  }
  function fallbackCopy(text, ok) {
    var i = document.createElement('textarea');
    i.value = text; i.style.position = 'fixed'; i.style.opacity = '0';
    document.body.appendChild(i); i.select();
    try { document.execCommand('copy'); toast(ok); } catch (e) { toast('Copy this: ' + text); }
    i.remove();
  }

  RDF.toast = toast;
  RDF.boot = boot;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot, boot);
      else boot();
    });
  } else {
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot, boot);
    else boot();
  }
  void booted;
})(window.RDF = window.RDF || {});
