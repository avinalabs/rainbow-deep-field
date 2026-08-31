#!/usr/bin/env node
/* Headless capture harness. Drives the build in a real browser so we can look at
   it, collect console errors, and later render trailer frames. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const url = 'file://' + path.join(__dirname, 'dist', 'index.html');

(async () => {
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(OUT, '01-intro.png') });

  await page.click('#btn-begin');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(OUT, '02-field.png') });

  // fly around a bit: hold the pointer off to one side
  await page.mouse.move(1080, 430);
  await page.mouse.down();
  await page.waitForTimeout(2400);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '03-flying.png') });

  // zoom right out to see the whole galaxy
  await page.click('#btn-wide');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(OUT, '04-wide.png') });
  await page.click('#btn-wide');
  await page.waitForTimeout(1800);

  // compose
  await page.click('#btn-leave');
  await page.waitForTimeout(600);
  await page.fill('#msg', 'you are doing better than the version of you from last year could have hoped');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '05-compose.png') });

  await page.click('#btn-send');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(OUT, '06-sent.png') });

  // and the card on its own
  const card = await page.$('#card');
  if (card) await card.screenshot({ path: path.join(OUT, '07-card.png') });

  const stats = await page.evaluate(() => ({
    comets: window.RDF.__world ? window.RDF.__world.comets.length : null,
    seeds: window.RDF.SEEDS.length
  }));

  await browser.close();
  console.log('seeds:', stats.seeds);
  console.log(errors.length ? errors.join('\n') : 'no console errors');
})();
