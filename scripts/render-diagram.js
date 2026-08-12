// Render an HTML diagram to PNG for visual verification
// Usage: node render-diagram.js <input.html> <output.png>
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const inputPath = path.resolve(process.argv[2]);
  const outputPath = path.resolve(process.argv[3]);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto('file://' + inputPath.replace(/\\/g, '/'));
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: outputPath, fullPage: true });
  await browser.close();
  console.log('OK', outputPath);
})();
