import express from 'express';
import puppeteer from 'puppeteer';

const app = express();

let cachedSession = {
    cookies: '',
    ua: '',
    timestamp: 0
};

const SESSION_TTL = 60 * 60 * 1000; // 1 hour

// ─────────────────────────────────────────────────────────────
// Refresh Cloudflare session using Puppeteer
// ─────────────────────────────────────────────────────────────
async function getFreshCookies(target) {
    console.log('Launching browser to refresh session...');

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    try {
        const page = await browser.newPage();

        await page.goto(target, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Wait for Cloudflare challenge to finish
        await page.waitForFunction(
            () => !document.title.includes('Just a moment'),
            { timeout: 30000 }
        );

        const cookies = await page.cookies();

        const ua = await page.evaluate(() => navigator.userAgent);

        cachedSession = {
            cookies: cookies
                .map(c => `${c.name}=${c.value}`)
                .join('; '),
            ua,
            timestamp: Date.now()
        };

        console.log('Session cached successfully.');
    } finally {
        await browser.close();
    }
}

// ─────────────────────────────────────────────────────────────
// Health Check Endpoint (for Uptime Robot)
// Example:
// https://your-app.onrender.com/ping
// ─────────────────────────────────────────────────────────────
app.get('/ping', (req, res) => {
    console.log('Ping received: Keeping server awake.');
    res.send('Pterodactyl-Bridge is Awake!');
});

// ─────────────────────────────────────────────────────────────
// Main Solver Endpoint
// Example:
// /solve?url=https://animepahe.pw/api?m=search&q=one+piece
// /solve?url=...&force=true
// ─────────────────────────────────────────────────────────────
app.get('/solve', async (req, res) => {
    const url = req.query.url;
    const force = req.query.force === 'true';

    // Safety check
    if (!url) {
        return res.status(400).json({
            error: 'No URL provided'
        });
    }

    try {
        // Refresh cookies if:
        // 1. No cookies exist
        // 2. Session expired
        // 3. Force refresh requested
        if (
            !cachedSession.cookies ||
            (Date.now() - cachedSession.timestamp) > SESSION_TTL ||
            force
        ) {
            await getFreshCookies('https://animepahe.pw/');
        }

        // Perform request using cached Cloudflare session
        const response = await fetch(url, {
            headers: {
                'Cookie': cachedSession.cookies,
                'User-Agent': cachedSession.ua,
                'Referer': 'https://animepahe.pw/',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        const text = await response.text();

        let parsed;

        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = text;
        }

        res.json({
            status: response.status,
            data: parsed,
            cached: true,
            forced: force
        });

    } catch (e) {
        console.error('Solver Error:', e);

        res.status(500).json({
            error: e.message
        });
    }
});

// ─────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Solver Bridge Active on port ${PORT}`);
});
