const { PERFORMANCE_CONFIG } = require('./constants');
const { TimeoutError } = require('./errors');

class LCPObserver {
  constructor(page, options = {}) {
    this.page = page;
    this.options = {
      stabilizationDelay:
        options.stabilizationDelay ??
        PERFORMANCE_CONFIG.LCP_STABILIZATION_DELAY,
      timeout: options.timeout ?? PERFORMANCE_CONFIG.DEFAULT_TIMEOUT,
    };
  }

  /**
   * Wait for LCP to stabilize before proceeding with extraction
   */
  async waitForLCPStabilization() {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Instead of rejecting, resolve with any LCP entries we have
        this.getCurrentLCP()
          .then((entries) => {
            console.warn(
              'LCP stabilization timeout, proceeding with available entries'
            );
            resolve(entries);
          })
          .catch(() => resolve([]));
      }, this.options.timeout);

      try {
        // Inject LCP observer script
        const stabilizationDelay = this.options.stabilizationDelay;
        await this.page.evaluate((delay) => {
          // Clear any existing observer
          if (window.__lcpObserver) {
            window.__lcpObserver.disconnect();
          }

          // Reset state
          window.__lcpStabilized = false;
          window.__lcpEntries = [];

          const lcpEntries = [];
          let stabilizationTimer = null;

          window.__lcpObserver = new PerformanceObserver((list) => {
            // If already stabilized, ignore further entries
            if (window.__lcpStabilized) return;

            const entries = list.getEntries();
            for (const entry of entries) {
              if (entry.entryType === 'largest-contentful-paint') {
                const lcpEntry = entry;
                lcpEntries.push({
                  element: lcpEntry.element?.tagName.toLowerCase() || 'unknown',
                  renderTime: lcpEntry.renderTime || lcpEntry.loadTime,
                  loadTime: lcpEntry.loadTime,
                  size: lcpEntry.size,
                  url: lcpEntry.url || undefined,
                });

                // Reset stabilization timer on each LCP entry
                if (stabilizationTimer) {
                  clearTimeout(stabilizationTimer);
                }

                // Set new stabilization timer using the passed-in delay
                stabilizationTimer = setTimeout(() => {
                  // LCP has stabilized
                  window.__lcpStabilized = true;
                  window.__lcpEntries = lcpEntries;
                }, delay || 500);
              }
            }
          });

          window.__lcpObserver.observe({
            entryTypes: ['largest-contentful-paint'],
          });

          // Set a fallback timeout for initial LCP
          setTimeout(() => {
            if (!window.__lcpStabilized && lcpEntries.length === 0) {
              // If no LCP entries after 3 seconds, proceed anyway
              window.__lcpStabilized = true;
              window.__lcpEntries = lcpEntries;
            }
          }, 3000);
        }, stabilizationDelay);

        // Poll for stabilization
        const checkStabilization = async () => {
          const result = await this.page.evaluate(() => {
            return {
              stabilized: window.__lcpStabilized || false,
              entries: window.__lcpEntries || [],
            };
          });

          if (result.stabilized) {
            clearTimeout(timeoutId);
            return result.entries;
          }

          // Check again after 100ms
          await new Promise((resolve) => setTimeout(resolve, 100));
          return checkStabilization();
        };

        const entries = await checkStabilization();
        clearTimeout(timeoutId);
        resolve(entries);
      } catch (error) {
        clearTimeout(timeoutId);
        // On error, try to get any available LCP entries
        try {
          const entries = await this.getCurrentLCP();
          resolve(entries);
        } catch {
          resolve([]);
        }
      }
    });
  }

  /**
   * Get current LCP metrics without waiting for stabilization
   */
  async getCurrentLCP() {
    return await this.page.evaluate(() => {
      return window.__lcpEntries || [];
    });
  }

  /**
   * Clean up the observer
   */
  async cleanup() {
    await this.page.evaluate(() => {
      if (window.__lcpObserver) {
        window.__lcpObserver.disconnect();
        delete window.__lcpObserver;
        delete window.__lcpStabilized;
        delete window.__lcpEntries;
      }
    });
  }

  /**
   * Get performance metrics for debugging
   */
  async getPerformanceMetrics() {
    return await this.page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByType('paint');

      return {
        domContentLoaded:
          navigation.domContentLoadedEventEnd -
          navigation.domContentLoadedEventStart,
        loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
        firstPaint: paint.find((entry) => entry.name === 'first-paint')
          ?.startTime,
        firstContentfulPaint: paint.find(
          (entry) => entry.name === 'first-contentful-paint'
        )?.startTime,
        lcpEntries: window.__lcpEntries || [],
      };
    });
  }
}

module.exports = { LCPObserver };
