import express from 'express';
import { firefox } from 'playwright';

const app = express();
const PORT = process.env.PORT || 3000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0';
const SESSION_TTL = 30 * 60 * 1000;

const cachedSessions = {};
let browserPromise = null;

app.get('/ping', (_req, res) => res.send('Alive'));

function getDomain(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

async function getFreshCookies(domain, targetUrl) {
  while (browserPromise) await browserPromise;
  browserPromise = _solve(domain, targetUrl).finally(() => { browserPromise = null; });
  return browserPromise;
}

async function _solve(domain, targetUrl) {
  console.log(`[SOLVER] Launching Firefox for ${domain}...`);
  const browser = await firefox.launch({
    headless: true,
    firefoxUserPrefs: {
      'media.navigator.enabled': false,
      'media.peerconnection.enabled': false,
      'dom.webdriver.enabled': false,
    }
  });
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      extraHTTPHeaders: { 'Referer': 'https://animepahe.pw/' }
    });
    const page = await ctx.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    const title = await page.title();
    console.log(`[SOLVER] Page title: "${title}"`);
    if (title.includes('Just a moment') || title.includes('Checking your browser')) {
      console.log('[SOLVER] Waiting for Cloudflare challenge...');
      await page.waitForFunction(() => {
        const t = document.title || '';
        return !t.includes('Just a moment') && !t.includes('Checking your browser');
      }, { timeout: 30000 }).catch(() => console.log('[SOLVER] Challenge wait timed out'));
      await page.waitForTimeout(3000);
    }
    const cookies = await ctx.cookies();
    console.log(`[SOLVER] Cookies: ${cookies.map(c => c.name).join(', ') || 'none'}`);
    cachedSessions[domain] = {
      cookies: cookies.map(c => `${c.name}=${c.value}`).join('; '),
      ua: UA,
      timestamp: Date.now()
    };
    console.log(`[SOLVER] ${domain} cached ${cookies.length} cookies`);
  } finally {
    await browser.close();
  }
}

async function fetchWithPlaywright(targetUrl) {
  console.log(`[SOLVER] Fetching via Playwright: ${targetUrl.substring(0, 60)}...`);
  const browser = await firefox.launch({
    headless: true,
    firefoxUserPrefs: {
      'media.navigator.enabled': false,
      'media.peerconnection.enabled': false,
      'dom.webdriver.enabled': false,
    }
  });
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      extraHTTPHeaders: { 'Referer': 'https://animepahe.pw/' }
    });

    let capturedM3u8Url = null;
    let capturedM3u8 = null;
    await ctx.route(/\.m3u8/, async (route) => {
      capturedM3u8Url = route.request().url();
      try {
        const resp = await route.fetch();
        capturedM3u8 = await resp.text();
        await route.fulfill({ response: resp, body: capturedM3u8 });
      } catch {
        await route.continue();
      }
    });

    const page = await ctx.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    const title = await page.title();
    console.log(`[SOLVER] Fetch title: "${title}"`);
    if (title.includes('Just a moment') || title.includes('Checking your browser')) {
      console.log('[SOLVER] Waiting for challenge...');
      await page.waitForFunction(() => {
        const t = document.title || '';
        return !t.includes('Just a moment') && !t.includes('Checking your browser');
      }, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }

    if (!capturedM3u8) await page.waitForTimeout(4000);

    const html = await page.content();
    console.log(`[SOLVER] m3u8 captured: ${capturedM3u8Url || 'none'}`);
    return { status: 200, text: html, m3u8Url: capturedM3u8Url, m3u8: capturedM3u8 };
  } finally {
    await browser.close();
  }
}

async function fetchWithCookies(target, domain) {
  const s = cachedSessions[domain];
  const r = await fetch(target, {
    headers: { 'Cookie': s?.cookies || '', 'User-Agent': UA, 'Referer': 'https://animepahe.pw/' }
  });
  return { status: r.status, text: await r.text() };
}

function isBlocked(text, status) {
  return status === 403 || text.includes('DDoS-Guard') || text.includes('Just a moment') || text.includes('Checking your browser');
}

app.get('/solve', async (req, res) => {
  const target = req.query.url;
  const force = req.query.force === 'true';
  if (!target) return res.status(400).send('Missing URL');

  try {
    const domain = getDomain(target);
    if (!domain) return res.status(400).json({ error: 'invalid domain' });

    if (domain === 'kwik.cx') {
      let result = await fetchWithPlaywright(target);
      if (isBlocked(result.text, result.status)) {
        console.log(`[SOLVER] kwik blocked via Playwright, solving first...`);
        await getFreshCookies(domain, target);
        result = await fetchWithPlaywright(target);
      }
      return res.json({
        status: result.status,
        data: result.text,
        m3u8Url: result.m3u8Url || null,
        m3u8: result.m3u8 || null
      });
    }

    const expired = (cachedSessions[domain]?.timestamp || 0) < Date.now() - SESSION_TTL;
    if (force || expired || !(await isCookieValid(domain))) {
      await getFreshCookies(domain, target);
    }

    let result = await fetchWithCookies(target, domain);
    if (isBlocked(result.text, result.status)) {
      await getFreshCookies(domain, target);
      result = await fetchWithCookies(target, domain);
    }

    res.json({ status: result.status, data: result.text });
  } catch (e) {
    console.error('[SOLVER] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

async function isCookieValid(domain) {
  const s = cachedSessions[domain];
  if (!s?.cookies) return false;
  try {
    const r = await fetch(`https://${domain}/`, {
      headers: { 'Cookie': s.cookies, 'User-Agent': s.ua, 'Referer': 'https://animepahe.pw/' }
    });
    const t = await r.text();
    return r.status !== 403 && !t.includes('DDoS-Guard') && !t.includes('Just a moment') && !t.includes('Checking your browser');
  } catch { return false; }
}

app.listen(PORT, () => console.log(`Solver ready on port ${PORT}`));
