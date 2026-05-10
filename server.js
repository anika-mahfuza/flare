        console.log("[BROWSER] Session cached.");
    } finally {
        await browser.close();
    }
}

// --- 3. MAIN SOLVER ENDPOINT ---
app.get('/solve', async (req, res) => {
    const url = req.query.url;
    const force = req.query.force === 'true';

    // Prevent accidental empty requests
    if (!url) {
        return res.status(400).json({
            error: 'No URL provided'
        });
    }

    try {
        // Refresh session if:
        // A) No cookies
        // B) Cache expired
        // C) Forced refresh requested
        if (
            !cachedSession.cookies ||
            (Date.now() - cachedSession.timestamp) > SESSION_TTL ||
            force
        ) {
            await getFreshCookies('https://animepahe.pw/');
        }

        // Request target using cached CF cookies
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
        console.error("[SOLVER ERROR]", e);

        res.status(500).json({
            error: e.message
        });
    }
});

// --- 4. START SERVER ---
app.listen(PORT, () => {
    console.log(`Solver Bridge Active on port ${PORT}`);
});
