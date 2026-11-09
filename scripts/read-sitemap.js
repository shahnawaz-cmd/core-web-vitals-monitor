/**
 * ─────────────────────────────────────────────────────────────────
 *  Whole Sitemap Reader & Discovery Task
 *  Ported & enhanced from universal-website-monitor for core-web-vitals-testing.
 * 
 *  Usage:
 *    node scripts/read-sitemap.js <domain-or-sitemap-url> [options]
 *    npm run sitemap -- https://example.com
 *    npm run sitemap:read -- https://example.com --limit 50
 * 
 *  Options:
 *    --browser          Force Playwright browser (useful if site has WAF/Cloudflare)
 *    --limit <num>      Max number of URLs to extract
 *    --output <file>    Custom path to save discovered URLs JSON
 *    --to-sites         Format output for easy insertion into sites.json
 * ─────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

// Attempt to load fast-xml-parser if available
let XMLParser;
try {
  XMLParser = require('fast-xml-parser').XMLParser;
} catch (e) {
  // Graceful fallback to regex-based parser
  XMLParser = null;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Parse CLI Arguments
const args = process.argv.slice(2);
let targetInput = '';
let forceBrowser = false;
let maxLimit = null;
let customOutputFile = '';
let exportToSitesFormat = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--browser') {
    forceBrowser = true;
  } else if (arg === '--to-sites') {
    exportToSitesFormat = true;
  } else if (arg === '--limit' && args[i + 1]) {
    maxLimit = parseInt(args[++i], 10);
  } else if (arg === '--output' && args[i + 1]) {
    customOutputFile = args[++i];
  } else if (!arg.startsWith('--') && !targetInput) {
    targetInput = arg;
  }
}

// Fallback to environment variables if not passed in CLI
if (!targetInput) {
  targetInput = process.env.TARGET_DOMAIN || process.env.SITEMAP_URL || '';
}

// Helper: Normalize URL
function normalizeTarget(input) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  } else if (url.startsWith('http://')) {
    // Favor HTTPS by default to prevent slow roundtrip 301 redirects
    url = url.replace(/^http:\/\//i, 'https://');
  }
  return url.replace(/\/+$/, '');
}

// Fetch via Native Fetch with User-Agent & timeout
async function fetchWithHttp(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/xml, application/xml, application/xhtml+xml, text/html;q=0.9, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, status: res.status, text: '' };
    }
    const text = await res.text();
    return { ok: true, status: res.status, text };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: 0, error: err.message };
  }
}

// Playwright Browser Fallback (handles WAF / JS / XSLT)
let sharedBrowser = null;
let sharedContext = null;
let sharedPage = null;

async function getBrowserPage() {
  if (!sharedBrowser) {
    console.log('  🌐 [Browser] Launching Chromium instance...');
    sharedBrowser = await chromium.launch({ headless: true });
    sharedContext = await sharedBrowser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 }
    });
    sharedPage = await sharedContext.newPage();
  }
  return sharedPage;
}

async function fetchWithBrowser(url) {
  try {
    const page = await getBrowserPage();
    const res = await page.goto(url, { waitUntil: 'commit', timeout: 45000 });
    if (!res) return { ok: false, status: 0, text: '' };
    const status = res.status();
    const text = await res.text();
    return { ok: status === 200, status, text };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

async function closeBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
    sharedContext = null;
    sharedPage = null;
  }
}

// Sitemap XML & Link Extractor
function parseSitemapContent(text) {
  const discoveredUrls = [];
  const subSitemaps = [];

  // 1. Try fast-xml-parser if available
  let parsedSuccess = false;
  if (XMLParser) {
    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        removeNSPrefix: true
      });
      const parsed = parser.parse(text);

      if (parsed.sitemapindex && parsed.sitemapindex.sitemap) {
        const items = Array.isArray(parsed.sitemapindex.sitemap)
          ? parsed.sitemapindex.sitemap
          : [parsed.sitemapindex.sitemap];
        for (const item of items) {
          if (item.loc && typeof item.loc === 'string') {
            subSitemaps.push(item.loc.trim());
          }
        }
        parsedSuccess = true;
      } else if (parsed.urlset && parsed.urlset.url) {
        const items = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
        for (const item of items) {
          if (item.loc && typeof item.loc === 'string') {
            const u = item.loc.trim();
            if (u.endsWith('.xml') || u.includes('/sitemap')) {
              subSitemaps.push(u);
            } else {
              discoveredUrls.push(u);
            }
          }
        }
        parsedSuccess = true;
      }
    } catch (e) {
      parsedSuccess = false;
    }
  }

  // 2. Fallback: Namespace-agnostic Regex Loc matching (<loc>...</loc>)
  let locFound = parsedSuccess;
  if (!parsedSuccess) {
    const locRegex = /<(?!(?:image|video):)(?:[a-zA-Z0-9_:-]+:)?loc>(https?:\/\/[^<]+)<\/(?:[a-zA-Z0-9_:-]+:)?loc>/gi;
    let match;

    while ((match = locRegex.exec(text)) !== null) {
      const locUrl = match[1].trim();
      if (locUrl.endsWith('.xml') || locUrl.includes('/sitemap')) {
        subSitemaps.push(locUrl);
      } else {
        discoveredUrls.push(locUrl);
      }
      locFound = true;
    }
  }

  // 3. XSLT / HTML anchor links (for styled sitemaps rendered in HTML)
  if (!locFound) {
    const hrefRegex = /href=["'](https?:\/\/[^"'\s>]+)/gi;
    while ((match = hrefRegex.exec(text)) !== null) {
      const linkUrl = match[1].trim();
      // Skip common sitemap plugin author/schema domains
      if (
        linkUrl.includes('rankmath.com') ||
        linkUrl.includes('sitemaps.org') ||
        linkUrl.includes('yoast.com') ||
        linkUrl.includes('w3.org') ||
        linkUrl.includes('google.com')
      ) {
        continue;
      }
      if (linkUrl.endsWith('.xml') || linkUrl.includes('/sitemap')) {
        subSitemaps.push(linkUrl);
      } else {
        discoveredUrls.push(linkUrl);
      }
    }
  }

  const ASSET_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|zip|mp4|webm|css|js)$/i;
  const cleanUrls = Array.from(new Set(discoveredUrls)).filter(u => !ASSET_EXTENSIONS.test(u));

  return {
    urls: cleanUrls,
    subSitemaps: Array.from(new Set(subSitemaps))
  };
}

// Main Crawler Function
async function crawlDomainSitemap(targetUrl) {
  const startTime = Date.now();
  const normalized = normalizeTarget(targetUrl);
  const targetObj = new URL(normalized);
  const host = `${targetObj.protocol}//${targetObj.host}`;
  const siteDomain = targetObj.hostname.replace(/^www\./, '');

  console.log(`\n======================================================`);
  console.log(`🗺️  SITEMAP AUDIT & CRAWLER`);
  console.log(`   Target: ${normalized}`);
  console.log(`   Engine: ${forceBrowser ? 'Playwright Browser' : 'Fast HTTP (with Browser fallback)'}`);
  if (maxLimit) console.log(`   Limit : ${maxLimit} URLs`);
  console.log(`======================================================\n`);

  const visitedSitemaps = new Set();
  const allDiscoveredUrls = new Set();
  const sitemapsToVisit = [];

  // Step 1: Detect Initial Sitemaps
  if (normalized.endsWith('.xml') || normalized.includes('sitemap')) {
    // Directly targeted a sitemap URL
    console.log(`🎯 Direct sitemap URL provided: ${normalized}`);
    sitemapsToVisit.push(normalized);
  } else {
    // Check robots.txt first (like universal-website-monitor)
    console.log(`🤖 Checking robots.txt for sitemap declarations (${host}/robots.txt)...`);
    let robotsFetched = false;
    try {
      const robotsRes = forceBrowser
        ? await fetchWithBrowser(`${host}/robots.txt`)
        : await fetchWithHttp(`${host}/robots.txt`);

      if (robotsRes.ok && robotsRes.text) {
        const lines = robotsRes.text.split('\n');
        for (const line of lines) {
          if (line.trim().toLowerCase().startsWith('sitemap:')) {
            const smUrl = line.substring(8).trim();
            if (smUrl) {
              console.log(`   ✅ Found in robots.txt: ${smUrl}`);
              sitemapsToVisit.push(smUrl);
              robotsFetched = true;
            }
          }
        }
      }
    } catch (e) {
      console.log(`   ⚠️ robots.txt lookup error: ${e.message}`);
    }

    // Step 2: Fallback to common sitemap paths if robots.txt didn't provide any
    if (!robotsFetched || sitemapsToVisit.length === 0) {
      console.log(`ℹ️  No sitemap in robots.txt. Checking common sitemap endpoints...`);
      const commonPaths = [
        `${host}/sitemap.xml`,
        `${host}/sitemap_index.xml`,
        `${host}/sitemap-index.xml`,
        `${host}/wp-sitemap.xml`
      ];

      for (const candidate of commonPaths) {
        console.log(`   🔎 Probing: ${candidate}`);
        const probeRes = await fetchWithHttp(candidate, 8000);
        if (probeRes.ok && probeRes.text && probeRes.text.includes('<')) {
          console.log(`   ✅ Valid sitemap found at: ${candidate}`);
          sitemapsToVisit.push(candidate);
          break;
        }
      }

      if (sitemapsToVisit.length === 0) {
        console.log(`   ⚠️ Could not probe via HTTP. Defaulting to: ${host}/sitemap.xml`);
        sitemapsToVisit.push(`${host}/sitemap.xml`);
      }
    }
  }

  // Step 3: Recursively crawl sitemaps
  console.log(`\n📥 Starting recursive sitemap extraction...\n`);

  while (sitemapsToVisit.length > 0) {
    if (maxLimit && allDiscoveredUrls.size >= maxLimit) {
      console.log(`\n🛑 URL limit (${maxLimit}) reached. Stopping crawl.`);
      break;
    }

    const currentSitemap = sitemapsToVisit.shift();
    if (visitedSitemaps.has(currentSitemap)) continue;
    visitedSitemaps.add(currentSitemap);

    process.stdout.write(`  [${visitedSitemaps.size}] Fetching: ${currentSitemap} ... `);

    let fetchRes;
    if (forceBrowser) {
      fetchRes = await fetchWithBrowser(currentSitemap);
    } else {
      fetchRes = await fetchWithHttp(currentSitemap);
      // Auto-fallback to Playwright if blocked by WAF/403
      if (!fetchRes.ok && (fetchRes.status === 403 || fetchRes.status === 503 || fetchRes.status === 429)) {
        process.stdout.write(`[HTTP ${fetchRes.status} -> Fallback Browser] `);
        fetchRes = await fetchWithBrowser(currentSitemap);
      }
    }

    if (!fetchRes.ok || !fetchRes.text) {
      console.log(`❌ Failed (${fetchRes.status || fetchRes.error || 'No content'})`);
      continue;
    }

    const { urls, subSitemaps } = parseSitemapContent(fetchRes.text);
    console.log(`✅ (${urls.length} URLs, ${subSitemaps.length} sub-sitemaps)`);

    // Add URLs
    for (const u of urls) {
      if (maxLimit && allDiscoveredUrls.size >= maxLimit) break;
      allDiscoveredUrls.add(u);
    }

    // Queue new sub-sitemaps
    for (const sub of subSitemaps) {
      if (!visitedSitemaps.has(sub) && !sitemapsToVisit.includes(sub)) {
        sitemapsToVisit.push(sub);
      }
    }

    // Gentle throttling between requests
    await delay(300);
  }

  await closeBrowser();

  const finalUrls = Array.from(allDiscoveredUrls);
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  // If no URLs discovered from sitemap, fallback to the root URL
  if (finalUrls.length === 0) {
    console.warn(`\n⚠️  No URLs could be extracted from sitemaps. Falling back to root: ${normalized}`);
    finalUrls.push(normalized);
  }

  console.log(`\n======================================================`);
  console.log(`🎉 SITEMAP READ COMPLETE in ${durationSec}s`);
  console.log(`   Domain           : ${siteDomain}`);
  console.log(`   Sitemaps Parsed  : ${visitedSitemaps.size}`);
  console.log(`   Total Discovered : ${finalUrls.length} unique URLs`);
  console.log(`======================================================\n`);

  // Preview first 10 URLs
  console.log(`Sample URLs (first ${Math.min(finalUrls.length, 10)}):`);
  finalUrls.slice(0, 10).forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
  if (finalUrls.length > 10) {
    console.log(`  ... and ${finalUrls.length - 10} more.`);
  }

  // Ensure reports directory exists
  const reportsDir = path.resolve(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Save Outputs
  const sanitizedHost = siteDomain.replace(/[^a-zA-Z0-9.-]/g, '_');
  const defaultOutputFile = path.join(reportsDir, `sitemap-${sanitizedHost}.json`);
  const outputFile = customOutputFile ? path.resolve(customOutputFile) : defaultOutputFile;

  const resultData = {
    target: normalized,
    domain: siteDomain,
    crawledAt: new Date().toISOString(),
    durationSeconds: parseFloat(durationSec),
    sitemapsScanned: Array.from(visitedSitemaps),
    totalUrls: finalUrls.length,
    urls: finalUrls
  };

  fs.writeFileSync(outputFile, JSON.stringify(resultData, null, 2), 'utf-8');
  console.log(`\n💾 Saved detailed results: ${path.relative(process.cwd(), outputFile)}`);

  // Also write generic discovered_urls.json for seamless integration with specs
  const genericOutput = path.join(reportsDir, 'discovered_urls.json');
  fs.writeFileSync(genericOutput, JSON.stringify(finalUrls, null, 2), 'utf-8');
  console.log(`💾 Saved URL list for test runs: ${path.relative(process.cwd(), genericOutput)}`);

  // Optional: Output formatted for sites.json
  if (exportToSitesFormat) {
    const sitesJsonBlock = {
      name: siteDomain,
      urls: finalUrls.map((u, idx) => ({
        label: `URL ${idx + 1}`,
        url: u
      }))
    };
    const sitesFormatPath = path.join(reportsDir, `site-entry-${sanitizedHost}.json`);
    fs.writeFileSync(sitesFormatPath, JSON.stringify(sitesJsonBlock, null, 2), 'utf-8');
    console.log(`📋 Saved sites.json format block: ${path.relative(process.cwd(), sitesFormatPath)}`);
  }

  return resultData;
}

// Help / Entrypoint
if (!targetInput || targetInput === '--help' || targetInput === '-h') {
  console.log(`
Usage:
  node scripts/read-sitemap.js <domain-or-url> [options]
  npm run sitemap -- <domain-or-url>

Options:
  --browser        Use Playwright browser engine (for Cloudflare / WAF protected sites)
  --limit <number> Limit the maximum number of discovered URLs
  --output <file>  Custom output path for the JSON results
  --to-sites       Generate a JSON block compatible with sites.json

Examples:
  npm run sitemap -- https://detailedvehiclehistory.com
  npm run sitemap -- classicdecoder.com --limit 100
  npm run sitemap -- https://vehiclehistory.eu/sitemap.xml --browser
`);

  // Display available sites in sites.json as quick options
  try {
    const sitesConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'sites.json'), 'utf-8'));
    if (sitesConfig.sites && sitesConfig.sites.length > 0) {
      console.log(`Quick domains configured in sites.json:`);
      sitesConfig.sites.slice(0, 10).forEach((s) => {
        const firstUrl = s.urls && s.urls[0] ? s.urls[0].url : '';
        console.log(`  - ${s.name}: ${firstUrl}`);
      });
      if (sitesConfig.sites.length > 10) {
        console.log(`  ... and ${sitesConfig.sites.length - 10} more in sites.json`);
      }
    }
  } catch (e) {}

  process.exit(0);
}

// Execute
crawlDomainSitemap(targetInput).catch((err) => {
  console.error('\n❌ Fatal error crawling sitemap:', err);
  process.exit(1);
});
