import express from 'express';
import puppeteer from 'puppeteer-core';

const app = express();
const PORT = process.env.PORT || 3000;

let cachedSession = { cookies: '', ua: '', timestamp: 0 };
const SESSION_TTL = 60 * 60 * 1000; 

app.get('/ping', (req, res) => res.send("Alive"));

async function getFreshCookies() {
    console.log("[BROWSER] Solving Cloudflare...");
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium', // Points to the Docker install
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--single-process',      // IMPORTANT: Stops Render from crashing
            '--no-zygote',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        
        await page.goto('https://animepahe.pw/', { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForFunction(() => !document.title.includes('Just a moment'), { timeout: 30000 });

        const cookies = await page.cookies();
        cachedSession = {
            cookies: cookies.map(c => `${c.name}=${c.value}`).join('; '),
            ua: await page.evaluate(() => navigator.userAgent),
            timestamp: Date.now()
        };
        console.log("[BROWSER] Cookies updated.");
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

app.listen(PORT, () => console.log(`Lightweight Solver ready on port ${PORT}`));
