/**
 * ─────────────────────────────────────────────────────────────────
 *  Diagnostic HTML Report Generator
 *  Creates a detailed root-cause analysis report showing
 *  exactly WHY metrics are poor and HOW to fix them.
 * ─────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

const reportsDir = path.resolve(__dirname, '..', 'reports');
const diagnosticsPath = path.join(reportsDir, 'diagnostics.json');
const outputPath = path.join(reportsDir, 'diagnostic-report.html');

if (!fs.existsSync(diagnosticsPath)) {
  console.log('❌ No diagnostics found. Run: npm run test:diagnose');
  process.exit(1);
}

const diagnostics = JSON.parse(fs.readFileSync(diagnosticsPath, 'utf-8'));
const timestamp = new Date().toLocaleString('en-US', {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function formatMs(val) {
  if (val === null || val === undefined) return 'N/A';
  return val >= 1000 ? `${(val / 1000).toFixed(2)}s` : `${Math.round(val)}ms`;
}

function severityClass(issues) {
  if (!issues || issues.length === 0) return 'pass';
  if (issues.length >= 3) return 'fail';
  return 'warn';
}

function severityIcon(issues) {
  if (!issues || issues.length === 0) return '✅';
  if (issues.length >= 3) return '🔴';
  return '🟡';
}

// Count total issues across all diagnostics
let totalIssues = 0;
let criticalIssues = 0;
for (const d of diagnostics) {
  const all = [
    ...(d.lcpAnalysis?.issues || []),
    ...(d.clsAnalysis?.issues || []),
    ...(d.ttfbAnalysis?.issues || []),
    ...(d.resourceAnalysis?.issues || []),
    ...(d.domAnalysis?.issues || []),
    ...(d.fontAnalysis?.issues || []),
    ...(d.securityCheck?.issues || []),
    ...(d.preloadCheck?.issues || []),
  ];
  totalIssues += all.length;
  criticalIssues += (d.lcpAnalysis?.issues || []).length;
  criticalIssues += (d.consoleErrors || []).length;
  criticalIssues += (d.failedRequests || []).length;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CWV Diagnostic Report — ${timestamp}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

    :root {
      --bg-0: #050810;
      --bg-1: #0c1021;
      --bg-2: #141929;
      --bg-3: #1c2339;
      --text-1: #f1f5f9;
      --text-2: #94a3b8;
      --text-3: #64748b;
      --border: #1e293b;
      --accent: #818cf8;
      --accent-dim: rgba(129, 140, 248, 0.15);
      --good: #34d399;
      --good-bg: rgba(52, 211, 153, 0.1);
      --good-border: rgba(52, 211, 153, 0.3);
      --warn: #fbbf24;
      --warn-bg: rgba(251, 191, 36, 0.1);
      --warn-border: rgba(251, 191, 36, 0.3);
      --fail: #f87171;
      --fail-bg: rgba(248, 113, 113, 0.1);
      --fail-border: rgba(248, 113, 113, 0.3);
      --info: #60a5fa;
      --info-bg: rgba(96, 165, 250, 0.1);
      --radius: 14px;
      --radius-sm: 8px;
      --mono: 'JetBrains Mono', monospace;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg-0);
      color: var(--text-1);
      line-height: 1.6;
    }

    .header {
      background: linear-gradient(180deg, rgba(129,140,248,0.1) 0%, transparent 100%);
      border-bottom: 1px solid var(--border);
      padding: 48px 0 40px;
    }
    .header-inner {
      max-width: 1300px; margin: 0 auto; padding: 0 32px;
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 24px;
    }
    .header h1 {
      font-size: 30px; font-weight: 800;
      background: linear-gradient(135deg, #818cf8, #c084fc);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .header .sub { color: var(--text-2); font-size: 14px; margin-top: 4px; }

    .stats-bar {
      display: flex; gap: 32px;
    }
    .stat { text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; }
    .stat-value.critical { color: var(--fail); }
    .stat-value.total { color: var(--warn); }
    .stat-value.pages { color: var(--accent); }
    .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-3); }

    .container { max-width: 1300px; margin: 0 auto; padding: 32px; }

    /* Accordion */
    .page-section { margin-bottom: 32px; }
    .page-header {
      display: flex; align-items: center; gap: 12px;
      padding: 20px 24px; background: var(--bg-2); border: 1px solid var(--border);
      border-radius: var(--radius) var(--radius) 0 0;
      cursor: pointer; user-select: none; transition: background 0.2s;
    }
    .page-header:hover { background: var(--bg-3); }
    .page-header .title { font-weight: 700; font-size: 17px; flex: 1; }
    .page-header .url { color: var(--text-3); font-size: 12px; font-family: var(--mono); }
    .page-header .toggle { font-size: 18px; color: var(--text-3); transition: transform 0.3s; }
    .page-header.open .toggle { transform: rotate(180deg); }
    .page-body {
      border: 1px solid var(--border); border-top: none;
      border-radius: 0 0 var(--radius) var(--radius);
      background: var(--bg-1); overflow: hidden;
      max-height: 0; transition: max-height 0.4s ease;
    }
    .page-body.open { max-height: none; }
    .page-body-inner { padding: 24px; }

    /* Audit Section */
    .audit {
      margin-bottom: 24px; border: 1px solid var(--border);
      border-radius: var(--radius); overflow: hidden;
    }
    .audit-header {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 20px; background: var(--bg-2);
      font-weight: 600; font-size: 14px;
    }
    .audit-header .emoji { font-size: 18px; }
    .audit-header .count {
      margin-left: auto; font-size: 11px; padding: 2px 10px;
      border-radius: 20px; font-weight: 600;
    }
    .audit-header .count.pass { background: var(--good-bg); color: var(--good); }
    .audit-header .count.warn { background: var(--warn-bg); color: var(--warn); }
    .audit-header .count.fail { background: var(--fail-bg); color: var(--fail); }
    .audit-body { padding: 16px 20px; }

    /* Issue List */
    .issue-list { list-style: none; }
    .issue-list li {
      padding: 10px 14px; margin-bottom: 6px;
      border-radius: var(--radius-sm); font-size: 13px;
      display: flex; align-items: flex-start; gap: 8px;
    }
    .issue-list li.warn-issue { background: var(--warn-bg); border: 1px solid var(--warn-border); color: var(--warn); }
    .issue-list li.fail-issue { background: var(--fail-bg); border: 1px solid var(--fail-border); color: var(--fail); }
    .issue-list li.good-issue { background: var(--good-bg); border: 1px solid var(--good-border); color: var(--good); }
    .issue-list li.info-issue { background: var(--info-bg); border: 1px solid rgba(96,165,250,0.3); color: var(--info); }

    /* Breakdown Grid */
    .breakdown-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 10px;
    }
    .breakdown-cell {
      background: var(--bg-2); border-radius: var(--radius-sm);
      padding: 14px; text-align: center;
    }
    .breakdown-cell .label { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 1px; }
    .breakdown-cell .value { font-size: 20px; font-weight: 700; margin-top: 4px; font-family: var(--mono); }
    .breakdown-cell .value.good { color: var(--good); }
    .breakdown-cell .value.warn { color: var(--warn); }
    .breakdown-cell .value.fail { color: var(--fail); }

    /* Resource Table */
    .res-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .res-table th {
      text-align: left; padding: 10px 12px; background: var(--bg-2);
      color: var(--text-3); font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
      border-bottom: 1px solid var(--border);
    }
    .res-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .res-table tr:hover td { background: var(--bg-2); }
    .res-table .url-cell { font-family: var(--mono); font-size: 11px; color: var(--text-2); word-break: break-all; }

    /* Bar Chart */
    .bar-chart { display: flex; flex-direction: column; gap: 8px; }
    .bar-row { display: flex; align-items: center; gap: 12px; }
    .bar-label { width: 140px; font-size: 12px; color: var(--text-2); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar-track { flex: 1; height: 24px; background: var(--bg-2); border-radius: 4px; overflow: hidden; position: relative; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width 0.6s ease; display: flex; align-items: center; padding-left: 8px; font-size: 11px; font-weight: 600; color: white; min-width: 40px; }
    .bar-fill.first-party { background: linear-gradient(90deg, #818cf8, #6366f1); }
    .bar-fill.third-party { background: linear-gradient(90deg, #f59e0b, #ef4444); }
    .bar-fill.css { background: linear-gradient(90deg, #06b6d4, #0891b2); }
    .bar-fill.js { background: linear-gradient(90deg, #f59e0b, #d97706); }
    .bar-fill.img { background: linear-gradient(90deg, #a78bfa, #7c3aed); }
    .bar-fill.font { background: linear-gradient(90deg, #34d399, #059669); }
    .bar-fill.other { background: linear-gradient(90deg, #64748b, #475569); }
    .bar-value { width: 80px; font-size: 12px; font-family: var(--mono); color: var(--text-2); }

    .footer {
      text-align: center; padding: 40px; color: var(--text-3); font-size: 12px;
      border-top: 1px solid var(--border); margin-top: 48px;
    }

    @media (max-width: 768px) {
      .header-inner { flex-direction: column; text-align: center; }
      .stats-bar { justify-content: center; }
      .container { padding: 16px; }
      .breakdown-grid { grid-template-columns: repeat(3, 1fr); }
    }
  </style>
</head>
<body>

<header class="header">
  <div class="header-inner">
    <div>
      <h1>🔬 Core Web Vitals — Diagnostic Report</h1>
      <div class="sub">Root cause analysis &amp; optimization recommendations • ${timestamp}</div>
    </div>
    <div class="stats-bar">
      <div class="stat">
        <div class="stat-value pages">${diagnostics.length}</div>
        <div class="stat-label">Pages Audited</div>
      </div>
      <div class="stat">
        <div class="stat-value total">${totalIssues}</div>
        <div class="stat-label">Total Issues</div>
      </div>
      <div class="stat">
        <div class="stat-value critical">${criticalIssues}</div>
        <div class="stat-label">Critical</div>
      </div>
    </div>
  </div>
</header>

<div class="container">
${diagnostics.map((d, idx) => {
  const allIssues = [
    ...(d.lcpAnalysis?.issues || []),
    ...(d.clsAnalysis?.issues || []),
    ...(d.ttfbAnalysis?.issues || []),
    ...(d.resourceAnalysis?.issues || []),
    ...(d.domAnalysis?.issues || []),
    ...(d.fontAnalysis?.issues || []),
    ...(d.securityCheck?.issues || []),
    ...(d.preloadCheck?.issues || []),
  ];
  const pageIssueCount = allIssues.length + (d.consoleErrors?.length || 0) + (d.failedRequests?.length || 0);

  return `
  <div class="page-section">
    <div class="page-header ${idx === 0 ? 'open' : ''}" onclick="toggleSection(this)">
      <span class="title">${d.site} — ${d.label}</span>
      <span class="url">${d.url}</span>
      <span style="font-size:12px;padding:2px 10px;border-radius:20px;background:${pageIssueCount > 5 ? 'var(--fail-bg)' : pageIssueCount > 0 ? 'var(--warn-bg)' : 'var(--good-bg)'};color:${pageIssueCount > 5 ? 'var(--fail)' : pageIssueCount > 0 ? 'var(--warn)' : 'var(--good)'};">${pageIssueCount} issues</span>
      <span class="toggle">▼</span>
    </div>
    <div class="page-body ${idx === 0 ? 'open' : ''}">
      <div class="page-body-inner">

        <!-- LCP Analysis -->
        <div class="audit">
          <div class="audit-header">
            <span class="emoji">📸</span> LCP Root Cause
            <span class="count ${severityClass(d.lcpAnalysis?.issues)}">${d.lcpAnalysis?.issues?.length || 0} issues</span>
          </div>
          <div class="audit-body">
            <div class="breakdown-grid" style="margin-bottom:16px;">
              <div class="breakdown-cell">
                <div class="label">Render Time</div>
                <div class="value ${(d.lcpAnalysis?.renderTime || 0) > 2500 ? 'fail' : (d.lcpAnalysis?.renderTime || 0) > 1500 ? 'warn' : 'good'}">${formatMs(d.lcpAnalysis?.renderTime)}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">Element</div>
                <div class="value" style="font-size:14px;color:var(--text-2);">${d.lcpAnalysis?.tagName || 'N/A'}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">Size</div>
                <div class="value" style="font-size:14px;color:var(--accent);">${d.lcpAnalysis?.size ? d.lcpAnalysis.size.toLocaleString() + 'px²' : 'N/A'}</div>
              </div>
            </div>
            ${d.lcpAnalysis?.src ? `<div style="font-size:12px;color:var(--text-3);margin-bottom:12px;font-family:var(--mono);word-break:break-all;">Source: ${d.lcpAnalysis.src.substring(0, 150)}</div>` : ''}
            <ul class="issue-list">
              ${(d.lcpAnalysis?.issues || []).map(i => `<li class="warn-issue">⚠️ ${i}</li>`).join('')}
              ${(d.lcpAnalysis?.issues || []).length === 0 ? '<li class="good-issue">✅ No LCP issues detected</li>' : ''}
            </ul>
          </div>
        </div>

        <!-- CLS Analysis -->
        <div class="audit">
          <div class="audit-header">
            <span class="emoji">📐</span> CLS Root Cause
            <span class="count ${(d.clsAnalysis?.totalCLS || 0) > 0.1 ? 'fail' : (d.clsAnalysis?.totalCLS || 0) > 0 ? 'warn' : 'pass'}">${d.clsAnalysis?.totalCLS || 0}</span>
          </div>
          <div class="audit-body">
            <div class="breakdown-grid" style="margin-bottom:16px;">
              <div class="breakdown-cell">
                <div class="label">Total CLS</div>
                <div class="value ${(d.clsAnalysis?.totalCLS || 0) > 0.25 ? 'fail' : (d.clsAnalysis?.totalCLS || 0) > 0.1 ? 'warn' : 'good'}">${d.clsAnalysis?.totalCLS || 0}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">Shifts</div>
                <div class="value" style="color:var(--text-2);">${d.clsAnalysis?.shifts?.length || 0}</div>
              </div>
            </div>
            <ul class="issue-list">
              ${(d.clsAnalysis?.issues || []).map(i => `<li class="warn-issue">⚠️ ${i}</li>`).join('')}
              ${(d.clsAnalysis?.shifts || []).slice(0, 3).map(s => `<li class="info-issue">ℹ️ ${s.tagName} shifted by ${s.value} ${s.hadRecentInput ? '(user input)' : '(no input)'}</li>`).join('')}
              ${(d.clsAnalysis?.issues || []).length === 0 && (d.clsAnalysis?.shifts || []).length === 0 ? '<li class="good-issue">✅ No layout shifts detected</li>' : ''}
            </ul>
          </div>
        </div>

        <!-- TTFB Breakdown -->
        ${d.ttfbAnalysis ? `
        <div class="audit">
          <div class="audit-header">
            <span class="emoji">🌐</span> TTFB Breakdown
            <span class="count ${severityClass(d.ttfbAnalysis?.issues)}">${d.ttfbAnalysis?.issues?.length || 0} issues</span>
          </div>
          <div class="audit-body">
            <div class="breakdown-grid" style="margin-bottom:16px;">
              <div class="breakdown-cell">
                <div class="label">Redirect</div>
                <div class="value ${(d.ttfbAnalysis.breakdown.redirect || 0) > 100 ? 'warn' : 'good'}">${formatMs(d.ttfbAnalysis.breakdown.redirect)}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">DNS</div>
                <div class="value ${(d.ttfbAnalysis.breakdown.dns || 0) > 100 ? 'warn' : 'good'}">${formatMs(d.ttfbAnalysis.breakdown.dns)}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">Connect</div>
                <div class="value ${(d.ttfbAnalysis.breakdown.connection || 0) > 100 ? 'warn' : 'good'}">${formatMs(d.ttfbAnalysis.breakdown.connection)}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">TLS</div>
                <div class="value" style="color:var(--text-2);">${formatMs(d.ttfbAnalysis.breakdown.tls)}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">Server</div>
                <div class="value ${(d.ttfbAnalysis.breakdown.serverProcessing || 0) > 600 ? 'fail' : (d.ttfbAnalysis.breakdown.serverProcessing || 0) > 200 ? 'warn' : 'good'}">${formatMs(d.ttfbAnalysis.breakdown.serverProcessing)}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">TTFB Total</div>
                <div class="value ${(d.ttfbAnalysis.breakdown.ttfb || 0) > 800 ? 'fail' : (d.ttfbAnalysis.breakdown.ttfb || 0) > 400 ? 'warn' : 'good'}">${formatMs(d.ttfbAnalysis.breakdown.ttfb)}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">Protocol</div>
                <div class="value" style="font-size:14px;color:var(--accent);">${d.ttfbAnalysis.breakdown.protocol || '?'}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">Full Load</div>
                <div class="value" style="color:var(--text-2);">${formatMs(d.ttfbAnalysis.breakdown.loadEvent)}</div>
              </div>
            </div>
            <ul class="issue-list">
              ${(d.ttfbAnalysis.issues || []).map(i => `<li class="warn-issue">⚠️ ${i}</li>`).join('')}
            </ul>
          </div>
        </div>
        ` : ''}

        <!-- Third-Party Impact -->
        <div class="audit">
          <div class="audit-header">
            <span class="emoji">🔗</span> Third-Party Impact
            <span class="count" style="background:var(--info-bg);color:var(--info);">${d.thirdPartyAnalysis?.totalDomains || 0} domains</span>
          </div>
          <div class="audit-body">
            <div class="bar-chart" style="margin-bottom:16px;">
              <div class="bar-row">
                <div class="bar-label">First-party</div>
                <div class="bar-track">
                  <div class="bar-fill first-party" style="width:${d.thirdPartyAnalysis ? Math.max(5, (d.thirdPartyAnalysis.firstPartySize / (d.thirdPartyAnalysis.firstPartySize + d.thirdPartyAnalysis.thirdPartySize)) * 100) : 50}%;">${formatBytes(d.thirdPartyAnalysis?.firstPartySize)}</div>
                </div>
              </div>
              <div class="bar-row">
                <div class="bar-label">Third-party</div>
                <div class="bar-track">
                  <div class="bar-fill third-party" style="width:${d.thirdPartyAnalysis ? Math.max(5, (d.thirdPartyAnalysis.thirdPartySize / (d.thirdPartyAnalysis.firstPartySize + d.thirdPartyAnalysis.thirdPartySize)) * 100) : 50}%;">${formatBytes(d.thirdPartyAnalysis?.thirdPartySize)}</div>
                </div>
              </div>
            </div>
            ${(d.thirdPartyAnalysis?.thirdPartyDomains || []).length > 0 ? `
              <table class="res-table">
                <tr><th>Domain</th><th>Requests</th><th>Size</th></tr>
                ${d.thirdPartyAnalysis.thirdPartyDomains.slice(0, 8).map(tp =>
                  `<tr><td class="url-cell">${tp.domain}</td><td>${tp.count}</td><td>${formatBytes(tp.size)}</td></tr>`
                ).join('')}
              </table>
            ` : ''}
          </div>
        </div>

        <!-- Resource Breakdown -->
        <div class="audit">
          <div class="audit-header">
            <span class="emoji">📦</span> Resource Breakdown
            <span class="count ${severityClass(d.resourceAnalysis?.issues)}">${d.resourceAnalysis?.totalCount || 0} requests • ${formatBytes(d.resourceAnalysis?.totalSize)}</span>
          </div>
          <div class="audit-body">
            ${d.resourceAnalysis?.byType ? `
              <div class="bar-chart" style="margin-bottom:16px;">
                ${Object.entries(d.resourceAnalysis.byType).sort(([,a],[,b]) => b.totalSize - a.totalSize).slice(0, 6).map(([type, data]) => `
                  <div class="bar-row">
                    <div class="bar-label">${type}</div>
                    <div class="bar-track">
                      <div class="bar-fill ${type === 'script' ? 'js' : type === 'css' ? 'css' : type === 'img' ? 'img' : type === 'font' ? 'font' : 'other'}" style="width:${Math.max(5, (data.totalSize / (d.resourceAnalysis.totalSize || 1)) * 100)}%;">${data.count} files</div>
                    </div>
                    <div class="bar-value">${formatBytes(data.totalSize)}</div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            ${(d.resourceAnalysis?.largeResources || []).length > 0 ? `
              <div style="font-size:12px;color:var(--text-3);margin-bottom:8px;font-weight:600;">⚠️ Large Resources (> 100KB)</div>
              <table class="res-table">
                <tr><th>URL</th><th>Type</th><th>Size</th><th>Duration</th></tr>
                ${d.resourceAnalysis.largeResources.slice(0, 5).map(r =>
                  `<tr><td class="url-cell">${r.url}</td><td>${r.type}</td><td style="color:var(--warn);font-weight:600;">${formatBytes(r.size)}</td><td>${formatMs(r.duration)}</td></tr>`
                ).join('')}
              </table>
            ` : ''}
            <ul class="issue-list" style="margin-top:12px;">
              ${(d.resourceAnalysis?.issues || []).map(i => `<li class="warn-issue">⚠️ ${i}</li>`).join('')}
            </ul>
          </div>
        </div>

        <!-- Render Blocking -->
        ${(d.renderBlocking || []).length > 0 ? `
        <div class="audit">
          <div class="audit-header">
            <span class="emoji">🚧</span> Render-Blocking Resources
            <span class="count fail">${d.renderBlocking.length}</span>
          </div>
          <div class="audit-body">
            <table class="res-table">
              <tr><th>Type</th><th>URL</th><th>Suggestion</th></tr>
              ${d.renderBlocking.slice(0, 10).map(r =>
                `<tr><td><span style="padding:2px 8px;border-radius:4px;background:${r.type === 'JS' ? 'var(--warn-bg)' : 'var(--info-bg)'};color:${r.type === 'JS' ? 'var(--warn)' : 'var(--info)'};font-size:11px;font-weight:600;">${r.type}</span></td><td class="url-cell">${r.url}</td><td style="font-size:12px;color:var(--text-2);">${r.suggestion}</td></tr>`
              ).join('')}
            </table>
          </div>
        </div>
        ` : ''}

        <!-- Image Audit -->
        ${(d.imageAudit?.issueCount || 0) > 0 ? `
        <div class="audit">
          <div class="audit-header">
            <span class="emoji">🖼️</span> Image Optimization
            <span class="count warn">${d.imageAudit.issueCount} / ${d.imageAudit.totalImages} images</span>
          </div>
          <div class="audit-body">
            <ul class="issue-list">
              ${d.imageAudit.images.slice(0, 8).map(img =>
                img.issues.map(i => `<li class="warn-issue">⚠️ ${i}${img.src ? ` — <span style="font-family:var(--mono);font-size:10px;">${img.src.substring(0, 60)}</span>` : ''}</li>`).join('')
              ).join('')}
            </ul>
          </div>
        </div>
        ` : ''}

        <!-- DOM + Fonts + Security + Preload condensed -->
        <div class="audit">
          <div class="audit-header">
            <span class="emoji">🛡️</span> Additional Checks
          </div>
          <div class="audit-body">
            <div class="breakdown-grid" style="margin-bottom:16px;">
              <div class="breakdown-cell">
                <div class="label">DOM Elements</div>
                <div class="value ${(d.domAnalysis?.totalElements || 0) > 1500 ? 'warn' : 'good'}" style="font-size:16px;">${d.domAnalysis?.totalElements || 'N/A'}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">DOM Depth</div>
                <div class="value ${(d.domAnalysis?.maxDepth || 0) > 32 ? 'warn' : 'good'}" style="font-size:16px;">${d.domAnalysis?.maxDepth || 'N/A'}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">Web Fonts</div>
                <div class="value" style="font-size:16px;color:var(--text-2);">${d.fontAnalysis?.fonts?.length || 0}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">Preloads</div>
                <div class="value" style="font-size:16px;color:var(--accent);">${d.preloadCheck?.preloads?.length || 0}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">Preconnects</div>
                <div class="value" style="font-size:16px;color:var(--accent);">${d.preloadCheck?.preconnects?.length || 0}</div>
              </div>
              <div class="breakdown-cell">
                <div class="label">Console Errors</div>
                <div class="value ${(d.consoleErrors?.length || 0) > 0 ? 'fail' : 'good'}" style="font-size:16px;">${d.consoleErrors?.length || 0}</div>
              </div>
            </div>
            <ul class="issue-list">
              ${(d.domAnalysis?.issues || []).map(i => `<li class="warn-issue">⚠️ ${i}</li>`).join('')}
              ${(d.fontAnalysis?.issues || []).map(i => `<li class="warn-issue">⚠️ ${i}</li>`).join('')}
              ${(d.securityCheck?.issues || []).map(i => `<li class="fail-issue">🔴 ${i}</li>`).join('')}
              ${(d.preloadCheck?.issues || []).map(i => `<li class="info-issue">ℹ️ ${i}</li>`).join('')}
              ${(d.consoleErrors || []).slice(0, 5).map(e => `<li class="fail-issue">❌ ${e.substring(0, 120)}</li>`).join('')}
              ${(d.failedRequests || []).slice(0, 5).map(r => `<li class="fail-issue">💥 [${r.status}] ${r.url}</li>`).join('')}
            </ul>
          </div>
        </div>

      </div>
    </div>
  </div>`;
}).join('')}
</div>

<div class="footer">
  Core Web Vitals Diagnostic Report — Generated on ${timestamp}<br>
  <span style="margin-top:6px;display:inline-block;">Run <code style="background:var(--bg-3);padding:2px 8px;border-radius:4px;">npm run test:diagnose</code> to refresh this report</span>
</div>

<script>
function toggleSection(header) {
  header.classList.toggle('open');
  header.nextElementSibling.classList.toggle('open');
}
</script>
</body>
</html>`;

if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

fs.writeFileSync(outputPath, html);
console.log(`\\n✅ Diagnostic report generated: ${outputPath}`);
console.log(`   Open in browser: start ${outputPath}\\n`);
