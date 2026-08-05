/**
 * ─────────────────────────────────────────────────────────────────
 *  HTML Report Generator for Core Web Vitals
 *  Combines Playwright real-browser results + PageSpeed Insights
 *  data into a beautiful, interactive HTML report with charts.
 * ─────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

const reportsDir = path.resolve(__dirname, '..', 'reports');
const cwvResultsPath = path.join(reportsDir, 'cwv-results.json');
const psiResultsPath = path.join(reportsDir, 'psi-results.json');
const outputPath = path.join(reportsDir, 'cwv-report.html');

// Load data and compile from temp directory if it exists
let cwvResults = [];
let psiResults = [];

const tempResultsDir = path.join(reportsDir, 'temp-results');
if (fs.existsSync(tempResultsDir)) {
  const files = fs.readdirSync(tempResultsDir);
  files.forEach(file => {
    if (file.endsWith('.json') && !file.startsWith('diag-')) {
      try {
        const fileContent = JSON.parse(fs.readFileSync(path.join(tempResultsDir, file), 'utf-8'));
        cwvResults.push(fileContent);
      } catch (e) {
        console.warn(`⚠️ Failed to parse temp file: ${file}`);
      }
    }
  });
  // Write the consolidated results file
  fs.writeFileSync(cwvResultsPath, JSON.stringify(cwvResults, null, 2));
} else if (fs.existsSync(cwvResultsPath)) {
  cwvResults = JSON.parse(fs.readFileSync(cwvResultsPath, 'utf-8'));
}

if (fs.existsSync(psiResultsPath)) {
  psiResults = JSON.parse(fs.readFileSync(psiResultsPath, 'utf-8'));
}

if (cwvResults.length === 0 && psiResults.length === 0) {
  console.log('❌ No results found. Run tests first:');
  console.log('   npm run test:cwv   — Playwright real browser tests');
  console.log('   npm run test:psi   — PageSpeed Insights API audit');
  process.exit(1);
}

const timestamp = new Date().toLocaleString('en-US', {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

function ratingClass(rating) {
  if (rating === 'good') return 'good';
  if (rating === 'needs-improvement') return 'warning';
  if (rating === 'poor') return 'poor';
  return 'neutral';
}

function ratingEmoji(rating) {
  if (rating === 'good') return '🟢';
  if (rating === 'needs-improvement') return '🟡';
  if (rating === 'poor') return '🔴';
  return '⚪';
}

function scoreColor(score) {
  if (score >= 90) return '#0cce6b';
  if (score >= 50) return '#ffa400';
  return '#ff4e42';
}

function formatMs(val) {
  if (val === null || val === undefined) return 'N/A';
  return val >= 1000 ? `${(val / 1000).toFixed(2)}s` : `${Math.round(val)}ms`;
}

function formatCLS(val) {
  if (val === null || val === undefined) return 'N/A';
  return val.toFixed(4);
}

// ──────────────────────────────────────────────────────────────
//  Build HTML
// ──────────────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Core Web Vitals Report — ${timestamp}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

    :root {
      --bg-primary: #0a0e1a;
      --bg-secondary: #111827;
      --bg-card: #1a2035;
      --bg-card-hover: #1f2847;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --border: #1e293b;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.3);
      --good: #0cce6b;
      --good-bg: rgba(12, 206, 107, 0.1);
      --warning: #ffa400;
      --warning-bg: rgba(255, 164, 0, 0.1);
      --poor: #ff4e42;
      --poor-bg: rgba(255, 78, 66, 0.1);
      --gradient-1: linear-gradient(135deg, #6366f1, #8b5cf6);
      --gradient-2: linear-gradient(135deg, #06b6d4, #3b82f6);
      --gradient-3: linear-gradient(135deg, #f59e0b, #ef4444);
      --radius: 16px;
      --radius-sm: 10px;
      --shadow: 0 4px 30px rgba(0,0,0,0.3);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ── Header ── */
    .header {
      background: linear-gradient(180deg, rgba(99,102,241,0.15) 0%, transparent 100%);
      border-bottom: 1px solid var(--border);
      padding: 40px 0;
    }

    .header-inner {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 20px;
    }

    .header h1 {
      font-size: 32px;
      font-weight: 800;
      background: var(--gradient-1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .header .subtitle {
      color: var(--text-secondary);
      font-size: 14px;
      margin-top: 4px;
    }

    .header-stats {
      display: flex;
      gap: 24px;
    }

    .header-stat {
      text-align: center;
    }

    .header-stat-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--accent);
    }

    .header-stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--text-muted);
    }

    /* ── Container ── */
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 32px;
    }

    /* ── Tabs ── */
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 32px;
      background: var(--bg-secondary);
      border-radius: var(--radius);
      padding: 4px;
      width: fit-content;
    }

    .tab {
      padding: 10px 24px;
      border-radius: 12px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.3s ease;
      font-family: 'Inter', sans-serif;
    }

    .tab:hover { color: var(--text-primary); }

    .tab.active {
      background: var(--accent);
      color: white;
      box-shadow: 0 2px 12px var(--accent-glow);
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* ── Section ── */
    .section-title {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .section-title .icon {
      font-size: 24px;
    }

    /* ── Cards Grid ── */
    .site-section {
      margin-bottom: 48px;
    }

    .site-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }

    .site-name {
      font-size: 20px;
      font-weight: 700;
    }

    .site-badge {
      background: var(--bg-card);
      color: var(--text-secondary);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }

    /* ── Metric Cards ── */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }

    .metric-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }

    .metric-card:hover {
      transform: translateY(-2px);
      border-color: var(--accent);
      box-shadow: 0 8px 40px rgba(99, 102, 241, 0.15);
    }

    .metric-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
    }

    .metric-card.good::before { background: var(--good); }
    .metric-card.warning::before { background: var(--warning); }
    .metric-card.poor::before { background: var(--poor); }

    .metric-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .metric-name {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--text-secondary);
    }

    .metric-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .metric-badge.good { background: var(--good-bg); color: var(--good); }
    .metric-badge.warning { background: var(--warning-bg); color: var(--warning); }
    .metric-badge.poor { background: var(--poor-bg); color: var(--poor); }

    .metric-value {
      font-size: 36px;
      font-weight: 800;
      line-height: 1;
      margin-bottom: 8px;
    }

    .metric-value.good { color: var(--good); }
    .metric-value.warning { color: var(--warning); }
    .metric-value.poor { color: var(--poor); }

    .metric-threshold {
      font-size: 12px;
      color: var(--text-muted);
    }

    /* ── URL Result Row ── */
    .url-result {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 16px;
      transition: all 0.3s ease;
    }

    .url-result:hover {
      border-color: rgba(99, 102, 241, 0.3);
    }

    .url-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 8px;
    }

    .url-label {
      font-size: 16px;
      font-weight: 600;
    }

    .url-link {
      color: var(--accent);
      font-size: 13px;
      text-decoration: none;
      word-break: break-all;
    }

    .url-link:hover { text-decoration: underline; }

    .url-meta {
      display: flex;
      gap: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .metrics-row {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 16px;
    }

    .metric-cell {
      text-align: center;
      padding: 12px;
      background: var(--bg-secondary);
      border-radius: var(--radius-sm);
      transition: all 0.3s ease;
    }

    .metric-cell:hover { background: var(--bg-card-hover); }

    .metric-cell-name {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    .metric-cell-value {
      font-size: 22px;
      font-weight: 700;
    }

    .metric-cell-value.good { color: var(--good); }
    .metric-cell-value.warning { color: var(--warning); }
    .metric-cell-value.poor { color: var(--poor); }
    .metric-cell-value.neutral { color: var(--text-secondary); }

    /* ── Score Ring ── */
    .score-ring {
      width: 100px;
      height: 100px;
      margin: 0 auto 12px;
    }

    .score-ring svg {
      width: 100%;
      height: 100%;
    }

    .score-ring-bg {
      fill: none;
      stroke: var(--border);
      stroke-width: 8;
    }

    .score-ring-progress {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
      transform: rotate(-90deg);
      transform-origin: center;
      transition: stroke-dashoffset 1s ease;
    }

    .score-ring-text {
      font-family: 'Inter', sans-serif;
      font-weight: 800;
      font-size: 24px;
      fill: var(--text-primary);
      text-anchor: middle;
      dominant-baseline: central;
    }

    /* ── PSI Cards ── */
    .psi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      gap: 24px;
    }

    .psi-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 28px;
      transition: all 0.3s ease;
    }

    .psi-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow);
    }

    .psi-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
    }

    .psi-strategy-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .psi-strategy-badge.mobile {
      background: rgba(6, 182, 212, 0.15);
      color: #06b6d4;
    }

    .psi-strategy-badge.desktop {
      background: rgba(139, 92, 246, 0.15);
      color: #8b5cf6;
    }

    /* ── Opportunities ── */
    .opportunities {
      margin-top: 20px;
    }

    .opportunity {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }

    .opportunity:last-child { border-bottom: none; }

    .opportunity-title { color: var(--text-primary); flex: 1; }

    .opportunity-savings {
      color: var(--warning);
      font-weight: 600;
      white-space: nowrap;
      margin-left: 12px;
    }

    /* ── Summary Table ── */
    .summary-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      background: var(--bg-card);
      border-radius: var(--radius);
      overflow: hidden;
      border: 1px solid var(--border);
    }

    .summary-table th {
      background: var(--bg-secondary);
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      padding: 14px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    .summary-table td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }

    .summary-table tr:last-child td { border-bottom: none; }

    .summary-table tr:hover td {
      background: var(--bg-card-hover);
    }

    /* ── Footer ── */
    .footer {
      text-align: center;
      padding: 40px;
      color: var(--text-muted);
      font-size: 13px;
      border-top: 1px solid var(--border);
      margin-top: 60px;
    }

    .footer a {
      color: var(--accent);
      text-decoration: none;
    }

    /* ── Animations ── */
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .animate-in {
      animation: fadeInUp 0.5s ease forwards;
      opacity: 0;
    }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .header-inner { flex-direction: column; text-align: center; }
      .header-stats { justify-content: center; }
      .metrics-row { grid-template-columns: repeat(3, 1fr); }
      .psi-grid { grid-template-columns: 1fr; }
      .container { padding: 16px; }
    }
  </style>
