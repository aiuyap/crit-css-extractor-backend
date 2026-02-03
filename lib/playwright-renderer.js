const { chromium: playwright } = require('playwright-core');
const { PERFORMANCE_CONFIG, USER_AGENTS } = require('./constants');
const { LCPObserver } = require('./lcp-observer');
const { DOMUtils } = require('./dom-utils');
const { StylesheetFetcher } = require('./stylesheet-fetcher');
const { TimeoutError, RenderingError, NetworkError } = require('./errors');

class PlaywrightRenderer {
  constructor() {
    this.browser = null;
    this.contexts = new Map();
    this.stylesheetFetcher = new StylesheetFetcher();
  }

  /**
   * Initialize browser with performance throttling
   */
  async initializeBrowser() {
    if (this.browser) return;

    this.browser = await playwright.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
      ],
    });
  }

  /**
   * Create rendering context for a specific extraction
   */
  async createContext(options) {
    await this.initializeBrowser();
    if (!this.browser) {
      throw new RenderingError('Failed to initialize browser');
    }

    const contextId = `${options.url}-${options.viewport.width}x${options.viewport.height}`;

    // Clean up existing context if any
    if (this.contexts.has(contextId)) {
      await this.contexts.get(contextId)?.close();
      this.contexts.delete(contextId);
    }

    // Create new context with performance simulation
    const context = await this.browser.newContext({
      viewport: {
        width: options.viewport.width,
        height: options.viewport.height,
      },
      deviceScaleFactor: options.viewport.deviceScaleFactor,
      isMobile: options.viewport.isMobile,
      hasTouch: options.viewport.hasTouch || false,
      userAgent:
        options.userAgent ||
        (options.viewport.isMobile ? USER_AGENTS.mobile : USER_AGENTS.desktop),
      reducedMotion: 'reduce',
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    // Apply performance throttling
    const client = await context.newCDPSession(
      context.pages()[0] || (await context.newPage())
    );
    await client.send(
      'Network.emulateNetworkConditions',
      PERFORMANCE_CONFIG.NETWORK_THROTTLE
    );
    await client.send('Emulation.setCPUThrottlingRate', {
      rate: PERFORMANCE_CONFIG.CPU_THROTTLE_RATE,
    });

    const page = await context.newPage();

    // Set up error handling
    page.on('pageerror', (error) => {
      console.warn('Page error:', error.message);
    });

    page.on('requestfailed', (request) => {
      console.warn(
        'Request failed:',
        request.url(),
        request.failure()?.errorText
      );
    });

    // Create utilities
    const lcpObserver = new LCPObserver(page, {
      stabilizationDelay: PERFORMANCE_CONFIG.LCP_STABILIZATION_DELAY,
      timeout: options.timeout || PERFORMANCE_CONFIG.DEFAULT_TIMEOUT,
    });

    const domUtils = new DOMUtils(page, options.viewport);

    this.contexts.set(contextId, context);

    return {
      browser: this.browser,
      context,
      page,
      lcpObserver,
      domUtils,
    };
  }

  /**
   * Navigate to URL and wait for LCP stabilization
   */
  async loadPage(renderingContext, url, options) {
    const { page, lcpObserver } = renderingContext;

    try {
      // Set timeout for navigation
      const timeout = options.timeout || PERFORMANCE_CONFIG.DEFAULT_TIMEOUT;
      console.log(`Loading page: ${url} with timeout: ${timeout}ms`);

      // Navigate to the page
      console.log('Starting navigation...');
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout,
      });
      console.log('Navigation completed successfully');

      // Wait for LCP stabilization
      console.log('Waiting for LCP stabilization...');
      await lcpObserver.waitForLCPStabilization();
      console.log('LCP stabilization completed');

      // Wait for dynamic content to settle
      console.log('Waiting for content to settle...');
      const settled =
        await renderingContext.domUtils.waitForContentSettle(2000);
      if (settled) {
        console.log('Content settling completed');
      } else {
        console.warn('Content settle window expired, continuing anyway');
      }
    } catch (error) {
      console.error('Error in loadPage:', error);
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new TimeoutError(`Page load timeout for ${url}`, error);
      } else if (
        error instanceof Error &&
        error.message.includes('net::ERR_')
      ) {
        throw new NetworkError(
          `Network error loading ${url}: ${error.message}`,
          error
        );
      } else {
        throw new RenderingError(`Failed to load page ${url}`, error);
      }
    }
  }

  /**
   * Extract page HTML and CSS information
   */
  async extractPageData(renderingContext) {
    const { page } = renderingContext;

    return await page.evaluate(() => {
      // Get HTML
      const html = document.documentElement.outerHTML;

      // Get inline styles
      const inlineStyles = [];
      document.querySelectorAll('style').forEach((style) => {
        inlineStyles.push(style.textContent || '');
      });

      // Get external stylesheets
      const externalStylesheets = [];
      document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
        const href = link.getAttribute('href');
        if (href) {
          externalStylesheets.push(href);
        }
      });

      // Get font faces
      const fontFaces = [];
      document.querySelectorAll('style').forEach((style) => {
        const cssText = style.textContent || '';
        const fontFaceRegex = /@font-face\s*{[^}]*}/g;
        let match;
        while ((match = fontFaceRegex.exec(cssText)) !== null) {
          fontFaces.push(match[0]);
        }
      });

      return {
        html,
        inlineStyles,
        externalStylesheets,
        fontFaces,
      };
    });
  }

  /**
   * Get all CSS content (inline and external)
   * Fetches external stylesheets via HTTP to bypass CORS restrictions
   */
  async getAllCSS(renderingContext, pageUrl) {
    const { page } = renderingContext;

    // Get inline styles and external stylesheet URLs from the page
    const pageData = await page.evaluate(() => {
      let inlineCSS = '';
      const externalStylesheetUrls = [];

      // Get inline styles
      const inlineStyles = document.querySelectorAll('style');
      inlineStyles.forEach((style) => {
        const content = style.textContent || '';
        if (content.trim()) {
          inlineCSS += content + '\n';
        }
      });

      // Get external stylesheet URLs
      const linkElements = document.querySelectorAll('link[rel="stylesheet"]');
      linkElements.forEach((link) => {
        const href = link.getAttribute('href');
        if (href) {
          externalStylesheetUrls.push(href);
        }
      });

      // Also try to get CSS from document.styleSheets (for same-origin stylesheets)
      let sameOriginCSS = '';
      const styleSheets = Array.from(document.styleSheets);
      const tryGetSheetText = (sheet) => {
        try {
          let cssText = '';
          if (sheet.cssRules) {
            for (const rule of Array.from(sheet.cssRules)) {
              cssText += rule.cssText + '\n';
            }
          }
          return cssText;
        } catch (e) {
          // CORS or other access issues - will fetch via HTTP instead
          return '';
        }
      };

      styleSheets.forEach((sheet) => {
        const sheetText = tryGetSheetText(sheet);
        if (sheetText.trim()) {
          sameOriginCSS += sheetText;
        }
      });

      return {
        inlineCSS,
        externalStylesheetUrls,
        sameOriginCSS,
      };
    });

    // Fetch external stylesheets via HTTP (bypasses CORS)
    let externalCSS = '';
    if (pageData.externalStylesheetUrls.length > 0) {
      console.log(`Found ${pageData.externalStylesheetUrls.length} external stylesheet(s), fetching via HTTP...`);
      const fetchedStylesheets = await this.stylesheetFetcher.fetchMultiple(
        pageData.externalStylesheetUrls,
        pageUrl
      );
      
      externalCSS = fetchedStylesheets.join('\n');
      console.log(`Fetched ${fetchedStylesheets.length} stylesheet(s) via HTTP (${externalCSS.length} bytes)`);
    }

    // Combine all CSS: inline + same-origin + fetched external
    const allCSS = pageData.inlineCSS + pageData.sameOriginCSS + externalCSS;
    
    console.log(`Total CSS collected: ${allCSS.length} bytes (inline: ${pageData.inlineCSS.length}, same-origin: ${pageData.sameOriginCSS.length}, external: ${externalCSS.length})`);
    
    return allCSS;
  }

  /**
   * Clean up rendering context
   */
  async cleanup(contextId) {
    const context = this.contexts.get(contextId);
    if (context) {
      await context.close();
      this.contexts.delete(contextId);
    }
  }

  /**
   * Clean up all resources
   */
  async close() {
    // Close all contexts
    for (const [contextId, context] of Array.from(this.contexts.entries())) {
      await context.close();
    }
    this.contexts.clear();

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Get browser metrics for debugging
   */
  async getMetrics(renderingContext) {
    const { page, lcpObserver } = renderingContext;

    const lcpMetrics = await lcpObserver.getPerformanceMetrics();
    const viewportInfo = await renderingContext.domUtils.getViewportInfo();

    return {
      lcp: lcpMetrics,
      viewport: viewportInfo,
    };
  }
}

module.exports = { PlaywrightRenderer };
