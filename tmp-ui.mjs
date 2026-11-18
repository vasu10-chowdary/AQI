import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5173/';
const OUT = 'docs/screenshots';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--hide-scrollbars', '--force-device-scale-factor=1'],
});
const context = browser.defaultBrowserContext();
await context.overridePermissions(URL, ['clipboard-read', 'clipboard-write']);

const page = await browser.newPage();
const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('requestfailed', (request) =>
  problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`)
);
page.on('response', (response) => {
  if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
});

await page.setViewport({ width: 1440, height: 1000 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
await page.evaluate(() => {
  localStorage.clear();
  sessionStorage.clear();
});
await page.reload({ waitUntil: 'networkidle2' });

// Enter demo mode.
await page.waitForSelector('.demo-controls .btn');
await page.evaluate(() => {
  [...document.querySelectorAll('.demo-controls .btn')].find((b) => /smog sample/i.test(b.textContent))?.click();
});
await page.waitForFunction(
  () =>
    document.querySelector('.aqi-value')?.textContent === '320' &&
    document.querySelectorAll('.tl-item').length === 3,
  { timeout: 30000 }
);
await new Promise((resolve) => setTimeout(resolve, 400));

const core = await page.evaluate(() => ({
  aqi: document.querySelector('.aqi-value')?.textContent,
  band: document.querySelector('.aqi-unit')?.textContent,
  sampleBadge: document.querySelector('.sample-badge')?.textContent,
  demoBanner: Boolean(document.querySelector('.demo-banner')),
  sampleTime: document.querySelector('.updated')?.textContent,
  criticalBanner: Boolean(document.querySelector('.banner-critical')),
  criticalTitle: document.querySelector('.banner-title')?.textContent,
  criticalParagraphs: [...document.querySelectorAll('.banner-critical p')].map((p) => p.textContent),
  timeline: [...document.querySelectorAll('.tl-item')].map((item) => ({
    slot: item.querySelector('.tl-slot')?.textContent,
    range: item.querySelector('.tl-range')?.textContent,
    time: item.querySelector('.tl-chip')?.textContent,
    action: item.querySelector('.tl-action')?.textContent,
    impact: item.querySelector('.tl-impact')?.textContent,
  })),
  planCards: document.querySelectorAll('.plan-card').length,
  shareButton: [...document.querySelectorAll('#plan-section button')].some((b) =>
    /share my plan/i.test(b.textContent)
  ),
  sources: document.querySelectorAll('.source-list a').length,
  simCols: [...document.querySelectorAll('.sim-col-title')].map((n) => n.textContent),
  simHeadline: document.querySelector('.sim-headline')?.textContent,
  chatInputLabel: document.querySelector('label[for="chat-input"]')?.textContent,
  chatChips: [...document.querySelectorAll('.chat-suggestions .chip-btn')].map((n) => n.textContent),
  liveRegions: document.querySelectorAll('[aria-live]').length,
}));

// Dark + Hindi screenshot before the chat is used.
await page.evaluate(() => {
  if (document.documentElement.dataset.theme !== 'dark') document.getElementById('theme-toggle')?.click();
  const select = document.getElementById('lang-select');
  select.value = 'hi';
  select.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForFunction(
  () => document.documentElement.lang.startsWith('hi') && document.querySelectorAll('.tl-item').length === 3,
  { timeout: 20000 }
);
await new Promise((resolve) => setTimeout(resolve, 500));
const hindi = await page.evaluate(() => ({
  h1: document.querySelector('h1')?.textContent,
  timeline: [...document.querySelectorAll('.tl-slot')].map((n) => n.textContent),
  banner: document.querySelector('.banner-title')?.textContent,
  chatTitle: document.querySelector('#chat-title')?.textContent,
}));

// Back to English + light.
await page.evaluate(() => {
  const select = document.getElementById('lang-select');
  select.value = 'en';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  if (document.documentElement.dataset.theme !== 'light') document.getElementById('theme-toggle')?.click();
});
await page.waitForFunction(() => document.documentElement.lang === 'en-IN', { timeout: 20000 });
await new Promise((resolve) => setTimeout(resolve, 400));

// Chat without a Gemini key: rule-based answer.
await page.evaluate(() => document.querySelector('.chat-suggestions .chip-btn')?.click());
await page.waitForFunction(
  () => {
    const bubble = document.querySelector('.chat-msg.assistant .chat-text');
    return bubble && bubble.textContent.trim().length > 60;
  },
  { timeout: 20000 }
);
const chat = await page.evaluate(() => ({
  question: document.querySelector('.chat-msg.user .chat-text')?.textContent,
  answer: document.querySelector('.chat-msg.assistant .chat-text')?.textContent,
  offline: document.querySelector('.chat-offline')?.textContent,
  status: document.querySelector('.chat-status')?.textContent,
  busy: document.querySelector('.chat-log')?.getAttribute('aria-busy'),
  messages: document.querySelectorAll('.chat-msg').length,
}));

// Simulator changes.
await page.evaluate(() => {
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
await new Promise((resolve) => setTimeout(resolve, 300));
const sim = await page.evaluate(() => ({
  headline: document.querySelector('.sim-headline')?.textContent,
  status: document.querySelector('.sim-delta-text')?.textContent,
  columns: [...document.querySelectorAll('.sim-col')].map((col) => ({
    title: col.querySelector('.sim-col-title')?.textContent,
    rows: [...col.querySelectorAll('.sim-row')].map((row) => ({
      label: row.querySelector('dt')?.textContent,
      value: row.querySelector('.sim-row-value')?.textContent,
      detail: row.querySelector('.sim-row-detail')?.textContent,
    })),
  })),
}));
await page.evaluate(() => document.getElementById('simulator-section').scrollIntoView({ block: 'start' }));
await new Promise((resolve) => setTimeout(resolve, 300));

// Share (clipboard fallback in desktop Chrome).
await page.evaluate(() => {
  [...document.querySelectorAll('#plan-section button')].find((b) => /share my plan/i.test(b.textContent))?.click();
});
await page.waitForFunction(() => document.querySelector('.share-status')?.textContent.trim().length > 0, {
  timeout: 10000,
});
const share = await page.evaluate(async () => ({
  status: document.querySelector('.share-status')?.textContent,
  clipboard: await navigator.clipboard.readText().catch(() => ''),
}));

// Desktop screenshot (top of page, full page).
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((resolve) => setTimeout(resolve, 300));
await page.evaluate(() => document.getElementById('chat-section').scrollIntoView({ block: 'start' }));
await new Promise((resolve) => setTimeout(resolve, 250));

// Contrast on the new UI, both themes.
const SELECTORS = [
  '.sample-badge',
  '.demo-banner',
  '.banner-title',
  '.banner-critical p',
  '.tl-action',
  '.tl-impact',
  '.tl-range',
  '.chat-text',
  '.chat-status',
  '.chat-offline',
  '.chip-btn',
  '.sim-headline-value',
  '.sim-col-hint',
  '.sim-row-value',
  '.sim-row-detail',
  '.source-list a',
  '.share-status',
];
async function measure(theme) {
  return page.evaluate(
    ({ selectors, theme }) => {
      document.documentElement.dataset.theme = theme;
      const parse = (value) => {
        const match = /rgba?\(([^)]+)\)/.exec(value || '');
        if (!match) return null;
        const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).map(Number);
        return { r, g, b, a };
      };
      const blend = (fg, bg) => ({
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      });
      const effectiveBg = (node) => {
        let current = node;
        let color = { r: 255, g: 255, b: 255, a: 1 };
        const stack = [];
        while (current) {
          const parsed = parse(getComputedStyle(current).backgroundColor);
          if (parsed && parsed.a > 0) stack.push(parsed);
          current = current.parentElement;
        }
        for (let index = stack.length - 1; index >= 0; index -= 1) color = blend(stack[index], color);
        return color;
      };
      const rel = (c) => {
        const channel = (v) => {
          const n = v / 255;
          return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
      };
      return selectors.map((selector) => {
        const node = document.querySelector(selector);
        if (!node) return { selector, missing: true };
        const style = getComputedStyle(node);
        const fg = parse(style.color);
        const bg = effectiveBg(node);
        const text = blend(fg, bg);
        const l1 = rel(text);
        const l2 = rel(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const size = parseFloat(style.fontSize);
        const bold = Number(style.fontWeight) >= 700;
        const large = size >= 24 || (bold && size >= 18.66);
        return { selector, ratio: Math.round(ratio * 100) / 100, required: large ? 3 : 4.5, pass: ratio >= (large ? 3 : 4.5) };
      });
    },
    { selectors: SELECTORS, theme }
  );
}
const lightContrast = await measure('light');
const darkContrast = await measure('dark');

// Structure and labels for the new UI.
const a11y = await page.evaluate(() => {
  document.documentElement.dataset.theme = 'light';
  const labelled = (field) =>
    Boolean(field.labels?.length || field.getAttribute('aria-label') || field.getAttribute('aria-labelledby'));
  const fields = [...document.querySelectorAll('#chat-section input, #timeline-section input')];
  const unlabelled = fields.filter((field) => !labelled(field));
  const namelessButtons = [...document.querySelectorAll('#chat-section button, #timeline-section button, .chip-btn')].filter(
    (button) => !button.textContent.trim() && !button.getAttribute('aria-label')
  );
  const headings = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => Number(h.tagName[1]));
  return {
    unlabelled: unlabelled.length,
    namelessButtons: namelessButtons.length,
    headings,
    orderOk: headings.every((level, index) => index === 0 || level <= headings[index - 1] + 1),
    timelineIsList: Boolean(document.querySelector('ol.timeline')),
    timelineItems: document.querySelectorAll('ol.timeline > li').length,
    chatLogRole: document.querySelector('.chat-log')?.getAttribute('role'),
    chatStatusLive: document.querySelector('.chat-status')?.getAttribute('aria-live'),
    llmOutputTextOnly: document.querySelector('.chat-msg.assistant')?.children.length,
  };
});

// Mobile + 320 px overflow.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await new Promise((resolve) => setTimeout(resolve, 400));
const mobile = await page.evaluate(() => ({
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));

await page.setViewport({ width: 320, height: 720, deviceScaleFactor: 1 });
await new Promise((resolve) => setTimeout(resolve, 300));
const narrow = await page.evaluate(() => ({
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));

// axe-core on the rich demo page.
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await page.evaluate(readFileSync('node_modules/axe-core/axe.min.js', 'utf8'));
const axe = await page.evaluate(async () => {
  const results = await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  });
  return {
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    })),
    passes: results.passes.length,
    incomplete: results.incomplete.length,
  };
});

console.log(
  JSON.stringify(
    {
      core,
      hindi,
      chat,
      sim,
      share: { status: share.status, clipboardHead: share.clipboard.slice(0, 160) },
      lightContrast,
      darkContrast,
      a11y,
      mobile,
      narrow,
      axe,
      problems,
    },
    null,
    2
  )
);

await browser.close();
