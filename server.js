import express from 'express';
import { firefox } from 'playwright';

const app = express();
const PORT = process.env.PORT || 3000;

let cachedSession = { cookies: '', ua: '', timestamp: 0 };
const SESSION_TTL = 60 * 60 * 1000;

app.get('/ping', (req, res) => res.send("Alive"));

async function getFreshCookies() {
    console.log("[BROWSER] Solving DDoS-Guard...");
    const browser = await firefox.launch({
        headless: true,
        firefoxUserPrefs: {
            'media.navigator.enabled': false,
            'media.peerconnection.enabled': false,
        }
    });

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
        });
        const page = await context.newPage();
        await page.goto('https://animepahe.pw/', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForFunction(() => !document.title.includes('DDoS-Guard'), { timeout: 30000 });

        const cookies = await context.cookies();
        cachedSession = {
            cookies: cookies.map(c => `${c.name}=${c.value}`).join('; '),
            ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
            timestamp: Date.now()
        };
        console.log("[BROWSER] Cookies updated:", cachedSession.cookies.substring(0, 80));
    } finally {
        await browser.close();
    }
}

app.get('/solve', async (req, res) => {
    const target = req.query.url;
    const force = req.query.force === 'true';
    if (!target) return res.status(400).send("Missing URL");

    try {
        if (!cachedSession.cookies || (Date.now() - cachedSession.timestamp) > SESSION_TTL || force) {
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
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => console.log(`Solver ready on port ${PORT}`));