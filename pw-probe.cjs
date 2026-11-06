const { chromium } = require('playwright');
(async () => {
  try {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    await page.setContent('<h1 id="t">Hello Cyps</h1><button id="b" onclick="document.getElementById(\'t\').textContent=\'Clicked\'">Go</button>');
    console.log('TITLE_TEXT=' + await page.textContent('#t'));
    await page.click('#b');
    console.log('AFTER_CLICK=' + await page.textContent('#t'));
    const buf = await page.screenshot();
    console.log('SCREENSHOT_BYTES=' + buf.length);
    await browser.close();
    console.log('BROWSER_OK');
  } catch (e) {
    console.log('BROWSER_FAIL: ' + e.message.split('\n')[0]);
  }
})();