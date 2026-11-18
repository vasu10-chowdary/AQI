import puppeteer from 'puppeteer-core';

const URL = 'http://127.0.0.1:5173/';
const OUT = 'docs/screenshots';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function demoPage(width, height) {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.demo-controls .btn');
  await page.evaluate(() => {
    [...document.querySelectorAll('.demo-controls .btn')]
      .find((button) => /smog sample/i.test(button.textContent))
      ?.click();
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.aqi-value')?.textContent === '320' &&
      document.querySelectorAll('.tl-item').length === 3,
    { timeout: 30000 }
  );
  return page;
}

const desktop = await demoPage(1440, 1000);

// Ask a suggested question so the chat has a real exchange (offline rules).
await page_clickFirstChip(desktop);
async function page_clickFirstChip(page) {
  await page.evaluate(() => document.querySelector('.chip-btn')?.click());
  await page.waitForFunction(() => Boolean(document.querySelector('.chat-offline')), { timeout: 20000 });
}

// Simulator: metro 3 days, purifier 8 h, N95 always.
await desktop.evaluate(() => {
  const section = document.getElementById('simulator-section');
  const ranges = [...section.querySelectorAll('input[type="range"]')];
  ranges[0].value = '3';
  ranges[0].dispatchEvent(new Event('input', { bubbles: true }));
  ranges[1].value = '8';
  ranges[1].dispatchEvent(new Event('input', { bubbles: true }));
  const mask = section.querySelector('select');
  mask.value = 'always';
  mask.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(300);

// Share (bounds the native sheet and copies instead in headless Chrome).
await desktop.evaluate(() => {
  [...document.querySelectorAll('#plan-section button')]
    .find((button) => /share my plan/i.test(button.textContent))
    ?.click();
});
await desktop.waitForFunction(() => document.querySelector('.share-status')?.textContent.trim().length > 0, {
  timeout: 15000,
});

await desktop.evaluate(() => window.scrollTo(0, 0));
await wait(300);
await desktop.screenshot({ path: `${OUT}/desktop-plan.png`, fullPage: true });

// Element crops avoid the sticky header sitting over the top of the section.
const hideChrome = await desktop.addStyleTag({
  content: '.site-header,.skip-link{display:none!important}',
});
await wait(150);
await (await desktop.$('#simulator-section')).screenshot({ path: `${OUT}/simulator.png` });
await (await desktop.$('#chat-section')).screenshot({ path: `${OUT}/chat.png` });
await hideChrome.evaluate((node) => node.remove());
await desktop.close();

// Hindi + dark on a fresh demo page, so the chat has no earlier English answer.
const hindi = await demoPage(1440, 1000);
await hindi.evaluate(() => {
  const select = document.querySelector('#lang-select');
  select.value = 'hi';
  select.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(600);
await hindi.click('#theme-toggle');
await wait(600);
await hindi.evaluate(() => window.scrollTo(0, 0));
await hindi.screenshot({ path: `${OUT}/dark-hindi.png`, fullPage: true });
await hindi.close();

// Mobile: fresh page (no reload after loading the sample) scrolled to the air card.
const mobile = await demoPage(390, 844);
await mobile.evaluate(() => {
  document.getElementById('air-section').scrollIntoView({ block: 'start' });
  window.scrollBy(0, -64);
});
await wait(400);
await mobile.screenshot({ path: `${OUT}/mobile-plan.png` });
const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

await mobile.setViewport({ width: 320, height: 720, deviceScaleFactor: 1 });
await wait(400);
const narrowOverflow = await mobile.evaluate(() => ({
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
}));
await mobile.close();

console.log(JSON.stringify({ mobileOverflow, narrowOverflow }, null, 2));
await browser.close();
