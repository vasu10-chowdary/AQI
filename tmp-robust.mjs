import puppeteer from 'puppeteer-core';

const URL = 'http://127.0.0.1:5173/';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
});
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('dialog', (dialog) => dialog.accept());

await page.setViewport({ width: 1280, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
await page.evaluate(() => {
  localStorage.clear();
  sessionStorage.clear();
});
await page.reload({ waitUntil: 'networkidle2' });

// Enter and leave demo mode.
await page.waitForSelector('.demo-controls .btn');
await page.evaluate(() => {
  [...document.querySelectorAll('.demo-controls .btn')].find((b) => /smog sample/i.test(b.textContent))?.click();
});
await page.waitForFunction(() => document.querySelector('.aqi-value')?.textContent === '320');
const demoOn = await page.evaluate(() => ({
  badge: Boolean(document.querySelector('.sample-badge')),
  exitLabel: document.querySelector('.demo-controls .btn')?.textContent,
  storedLocation: localStorage.getItem('uaqa:v1:location'),
}));

await page.evaluate(() => {
  [...document.querySelectorAll('.demo-controls .btn')].find((b) => /live data/i.test(b.textContent))?.click();
});
await page.waitForFunction(() => !document.querySelector('.sample-badge'), { timeout: 10000 });
const demoOff = await page.evaluate(() => ({
  emptyOverview: Boolean(document.querySelector('#air-section .empty-state')),
  locationEmpty: !document.querySelector('.location-current'),
  demoBanner: Boolean(document.querySelector('.demo-banner')),
}));

// Seed a cached reading, go offline and select the matching city.
await page.evaluate(() => {
  const hourly = Array.from({ length: 24 }, (_, index) => ({
    time: `2026-11-18T${String(index).padStart(2, '0')}:00`,
    pm25: index > 17 ? 200 : 150,
    usAqi: null,
  }));
  localStorage.setItem(
    'uaqa:v1:lastAir',
    JSON.stringify({
      lat: 28.6139,
      lon: 77.209,
      savedAt: Date.now() - 30 * 60 * 1000,
      air: {
        current: {
          pm25: 145,
          pm10: 200,
          usAqi: 190,
          carbonMonoxide: 900,
          nitrogenDioxide: 40,
          time: '2026-11-18T08:00',
        },
        hourly,
        timezone: 'Asia/Kolkata',
        fetchedAt: Date.now() - 30 * 60 * 1000,
      },
    })
  );
});
await page.setOfflineMode(true);
await page.evaluate(() => {
  [...document.querySelectorAll('.quick-pick')].find((b) => b.textContent.trim() === 'Delhi')?.click();
});
await page.waitForFunction(() => Boolean(document.querySelector('.stale-note')), { timeout: 20000 });
const stale = await page.evaluate(() => ({
  note: document.querySelector('.stale-note')?.textContent,
  aqi: document.querySelector('.aqi-value')?.textContent,
  hasRetry: Boolean(document.querySelector('.stale-note .btn')),
  planCards: document.querySelectorAll('.plan-card').length,
}));
await page.setOfflineMode(false);

// Clear my data removes the saved profile, location and cache.
await page.evaluate(() => {
  [...document.querySelectorAll('#profile-section button')].find((b) => /clear my data/i.test(b.textContent))?.click();
});
await new Promise((resolve) => setTimeout(resolve, 500));
const cleared = await page.evaluate(() => ({
  keys: Object.keys(localStorage).sort(),
  sessionKeys: Object.keys(sessionStorage),
  overviewEmpty: Boolean(document.querySelector('#air-section .empty-state')),
  staleGone: !document.querySelector('.stale-note'),
}));

console.log(JSON.stringify({ demoOn, demoOff, stale, cleared, problems }, null, 2));
await browser.close();
