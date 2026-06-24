import puppeteer from 'puppeteer-core';
import fs from 'fs';

const paths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.USERPROFILE}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' // Fallback to Edge
];

let executablePath = '';
for (const p of paths) {
  if (fs.existsSync(p)) {
    executablePath = p;
    break;
  }
}

if (!executablePath) {
  console.error('Could not find Chrome or Edge installation.');
  process.exit(1);
}

console.log('Using browser at:', executablePath);

(async () => {
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Listen for console logs and errors
  page.on('console', msg => {
    console.log(`[BROWSER CONSOLE ${msg.type().toUpperCase()}]:`, msg.text());
  });

  page.on('pageerror', err => {
    console.error('[BROWSER RUNTIME ERROR STACK]:', err.stack || err.toString());
  });

  page.on('requestfailed', request => {
    console.error(`[BROWSER REQUEST FAILED]: ${request.url()} - ${request.failure()?.errorText || 'Unknown error'}`);
  });

  try {
    console.log('Navigating to http://localhost:3001...');
    await page.goto('http://localhost:3001', { waitUntil: 'load', timeout: 10000 });
    
    console.log('Page loaded. Waiting 5 seconds to capture runtime events...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  } catch (err) {
    console.error('Navigation error:', err.message);
  } finally {
    await browser.close();
    process.exit(0);
  }
})();
