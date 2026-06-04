#!/usr/bin/env node
/**
 * Reusable headless-browser helper for Claude Code.
 *
 * Renders pages with Chromium (Playwright) and extracts useful metadata that a
 * plain HTTP fetch misses on JS-rendered sites: title, meta/og descriptions,
 * the first <h1>, a best-guess visible tagline, and which comment platform (if
 * any) the page loads. Optionally captures a screenshot per URL.
 *
 * Usage:
 *   node browse.mjs <url> [url2 ...]
 *   node browse.mjs --file urls.txt            # one URL per line (or row<TAB>name<TAB>url)
 *   node browse.mjs --file urls.txt --jsonl out.jsonl
 *   node browse.mjs <url> --screenshot ./shots --timeout 30000 --concurrency 4
 *
 * Output: one JSON object per URL on stdout (NDJSON). Progress/errors on stderr.
 * Exit code is always 0 unless setup fails; per-URL errors are captured in the
 * "error" field so a batch run never aborts midway.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Known on-site comment platforms, matched against page HTML + network requests.
const COMMENT_VENDORS = [
  ['Disqus', /disqus\.com|disqus_thread|embed\.js.*disqus/i],
  ['Coral (Vox/talk)', /coral|talk\.(?:vox|services)|cdn\.coral|embed\.js#?coral/i],
  ['OpenWeb/Spot.IM', /spot\.im|spotim|openweb/i],
  ['Viafoura', /viafoura/i],
  ['Hyvor Talk', /hyvor/i],
  ['Commento', /commento/i],
  ['wpDiscuz', /wpdiscuz/i],
  ['Vuukle', /vuukle/i],
  ['Facebook Comments', /fb-comments|connect\.facebook\.net.*sdk/i],
  ['Gigya/SAP', /gigya/i],
  ['WordPress native', /id=["']comments["']|wp-comments-post\.php|comment-respond/i],
];

function parseArgs(argv) {
  const opts = { urls: [], file: null, screenshot: null, jsonl: null, timeout: 30000, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') opts.file = argv[++i];
    else if (a === '--screenshot') opts.screenshot = argv[++i];
    else if (a === '--jsonl') opts.jsonl = argv[++i];
    else if (a === '--timeout') opts.timeout = parseInt(argv[++i], 10);
    else if (a === '--concurrency') opts.concurrency = parseInt(argv[++i], 10);
    else opts.urls.push(a);
  }
  if (opts.file) {
    for (const line of readFileSync(opts.file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      // Accept either a bare URL or a TSV row whose last field is the URL.
      const parts = t.split('\t');
      const candidate = parts[parts.length - 1].trim();
      if (/^https?:\/\//i.test(candidate)) opts.urls.push(candidate);
    }
  }
  return opts;
}

function slug(url) {
  return url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
}

async function extract(page) {
  return page.evaluate(() => {
    const m = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() || '';
    const txt = (sel) => document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const taglineSel = [
      '.tagline', '.site-tagline', '.site-description', '.slogan',
      '[class*="tagline"]', '[class*="slogan"]', 'header [class*="description"]',
      '.site-title + p', '.logo + .description',
    ];
    let tagline = '';
    for (const s of taglineSel) {
      const v = txt(s);
      if (v && v.length > 3 && v.length < 200) { tagline = v; break; }
    }
    return {
      title: (document.title || '').replace(/\s+/g, ' ').trim(),
      metaDescription: m('meta[name="description"]'),
      ogDescription: m('meta[property="og:description"]'),
      ogSiteName: m('meta[property="og:site_name"]'),
      h1: txt('h1').slice(0, 200),
      taglineGuess: tagline,
    };
  });
}

const CHALLENGE = /just a moment|checking your browser|attention required|enable javascript and cookies/i;

async function visit(browser, url, opts) {
  const seenRequests = [];
  const context = await browser.newContext({
    userAgent: UA,
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 1366, height: 900 },
  });
  // Light stealth: mask the most obvious headless tells.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = window.chrome || { runtime: {} };
  });
  const page = await context.newPage();
  page.on('request', (r) => seenRequests.push(r.url()));
  // Block heavy assets for speed; keep scripts so SPA content renders.
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') return route.abort();
    return route.continue();
  });
  const out = { url };
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeout });
    out.status = resp ? resp.status() : null;
    // Give SPAs a beat to hydrate, then settle.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // If we hit a JS anti-bot interstitial, wait for it to auto-clear (best effort).
    if (CHALLENGE.test(await page.title())) {
      out.challenged = true;
      for (let i = 0; i < 4 && CHALLENGE.test(await page.title()); i++) {
        await page.waitForTimeout(2500);
      }
    }
    out.finalUrl = page.url();
    Object.assign(out, await extract(page));
    const html = await page.content();
    const haystack = html + '\n' + seenRequests.join('\n');
    out.commentVendors = COMMENT_VENDORS.filter(([, re]) => re.test(haystack)).map(([name]) => name);
    if (opts.screenshot) {
      mkdirSync(opts.screenshot, { recursive: true });
      const path = resolve(opts.screenshot, slug(url) + '.png');
      await page.screenshot({ path, fullPage: false });
      out.screenshot = path;
    }
  } catch (e) {
    out.error = `${e.name}: ${e.message}`.slice(0, 200);
  } finally {
    await context.close();
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.urls.length) {
    console.error('No URLs. Usage: node browse.mjs <url ...> | --file urls.txt [--screenshot dir] [--jsonl out]');
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: true });
  const sink = opts.jsonl ? createWriteStream(opts.jsonl) : null;
  let done = 0;
  const queue = [...opts.urls];
  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      const res = await visit(browser, url, opts);
      const line = JSON.stringify(res);
      if (sink) sink.write(line + '\n');
      else process.stdout.write(line + '\n');
      done++;
      process.stderr.write(`[${done}/${opts.urls.length}] ${res.error ? 'ERR ' : 'ok  '} ${url}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, opts.urls.length) }, worker));
  if (sink) sink.end();
  await browser.close();
  process.stderr.write(`Done: ${done} URLs.${opts.jsonl ? ' Wrote ' + opts.jsonl : ''}\n`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
