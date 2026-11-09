/**
 * ─────────────────────────────────────────────────────────────────
 *  PageSpeed Insights API Audit Script
 *  Fetches lab data from Google's PageSpeed Insights API for all
 *  sites configured in sites.json.
 * ─────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Load configuration or fall back to environment variables
const TARGET_DOMAIN = process.env.TARGET_DOMAIN || '';
const DOMAIN_ID = process.env.DOMAIN_ID || '';

let sites = [];
let settings = { pagespeed_enabled: true, pagespeed_api_key: '' };

const configPath = path.resolve(__dirname, '..', 'sites.json');
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  sites = config.sites || [];
  settings = config.settings || settings;
  
  if (process.env.USE_SITEMAP_URLS) {
    const sitemapFile = process.env.SITEMAP_FILE
      ? path.resolve(process.env.SITEMAP_FILE)
      : path.resolve(__dirname, '../reports/discovered_urls.json');
    if (fs.existsSync(sitemapFile)) {
      let urls = JSON.parse(fs.readFileSync(sitemapFile, 'utf8'));
      if (process.env.PSI_LIMIT) {
        const limit = parseInt(process.env.PSI_LIMIT, 10);
        urls = urls.slice(0, limit);
      }
      const defaultSiteName = urls.length > 0
        ? new URL(urls[0]).hostname.replace(/^www\./, '') + ' (Sitemap)'
        : 'Sitemap URLs';
      const siteName = process.env.SITE_NAME || defaultSiteName;
      sites = [{
        name: siteName,
        urls: urls.map((u, i) => {
          try {
            const pathName = new URL(u).pathname;
            return { label: pathName === '/' ? 'Homepage' : pathName, url: u };
          } catch (e) {
            return { label: `URL ${i + 1}`, url: u };
          }
        })
      }];
    }
  } else if (DOMAIN_ID) {
    sites = sites.filter(s => s.name.toLowerCase().replace(/[^a-z0-9]/g, '') === DOMAIN_ID);
  }
}

const API_KEY = settings.pagespeed_api_key || process.env.PAGESPEED_API_KEY || '';

if (!settings.pagespeed_enabled) {
  console.log('⚠️  PageSpeed Insights is disabled. Skipping.');
  process.exit(0);
}

/**
 * Fetch PageSpeed Insights data for a single URL
 */
