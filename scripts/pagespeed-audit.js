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

const configPath = path.resolve(__dirname, '..', 'sites.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const { settings, sites } = config;

const API_KEY = settings.pagespeed_api_key || process.env.PAGESPEED_API_KEY || '';

if (!settings.pagespeed_enabled) {
  console.log('⚠️  PageSpeed Insights is disabled in sites.json. Set pagespeed_enabled: true to enable.');
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

  for (const site of sites) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🌐 ${site.name}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    for (const urlEntry of site.urls) {
      const strategies = ['mobile', 'desktop'];

      for (const strategy of strategies) {
        const psiData = await fetchPageSpeedData(urlEntry.url, strategy);
        const metrics = extractMetrics(psiData);

        if (metrics) {
          const result = {
            site: site.name,
            label: urlEntry.label,
            url: urlEntry.url,
            strategy,
            timestamp: new Date().toISOString(),
            ...metrics,
          };

          allResults.push(result);

          // Display results
          const scoreEmoji = metrics.performanceScore >= 90 ? '🟢' : metrics.performanceScore >= 50 ? '🟡' : '🔴';
          console.log(`\n  ${scoreEmoji} ${urlEntry.label} (${strategy}) — Score: ${metrics.performanceScore}/100`);
          console.log(`     LCP:  ${metrics.lcp.displayValue}`);
          console.log(`     FCP:  ${metrics.fcp.displayValue}`);
          console.log(`     CLS:  ${metrics.cls.displayValue}`);
          console.log(`     TBT:  ${metrics.tbt.displayValue}`);
          console.log(`     SI:   ${metrics.si.displayValue}`);
          console.log(`     TTFB: ${metrics.ttfb.displayValue}`);

          if (metrics.opportunities.length > 0) {
            console.log(`\n     💡 Top Opportunities:`);
            for (const opp of metrics.opportunities.slice(0, 3)) {
              console.log(`        • ${opp.title} (save ~${opp.savingsMs}ms)`);
            }
          }
        }

        // Rate limit: wait between requests
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

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
