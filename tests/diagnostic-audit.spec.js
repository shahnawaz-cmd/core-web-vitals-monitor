// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────────────────────
//  Deep Diagnostic Audit — Root Cause Analysis
//  When Core Web Vitals are poor, THIS tells you WHY.
// ──────────────────────────────────────────────────────────────

const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../sites.json'), 'utf8'));
let sites = config.sites;
if (process.env.DOMAIN_ID) {
  sites = sites.filter(s => s.name.toLowerCase().replace(/[^a-z0-9]/g, '') === process.env.DOMAIN_ID);
}
const allDiagnostics = [];

for (const site of sites) {
  test.describe(`🔍 Deep Diagnostic — ${site.name}`, () => {
    for (const urlEntry of site.urls) {
      test(`${urlEntry.label} (${urlEntry.url})`, async ({ page, browserName }) => {

        // ── Collect console errors ──
        const consoleErrors = [];
        const consoleWarnings = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
          if (msg.type() === 'warning') consoleWarnings.push(msg.text());
        });

        // ── Collect failed requests (404s, 500s, etc.) ──
        const failedRequests = [];
        const allNetworkRequests = [];
        page.on('requestfinished', async (request) => {
          try {
            const response = await request.response();
            const status = response ? response.status() : 0;
            const url = request.url();
            const resourceType = request.resourceType();

            allNetworkRequests.push({
              url: url.length > 120 ? url.substring(0, 120) + '...' : url,
              status,
              resourceType,
              method: request.method(),
            });

            if (status >= 400) {
              failedRequests.push({ url: url.substring(0, 150), status, resourceType });
            }
          } catch (e) {
            // Page may have closed while processing — safe to ignore
          }
        });

        page.on('requestfailed', (request) => {
          failedRequests.push({
            url: request.url().substring(0, 150),
            status: 0,
            resourceType: request.resourceType(),
            failure: request.failure()?.errorText || 'Unknown',
          });
        });

        // ── Navigate ──
        await page.goto(urlEntry.url, { waitUntil: 'load', timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Small wait for late-loading resources
        await page.waitForTimeout(2000);

        // ══════════════════════════════════════════════════════
        //  1. LCP ROOT CAUSE — What element is LCP & why slow?
        // ══════════════════════════════════════════════════════
        const lcpAnalysis = await page.evaluate(() => {
          const result = {
            element: null,
            tagName: null,
            size: null,
            src: null,
            renderTime: null,
            loadTime: null,
            issues: [],
          };

          try {
            const entries = performance.getEntriesByType('largest-contentful-paint');
            if (entries.length > 0) {
              const lcp = entries[entries.length - 1];
              result.renderTime = Math.round(lcp.startTime);
              result.loadTime = lcp.loadTime ? Math.round(lcp.loadTime) : null;
              result.size = lcp.size;

              const el = lcp.element;
              if (el) {
                result.tagName = el.tagName;
                result.element = el.outerHTML.substring(0, 300);

                // Check if LCP is an image
                if (el.tagName === 'IMG') {
                  result.src = el.src;
                  if (!el.loading || el.loading !== 'eager') {
                    // LCP images should NOT be lazy loaded
                  }
                  if (!el.fetchPriority || el.fetchPriority !== 'high') {
                    result.issues.push('LCP image missing fetchpriority="high"');
                  }
                  if (!el.width || !el.height) {
                    result.issues.push('LCP image missing explicit width/height (causes CLS)');
                  }
                  if (el.loading === 'lazy') {
                    result.issues.push('⚠️ LCP image has loading="lazy" — removes from preload priority!');
                  }
                  // Check if image is using next-gen format
                  const src = el.src || el.currentSrc || '';
                  if (src.match(/\.(jpg|jpeg|png|gif|bmp)(\?|$)/i)) {
                    result.issues.push('LCP image not using next-gen format (WebP/AVIF)');
                  }
                }

                // Check if LCP is a background image
                const bgImage = getComputedStyle(el).backgroundImage;
                if (bgImage && bgImage !== 'none') {
                  result.issues.push('LCP element uses background-image (harder to preload)');
                }

                // Check if LCP element is inside viewport
                const rect = el.getBoundingClientRect();
                if (rect.top > window.innerHeight) {
                  result.issues.push('LCP element is below the fold');
                }
              }

              // Check render delay (time between load and render)
              if (result.loadTime && result.renderTime) {
                const delay = result.renderTime - result.loadTime;
                if (delay > 500) {
                  result.issues.push(`Render delay of ${delay}ms after resource loaded`);
                }
              }

              if (result.renderTime > 2500) {
                result.issues.push(`LCP is ${result.renderTime}ms — exceeds 2.5s threshold`);
              }
            }
          } catch (e) {}

          return result;
        });

        // ══════════════════════════════════════════════════════
        //  2. CLS ROOT CAUSE — Which elements shifted & when?
        // ══════════════════════════════════════════════════════
        const clsAnalysis = await page.evaluate(() => {
          const shifts = [];
          let totalCLS = 0;

          try {
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                totalCLS += entry.value;
                if (entry.sources) {
                  for (const source of entry.sources) {
                    shifts.push({
                      value: Math.round(entry.value * 10000) / 10000,
                      hadRecentInput: entry.hadRecentInput,
                      element: source.node ? source.node.outerHTML?.substring(0, 200) : 'unknown',
                      tagName: source.node?.tagName || 'unknown',
                      previousRect: source.previousRect ? {
                        x: Math.round(source.previousRect.x),
                        y: Math.round(source.previousRect.y),
                        width: Math.round(source.previousRect.width),
                        height: Math.round(source.previousRect.height),
                      } : null,
                      currentRect: source.currentRect ? {
                        x: Math.round(source.currentRect.x),
                        y: Math.round(source.currentRect.y),
                        width: Math.round(source.currentRect.width),
                        height: Math.round(source.currentRect.height),
                      } : null,
                    });
                  }
                }
              }
            });
            observer.observe({ type: 'layout-shift', buffered: true });
          } catch (e) {}

          // Common CLS causes
          const issues = [];
          // Check images without dimensions
          const images = document.querySelectorAll('img:not([width]):not([height])');
          if (images.length > 0) {
            issues.push(`${images.length} image(s) missing width/height attributes`);
          }

          // Check ads/embeds without reserved space
          const iframes = document.querySelectorAll('iframe:not([width]):not([height])');
          if (iframes.length > 0) {
            issues.push(`${iframes.length} iframe(s) missing dimensions`);
          }

          // Check for dynamically injected content above fold
          const stickyElements = document.querySelectorAll('[style*="position: fixed"], [style*="position: sticky"]');
          if (stickyElements.length > 0) {
            issues.push(`${stickyElements.length} fixed/sticky element(s) found that may push content`);
          }

          // Check web fonts
          const fontFaces = document.fonts ? Array.from(document.fonts).filter(f => f.status === 'loading') : [];
          if (fontFaces.length > 0) {
            issues.push(`${fontFaces.length} web font(s) still loading — may cause FOIT/FOUT shifts`);
          }

          return {
            totalCLS: Math.round(totalCLS * 10000) / 10000,
            shifts: shifts.slice(0, 10),
            issues,
          };
        });

        // ══════════════════════════════════════════════════════
        //  3. TTFB BREAKDOWN — DNS, Connection, TLS, Server
        // ══════════════════════════════════════════════════════
        const ttfbAnalysis = await page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          if (!nav) return null;

          const breakdown = {
            redirect: Math.round(nav.redirectEnd - nav.redirectStart),
            dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
            connection: Math.round(nav.connectEnd - nav.connectStart),
            tls: nav.secureConnectionStart > 0
              ? Math.round(nav.connectEnd - nav.secureConnectionStart) : 0,
            serverProcessing: Math.round(nav.responseStart - nav.requestStart),
            ttfb: Math.round(nav.responseStart - nav.startTime),
            download: Math.round(nav.responseEnd - nav.responseStart),
            domParsing: Math.round(nav.domInteractive - nav.responseEnd),
            domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
            loadEvent: Math.round(nav.loadEventEnd - nav.startTime),
            transferSize: nav.transferSize,
            encodedBodySize: nav.encodedBodySize,
            decodedBodySize: nav.decodedBodySize,
            protocol: nav.nextHopProtocol,
          };

          const issues = [];
          if (breakdown.redirect > 100) issues.push(`Redirect chain taking ${breakdown.redirect}ms`);
          if (breakdown.dns > 100) issues.push(`Slow DNS resolution: ${breakdown.dns}ms`);
          if (breakdown.serverProcessing > 600) issues.push(`Slow server response: ${breakdown.serverProcessing}ms`);
          if (breakdown.ttfb > 800) issues.push(`TTFB exceeds 800ms threshold: ${breakdown.ttfb}ms`);
          if (breakdown.download > 500) issues.push(`Slow document download: ${breakdown.download}ms`);
          if (!breakdown.protocol || breakdown.protocol === 'http/1.1') {
            issues.push('Not using HTTP/2 or HTTP/3 — upgrade recommended');
          }
          if (breakdown.decodedBodySize > 0 && breakdown.encodedBodySize > 0) {
            const ratio = breakdown.encodedBodySize / breakdown.decodedBodySize;
            if (ratio > 0.9) issues.push('HTML not compressed (no gzip/brotli)');
          }

          return { breakdown, issues };
        });

        // ══════════════════════════════════════════════════════
        //  4. RENDER-BLOCKING RESOURCES
        // ══════════════════════════════════════════════════════
        const renderBlocking = await page.evaluate(() => {
          const blocking = [];

          // Check render-blocking stylesheets
          const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
          stylesheets.forEach((link) => {
            const href = link.getAttribute('href') || '';
            const media = link.getAttribute('media');
            if (!media || media === 'all' || media === 'screen') {
              // Check if it's in <head> (render-blocking position)
              if (link.parentElement?.tagName === 'HEAD') {
                blocking.push({
                  type: 'CSS',
                  url: href.length > 100 ? href.substring(0, 100) + '...' : href,
                  suggestion: 'Consider async loading or inlining critical CSS',
                });
              }
            }
          });

          // Check render-blocking scripts
          const scripts = document.querySelectorAll('head script[src]:not([async]):not([defer]):not([type="module"])');
          scripts.forEach((script) => {
            const src = script.getAttribute('src') || '';
            blocking.push({
              type: 'JS',
              url: src.length > 100 ? src.substring(0, 100) + '...' : src,
              suggestion: 'Add async or defer attribute',
            });
          });

          return blocking;
        });

        // ══════════════════════════════════════════════════════
        //  5. RESOURCE ANALYSIS — Sizes by type
        // ══════════════════════════════════════════════════════
        const resourceAnalysis = await page.evaluate(() => {
          const resources = performance.getEntriesByType('resource');
          const byType = {};
          const largeResources = [];
          let totalSize = 0;
          let totalCount = 0;

          for (const r of resources) {
            const type = r.initiatorType || 'other';
            if (!byType[type]) {
              byType[type] = { count: 0, totalSize: 0, totalDuration: 0 };
            }
            byType[type].count++;
            byType[type].totalSize += r.transferSize || 0;
            byType[type].totalDuration += r.duration || 0;

            totalSize += r.transferSize || 0;
            totalCount++;

            // Track large resources (> 100KB)
            if (r.transferSize > 102400) {
              largeResources.push({
                url: r.name.length > 100 ? r.name.substring(0, 100) + '...' : r.name,
                type,
                size: r.transferSize,
                duration: Math.round(r.duration),
              });
            }
          }

          // Sort large resources by size
          largeResources.sort((a, b) => b.size - a.size);

          const issues = [];
          if (totalCount > 100) issues.push(`High request count: ${totalCount} resources`);
          if (totalSize > 3 * 1024 * 1024) issues.push(`Total page weight over 3MB: ${(totalSize / 1024 / 1024).toFixed(1)}MB`);

          // Check for uncompressed resources
          for (const r of resources) {
            if (r.decodedBodySize > 0 && r.encodedBodySize > 0) {
              const ratio = r.encodedBodySize / r.decodedBodySize;
              if (ratio > 0.9 && r.decodedBodySize > 10240) {
                // Resource over 10KB and not compressed
              }
            }
          }

          return {
            totalCount,
            totalSize,
            byType,
            largeResources: largeResources.slice(0, 10),
            issues,
          };
        });

        // ══════════════════════════════════════════════════════
        //  6. IMAGE OPTIMIZATION AUDIT
        // ══════════════════════════════════════════════════════
        const imageAudit = await page.evaluate(() => {
          const images = document.querySelectorAll('img');
          const issues = [];
          const imageDetails = [];

          images.forEach((img, index) => {
            const detail = {
              src: (img.src || img.currentSrc || '').substring(0, 100),
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              displayWidth: img.clientWidth,
              displayHeight: img.clientHeight,
              loading: img.loading || 'auto',
              fetchPriority: img.fetchPriority || 'auto',
              hasAlt: !!img.alt,
              hasDimensions: !!(img.width && img.height) || !!(img.getAttribute('width') && img.getAttribute('height')),
              issues: [],
            };

            // Check oversized images (rendered much smaller than natural size)
            if (img.naturalWidth > 0 && img.clientWidth > 0) {
              const ratio = img.naturalWidth / img.clientWidth;
              if (ratio > 2) {
                detail.issues.push(`Oversized: ${img.naturalWidth}x${img.naturalHeight} displayed at ${img.clientWidth}x${img.clientHeight}`);
              }
            }

            // Check missing alt text (accessibility + SEO)
            if (!img.alt && img.src) {
              detail.issues.push('Missing alt text');
            }

            // Check missing dimensions
            if (!detail.hasDimensions && img.src) {
              detail.issues.push('Missing width/height attributes (causes CLS)');
            }

            // Check lazy loading on above-fold images
            const rect = img.getBoundingClientRect();
            if (rect.top < window.innerHeight && img.loading === 'lazy') {
              detail.issues.push('Above-fold image has loading="lazy" — slows LCP');
            }

            // Check format
            const src = img.src || img.currentSrc || '';
            if (src.match(/\.(jpg|jpeg|png|gif|bmp)(\?|$)/i) && img.naturalWidth > 100) {
              detail.issues.push('Not using modern format (WebP/AVIF)');
            }

            if (detail.issues.length > 0) {
              imageDetails.push(detail);
            }
          });

          return {
            totalImages: images.length,
            issueCount: imageDetails.length,
            images: imageDetails.slice(0, 15),
          };
        });

        // ══════════════════════════════════════════════════════
        //  7. THIRD-PARTY SCRIPT IMPACT
        // ══════════════════════════════════════════════════════
        const thirdPartyAnalysis = await page.evaluate(() => {
          const pageOrigin = window.location.origin;
          const resources = performance.getEntriesByType('resource');
          const thirdParty = {};
          let firstPartySize = 0;
          let thirdPartySize = 0;

          for (const r of resources) {
            try {
              const url = new URL(r.name);
              const domain = url.hostname;

              if (!r.name.startsWith(pageOrigin)) {
                if (!thirdParty[domain]) {
                  thirdParty[domain] = { count: 0, size: 0, totalDuration: 0 };
                }
                thirdParty[domain].count++;
                thirdParty[domain].size += r.transferSize || 0;
                thirdParty[domain].totalDuration += r.duration || 0;
                thirdPartySize += r.transferSize || 0;
              } else {
                firstPartySize += r.transferSize || 0;
              }
            } catch (e) {}
          }

          // Sort by size
          const sorted = Object.entries(thirdParty)
            .sort(([, a], [, b]) => b.size - a.size)
            .slice(0, 15)
            .map(([domain, data]) => ({
              domain,
              count: data.count,
              size: data.size,
              duration: Math.round(data.totalDuration),
            }));

          return {
            firstPartySize,
            thirdPartySize,
            thirdPartyDomains: sorted,
            totalDomains: Object.keys(thirdParty).length,
          };
        });

        // ══════════════════════════════════════════════════════
        //  8. DOM SIZE & COMPLEXITY
        // ══════════════════════════════════════════════════════
        const domAnalysis = await page.evaluate(() => {
          const allElements = document.querySelectorAll('*');
          const totalElements = allElements.length;

          // Max depth
          let maxDepth = 0;
          let deepestElement = '';
          function getDepth(el) {
            let depth = 0;
            let current = el;
            while (current.parentElement) {
              depth++;
              current = current.parentElement;
            }
            return depth;
          }

          for (const el of allElements) {
            const d = getDepth(el);
            if (d > maxDepth) {
              maxDepth = d;
              deepestElement = el.tagName;
            }
          }

          // Max children
          let maxChildren = 0;
          let widestElement = '';
          for (const el of allElements) {
            if (el.children.length > maxChildren) {
              maxChildren = el.children.length;
              widestElement = `${el.tagName}${el.id ? '#' + el.id : ''}`;
            }
          }

          const issues = [];
          if (totalElements > 1500) issues.push(`Large DOM: ${totalElements} elements (recommended < 1500)`);
          if (maxDepth > 32) issues.push(`Deep nesting: ${maxDepth} levels (recommended < 32)`);
          if (maxChildren > 60) issues.push(`Wide node: ${widestElement} has ${maxChildren} children (recommended < 60)`);

          return { totalElements, maxDepth, maxChildren, widestElement, deepestElement, issues };
        });

        // ══════════════════════════════════════════════════════
        //  9. FONT LOADING ANALYSIS
        // ══════════════════════════════════════════════════════
        const fontAnalysis = await page.evaluate(() => {
          const fontResources = performance.getEntriesByType('resource')
            .filter(r => r.initiatorType === 'css' || r.name.match(/\.(woff2?|ttf|otf|eot)(\?|$)/i));

          const fonts = fontResources.map(r => ({
            url: r.name.length > 80 ? '...' + r.name.substring(r.name.length - 80) : r.name,
            size: r.transferSize || 0,
            duration: Math.round(r.duration),
          }));

          // Check font-display
          const fontFaces = [];
          for (const sheet of document.styleSheets) {
            try {
              for (const rule of sheet.cssRules) {
                if (rule instanceof CSSFontFaceRule) {
                  const display = rule.style.getPropertyValue('font-display');
                  fontFaces.push({
                    family: rule.style.getPropertyValue('font-family'),
                    display: display || 'auto',
                  });
                }
              }
            } catch (e) {} // Cross-origin stylesheets
          }

          const issues = [];
          const autoDisplay = fontFaces.filter(f => f.display === 'auto' || f.display === 'block');
          if (autoDisplay.length > 0) {
            issues.push(`${autoDisplay.length} font(s) using font-display: auto/block — causes invisible text (FOIT)`);
          }
          if (fonts.length > 5) {
            issues.push(`${fonts.length} font files loaded — consider reducing`);
          }

          return { fonts, fontFaces, issues };
        });

        // ══════════════════════════════════════════════════════
        //  10. SECURITY & BEST PRACTICES
        // ══════════════════════════════════════════════════════
        const securityCheck = await page.evaluate(() => {
          const issues = [];

          // HTTPS check
          if (window.location.protocol !== 'https:') {
            issues.push('Page not served over HTTPS');
          }

          // Check for mixed content
          const allResources = performance.getEntriesByType('resource');
          const httpResources = allResources.filter(r => r.name.startsWith('http://'));
          if (httpResources.length > 0) {
            issues.push(`${httpResources.length} resource(s) loaded over HTTP (mixed content)`);
          }

          // Check viewport meta tag
          const viewport = document.querySelector('meta[name="viewport"]');
          if (!viewport) {
            issues.push('Missing viewport meta tag');
          }

          // Check charset
          const charset = document.querySelector('meta[charset]');
          if (!charset) {
            issues.push('Missing charset declaration');
          }

          // Check document language
          if (!document.documentElement.lang) {
            issues.push('Missing lang attribute on <html>');
          }

          // Check for document.write
          // (can't detect dynamically, but check inline scripts)

          return { issues };
        });

        // ══════════════════════════════════════════════════════
        //  11. PRELOAD & PRECONNECT CHECK
        // ══════════════════════════════════════════════════════
        const preloadCheck = await page.evaluate(() => {
          const preloads = Array.from(document.querySelectorAll('link[rel="preload"]')).map(l => ({
            href: l.getAttribute('href')?.substring(0, 80),
            as: l.getAttribute('as'),
          }));

          const preconnects = Array.from(document.querySelectorAll('link[rel="preconnect"]')).map(l => ({
            href: l.getAttribute('href'),
          }));

          const dnsPrefetch = Array.from(document.querySelectorAll('link[rel="dns-prefetch"]')).map(l => ({
            href: l.getAttribute('href'),
          }));

          const issues = [];

          // Check if critical third-party origins have preconnect
          const thirdPartyOrigins = new Set();
          performance.getEntriesByType('resource').forEach(r => {
            try {
              const url = new URL(r.name);
              if (url.origin !== window.location.origin) {
                thirdPartyOrigins.add(url.origin);
              }
            } catch (e) {}
          });

          const preconnectedOrigins = new Set(preconnects.map(p => p.href).filter(Boolean));
          const missingPreconnects = [...thirdPartyOrigins].filter(o => !preconnectedOrigins.has(o));
          if (missingPreconnects.length > 3) {
            issues.push(`${missingPreconnects.length} third-party origins without preconnect hints`);
          }

          if (preloads.length === 0) {
            issues.push('No preload hints found — consider preloading LCP image/font');
          }

          return { preloads, preconnects, dnsPrefetch, issues };
        });

        // ══════════════════════════════════════════════════════
        //  COMPILE DIAGNOSTICS
        // ══════════════════════════════════════════════════════

        const diagnostic = {
          site: site.name,
          label: urlEntry.label,
          url: urlEntry.url,
          browser: test.info().project.name,
          timestamp: new Date().toISOString(),
          lcpAnalysis,
          clsAnalysis,
          ttfbAnalysis,
          renderBlocking,
          resourceAnalysis,
          imageAudit,
          thirdPartyAnalysis,
          domAnalysis,
          fontAnalysis,
          securityCheck,
          preloadCheck,
          consoleErrors: consoleErrors.slice(0, 20),
          consoleWarnings: consoleWarnings.slice(0, 10),
          failedRequests: failedRequests.slice(0, 20),
        };

        allDiagnostics.push(diagnostic);

        // ── Print diagnostic summary ──
        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(`║  🔍 DIAGNOSTIC REPORT — ${site.name} / ${urlEntry.label}`);
        console.log(`╚════════════════════════════════════════════════════════════╝\n`);

        // LCP
        console.log(`  📸 LCP Analysis:`);
        console.log(`     Element: ${lcpAnalysis.tagName || 'N/A'}`);
        console.log(`     Render Time: ${lcpAnalysis.renderTime || 'N/A'}ms`);
        if (lcpAnalysis.issues.length > 0) {
          lcpAnalysis.issues.forEach(i => console.log(`     ⚠️  ${i}`));
        } else {
          console.log(`     ✅ No LCP issues detected`);
        }

        // CLS
        console.log(`\n  📐 CLS Analysis:`);
        console.log(`     Total CLS: ${clsAnalysis.totalCLS}`);
        console.log(`     Layout Shifts: ${clsAnalysis.shifts.length}`);
        if (clsAnalysis.issues.length > 0) {
          clsAnalysis.issues.forEach(i => console.log(`     ⚠️  ${i}`));
        }

        // TTFB
        if (ttfbAnalysis) {
          console.log(`\n  🌐 TTFB Breakdown:`);
          console.log(`     DNS:       ${ttfbAnalysis.breakdown.dns}ms`);
          console.log(`     Connect:   ${ttfbAnalysis.breakdown.connection}ms`);
          console.log(`     TLS:       ${ttfbAnalysis.breakdown.tls}ms`);
          console.log(`     Server:    ${ttfbAnalysis.breakdown.serverProcessing}ms`);
          console.log(`     TTFB:      ${ttfbAnalysis.breakdown.ttfb}ms`);
          console.log(`     Protocol:  ${ttfbAnalysis.breakdown.protocol || 'unknown'}`);
          if (ttfbAnalysis.issues.length > 0) {
            ttfbAnalysis.issues.forEach(i => console.log(`     ⚠️  ${i}`));
          }
        }

        // Render Blocking
        console.log(`\n  🚧 Render-Blocking Resources: ${renderBlocking.length}`);
        renderBlocking.slice(0, 5).forEach(r =>
          console.log(`     ${r.type}: ${r.url}`)
        );

        // Resources
        console.log(`\n  📦 Resource Summary:`);
        console.log(`     Total: ${resourceAnalysis.totalCount} requests, ${(resourceAnalysis.totalSize / 1024).toFixed(0)} KB`);
        if (resourceAnalysis.issues.length > 0) {
          resourceAnalysis.issues.forEach(i => console.log(`     ⚠️  ${i}`));
        }

        // Images
        console.log(`\n  🖼️  Image Audit: ${imageAudit.totalImages} images, ${imageAudit.issueCount} with issues`);

        // Third-party
        console.log(`\n  🔗 Third-Party Impact:`);
        console.log(`     First-party: ${(thirdPartyAnalysis.firstPartySize / 1024).toFixed(0)} KB`);
        console.log(`     Third-party: ${(thirdPartyAnalysis.thirdPartySize / 1024).toFixed(0)} KB (${thirdPartyAnalysis.totalDomains} domains)`);

        // DOM
        console.log(`\n  🏗️  DOM Size: ${domAnalysis.totalElements} elements, depth ${domAnalysis.maxDepth}`);
        if (domAnalysis.issues.length > 0) {
          domAnalysis.issues.forEach(i => console.log(`     ⚠️  ${i}`));
        }

        // Console Errors
        if (consoleErrors.length > 0) {
          console.log(`\n  ❌ Console Errors: ${consoleErrors.length}`);
          consoleErrors.slice(0, 5).forEach(e => console.log(`     ${e.substring(0, 100)}`));
        }

        // Failed Requests
        if (failedRequests.length > 0) {
          console.log(`\n  💥 Failed Requests: ${failedRequests.length}`);
          failedRequests.slice(0, 5).forEach(r =>
            console.log(`     [${r.status}] ${r.url}`)
          );
        }

        // Save this page's diagnostics to a unique temporary file
        const tempDir = path.resolve(__dirname, '..', 'reports', 'temp-results');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        const tempFile = path.join(tempDir, `diag-${site.name}-${urlEntry.label}-${test.info().project.name}.json`.replace(/[^a-zA-Z0-9.-]/g, '_'));
        fs.writeFileSync(tempFile, JSON.stringify(diagnostic, null, 2));

        console.log(`\n  ────────────────────────────────────────────\n`);
      });
    }
  });
}
