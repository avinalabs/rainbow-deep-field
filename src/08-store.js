/* Rainbow Deep Field — where the messages live.

   Two layers:
     1. The founding messages, bundled in the page. Always present.
     2. Everything real people have left, from a shared backend.

   If the backend is unreachable the sky still works — you just only see the
   founding messages plus your own. The site is never broken. */
(function (RDF) {
  'use strict';

  var CFG = window.RDF_CONFIG || {};
  var LS_MINE = 'rdf.mine.v1';
  var LS_SEEN = 'rdf.seen.v1';
  var LS_FOUND = 'rdf.found.v1';
  var LS_CHASE = 'rdf.chase.v1';
  var LS_LIT = 'rdf.lit.v1';
  var LS_LAST = 'rdf.last.v1';
  var LS_POCKET = 'rdf.pocket.v1';
  var COOLDOWN_MS = 3 * 60 * 1000;

  function lsGet(k, d) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }
    catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ }
  }

  function makeId(text, ts) {
    return RDF.shortId(RDF.hashStr(text + '|' + ts) ^ RDF.hashStr2(String(ts)), 7);
  }

  /* ------------------------------------------------------------ moderation */

  // Normalise the usual evasions before matching.
  function normalise(s) {
    return s.toLowerCase()
      .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
      .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u')
      .replace(/[0]/g, 'o').replace(/[1!|]/g, 'i').replace(/[3]/g, 'e')
      .replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/[7]/g, 't')
      .replace(/[^a-z ]/g, '');
  }

  /* Two lists, because one was quietly wrong.

     The old check collapsed every space and then looked for each blocked term
     as a substring — which defeats "f u c k" and also refuses "who remembers",
     because whoremembers contains whore. That is not hypothetical: two of the
     349 founding messages were unpublishable, and so was the word "whoever",
     which is close to this project's native vocabulary ("to whoever got
     rejected today"). "grapefruit", "peacock", "auspicious" and "Dickens" went
     the same way.

     So: WORDS match on word boundaries, where a prefix is deliberate (nigg,
     fagg) and everything else is a whole word. Letter-spacing evasion is
     handled by collapsing runs of single letters first, which turns "f u c k"
     into fuck and leaves "who remembers" alone. FRAGMENTS are compounds that
     have no innocent substring reading, so they can still match anywhere. */
  var WORDS = [
    'fuck', 'fucking', 'shit', 'bitch', 'cunt', 'asshole', 'arsehole', 'bastard',
    'dick', 'cock', 'pussy', 'whore', 'slut', 'rape', 'raping', 'rapist',
    'nigg\\w*', 'fagg\\w*', 'retard', 'retarded', 'tranny', 'kike', 'spic',
    'chink', 'wetback', 'kys', 'suicide', 'nazi', 'hitler', 'porn', 'crypto',
    'nft', 'airdrop', 'subscribe'
  ];
  var BLOCK_RE = new RegExp('\\b(?:' + WORDS.join('|') + ')\\b');
  var FRAGMENTS = [
    'killyourself', 'killurself', 'hangyourself', 'onlyfans',
    'freemoney', 'buynow', 'clickhere', 'followme', 'promocode'
  ];

  /* "f u c k" and "f-u-c-k" become fuck; "who remembers" stays two words. Only
     runs of THREE or more single letters collapse, so ordinary prose — "a bit
     of it", "i am a" — is untouched. */
  function despace(n) {
    return n.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, function (run) { return run.replace(/ /g, ''); });
  }

  function moderate(text) {
    var t = String(text || '').trim();
    if (t.length < 8) return { ok: false, why: 'A little longer — give them a whole thought.' };
    if (t.length > 160) return { ok: false, why: 'Keep it under 160 characters. Short travels further.' };
    if (/https?:\/\/|www\.|\.(com|net|org|io|co|xyz|ru)\b/i.test(t))
      return { ok: false, why: 'No links out here. Just words.' };
    if (/[\w.+-]+@[\w-]+\.\w+/.test(t))
      return { ok: false, why: 'Leave your email out of it — this is anonymous, and safer that way.' };
    if (/@\w{2,}|(?:^|\s)#\w+/.test(t))
      return { ok: false, why: 'No handles or hashtags. This isn\'t that kind of place.' };
    if (/(\+?\d[\d\s().-]{7,}\d)/.test(t))
      return { ok: false, why: 'That looks like a phone number. Leave it out.' };
    if (/(.)\1{5,}/.test(t))
      return { ok: false, why: 'Too many repeated characters.' };
    var letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length > 12 && letters === letters.toUpperCase())
      return { ok: false, why: 'Try it without the shouting.' };

    var n = normalise(t);
    var unspaced = despace(n);
    var flat = n.replace(/ /g, '');
    if (BLOCK_RE.test(n) || BLOCK_RE.test(unspaced)) {
      return { ok: false, why: 'That one won\'t make it. This place only carries kind things.' };
    }
    for (var i = 0; i < FRAGMENTS.length; i++) {
      if (flat.indexOf(FRAGMENTS[i]) !== -1) {
        return { ok: false, why: 'That one won\'t make it. This place only carries kind things.' };
      }
    }
    if (cruel(n)) {
      return { ok: false, why: 'That one won\'t make it. This place only carries kind things.' };
    }
    return { ok: true };
  }

  /* Cruelty in ordinary words.

     The block list above catches slurs and profanity, which is the easy half.
     The half that matters more in a place like this is a sentence built
     entirely out of words no filter objects to, which exists only to hurt
     whoever finds it: "you are worthless", "nobody loves you", "you should
     give up". Those sail straight through a profanity list, and they are
     exactly what somebody would write to poison a sky whose entire promise is
     that every rainbow in it is a kind thing a stranger left.

     Negation is the whole difficulty, and it is not a corner case — the
     founding messages are full of "you are not a burden" and "it is not too
     late", which are the same words doing the opposite job. So this looks for a
     demeaning word aimed at the reader and stands down when the sentence is
     denying it. Checked against every founding message: none are refused. */

  var HARSH = ('worthless useless pathetic hopeless disgusting repulsive unlovable ' +
    'unloved unwanted stupid idiot idiotic moron moronic dumb ugly hideous ' +
    'loser failure pitiful contemptible insufferable despicable vile').split(' ');

  // whole phrases that need no second person nearby to be what they are
  var SPITE = [
    'nobody loves you', 'no one loves you', 'nobody cares about you',
    'no one cares about you', 'nobody will miss you', 'no one will miss you',
    'everyone hates you', 'everybody hates you', 'nobody likes you',
    'no one likes you', 'you should give up', 'you should quit',
    'you deserve to suffer', 'you deserve this', 'you are a mistake',
    'you were a mistake', 'go away and never', 'drop dead', 'shut up',
    'you ruin everything', 'you always ruin', 'the world is better without you',
    'nobody wants you here', 'you dont belong here', 'you do not belong here'
  ];

  /* Words that may sit between "you" and the harsh word without breaking the
     accusation: copulas, articles, intensifiers. Anything else ends the run,
     which is what keeps "i hope you laugh at something stupid today" and "the
     version of you that felt stupid" out of it — there the harsh word is
     describing something else entirely. */
  var LINK = ('are is was were am be been being r look looks looked seem seems ' +
    'seemed sound sounds feel feels felt a an the so such just really totally ' +
    'completely absolutely utterly always still pretty very too quite have has ' +
    'had all both kind sort bit complete total utter absolute right proper ' +
    'massive huge big giant one').split(' ');

  var NEGATE = ('not never no arent isnt aint wasnt werent dont doesnt didnt ' +
    'cant cannot wont couldnt shouldnt neither nor anything but far less least ' +
    'stop stopped hardly barely').split(' ');

  function cruel(n) {
    for (var s = 0; s < SPITE.length; s++) {
      if (n.indexOf(SPITE[s]) !== -1) return true;
    }
    var words = n.split(' ');
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w !== 'you' && w !== 'youre' && w !== 'ur' && w !== 'u' && w !== 'yous') continue;
      // walk forward while the words are still part of "you are ... X"
      var denied = (w === 'youre' && false);
      for (var j = i + 1; j < Math.min(words.length, i + 7); j++) {
        var v = words[j];
        if (HARSH.indexOf(v) !== -1) { if (!denied) return true; break; }
        if (NEGATE.indexOf(v) !== -1) { denied = true; continue; }
        if (LINK.indexOf(v) === -1) break;      // the sentence moved on
      }
    }
    return false;
  }

  function cooldownLeft() {
    var last = lsGet(LS_LAST, 0);
    var left = COOLDOWN_MS - (Date.now() - last);
    return left > 0 ? left : 0;
  }

  /* --------------------------------------------------------------- backend */

  /* Supabase, spoken directly over PostgREST — no client library, because the
     whole point of this page is that it is one file with no dependencies.

     The anon key below is public by design: it identifies the project, it does
     not authorise anything. The database refuses every direct write, and the
     three functions it does expose re-run the moderation and the rate limit
     server-side. See supabase/schema.sql. */

  var SB = CFG.supabase || null;

  /* Supabase has two generations of client key in circulation: the legacy JWT
     'anon' key (starts eyJ) and the newer publishable key (sb_publishable_…).
     A legacy key is expected in both apikey and Authorization; a publishable one
     is only permitted in Authorization when it exactly matches apikey, so the
     simplest correct thing is to send it in apikey alone. Either works here. */
  function sbHeaders() {
    var key = SB.anonKey || SB.publishableKey || '';
    var h = { 'Content-Type': 'application/json', apikey: key };
    if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key;
    return h;
  }

  function sbFetch(path, opts) {
    if (!SB) return Promise.reject(new Error('no-backend'));
    var ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, 9000);
    opts = opts || {};
    return fetch(SB.url.replace(/\/$/, '') + path, {
      method: opts.method || 'GET',
      signal: ctl.signal,
      headers: sbHeaders(),
      body: opts.body
    }).then(function (r) {
      clearTimeout(to);
      return r.text().then(function (raw) {
        var data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (e) { /* not json */ }
        if (!r.ok) {
          var err = new Error('http-' + r.status);
          err.status = r.status;
          err.detail = (data && (data.message || data.hint)) || raw;
          throw err;
        }
        return data;
      });
    });
  }

  function rpc(name, args) {
    return sbFetch('/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(args) });
  }

  /* The database speaks in errors like 'rejected: unkind'. Turn those into
     something a person would want to read. */
  function humanise(err) {
    var d = String((err && err.detail) || '');
    if (/slow down/i.test(d)) return { why: 'One rainbow at a time. Give it a few minutes.' };
    if (/enough for today/i.test(d)) return { why: 'That is plenty for one day. Come back tomorrow.' };
    if (/unkind/i.test(d)) return { why: 'That one won\u2019t make it. This place only carries kind things.' };
    if (/no links/i.test(d)) return { why: 'No links out here. Just words.' };
    if (/no email|no numbers|no handles/i.test(d)) return { why: 'Leave contact details out of it.' };
    if (/too short/i.test(d)) return { why: 'A little longer \u2014 give them a whole thought.' };
    if (/too long/i.test(d)) return { why: 'Keep it under 160 characters.' };
    if (/shouting/i.test(d)) return { why: 'Try it without the shouting.' };
    if (/repeated/i.test(d)) return { why: 'Too many repeated characters.' };
    return null;
  }

  var remoteOK = false;

  /* Three layers, in order of how certain we are to have them.

       1. the founding messages, compiled in — always present
       2. the baked snapshot from bake.js — everything real people had left as
          of the last deploy, also compiled in
       3. whatever is newer than the snapshot, from Supabase

     The third request used to be the whole field, which meant nothing appeared
     until the network answered and a paused free project emptied the sky down
     to the 349 founding messages. Now it asks only for what the page does not
     already have, so it is usually zero rows, and if it never answers at all
     the field is still as full as it was on deploy day. */

  function load() {
    var seeds = RDF.SEEDS.map(function (text) {
      return { id: makeId(text, 0), text: text, ts: 0, seed: true, lights: 0 };
    });
    var harvest = (RDF.HARVEST || []).map(function (r) {
      return { id: r[0], text: r[1], ts: r[2] || 0, lights: r[3] || 0 };
    });
    var mine = lsGet(LS_MINE, []);
    var local = seeds.concat(harvest, mine.map(function (m) { m.mine = true; return m; }));

    var seen = {}, byText = {};
    local = local.filter(function (r) {
      if (seen[r.id] || byText[r.text]) return false;
      seen[r.id] = 1; byText[r.text] = 1;
      return true;
    });

    if (!SB) return Promise.resolve({ records: local, remote: false });

    var since = RDF.HARVEST_TS || 0;
    var q = '/rest/v1/messages?select=id,body,ts,lights&order=ts.desc&limit=8000';
    if (since) q += '&ts=gt.' + since;

    return sbFetch(q)
      .then(function (rows) {
        remoteOK = true;
        var extra = [];
        (rows || []).forEach(function (r) {
          if (seen[r.id] || byText[r.body]) return;
          if (!moderate(r.body).ok) return;      // the snapshot is filtered; so is this
          seen[r.id] = 1; byText[r.body] = 1;
          extra.push({ id: r.id, text: r.body, ts: Number(r.ts) || 0, lights: r.lights || 0 });
        });
        return { records: local.concat(extra), remote: true, fresh: extra.length };
      })
      .catch(function () {
        return { records: local, remote: false };   // the sky still works offline
      });
  }

  function submit(text) {
    var m = moderate(text);
    if (!m.ok) return Promise.reject(m);
    var left = cooldownLeft();
    if (left > 0) {
      return Promise.reject({ why: 'One rainbow at a time. Try again in ' + Math.ceil(left / 60000) + ' min.' });
    }
    var body = text.trim();
    var ts = Date.now();
    var rec = { id: makeId(body, ts), text: body, ts: ts, mine: true, lights: 0 };

    function keepLocally(r) {
      var mine = lsGet(LS_MINE, []);
      mine.push({ id: r.id, text: r.text, ts: r.ts });
      lsSet(LS_MINE, mine);
      lsSet(LS_LAST, Date.now());
    }

    if (!SB) { keepLocally(rec); return Promise.resolve({ rec: rec, remote: false }); }

    return rpc('leave_message', { p_text: body, p_id: rec.id })
      .then(function (rows) {
        var row = rows && rows[0];
        if (row) { rec.id = row.id; rec.ts = Number(row.ts) || rec.ts; }
        keepLocally(rec);
        return { rec: rec, remote: true };
      })
      .catch(function (err) {
        var nice = humanise(err);
        if (nice) throw nice;                       // the server said no, and meant it
        keepLocally(rec);                           // the server was merely unreachable
        return { rec: rec, remote: false };
      });
  }

  function light(id) {
    var lit = lsGet(LS_LIT, {});
    if (lit[id]) return Promise.resolve({ already: true });
    lit[id] = 1; lsSet(LS_LIT, lit);
    if (!SB) return Promise.resolve({ remote: false });
    return rpc('light_message', { p_id: id }).catch(function () { return {}; });
  }

  function isLit(id) { return !!lsGet(LS_LIT, {})[id]; }

  function report(id) {
    if (!SB) return Promise.resolve({});
    return rpc('report_message', { p_id: id }).catch(function () { return {}; });
  }

  /* ------------------------------------------------------- what you've found

     Which rainbows you have read, in the order you read them. This is the only
     thing the field remembers about a visitor, it never leaves the device, and
     it is what your constellation is drawn from — the shape of it is a record
     of one particular evening of flying around, and no two are alike.

     Capped: past a few thousand the constellation is an unreadable scribble and
     localStorage starts to matter. The oldest finds fall off the front. */

  var FOUND_CAP = 3000;

  /* Finds keep their text, not just their id, and that is a bug fix rather than
     a feature.

     The field a visitor loads is a window on the corpus — the newest few
     thousand — and it always was. So a message you read in week one falls out
     of that window in week four, restoreFound cannot find the id, and the node
     silently disappears from your constellation. Reproduced without any
     sharding at all: a corpus of 600 with a 400-message window took a
     sixteen-node constellation down to one, while the counter still cheerfully
     said seventeen.

     Carrying the text means anything you have personally read is re-added to
     the sky whatever slice happens to be loaded. Your constellation is yours
     and it does not evaporate because other people have been busy. It is also
     the thing that would have to exist before the field could ever be split
     across rotating files.

     Bounded at 800: the sky only needs to rebuild what you might still be
     looking at, and unbounded text in localStorage is how you end up wedged
     against a five megabyte quota with no way to recover. */
  var KEEP_CAP = 800;

  function foundState() {
    var s = lsGet(LS_FOUND, null);
    if (!s || !s.ids) {
      // carry over the plain counter kept by earlier versions, so somebody who
      // has been here before doesn't get told they have found nothing
      var old = lsGet(LS_SEEN, { n: 0 });
      s = { ids: [], rare: 0, prior: old.n || 0 };
    }
    if (!s.ids) s.ids = [];
    return s;
  }

  function markFound(c, isRare) {
    var id = c && c.id ? c.id : c;
    var s = foundState();
    if (s.ids.indexOf(id) !== -1) return { count: total(s), fresh: false };
    s.ids.push(id);
    if (isRare) s.rare = (s.rare || 0) + 1;
    if (s.ids.length > FOUND_CAP) s.ids.splice(0, s.ids.length - FOUND_CAP);
    if (c && c.text) {
      s.keep = s.keep || [];
      s.keep.push([id, c.text, c.ts || 0]);
      if (s.keep.length > KEEP_CAP) s.keep.splice(0, s.keep.length - KEEP_CAP);
    }
    lsSet(LS_FOUND, s);
    return { count: total(s), fresh: true, rare: s.rare || 0 };
  }

  /** Everything you have read that we can rebuild from this device alone. */
  function foundKept() {
    var k = foundState().keep || [];
    return k.map(function (r) { return { id: r[0], text: r[1], ts: r[2] || 0 }; });
  }

  function total(s) { return (s.prior || 0) + s.ids.length; }

  function foundIds() { return foundState().ids; }
  function foundRare() { return foundState().rare || 0; }
  function isFound(id) { return foundState().ids.indexOf(id) !== -1; }

  function discovered() { return total(foundState()); }

  /* Your best chase, kept on this device and nowhere else. No leaderboard:
     a browser-timed score is forgeable by anyone who opens the console, and a
     public top-20 whose first rows are obvious fakes is worse than no board at
     all. The share card is the bragging mechanism instead — and a card someone
     posts does more than a page they glance at once. */
  function chase(ms) {
    var s = lsGet(LS_CHASE, { best: 0, n: 0 });
    if (ms) {
      s.n = (s.n || 0) + 1;
      if (!s.best || ms < s.best) { s.best = ms; s.fresh = true; }
      else s.fresh = false;
      lsSet(LS_CHASE, s);
    }
    return s;
  }

  /* Pocket bests. One number per pocket, kept on this device — same reasoning
     as the chase clock. `n` is how many times you have been through that door,
     which is what decides whether we still explain the rules on the way in. */
  function pocketBest(key) {
    var s = lsGet(LS_POCKET, {});
    var r = s[key];
    if (!r) return { best: 0, n: 0 };
    return { best: r[0] || 0, n: r[1] || 0 };
  }

  function pocketScore(key, n) {
    var s = lsGet(LS_POCKET, {});
    var r = s[key] || [0, 0];
    var fresh = n > (r[0] || 0);
    s[key] = [fresh ? n : r[0], (r[1] || 0) + 1];
    lsSet(LS_POCKET, s);
    return { best: s[key][0], n: s[key][1], fresh: fresh && n > 0 };
  }

  /** Every pocket you have ever been inside, for the wide-view legend. */
  function pocketsSeen() {
    var s = lsGet(LS_POCKET, {}), out = {};
    for (var k in s) if (s.hasOwnProperty(k)) out[k] = { best: s[k][0] || 0, n: s[k][1] || 0 };
    return out;
  }

  function myMessages() { return lsGet(LS_MINE, []); }

  RDF.store = {
    load: load,
    submit: submit,
    light: light,
    isLit: isLit,
    report: report,
    moderate: moderate,
    discovered: discovered,
    markFound: markFound,
    foundIds: foundIds,
    foundKept: foundKept,
    foundRare: foundRare,
    isFound: isFound,
    chase: chase,
    pocketBest: pocketBest,
    pocketScore: pocketScore,
    pocketsSeen: pocketsSeen,
    myMessages: myMessages,
    cooldownLeft: cooldownLeft,
    makeId: makeId,
    hasRemote: function () { return remoteOK; },
    configured: function () { return !!SB; }
  };
})(window.RDF = window.RDF || {});
