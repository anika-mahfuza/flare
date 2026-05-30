import express from 'express';
import { firefox } from 'playwright';

const app = express();
const PORT = process.env.PORT || 7860;

let cachedSession = { cookies: '', ua: '', timestamp: 0 };
const SESSION_TTL = 11 * 30 * 24 * 60 * 60 * 1000; // 11 months
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0';

let browserPromise = null; // mutex — only one browser at a time

app.get('/ping', (req, res) => res.send("Alive"));

async function isCookieValid() {
    if (!cachedSession.cookies) return false;
    try {
        const res = await fetch('https://animepahe.pw/api?m=search&q=test', {
            headers: {
                'Cookie': cachedSession.cookies,
                'User-Agent': cachedSession.ua,
                'Referer': 'https://animepahe.pw/'
            }
        });
        const text = await res.text();
        const blocked = text.includes('DDoS-Guard') || text.includes('ddos-guard') || res.status === 403;
        if (blocked) console.log('[COOKIE] Invalid — DDoS-Guard block detected');
        return !blocked;
    } catch (e) {
        console.log('[COOKIE] Validation error:', e.message);
        return false;
    }
}

async function getFreshCookies() {
    if (browserPromise) {
        console.log("[BROWSER] Already solving, waiting...");
        return browserPromise;
    }
    browserPromise = _doSolve().finally(() => browserPromise = null);
    return browserPromise;
}

async function _doSolve() {
    console.log("[BROWSER] Launching Firefox to solve DDoS-Guard...");
    const browser = await firefox.launch({
        headless: true,
        firefoxUserPrefs: {
            'media.navigator.enabled': false,
            'media.peerconnection.enabled': false,
        }
    });
    try {
        const context = await browser.newContext({ userAgent: UA });
        const page = await context.newPage();
        await page.goto('https://animepahe.pw/', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForFunction(() => !document.title.includes('DDoS-Guard'), { timeout: 30000 });
        const cookies = await context.cookies();
        cachedSession = {
            cookies: cookies.map(c => `${c.name}=${c.value}`).join('; '),
            ua: UA,
            timestamp: Date.now()
        };
        console.log("[BROWSER] Done. Cookies cached.");
    } finally {
        await browser.close();
    }
}

app.get('/solve', async (req, res) => {
    const target = req.query.url;
    const force = req.query.force === 'true';
    if (!target) return res.status(400).send("Missing URL");

    try {
        const expired = (Date.now() - cachedSession.timestamp) > SESSION_TTL;
        const needsRefresh = force || expired || !(await isCookieValid());

        if (needsRefresh) {
            await getFreshCookies();
        }

        const response = await fetch(target, {
            headers: {
                'Cookie': cachedSession.cookies,
                'User-Agent': cachedSession.ua,
                'Referer': 'https://animepahe.pw/'
            }
        });
        const text = await response.text();
        res.json({ status: response.status, data: text });
    } catch (e) {
        console.error('[SOLVE] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => console.log(`Solver ready on port ${PORT}`));