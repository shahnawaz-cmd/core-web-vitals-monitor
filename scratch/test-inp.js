const { chromium } = require('@playwright/test');

async function testInp() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Register PerformanceObserver before navigation
  await page.addInitScript(() => {
    window.__eventTimings = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // Track event duration
          window.__eventTimings.push({
            name: entry.name,
            duration: Math.round(entry.duration),
            interactionId: entry.interactionId || 0
          });
        }
      });
      observer.observe({ type: 'event', durationThreshold: 0, buffered: true });
    } catch (e) {
      console.warn('Event timing observer error:', e);
    }
  });

  console.log('Navigating to https://windowstickerslookup.com/ ...');
  await page.goto('https://windowstickerslookup.com/', { waitUntil: 'load' });
  await page.waitForTimeout(1000);

  // 2. Perform realistic user interaction
  console.log('Performing interaction...');
  const input = page.locator('input[type="text"], input[type="search"], input:not([type="hidden"]), textarea').first();
  const inputVisible = await input.isVisible({ timeout: 1500 }).catch(() => false);

  if (inputVisible) {
    console.log('Found visible input, typing...');
    await input.click();
    await input.pressSequentially('TEST', { delay: 50 });
  } else {
    const button = page.locator('button, [role="button"], a.btn').first();
    const buttonVisible = await button.isVisible({ timeout: 1500 }).catch(() => false);
    if (buttonVisible) {
      console.log('Found visible button, clicking...');
      await button.click();
    } else {
      console.log('Clicking document body...');
      await page.mouse.click(200, 200);
    }
  }

  // Wait for paint
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);

  // 3. Extract INP
  const timings = await page.evaluate(() => {
    const entries = window.__eventTimings || [];
    const valid = entries.filter(e => e.duration > 0);
    if (valid.length === 0) return null;
    // INP is the maximum duration among interaction events
    const maxDur = Math.max(...valid.map(e => e.duration));
    return {
      inp: maxDur,
      totalEvents: valid.length,
      sampleEvents: valid.slice(-5)
    };
  });

  console.log('INP Result:', timings);
  await browser.close();
}

testInp().catch(console.error);
