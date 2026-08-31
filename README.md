# Rainbow Deep Field

**A galaxy where every rainbow is one kind sentence somebody left for a stranger.**

You fly a small cat with a rainbow trail through a spiral galaxy in your browser. Every comet drifting out there is a single anonymous message. Drift close enough and it opens by itself and you can read it. Then you leave one of your own, and it becomes a rainbow nobody else has, and it stays out there.

Built solo in eight days for a hackathon. Theme: *discover unexpectedly wholesome space rainbows.*

---

## How to use it

Three things:

1. **Fly.** Hold down anywhere and the cat flies toward it. Or `W` `A` `S` `D`. Scroll or pinch to zoom.
2. **Read.** Drift close to any rainbow and it opens on its own. No clicking.
3. **Leave one.** One kind sentence, up to 160 characters. You get a link that drops anyone straight onto your rainbow.

Zoom all the way out and the whole field turns out to be a spiral galaxy made of these things.

---

## The part that isn't obvious

**Every message generates its own spectrum from its own text.** The coloured band under a message isn't decoration — it's that sentence split into light. Where the rainbow starts on the visible spectrum, which direction it runs, how many bands it breaks into, how saturated it burns: all of it is hashed out of the words. The dark absorption lines running through the band are the individual characters of the sentence, placed at wavelengths derived from their character codes.

Same words always give the same rainbow. Different words never do. This is roughly how we actually learned what stars are made of — helium was found in the sun's spectrum before anyone found it on Earth.

**The galaxy grows.** Its radius is set from the population — `R = 980 × √n` — so on-screen density stays constant no matter how many messages are in it, and the spiral visibly gets bigger as more people leave one.

**Nothing is random at runtime.** Every position, colour, drift and chime comes from a seeded hash of the message itself, never `Math.random()`. Two people on opposite sides of the world are looking at the identical galaxy, and a permalink still points at the same comet a year later.

---

## Running it

The whole thing is one self-contained HTML file. No build step to view it, no server, no dependencies at runtime, no third-party requests — the typefaces are embedded in the page.

```
open docs/index.html
```

To work on it:

```
npm install          # only needed for the fonts and the render harness
node build.js        # src/ → dist/index.html, dist/preview.html, docs/index.html
node shoot.js        # drives the whole flow headlessly and screenshots it
node trailer.js wide # renders trailer frames
./assemble.sh wide   # cuts them together with the score
```

`docs/` is what GitHub Pages serves.

### Layout

| file | what it does |
|---|---|
| `src/01-rng.js` | hashing and seeded PRNG — the reason the galaxy is the same for everybody |
| `src/02-spectrum.js` | text → rainbow, absorption lines, and a three-note chime |
| `src/03-seeds.js` | the founding messages |
| `src/04-world.js` | spiral placement, spatial hash, nearest-neighbour |
| `src/05-art.js` | the cat, the nebulae, the star layers, the galactic dust |
| `src/06-engine.js` | camera, input, and the draw loop |
| `src/07-audio.js` | ambient drone and per-message chimes |
| `src/08-store.js` | persistence and moderation |
| `src/09-main.js` | boot, interface, share card |
| `score.py` | the trailer's music, synthesised from scratch |

---

## The shared sky

By default the field runs on its founding messages alone — no server, no accounts, no requests. Point it at a Supabase project (`SUPABASE.md`, about ten minutes) and messages start accumulating in one sky everybody adds to.

Either way, a share link works: it carries the message itself, so the rainbow reconstructs from the text on a device that has never seen the site. If the database is unreachable the field simply falls back to the founding messages and keeps working.

## Privacy

No accounts, no cookies, no analytics, no third-party requests of any kind. Messages are anonymous and nothing about who wrote them is recorded. The only thing kept in your browser is which rainbows you've already found, so the counter works.

## Moderation

Messages are filtered for profanity, slurs, links, contact details, handles and shouting before they go anywhere, there's a cooldown between submissions, and anything that slips through can be reported from the message itself.

## Provenance

The field opened with a few hundred founding messages so it was never empty. Every rainbow tells you which it is when you read it — `FOUNDING MESSAGE`, or the day somebody left it.

## The cat

She is not Nyan Cat. Nyan Cat is Christopher Torres' character and this isn't it — different silhouette, different palette, no pop-tart, and she wears a helmet, because space.

## Licence

MIT. See `LICENSE`.
