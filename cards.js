#!/usr/bin/env node
/* Renders the trailer's caption and end card as transparent PNGs, using the same
   embedded typefaces as the site so the film and the thing it advertises look
   like one object.

   usage: node cards.js [url] */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_TEXT = process.argv[2] || 'rainbowdeepfield.com';
const OUT = path.join(__dirname, 'cards');
fs.mkdirSync(OUT, { recursive: true });

// pull the embedded @font-face block straight out of the build
const built = fs.readFileSync(path.join(__dirname, 'dist', 'index.html'), 'utf8');
const faces = (built.match(/@font-face\{[^}]*\}/g) || []).join('\n');

const SIZES = { wide: [1920, 1080], tall: [1080, 1920] };

function page(kind, w, h) {
  const tall = h > w;
  return `<style>
${faces}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${w}px;height:${h}px;background:${kind === 'end' ? '#03030a' : 'transparent'};overflow:hidden}
body{display:grid;place-items:center;font-family:'Space Grotesk',sans-serif;color:#fff}
.wrap{text-align:center;padding:0 ${tall ? 90 : 200}px}
/* The pull-back ends on the galaxy, and the galaxy's core is the brightest,
   most saturated thing in the whole film. Centred text landed straight on top
   of it: white serif on a full-strength rainbow, illegible, and covering the
   one shot the trailer exists to deliver. So the caption sits in the lower
   third instead, with a soft scrim under it — the picture keeps the middle. */
${kind === 'caption' ? `
body{align-items:end}
.wrap{padding-bottom:${tall ? 320 : 104}px;position:relative}
.wrap::before{content:'';position:absolute;left:50%;transform:translateX(-50%);
  bottom:${tall ? 250 : 30}px;width:${tall ? 1020 : 1560}px;height:${tall ? 400 : 330}px;
  background:radial-gradient(ellipse at center,rgba(3,3,10,.74) 0%,rgba(3,3,10,.5) 45%,rgba(3,3,10,0) 72%);
  z-index:-1}` : ''}
.caption{font-family:'Newsreader',serif;font-weight:300;
  font-size:${tall ? 62 : 58}px;line-height:1.32;letter-spacing:-.01em;
  text-shadow:0 4px 40px rgba(0,0,0,.95),0 0 90px rgba(0,0,0,.85),0 2px 8px rgba(0,0,0,.7)}
.mark{width:${tall ? 74 : 62}px;height:${tall ? 74 : 62}px;border-radius:50%;margin:0 auto ${tall ? 44 : 36}px;
  background:conic-gradient(from .25turn,#ff4654,#ff9e2d,#ffe83e,#5ae276,#46a8ff,#ac74ff,#ff4654);
  box-shadow:0 0 60px rgba(255,255,255,.35)}
h1{font-family:'Newsreader',serif;font-weight:300;font-size:${tall ? 116 : 104}px;
  line-height:.96;letter-spacing:-.025em;margin-bottom:${tall ? 34 : 26}px}
.sub{font-family:'Newsreader',serif;font-weight:300;font-size:${tall ? 44 : 38}px;
  color:#b9b5d4;line-height:1.45;margin-bottom:${tall ? 60 : 48}px}
.url{font-size:${tall ? 34 : 29}px;letter-spacing:.16em;text-transform:uppercase;color:#f0eeff;
  border:1px solid rgba(200,196,240,.4);border-radius:999px;
  padding:${tall ? '20px 44px' : '17px 38px'};display:inline-block}
</style>
<div class="wrap">${kind === 'caption'
    ? `<p class="caption">Every one of them is something<br>a stranger wanted you to hear.</p>`
    : `<div class="mark"></div>
       <h1>Rainbow<br>Deep Field</h1>
       <p class="sub">Go and find one.<br>Then leave one.</p>
       <span class="url">${URL_TEXT}</span>`}</div>`;
}

(async () => {
  const browser = await chromium.launch();
  for (const [name, [w, h]] of Object.entries(SIZES)) {
    for (const kind of ['caption', 'end']) {
      const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await p.setContent(page(kind, w, h));
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(250);
      await p.screenshot({
        path: path.join(OUT, `${kind}-${name}.png`),
        omitBackground: kind === 'caption'
      });
      await p.close();
    }
  }
  await browser.close();
  console.log('cards →', fs.readdirSync(OUT).join(', '));
})();
