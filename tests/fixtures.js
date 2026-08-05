// @ts-check
const { test: baseTest } = require('@playwright/test');

// Define network profile properties
const NETWORK_PRESETS = {
  'slow-4g': {
    offline: false,
    downloadThroughput: (1.6384 * 1024 * 1024) / 8, // 1.6 Mbps
    uploadThroughput: (768 * 1024) / 8, // 768 Kbps
    latency: 150, // 150 ms
  },
  'fast-4g': {
    offline: false,
    downloadThroughput: (4 * 1024 * 1024) / 8, // 4 Mbps
    uploadThroughput: (1.5 * 1024 * 1024) / 8, // 1.5 Mbps
    latency: 40, // 40 ms
  }
};

/**
 * Custom fixture extending base test to inject CPU/Network throttling
 * and Dark/Light Mode emulation, plus helper functions for INP checks.
 */
const test = baseTest.extend({
  // Throttling configuration options
  throttleConfig: [
    { cpu: 1, network: null },
    { option: true }
  ],
  
  // Theme preference parameter
  colorSchemePref: [
    'light',
    { option: true }
  ],

  page: async ({ page, throttleConfig, colorSchemePref }, use) => {
    // 1. Emulate color scheme
    await page.emulateMedia({ colorScheme: colorSchemePref });

    // 2. Setup CPU & Network Throttling if specified (only works on Chromium-based browsers)
    try {
      if (throttleConfig && (throttleConfig.cpu > 1 || throttleConfig.network)) {
        const client = await page.context().newCDPSession(page);
        
        // Apply CPU throttling
        if (throttleConfig.cpu > 1) {
          await client.send('Emulation.setCPUThrottlingRate', {
            rate: throttleConfig.cpu, // e.g. 4 for 4x slowdown
          });
        }

        // Apply Network throttling
        if (throttleConfig.network && NETWORK_PRESETS[throttleConfig.network]) {
          const preset = NETWORK_PRESETS[throttleConfig.network];
          await client.send('Network.emulateNetworkConditions', preset);
        }
      }
    } catch (e) {
      // CDPSession might not be supported on non-Chromium browsers
      console.warn('⚠️ Could not set network/CPU throttling (only supported on Chromium).');
    }

    await use(page);
  },
});

module.exports = { test, expect: baseTest.expect };