</head>
<body>

  <!-- ═══ HEADER ═══ -->
  <header class="header">
    <div class="header-inner">
      <div>
        <h1>⚡ Core Web Vitals Report</h1>
        <div class="subtitle">Generated on ${timestamp}</div>
      </div>
      <div class="header-stats">
        <div class="header-stat">
          <div class="header-stat-value">${new Set([...cwvResults.map(r => r.site), ...psiResults.map(r => r.site)]).size}</div>
          <div class="header-stat-label">Sites Tested</div>
        </div>
        <div class="header-stat">
          <div class="header-stat-value">${new Set([...cwvResults.map(r => r.url), ...psiResults.map(r => r.url)]).size}</div>
          <div class="header-stat-label">Pages Tested</div>
        </div>
        <div class="header-stat">
          <div class="header-stat-value">${cwvResults.reduce((s, r) => s + (r.runs?.length || 0), 0)}</div>
          <div class="header-stat-label">Browser Runs</div>
        </div>
      </div>
    </div>
  </header>

  <div class="container">

    <!-- ═══ TABS ═══ -->
    <div class="tabs">
      <button class="tab active" onclick="switchTab('overview')">📊 Overview</button>
      <button class="tab" onclick="switchTab('browser')">🌐 Browser Tests</button>
      <button class="tab" onclick="switchTab('pagespeed')">🔬 PageSpeed Insights</button>
      <button class="tab" onclick="switchTab('summary')">📋 Summary Table</button>
    </div>

    <!-- ═══ OVERVIEW TAB ═══ -->
    <div id="tab-overview" class="tab-content active">
      <div class="section-title"><span class="icon">📊</span> Overview — All Sites</div>
      ${generateOverviewCards()}
    </div>

    <!-- ═══ BROWSER TESTS TAB ═══ -->
    <div id="tab-browser" class="tab-content">
      <div class="section-title"><span class="icon">🌐</span> Real Browser Metrics (Playwright)</div>
      ${generateBrowserResultsClean()}
    </div>

    <!-- ═══ PAGESPEED TAB ═══ -->
    <div id="tab-pagespeed" class="tab-content">
      <div class="section-title"><span class="icon">🔬</span> PageSpeed Insights Lab Data</div>
      ${generatePSIResults()}
    </div>

    <!-- ═══ SUMMARY TAB ═══ -->
    <div id="tab-summary" class="tab-content">
      <div class="section-title"><span class="icon">📋</span> Summary Comparison</div>
      ${generateSummaryTable()}
    </div>

  </div>

  <!-- ═══ FOOTER ═══ -->
  <div class="footer">
    <p>Core Web Vitals Testing Suite — Report generated on ${timestamp}</p>
    <p style="margin-top: 8px;">
      Thresholds: LCP ≤ 2.5s 🟢 ≤ 4s 🟡 &gt;4s 🔴 &nbsp;|&nbsp;
      FCP ≤ 1.8s 🟢 ≤ 3s 🟡 &gt;3s 🔴 &nbsp;|&nbsp;
      CLS ≤ 0.1 🟢 ≤ 0.25 🟡 &gt;0.25 🔴 &nbsp;|&nbsp;
      TTFB ≤ 800ms 🟢 ≤ 1.8s 🟡 &gt;1.8s 🔴
    </p>
  </div>

  <script>
    function switchTab(tabName) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('tab-' + tabName).classList.add('active');
    }

    // Animate elements on scroll
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          entry.target.style.animationDelay = (i * 0.05) + 's';
          entry.target.classList.add('animate-in');
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.metric-card, .url-result, .psi-card').forEach(el => {
      observer.observe(el);
    });
  </script>

