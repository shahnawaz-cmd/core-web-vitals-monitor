// @ts-check
const { test, expect } = require('./fixtures');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────────────────────
//  Core Web Vitals Test Suite — Multi-Site Performance Audit
//  Supports: Network Throttling, CPU Throttling, and Color Schemes
// ──────────────────────────────────────────────────────────────

const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../sites.json'), 'utf8'));
const sites = config.sites;
const RUNS = 3;

const allResults = [];

async function collectWebVitals(page, url, timeout = 15000) {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  return await page.evaluate(async (waitMs) => {
    return new Promise((resolve) => {
      const results = {
        lcp: null,
        fcp: null,
        cls: null,
        ttfb: null,
        inp: null,
        si: null,
        domContentLoaded: null,
        loadEvent: null,
        totalBlockingTime: null,
        resourceCount: 0,
        totalTransferSize: 0,
      };

      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        results.ttfb = Math.round(nav.responseStart - nav.requestStart);
        results.domContentLoaded = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
        results.loadEvent = Math.round(nav.loadEventEnd - nav.startTime);
      }

      const paintEntries = performance.getEntriesByType('paint');
      const fcpEntry = paintEntries.find((e) => e.name === 'first-contentful-paint');
      if (fcpEntry) {
        results.fcp = Math.round(fcpEntry.startTime);
      }

      let lcpValue = null;
      try {
        const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
        if (lcpEntries.length > 0) {
          lcpValue = Math.round(lcpEntries[lcpEntries.length - 1].startTime);
        }
      } catch (e) {}

      try {
        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            lcpValue = Math.round(entries[entries.length - 1].startTime);
          }
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => lcpObserver.disconnect(), 100);
      } catch (e) {}

      let clsValue = 0;
      try {
        const clsObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
            }
          }
        });
        clsObserver.observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => clsObserver.disconnect(), 100);
      } catch (e) {}

      let totalBlockingTime = 0;
      try {
        const longTaskEntries = performance.getEntriesByType('longtask');
        for (const entry of longTaskEntries) {
          totalBlockingTime += Math.max(0, entry.duration - 50);
        }
      } catch (e) {}

      const resources = performance.getEntriesByType('resource');
      results.resourceCount = resources.length;
      results.totalTransferSize = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);

      setTimeout(() => {
        results.lcp = lcpValue;
        results.cls = Math.round(clsValue * 10000) / 10000;
        results.totalBlockingTime = Math.round(totalBlockingTime);
        resolve(results);
      }, Math.min(waitMs, 5000));
    });
  }, timeout);
}

function rateMetric(name, value) {
  if (value === null || value === undefined) return 'unknown';
  const thresholds = {
    lcp:  { good: 2500, poor: 4000 },
    fcp:  { good: 1800, poor: 3000 },
    cls:  { good: 0.1,  poor: 0.25 },
    ttfb: { good: 800,  poor: 1800 },
    inp:  { good: 200,  poor: 500 },
    tbt:  { good: 200,  poor: 600 },
  };
  const t = thresholds[name];
  if (!t) return 'info';
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

function estimateSpeedIndex(metrics) {
  if (metrics.fcp && metrics.loadEvent) {
    return Math.round((metrics.fcp * 0.4) + (metrics.loadEvent * 0.6));
  }
  return null;
}

for (const site of sites) {
  test.describe(`📊 Core Web Vitals — ${site.name}`, () => {
    for (const urlEntry of site.urls) {
      test(`${urlEntry.label} (${urlEntry.url})`, async ({ page, browserName }) => {
        const runResults = [];

        let runPage = page;
        for (let run = 1; run <= RUNS; run++) {
          if (run > 1) {
            // Create a fresh new context page to avoid state leakage
            const freshContext = await page.context().browser().newContext(test.info().project.use);
            runPage = await freshContext.newPage();
          }

          const metrics = await collectWebVitals(runPage, urlEntry.url);
          metrics.si = estimateSpeedIndex(metrics);

          // Measure user interaction INP if visiting an input page
          let inp = null;
          if (urlEntry.url.includes('vin-check') || urlEntry.url.includes('license-plate-lookup')) {
            try {
              // 1. Enter dummy input
              const searchInput = runPage.locator('input[placeholder*="VIN"], input[type="text"]').first();
              if (await searchInput.isVisible()) {
                const startTime = Date.now();
                await searchInput.fill('1HGCR2F8XHA000000');
                await runPage.keyboard.press('Enter');
                const endTime = Date.now();
                inp = Math.min(endTime - startTime, 1000); 
              }
            } catch (e) {
              console.log('⚠️ Interaction for INP failed or skipped');
            }
          }
          metrics.inp = inp;

          runResults.push({
            run,
            ...metrics,
            ratings: {
              lcp:  rateMetric('lcp', metrics.lcp),
              fcp:  rateMetric('fcp', metrics.fcp),
              cls:  rateMetric('cls', metrics.cls),
              ttfb: rateMetric('ttfb', metrics.ttfb),
              tbt:  rateMetric('tbt', metrics.totalBlockingTime),
              inp:  rateMetric('inp', metrics.inp),
            },
          });

          if (run > 1) {
            // Close the temporary context page
            await runPage.context().close();
          }
        }

        const avg = {};
        const numericKeys = ['lcp', 'fcp', 'cls', 'ttfb', 'si', 'totalBlockingTime', 'domContentLoaded', 'loadEvent', 'resourceCount', 'totalTransferSize', 'inp'];
        for (const key of numericKeys) {
          const values = runResults.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
          avg[key] = values.length > 0
            ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
            : null;
        }

        const result = {
          site: site.name,
          label: urlEntry.label,
          url: urlEntry.url,
          browser: test.info().project.name,
          timestamp: new Date().toISOString(),
          runs: runResults,
          averages: avg,
          ratings: {
            lcp:  rateMetric('lcp', avg.lcp),
            fcp:  rateMetric('fcp', avg.fcp),
            cls:  rateMetric('cls', avg.cls),
            ttfb: rateMetric('ttfb', avg.ttfb),
            tbt:  rateMetric('tbt', avg.totalBlockingTime),
            inp:  rateMetric('inp', avg.inp),
          },
        };

        // Save this page's results to a unique temporary file
        const tempDir = path.resolve(__dirname, '..', 'reports', 'temp-results');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        const tempFile = path.join(tempDir, `${site.name}-${urlEntry.label}-${test.info().project.name}.json`.replace(/[^a-zA-Z0-9.-]/g, '_'));
        fs.writeFileSync(tempFile, JSON.stringify(result, null, 2));

        console.log(`\n  📈 AVERAGES — ${site.name} / ${urlEntry.label}`);
        console.log(`     LCP:  ${avg.lcp !== null ? avg.lcp + 'ms' : 'N/A'} [${rateMetric('lcp', avg.lcp)}]`);
        console.log(`     INP:  ${avg.inp !== null ? avg.inp + 'ms' : 'N/A'} [${rateMetric('inp', avg.inp)}]`);
        console.log(`     TBT:  ${avg.totalBlockingTime !== null ? avg.totalBlockingTime + 'ms' : 'N/A'} [${rateMetric('tbt', avg.totalBlockingTime)}]`);
      });
    }
  });
}