function fetchPageSpeedData(url, strategy = 'mobile') {
  return new Promise((resolve, reject) => {
    let apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=PERFORMANCE`;
    if (API_KEY) {
      apiUrl += `&key=${API_KEY}`;
    }

    console.log(`  🔍 Fetching PSI data: ${url} (${strategy})...`);

    const req = https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            console.error(`  ❌ API Error for ${url}: ${json.error.message}`);
            resolve(null);
            return;
          }
          resolve(json);
        } catch (e) {
          console.error(`  ❌ Parse error for ${url}: ${e.message}`);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.error(`  ❌ Request error for ${url}: ${e.message}`);
      resolve(null);
    });

    req.setTimeout(60000, () => {
      req.destroy();
      console.error(`  ❌ Timeout for ${url}`);
      resolve(null);
    });
  });
}

/**
 * Extract key metrics from PSI response
 */
function extractMetrics(psiData) {
  if (!psiData || !psiData.lighthouseResult) return null;

  const lhr = psiData.lighthouseResult;
  const audits = lhr.audits || {};

  return {
    performanceScore: Math.round((lhr.categories?.performance?.score || 0) * 100),
    lcp: {
      value: audits['largest-contentful-paint']?.numericValue || null,
      displayValue: audits['largest-contentful-paint']?.displayValue || 'N/A',
      score: audits['largest-contentful-paint']?.score || 0,
    },
    fcp: {
      value: audits['first-contentful-paint']?.numericValue || null,
      displayValue: audits['first-contentful-paint']?.displayValue || 'N/A',
      score: audits['first-contentful-paint']?.score || 0,
    },
    cls: {
      value: audits['cumulative-layout-shift']?.numericValue || null,
      displayValue: audits['cumulative-layout-shift']?.displayValue || 'N/A',
      score: audits['cumulative-layout-shift']?.score || 0,
    },
    tbt: {
      value: audits['total-blocking-time']?.numericValue || null,
      displayValue: audits['total-blocking-time']?.displayValue || 'N/A',
      score: audits['total-blocking-time']?.score || 0,
    },
    si: {
      value: audits['speed-index']?.numericValue || null,
      displayValue: audits['speed-index']?.displayValue || 'N/A',
      score: audits['speed-index']?.score || 0,
    },
    ttfb: {
      value: audits['server-response-time']?.numericValue || null,
      displayValue: audits['server-response-time']?.displayValue || 'N/A',
      score: audits['server-response-time']?.score || 0,
    },
    interactive: {
      value: audits['interactive']?.numericValue || null,
      displayValue: audits['interactive']?.displayValue || 'N/A',
      score: audits['interactive']?.score || 0,
    },
    opportunities: Object.values(audits)
      .filter((a) => a.details?.type === 'opportunity' && a.details?.overallSavingsMs > 0)
      .map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        savingsMs: Math.round(a.details.overallSavingsMs),
        savingsBytes: a.details.overallSavingsBytes || 0,
      }))
      .sort((a, b) => b.savingsMs - a.savingsMs)
      .slice(0, 10),
    diagnostics: Object.values(audits)
      .filter((a) => a.details?.type === 'table' && a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative')
      .map((a) => ({
        id: a.id,
        title: a.title,
        displayValue: a.displayValue,
        score: a.score,
      }))
      .slice(0, 10),
  };
}

/**
 * Main execution
 */
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   📊  PageSpeed Insights — Multi-Site Audit             ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (!API_KEY) {
    console.log('⚠️  No API key set. Using public API (rate-limited).');
    console.log('   Set PAGESPEED_API_KEY env var or pagespeed_api_key in sites.json\n');
  }

  const allResults = [];

  const queue = [];
  for (const site of sites) {
    for (const urlEntry of site.urls) {
      for (const strategy of ['mobile', 'desktop']) {
        queue.push({
          site: site.name,
          label: urlEntry.label,
          url: urlEntry.url,
          strategy,
        });
      }
    }
  }

  console.log(`📋 Total PSI audit tasks queued: ${queue.length} (Desktop & Mobile)`);
  const CONCURRENCY = process.env.PSI_CONCURRENCY ? parseInt(process.env.PSI_CONCURRENCY, 10) : 4;
  console.log(`⚡ Running with concurrency: ${CONCURRENCY} parallel requests\n`);

  let completed = 0;
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const psiData = await fetchPageSpeedData(item.url, item.strategy);
      const metrics = extractMetrics(psiData);
      completed++;

      if (metrics) {
        const result = {
          site: item.site,
          label: item.label,
          url: item.url,
          strategy: item.strategy,
          timestamp: new Date().toISOString(),
          ...metrics,
        };
        allResults.push(result);

        const scoreEmoji = metrics.performanceScore >= 90 ? '🟢' : metrics.performanceScore >= 50 ? '🟡' : '🔴';
        console.log(`  [${completed}] ${scoreEmoji} ${item.label} (${item.strategy}) — Score: ${metrics.performanceScore}/100 | LCP: ${metrics.lcp.displayValue} | CLS: ${metrics.cls.displayValue}`);
      }

      // Small delay between requests to avoid burst rate limits
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  // Save results
  const outputDir = path.resolve(__dirname, '..', 'reports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, 'psi-results.json');
  fs.writeFileSync(outputFile, JSON.stringify(allResults, null, 2));
  console.log(`\n\n✅ PageSpeed results saved to ${outputFile}`);
  console.log(`   Run 'npm run report' to generate the HTML report.\n`);
}

main().catch(console.error);