</body>
</html>`;

// ──────────────────────────────────────────────────────────────
//  Helper functions for generating HTML sections
// ──────────────────────────────────────────────────────────────

function generateOverviewCards() {
  const siteGroups = {};
  for (const r of cwvResults) {
    if (!siteGroups[r.site]) siteGroups[r.site] = { desktop: [], mobile: [], psi: [] };
    const device = r.browser && r.browser.includes('mobile') ? 'mobile' : 'desktop';
    siteGroups[r.site][device].push(r);
  }
  for (const r of psiResults) {
    if (!siteGroups[r.site]) siteGroups[r.site] = { desktop: [], mobile: [], psi: [] };
    siteGroups[r.site].psi.push(r);
  }

  let html = '';

  for (const [siteName, data] of Object.entries(siteGroups)) {
    html += `<div class="site-section">
      <div class="site-header">
        <span class="site-name">🌐 ${siteName}</span>
        <span class="site-badge">${data.desktop.length + data.mobile.length + data.psi.length} results</span>
      </div>`;

    // Desktop browser test overview
    if (data.desktop.length > 0) {
      html += `<h3 style="margin: 16px 0 10px; color: var(--text-primary); font-size: 15px; display: flex; align-items: center; gap: 8px;">🖥️ Desktop Viewport Results</h3>`;
      for (const result of data.desktop) {
        const avg = result.averages || {};
        html += `<div class="url-result">
          <div class="url-header">
            <div>
              <div class="url-label">${result.label}</div>
              <a class="url-link" href="${result.url}" target="_blank">${result.url}</a>
            </div>
            <div class="url-meta">
              <span>🖥️ ${result.browser || 'chrome'}</span>
              <span>📅 ${new Date(result.timestamp).toLocaleDateString()}</span>
            </div>
          </div>
          <div class="metrics-row" style="grid-template-columns: repeat(7, 1fr);">
            <div class="metric-cell">
              <div class="metric-cell-name">LCP</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.lcp)}">${formatMs(avg.lcp)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">FCP</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.fcp)}">${formatMs(avg.fcp)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">CLS</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.cls)}">${formatCLS(avg.cls)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">TTFB</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.ttfb)}">${formatMs(avg.ttfb)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">TBT</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.tbt)}">${formatMs(avg.totalBlockingTime)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">INP</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.inp)}">${avg.inp !== null ? formatMs(avg.inp) : '—'}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">Speed Index</div>
              <div class="metric-cell-value neutral">${formatMs(avg.si)}</div>
            </div>
          </div>
        </div>`;
      }
    }

    // Mobile browser test overview
    if (data.mobile.length > 0) {
      html += `<h3 style="margin: 24px 0 10px; color: var(--text-primary); font-size: 15px; display: flex; align-items: center; gap: 8px;">📱 Mobile Viewport Results</h3>`;
      for (const result of data.mobile) {
        const avg = result.averages || {};
        html += `<div class="url-result">
          <div class="url-header">
            <div>
              <div class="url-label">${result.label}</div>
              <a class="url-link" href="${result.url}" target="_blank">${result.url}</a>
            </div>
            <div class="url-meta">
              <span>📱 ${result.browser || 'chrome'}</span>
              <span>📅 ${new Date(result.timestamp).toLocaleDateString()}</span>
            </div>
          </div>
          <div class="metrics-row" style="grid-template-columns: repeat(7, 1fr);">
            <div class="metric-cell">
              <div class="metric-cell-name">LCP</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.lcp)}">${formatMs(avg.lcp)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">FCP</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.fcp)}">${formatMs(avg.fcp)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">CLS</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.cls)}">${formatCLS(avg.cls)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">TTFB</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.ttfb)}">${formatMs(avg.ttfb)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">TBT</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.tbt)}">${formatMs(avg.totalBlockingTime)}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">INP</div>
              <div class="metric-cell-value ${ratingClass(result.ratings?.inp)}">${avg.inp !== null ? formatMs(avg.inp) : '—'}</div>
            </div>
            <div class="metric-cell">
              <div class="metric-cell-name">Speed Index</div>
              <div class="metric-cell-value neutral">${formatMs(avg.si)}</div>
            </div>
          </div>
        </div>`;
      }
    }

    html += '</div>';
  }

  if (Object.keys(siteGroups).length === 0) {
    html = '<p style="color: var(--text-muted);">No results yet. Run tests to generate data.</p>';
  }

  return html;
}

function generateBrowserResults() {
  if (cwvResults.length === 0) {
    return '<p style="color: var(--text-muted);">No browser test results. Run: <code>npm run test:cwv</code></p>';
  }

  let html = '';
  const siteGroups = {};
  for (const r of cwvResults) {
    if (!siteGroups[r.site]) siteGroups[r.site] = { desktop: [], mobile: [] };
    const device = r.browser && r.browser.includes('mobile') ? 'mobile' : 'desktop';
    siteGroups[r.site][device].push(r);
  }

  for (const [siteName, data] of Object.entries(siteGroups)) {
    html += `<div class="site-section">
      <div class="site-header">
        <span class="site-name">${siteName}</span>
        <span class="site-badge">${data.desktop.length + data.mobile.length} pages tested</span>
      </div>`;

    // Render Desktop Results
    if (data.desktop.length > 0) {
      html += `<h3 style="margin: 16px 0 10px; color: var(--text-primary); font-size: 15px;">🖥️ Desktop Viewport</h3>`;
      for (const result of data.desktop) {
        const avg = result.averages || {};
        html += `<div class="url-result">
          <div class="url-header">
            <div>
              <div class="url-label">${result.label}</div>
              <a class="url-link" href="${result.url}" target="_blank">${result.url}</a>
            </div>
            <div class="url-meta">
              <span>🖥️ ${result.browser || 'chrome'}</span>
              <span>${result.runs?.length || 0} runs</span>
            </div>
          </div>`;
          // Metric rows and runs list will follow template
      }
    }

    // Render Mobile Results
    if (data.mobile.length > 0) {
      html += `<h3 style="margin: 24px 0 10px; color: var(--text-primary); font-size: 15px;">📱 Mobile Viewport</h3>`;
      for (const result of data.mobile) {
        const avg = result.averages || {};
        html += `<div class="url-result">
          <div class="url-header">
            <div>
              <div class="url-label">${result.label}</div>
              <a class="url-link" href="${result.url}" target="_blank">${result.url}</a>
            </div>
            <div class="url-meta">
              <span>📱 ${result.browser || 'chrome'}</span>
              <span>${result.runs?.length || 0} runs</span>
            </div>
          </div>`;
      }
    }

    html += '</div>';
  }

  return html;
}

// We will keep a helper function that returns the HTML of a card row to prevent duplicating rendering logic
function renderMetricRowHtml(result, avg) {
  let html = `<div class="metrics-row" style="grid-template-columns: repeat(7, 1fr);">
    <div class="metric-cell">
      <div class="metric-cell-name">LCP</div>
      <div class="metric-cell-value ${ratingClass(result.ratings?.lcp)}">${formatMs(avg.lcp)}</div>
    </div>
    <div class="metric-cell">
      <div class="metric-cell-name">FCP</div>
      <div class="metric-cell-value ${ratingClass(result.ratings?.fcp)}">${formatMs(avg.fcp)}</div>
    </div>
    <div class="metric-cell">
      <div class="metric-cell-name">CLS</div>
      <div class="metric-cell-value ${ratingClass(result.ratings?.cls)}">${formatCLS(avg.cls)}</div>
    </div>
    <div class="metric-cell">
      <div class="metric-cell-name">TTFB</div>
      <div class="metric-cell-value ${ratingClass(result.ratings?.ttfb)}">${formatMs(avg.ttfb)}</div>
    </div>
    <div class="metric-cell">
      <div class="metric-cell-name">TBT</div>
      <div class="metric-cell-value ${ratingClass(result.ratings?.tbt)}">${formatMs(avg.totalBlockingTime)}</div>
    </div>
    <div class="metric-cell">
      <div class="metric-cell-name">INP</div>
      <div class="metric-cell-value ${ratingClass(result.ratings?.inp)}">${avg.inp !== null ? formatMs(avg.inp) : '—'}</div>
    </div>
    <div class="metric-cell">
      <div class="metric-cell-name">Resources</div>
      <div class="metric-cell-value neutral">${avg.resourceCount || 'N/A'}</div>
    </div>
  </div>`;

  if (result.runs && result.runs.length > 0) {
    html += `<details style="margin-top: 8px; margin-bottom: 16px; padding: 0 12px 8px;">
      <summary style="cursor: pointer; color: var(--text-secondary); font-size: 13px;">Show individual runs</summary>
      <div style="margin-top: 12px;">`;

    for (const run of result.runs) {
      html += `<div style="display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px;">
        <span style="color: var(--text-muted); width: 60px;">Run ${run.run}</span>
        <span class="${ratingClass(run.ratings?.lcp)}">LCP: ${formatMs(run.lcp)}</span>
        <span class="${ratingClass(run.ratings?.fcp)}">FCP: ${formatMs(run.fcp)}</span>
        <span class="${ratingClass(run.ratings?.cls)}">CLS: ${formatCLS(run.cls)}</span>
        <span class="${ratingClass(run.ratings?.ttfb)}">TTFB: ${formatMs(run.ttfb)}</span>
        <span class="${ratingClass(run.ratings?.inp)}">INP: ${run.inp !== null ? formatMs(run.inp) : '—'}</span>
      </div>`;
    }

    html += '</div></details>';
  }

  return html;
}

// Re-write the generateBrowserResults cleanly using the helper
function generateBrowserResultsClean() {
  if (cwvResults.length === 0) {
    return '<p style="color: var(--text-muted);">No browser test results. Run: <code>npm run test:cwv</code></p>';
  }

  let html = '';
  const siteGroups = {};
  for (const r of cwvResults) {
    if (!siteGroups[r.site]) siteGroups[r.site] = { desktop: [], mobile: [] };
    const device = r.browser && r.browser.includes('mobile') ? 'mobile' : 'desktop';
    siteGroups[r.site][device].push(r);
  }

  for (const [siteName, data] of Object.entries(siteGroups)) {
    html += `<div class="site-section">
      <div class="site-header">
        <span class="site-name">${siteName}</span>
        <span class="site-badge">${data.desktop.length + data.mobile.length} pages tested</span>
      </div>`;

    if (data.desktop.length > 0) {
      html += `<h3 style="margin: 16px 0 10px; color: var(--text-primary); font-size: 15px; display: flex; align-items: center; gap: 8px;">🖥️ Desktop Viewport</h3>`;
      for (const result of data.desktop) {
        const avg = result.averages || {};
        html += `<div class="url-result">
          <div class="url-header">
            <div>
              <div class="url-label">${result.label}</div>
              <a class="url-link" href="${result.url}" target="_blank">${result.url}</a>
            </div>
            <div class="url-meta">
              <span>🖥️ ${result.browser || 'chrome'}</span>
              <span>${result.runs?.length || 0} runs</span>
            </div>
          </div>
          ${renderMetricRowHtml(result, avg)}
        </div>`;
      }
    }

    if (data.mobile.length > 0) {
      html += `<h3 style="margin: 24px 0 10px; color: var(--text-primary); font-size: 15px; display: flex; align-items: center; gap: 8px;">📱 Mobile Viewport</h3>`;
      for (const result of data.mobile) {
        const avg = result.averages || {};
        html += `<div class="url-result">
          <div class="url-header">
            <div>
              <div class="url-label">${result.label}</div>
              <a class="url-link" href="${result.url}" target="_blank">${result.url}</a>
            </div>
            <div class="url-meta">
              <span>📱 ${result.browser || 'chrome'}</span>
              <span>${result.runs?.length || 0} runs</span>
            </div>
          </div>
          ${renderMetricRowHtml(result, avg)}
        </div>`;
      }
    }

    html += '</div>';
  }

  return html;
}

function generatePSIResults() {
  if (psiResults.length === 0) {
    return '<p style="color: var(--text-muted);">No PageSpeed Insights results. Run: <code>npm run test:psi</code></p>';
  }

  let html = '<div class="psi-grid">';

  for (const result of psiResults) {
    const color = scoreColor(result.performanceScore);
    const circumference = 2 * Math.PI * 40;
    const offset = circumference - (result.performanceScore / 100) * circumference;

    html += `<div class="psi-card">
      <div class="psi-card-header">
        <div>
          <div style="font-weight: 600; font-size: 16px;">${result.site} — ${result.label}</div>
          <a class="url-link" href="${result.url}" target="_blank" style="font-size: 12px;">${result.url}</a>
        </div>
        <span class="psi-strategy-badge ${result.strategy}">${result.strategy === 'mobile' ? '📱 Mobile' : '🖥️ Desktop'}</span>
      </div>

      <div style="text-align: center; margin-bottom: 20px;">
        <div class="score-ring">
          <svg viewBox="0 0 100 100">
            <circle class="score-ring-bg" cx="50" cy="50" r="40"/>
            <circle class="score-ring-progress" cx="50" cy="50" r="40"
              stroke="${color}"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${offset}"/>
            <text class="score-ring-text" x="50" y="50" fill="${color}">${result.performanceScore}</text>
          </svg>
        </div>
        <div style="font-size: 12px; color: var(--text-muted);">Performance Score</div>
      </div>

      <div class="metrics-row" style="grid-template-columns: repeat(3, 1fr);">
        <div class="metric-cell">
          <div class="metric-cell-name">LCP</div>
          <div class="metric-cell-value" style="font-size: 16px; color: ${scoreColor(result.lcp?.score * 100)}">${result.lcp?.displayValue || 'N/A'}</div>
        </div>
        <div class="metric-cell">
          <div class="metric-cell-name">FCP</div>
          <div class="metric-cell-value" style="font-size: 16px; color: ${scoreColor(result.fcp?.score * 100)}">${result.fcp?.displayValue || 'N/A'}</div>
        </div>
        <div class="metric-cell">
          <div class="metric-cell-name">CLS</div>
          <div class="metric-cell-value" style="font-size: 16px; color: ${scoreColor(result.cls?.score * 100)}">${result.cls?.displayValue || 'N/A'}</div>
        </div>
        <div class="metric-cell">
          <div class="metric-cell-name">TBT</div>
          <div class="metric-cell-value" style="font-size: 16px; color: ${scoreColor(result.tbt?.score * 100)}">${result.tbt?.displayValue || 'N/A'}</div>
        </div>
        <div class="metric-cell">
          <div class="metric-cell-name">SI</div>
          <div class="metric-cell-value" style="font-size: 16px; color: ${scoreColor(result.si?.score * 100)}">${result.si?.displayValue || 'N/A'}</div>
        </div>
        <div class="metric-cell">
          <div class="metric-cell-name">TTFB</div>
          <div class="metric-cell-value" style="font-size: 16px; color: ${scoreColor(result.ttfb?.score * 100)}">${result.ttfb?.displayValue || 'N/A'}</div>
        </div>
      </div>

      ${result.opportunities && result.opportunities.length > 0 ? `
        <div class="opportunities">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">💡 Opportunities</div>
          ${result.opportunities.slice(0, 5).map(opp => `
            <div class="opportunity">
              <span class="opportunity-title">${opp.title}</span>
              <span class="opportunity-savings">~${formatMs(opp.savingsMs)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>`;
  }

  html += '</div>';
  return html;
}

function generateSummaryTable() {
  let html = `<div style="overflow-x: auto;">
    <table class="summary-table">
      <thead>
        <tr>
          <th>Site</th>
          <th>Page</th>
          <th>Source</th>
          <th>LCP</th>
          <th>FCP</th>
          <th>CLS</th>
          <th>TTFB</th>
          <th>TBT</th>
          <th>INP</th>
          <th>SI</th>
          <th>Score</th>
        </tr>
      </thead>
      <tbody>`;

  // Browser results
  for (const r of cwvResults) {
    const avg = r.averages || {};
    html += `<tr>
      <td>${r.site}</td>
      <td>${r.label}</td>
      <td>🌐 ${r.browser || 'Browser'}</td>
      <td><span class="${ratingClass(r.ratings?.lcp)}">${formatMs(avg.lcp)}</span></td>
      <td><span class="${ratingClass(r.ratings?.fcp)}">${formatMs(avg.fcp)}</span></td>
      <td><span class="${ratingClass(r.ratings?.cls)}">${formatCLS(avg.cls)}</span></td>
      <td><span class="${ratingClass(r.ratings?.ttfb)}">${formatMs(avg.ttfb)}</span></td>
      <td><span class="${ratingClass(r.ratings?.tbt)}">${formatMs(avg.totalBlockingTime)}</span></td>
      <td><span class="${ratingClass(r.ratings?.inp)}">${avg.inp !== null ? formatMs(avg.inp) : '—'}</span></td>
      <td>${formatMs(avg.si)}</td>
      <td>—</td>
    </tr>`;
  }

  // PSI results
  for (const r of psiResults) {
    const color = scoreColor(r.performanceScore);
    html += `<tr>
      <td>${r.site}</td>
      <td>${r.label}</td>
      <td>${r.strategy === 'mobile' ? '📱' : '🖥️'} PSI ${r.strategy}</td>
      <td>${r.lcp?.displayValue || 'N/A'}</td>
      <td>${r.fcp?.displayValue || 'N/A'}</td>
      <td>${r.cls?.displayValue || 'N/A'}</td>
      <td>${r.ttfb?.displayValue || 'N/A'}</td>
      <td>${r.tbt?.displayValue || 'N/A'}</td>
      <td>${r.inp?.displayValue || '—'}</td>
      <td>${r.si?.displayValue || 'N/A'}</td>
      <td><span style="color: ${color}; font-weight: 700;">${r.performanceScore}</span></td>
    </tr>`;
  }

  html += '</tbody></table></div>';

  if (cwvResults.length === 0 && psiResults.length === 0) {
    html = '<p style="color: var(--text-muted);">No results to display. Run tests first.</p>';
  }

  return html;
}

// ──────────────────────────────────────────────────────────────
//  Write the report
// ──────────────────────────────────────────────────────────────

if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

fs.writeFileSync(outputPath, html);
console.log(`\n✅ HTML report generated: ${outputPath}`);
console.log(`   Open in browser: start ${outputPath}\n`);
