/**
 * ─────────────────────────────────────────────────────────────────
 *  Index Portal Page Generator
 *  Creates a beautiful portal at the root directory linking
 *  to the reports of all monitored domains.
 * ─────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

const matrixPath = path.resolve(__dirname, '..', 'sites-matrix.json');
const reportsDir = path.resolve(__dirname, '..', 'reports');
const outputPath = path.join(reportsDir, 'index.html');

if (!fs.existsSync(matrixPath)) {
  console.error('❌ sites-matrix.json not found.');
  process.exit(1);
}

const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf-8'));
const timestamp = new Date().toLocaleString('en-US', {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Core Web Vitals Monitoring Portal</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

    :root {
      --bg-primary: #0a0e1a;
      --bg-secondary: #111827;
      --bg-card: #1a2035;
      --bg-card-hover: #222a47;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --border: #1e293b;
      --accent: #6366f1;
      --radius: 16px;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }

    .container {
      max-width: 800px;
      width: 100%;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 40px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }

    h1 {
      font-size: 28px;
      font-weight: 800;
      margin-bottom: 8px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-align: center;
    }

    .subtitle {
      color: var(--text-secondary);
      font-size: 14px;
      text-align: center;
      margin-bottom: 32px;
    }

    .grid {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.2s ease;
      text-decoration: none;
      color: inherit;
    }

    .card:hover {
      transform: translateY(-2px);
      border-color: var(--accent);
      background: var(--bg-card-hover);
    }

    .site-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .site-name {
      font-size: 16px;
      font-weight: 600;
    }

    .site-url {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .links {
      display: flex;
      gap: 12px;
    }

    .btn {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      transition: background 0.2s;
    }

    .btn-cwv {
      background: var(--accent);
      color: white;
    }

    .btn-cwv:hover {
      background: #4f46e5;
    }

    .btn-diag {
      background: #374151;
      color: var(--text-primary);
      border: 1px solid var(--border);
    }

    .btn-diag:hover {
      background: #4b5563;
    }

    .footer {
      margin-top: 32px;
      text-align: center;
      font-size: 12px;
      color: var(--text-secondary);
    }
  </style>
</head>
<body>

  <div class="container">
    <h1>⚡ Core Web Vitals Monitoring Portal</h1>
    <div class="subtitle">Monitored Domains Dashboard Portal • Last checked: ${timestamp}</div>

    <div class="grid">
      ${matrix.map(site => `
        <div class="card">
          <div class="site-info">
            <span class="site-name">🌐 ${site.id.toUpperCase().replace(/-/g, ' ')}</span>
            <span class="site-url">${site.url}</span>
          </div>
          <div class="links">
            <a class="btn btn-cwv" href="./${site.id}/cwv-report.html">📊 CWV Report</a>
            <a class="btn btn-diag" href="./${site.id}/diagnostic-report.html">🔬 Diagnostics</a>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="footer">
      Core Web Vitals Monitoring Suite — Deployments handled by GitHub Pages.
    </div>
  </div>

</body>
</html>`;

if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

fs.writeFileSync(outputPath, html);
console.log(`✅ Portal page generated: ${outputPath}`);
