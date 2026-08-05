# ⚡ Core Web Vitals — Multi-Site Testing Suite

Professional performance testing tool that measures **Core Web Vitals** across multiple websites using real browser metrics (Playwright) and Google's PageSpeed Insights API.

## 📊 Metrics Measured

| Metric | Abbr | Good | Needs Improvement | Poor |
|--------|------|------|-------------------|------|
| Largest Contentful Paint | LCP | ≤ 2.5s | ≤ 4s | > 4s |
| First Contentful Paint | FCP | ≤ 1.8s | ≤ 3s | > 3s |
| Cumulative Layout Shift | CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |
| Time to First Byte | TTFB | ≤ 800ms | ≤ 1.8s | > 1.8s |
| Interaction to Next Paint | INP | ≤ 200ms | ≤ 500ms | > 500ms |
| Total Blocking Time | TBT | ≤ 200ms | ≤ 600ms | > 600ms |
| Speed Index | SI | — | — | — |

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install
npx playwright install chromium

# 2. Configure your sites (edit sites.json)

# 3. Run all tests + generate report
npm run test:all

# 4. Open the report
npm run report:open
```

## 📁 Project Structure

```
core-web-vitals-testing/
├── sites.json                    # ← Configure your sites here
├── playwright.config.js          # Playwright configuration
├── package.json
├── tests/
│   └── core-web-vitals.spec.js   # Real browser CWV tests
├── scripts/
│   ├── pagespeed-audit.js        # PageSpeed Insights API
│   └── generate-report.js        # HTML report generator
└── reports/                      # Generated after tests run
    ├── cwv-results.json          # Browser test data
    ├── psi-results.json          # PageSpeed data
    └── cwv-report.html           # ← Beautiful HTML report
```

## ⚙️ Configuration

Edit `sites.json` to add your sites:

```json
{
  "settings": {
    "runs_per_url": 3,
    "pagespeed_api_key": "",
    "pagespeed_enabled": true
  },
  "sites": [
    {
      "name": "My Website",
      "urls": [
        { "label": "Homepage", "url": "https://mysite.com" },
        { "label": "Products", "url": "https://mysite.com/products" }
      ]
    }
  ]
}
```

## 📋 Available Commands

| Command | Description |
|---------|-------------|
| `npm run test:cwv` | Run Playwright browser tests only |
| `npm run test:psi` | Run PageSpeed Insights API audit only |
| `npm run test:all` | Run both + generate HTML report |
| `npm run report` | Generate HTML report from existing data |
| `npm run report:open` | Generate + open report in browser |
| `npm run test:mobile` | Test mobile viewport (Pixel 5) |

## 🔑 PageSpeed API Key (Optional)

For faster, unlimited PSI audits, get a free API key:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the PageSpeed Insights API
3. Create an API key
4. Set it in `sites.json` → `settings.pagespeed_api_key` or as env var `PAGESPEED_API_KEY`

## 🖥️ Multi-Browser Testing

Run tests across different browsers:

```bash
npx playwright test --project=desktop-chrome
npx playwright test --project=desktop-firefox
npx playwright test --project=desktop-edge
npx playwright test --project=mobile-chrome
```
