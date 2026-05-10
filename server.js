import express from 'express';
import puppeteer from 'puppeteer';

const app = express();
let cachedSession = { cookies: '', ua: '', timestamp: 0 };
const SESSION_TTL = 60 * 60 * 1000; // Cache cookies for 1 hour

async function getFreshCookies(target) {
    console.log("Launching browser to refresh session...");
    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.goto(target, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Wait for the Cloudflare spinner to finish
        await page.waitForFunction(() => !document.title.includes('Just a moment'), { timeout: 30000 });

        const cookies = await page.cookies();
        const ua = await page.evaluate(() => navigator.userAgent);
        
        cachedSession = {
            cookies: cookies.map(c => `${c.name}=${c.value}`).join('; '),
            ua: ua,
            timestamp: Date.now()
        };
        console.log("Session cached successfully.");
    } finally {
        await browser.close();
    }
}

app.get('/solve', async (req, res) => {
    const url = req.query.url || 'https://animepahe.pw';
    
    try {
        // Only launch browser if cache is old
        if (!cachedSession.cookies || (Date.now() - cachedSession.timestamp) > SESSION_TTL) {
            await getFreshCookies('https://animepahe.pw/');
        }

        // Use standard fetch with cached cookies (Zero browser overhead)
        const response = await fetch(url, {
            headers: {
                'Cookie': cachedSession.cookies,
                'User-Agent': cachedSession.ua,
                'Referer': 'https://animepahe.pw/'
            }
        });

        const text = await response.text();
        res.json({ 
            status: response.status, 
            data: text.startsWith('{') ? JSON.parse(text) : text,
            cached: true 
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(3000, () => console.log("Solver Bridge Active"));
