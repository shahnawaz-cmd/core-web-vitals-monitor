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

// Load diagnostics if available to extract actionable opportunities
const diagnosticsPath = path.join(reportsDir, 'diagnostics.json');
let diagnostics = [];
if (fs.existsSync(diagnosticsPath)) {
  try {
    diagnostics = JSON.parse(fs.readFileSync(diagnosticsPath, 'utf-8'));
  } catch (e) {
    // Ignore parse error
  }
}

// Group results by site name
const siteGroups = {};
let overallStatus = '🟢 PASS';
const failureExplanations = [];
let totalPassed = 0;
let totalWarned = 0;
let totalFailed = 0;

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
    totalFailed++;
    pageStatus = 'FAILED 🔴';
    hasIssue = true;
  } else if (lcp === 'needs-improvement' || tbt === 'needs-improvement' || inp === 'needs-improvement') {
    group.warned++;
    totalWarned++;
    pageStatus = 'WARNING 🟡';
    hasIssue = true;
  } else {
    group.passed++;
    totalPassed++;
  }

  if (hasIssue) {
    let metricsIssues = [];
    if (lcp === 'poor') metricsIssues.push(`LCP: ${avg.lcp}ms (Poor)`);
    if (lcp === 'needs-improvement') metricsIssues.push(`LCP: ${avg.lcp}ms (Needs Imp.)`);
    if (tbt === 'poor') metricsIssues.push(`TBT: ${avg.totalBlockingTime}ms (Poor)`);
    if (tbt === 'needs-improvement') metricsIssues.push(`TBT: ${avg.totalBlockingTime}ms (Needs Imp.)`);
    if (inp === 'poor') metricsIssues.push(`INP: ${avg.inp}ms (Poor)`);
    if (inp === 'needs-improvement') metricsIssues.push(`INP: ${avg.inp}ms (Needs Imp.)`);
    if (cls === 'poor') metricsIssues.push(`CLS: ${avg.cls} (Poor)`);
    if (cls === 'needs-improvement') metricsIssues.push(`CLS: ${avg.cls} (Needs Imp.)`);

    group.pages.push(`• ${result.label} (${result.browser}): *${pageStatus}* [${metricsIssues.join(', ')}]`);

    // Add explanatory impact messages for specific failures and warnings
    if (inp === 'poor' || inp === 'needs-improvement') {
      const ratingWord = inp === 'poor' ? 'Poor' : 'Needs Improvement';
      const ratingEmoji = inp === 'poor' ? '🔴' : '🟡';
      failureExplanations.push(`⚠️ *INP Issue on ${result.label} (${result.browser}):* Measured at *${avg.inp}ms (${ratingEmoji} ${ratingWord})*. This indicates that when the user types in input fields or clicks submit, the browser interface takes over half a second to respond and start rendering the next screen.`);
    }
    if (tbt === 'poor' || tbt === 'needs-improvement') {
      const ratingWord = tbt === 'poor' ? 'Poor' : 'Needs Improvement';
      const ratingEmoji = tbt === 'poor' ? '🔴' : '🟡';
      failureExplanations.push(`⚠️ *TBT Issue on ${result.label} (${result.browser}):* Measured at *${avg.totalBlockingTime}ms (${ratingEmoji} ${ratingWord})*. This indicates heavy JavaScript execution is blocking the main thread, making the page unresponsive during load.`);
    }
    if (lcp === 'poor' || lcp === 'needs-improvement') {
      const ratingWord = lcp === 'poor' ? 'Poor' : 'Needs Improvement';
      const ratingEmoji = lcp === 'poor' ? '🔴' : '🟡';
      failureExplanations.push(`⚠️ *LCP Issue on ${result.label} (${result.browser}):* Measured at *${avg.lcp}ms (${ratingEmoji} ${ratingWord})*. The largest visual element took too long to load, increasing the risk of user bounce.`);
    }
    if (cls === 'poor' || cls === 'needs-improvement') {
      const ratingWord = cls === 'poor' ? 'Poor' : 'Needs Improvement';
      const ratingEmoji = cls === 'poor' ? '🔴' : '🟡';
      failureExplanations.push(`⚠️ *CLS Issue on ${result.label} (${result.browser}):* Measured at *${avg.cls} (${ratingEmoji} ${ratingWord})*. Layout shifts detected, which can cause unexpected shifts on the screen while loading.`);
    }
  }
});

// Extract top diagnostic recommendations
const recommendations = [];
diagnostics.forEach(diag => {
  if (diag.renderBlocking && diag.renderBlocking.length > 0) {
    diag.renderBlocking.slice(0, 1).forEach(r => {
      recommendations.push(`• *Render-blocking script found on ${diag.label}:* ${r.url.split('/').pop()} (~${r.duration}ms latency contribution). Consider applying async/defer tags.`);
    });
  }
  if (diag.imageAudit && diag.imageAudit.issues && diag.imageAudit.issues.length > 0) {
    diag.imageAudit.issues.slice(0, 1).forEach(i => {
      recommendations.push(`• *Image Issue on ${diag.label}:* ${i}`);
    });
  }
});

// Generate summary blocks
const summaryBlocks = [];

Object.entries(siteGroups).forEach(([siteName, data]) => {
  const statusEmoji = data.failed > 0 ? '🔴' : data.warned > 0 ? '🟡' : '🟢';
  const siteId = siteName.toLowerCase().replace(/[^a-z0-9]/g, '');
  let detailsText = `*${statusEmoji} ${siteName}* — Passed: ${data.passed}/${data.total} (<${GITHUB_PAGES_URL}/${siteId}/cwv-report.html|View site reports>)`;
  
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
  const uniqueExplanations = [...new Set(failureExplanations)].slice(0, 3);
  explanationBlocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*📋 Failure Diagnostics & Impact:*\n${uniqueExplanations.join('\n\n')}`
    }
  });
}

// Generate recommendations blocks
const recommendationBlocks = [];
if (recommendations.length > 0) {
  const uniqueRecs = [...new Set(recommendations)].slice(0, 3);
  recommendationBlocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*💡 Actionable Performance Opportunities:*\n${uniqueRecs.join('\n')}`
    }
  });
}

// Determine attachment sidebar color
let attachmentColor = '#2eb886'; // Green
if (overallStatus === '🔴 FAIL') {
  attachmentColor = '#a30200'; // Red
} else if (overallStatus === '🟡 WARNING') {
  attachmentColor = '#e8a838'; // Yellow
}

const DOMAIN_ID = process.env.DOMAIN_ID || '';
const TARGET_DOMAIN = process.env.TARGET_DOMAIN || '';
const siteDisplay = DOMAIN_ID ? ` — ${DOMAIN_ID.toUpperCase().replace(/-/g, ' ')}` : '';

const payload = {
  attachments: [
    {
      color: attachmentColor,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `⚡ Core Web Vitals Audit${siteDisplay}`,
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Status:* ${overallStatus}  •  *Passed:* ${totalPassed}  •  *Warnings:* ${totalWarned}  •  *Failed:* ${totalFailed}\n*Portal URL:* <${GITHUB_PAGES_URL}|Open HTML Report Portal 📊>`
          }
        },
        {
          type: 'divider'
        },
        ...summaryBlocks,
        explanationBlocks.length > 0 ? { type: 'divider' } : null,
        ...explanationBlocks,
        recommendationBlocks.length > 0 ? { type: 'divider' } : null,
        ...recommendationBlocks,
        {
          type: 'divider'
        },
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
    }
  ]
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
