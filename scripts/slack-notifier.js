/**
 * ─────────────────────────────────────────────────────────────────
 *  Slack Notification Script (Detailed Summary Version)
 *  Groups results by Site, lists page statuses, and explains
 *  the user impact of failures (like poor LCP, TBT, or INP).
 * ─────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const reportsDir = path.resolve(__dirname, '..', 'reports');
const cwvResultsPath = path.join(reportsDir, 'cwv-results.json');

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const GITHUB_PAGES_URL = process.env.GITHUB_PAGES_URL || 'https://yourusername.github.io/your-repo';

if (!SLACK_WEBHOOK_URL) {
  console.log('⚠️  SLACK_WEBHOOK_URL is not set. Skipping Slack notification.');
  process.exit(0);
}

if (!fs.existsSync(cwvResultsPath)) {
  console.error('❌ cwv-results.json not found. Run tests first.');
  process.exit(1);
}

const cwvResults = JSON.parse(fs.readFileSync(cwvResultsPath, 'utf-8'));

// Group results by site name
const siteGroups = {};
let overallStatus = '🟢 PASS';
const failureExplanations = [];

cwvResults.forEach((result) => {
  const avg = result.averages || {};
  const lcp = result.ratings?.lcp || 'unknown';
  const tbt = result.ratings?.tbt || 'unknown';
  const cls = result.ratings?.cls || 'unknown';
  const inp = result.ratings?.inp || 'unknown';

  if (lcp === 'poor' || tbt === 'poor' || cls === 'poor' || inp === 'poor') {
    overallStatus = '🔴 FAIL';
  } else if ((lcp === 'needs-improvement' || tbt === 'needs-improvement' || inp === 'needs-improvement') && overallStatus !== '🔴 FAIL') {
    overallStatus = '🟡 WARNING';
  }

  if (!siteGroups[result.site]) {
    siteGroups[result.site] = {
      passed: 0,
      warned: 0,
      failed: 0,
      total: 0,
      pages: []
    };
  }

  const group = siteGroups[result.site];
  group.total++;

  let pageStatus = 'PASSED 🟢';
  let hasIssue = false;

  if (lcp === 'poor' || tbt === 'poor' || cls === 'poor' || inp === 'poor') {
    group.failed++;
    pageStatus = 'FAILED 🔴';
    hasIssue = true;
  } else if (lcp === 'needs-improvement' || tbt === 'needs-improvement' || inp === 'needs-improvement') {
    group.warned++;
    pageStatus = 'WARNING 🟡';
    hasIssue = true;
  } else {
    group.passed++;
  }

  if (hasIssue) {
    let metricsIssues = [];
    if (lcp === 'poor') metricsIssues.push(`LCP: ${avg.lcp}ms (Poor)`);
    if (tbt === 'poor') metricsIssues.push(`TBT: ${avg.totalBlockingTime}ms (Poor)`);
    if (inp === 'poor') metricsIssues.push(`INP: ${avg.inp}ms (Poor)`);
    if (cls === 'poor') metricsIssues.push(`CLS: ${avg.cls} (Poor)`);

    group.pages.push(`• ${result.label} (${result.browser}): *${pageStatus}* [${metricsIssues.join(', ')}]`);

    // Add explanatory impact messages for specific failures
    if (inp === 'poor') {
      failureExplanations.push(`⚠️ *INP Issue on ${result.label} (${result.browser}):* Measured at *${avg.inp}ms (🔴 Poor)*. This indicates that when the user types in input fields or clicks submit, the browser interface takes over half a second to respond and start rendering the next screen.`);
    }
    if (tbt === 'poor') {
      failureExplanations.push(`⚠️ *TBT Issue on ${result.label} (${result.browser}):* Measured at *${avg.totalBlockingTime}ms (🔴 Poor)*. This indicates heavy JavaScript execution is blocking the main thread, making the page unresponsive during load.`);
    }
    if (lcp === 'poor') {
      failureExplanations.push(`⚠️ *LCP Issue on ${result.label} (${result.browser}):* Measured at *${avg.lcp}ms (🔴 Poor)*. The largest visual element took too long to load, increasing the risk of user bounce.`);
    }
  }
});

// Generate summary blocks
const summaryBlocks = [];

Object.entries(siteGroups).forEach(([siteName, data]) => {
  const statusEmoji = data.failed > 0 ? '🔴' : data.warned > 0 ? '🟡' : '🟢';
  let detailsText = `*${statusEmoji} ${siteName}* — Passed: ${data.passed}/${data.total}`;
  
  if (data.warned > 0 || data.failed > 0) {
    detailsText += `\n${data.pages.slice(0, 5).join('\n')}`;
    if (data.pages.length > 5) {
      detailsText += `\n• ...and ${data.pages.length - 5} more pages`;
    }
  }

  summaryBlocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: detailsText
    }
  });
});

// Generate explanations block if any failures occurred
const explanationBlocks = [];
if (failureExplanations.length > 0) {
  // Deduplicate and slice explanations to keep message clean
  const uniqueExplanations = [...new Set(failureExplanations)].slice(0, 3);
  explanationBlocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*📋 Failure Diagnostics & Impact:*\n${uniqueExplanations.join('\n\n')}`
    }
  });
}

const payload = {
  text: `⚡ *Core Web Vitals Audit: ${overallStatus}*`,
  blocks: [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `⚡ Core Web Vitals Audit Summary`,
        emoji: true
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Overall Status:* ${overallStatus}\n*Report URL:* <${GITHUB_PAGES_URL}/reports/cwv-report.html|Open HTML Report 📊>`
      }
    },
    {
      type: 'divider'
    },
    ...summaryBlocks,
    {
      type: 'divider'
    },
    ...explanationBlocks,
    failureExplanations.length > 0 ? { type: 'divider' } : null,
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Tested on standard mobile & desktop viewports using Playwright CI runner.`
        }
      ]
    }
  ].filter(Boolean)
};

// Send webhook request
const url = new URL(SLACK_WEBHOOK_URL);
const options = {
  hostname: url.hostname,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log(`✅ Slack notification sent. Status: ${res.statusCode}`);
  });
});

req.on('error', (e) => {
  console.error(`❌ Failed to send Slack notification: ${e.message}`);
});

req.write(JSON.stringify(payload));
req.end();
