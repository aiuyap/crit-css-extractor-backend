const { VIEWPORTS, PERFORMANCE_CONFIG } = require('./constants');
const { CriticalExtractionError } = require('./errors');
const { PlaywrightRenderer } = require('./playwright-renderer');
const { CSSParser } = require('./css-parser');
const { FontHandler } = require('./font-handler');

class CriticalCSSExtractor {
  constructor() {
    this.renderer = new PlaywrightRenderer();
    this.cssParser = new CSSParser();
  }

  /**
   * Extract critical CSS for a single URL and viewport
   */
  async extractCriticalCSS(options) {
    const startTime = Date.now();
    let renderingContext = null;
    const contextId = `${options.url}-${options.viewport.width}x${options.viewport.height}`;

    try {
      console.log(
        `Starting extraction for ${options.url} with viewport ${options.viewport.width}x${options.viewport.height}`
      );

      // Create rendering context
      renderingContext = await this.renderer.createContext(options);

      // Load page and wait for LCP stabilization
      await this.renderer.loadPage(renderingContext, options.url, options);

      // Get above-fold elements
      const aboveFoldElements =
        await renderingContext.domUtils.getAboveFoldElements();
      console.log(`Found ${aboveFoldElements.length} above-fold elements`);

      // Collect selectors from above-fold elements
      const aboveFoldSelectors = new Set();
      for (const elementInfo of aboveFoldElements) {
        aboveFoldSelectors.add(elementInfo.selector);
        // Also add individual classes for broader matching
        if (elementInfo.className) {
          const classes = elementInfo.className
            .split(' ')
            .filter((c) => c.trim());
          for (const cls of classes) {
            aboveFoldSelectors.add(`.${cls}`);
          }
        }
        // Add tag name for tag-only selectors
        aboveFoldSelectors.add(elementInfo.tagName);
        // Add ID if present
        if (elementInfo.id) {
          aboveFoldSelectors.add(`#${elementInfo.id}`);
        }
      }

      console.log(
        `Generated ${aboveFoldSelectors.size} unique selectors from above-fold elements`
      );
      // Log a sample of selectors for debugging
      const selectorSample = Array.from(aboveFoldSelectors).slice(0, 10);
      console.log('Selector sample:', selectorSample);

      // Get all CSS from the page
      const allCSS = await this.renderer.getAllCSS(renderingContext);
      console.log(`Retrieved ${allCSS.length} characters of CSS`);

      if (allCSS.length === 0) {
        console.warn('No CSS found on page - this might be a CORS issue');
      } else {
        // Log a sample of the CSS to debug
        console.log('CSS sample:', allCSS.substring(0, 200));
      }

      // Parse CSS into rules
      const cssRules = this.cssParser.parseCSS(allCSS);
      console.log(`Parsed ${cssRules.length} CSS rules`);

      // Filter CSS rules based on above-fold elements
      const criticalRules = this.cssParser.filterCSSRules(
        cssRules,
        aboveFoldSelectors
      );
      console.log(`Filtered to ${criticalRules.length} critical CSS rules`);

      // Handle font optimization
      const fontHandler = new FontHandler(renderingContext.page);
      const { css: fontCSS, preloads } =
        await fontHandler.optimizeFontLoading();

      // Combine CSS with font rules
      const allCriticalRules = [...criticalRules];
      if (fontCSS) {
        const fontRules = this.cssParser.parseCSS(fontCSS);
        allCriticalRules.push(...fontRules);
      }

      // Deduplicate and optimize CSS
      const optimizedRules = this.cssParser.deduplicateRules(allCriticalRules);
      console.log(`Optimized to ${optimizedRules.length} unique CSS rules`);

      // Generate final CSS
      let criticalCSS = this.cssParser.generateCSS(optimizedRules);

      // Minify if needed
      criticalCSS = this.cssParser.minifyCSS(criticalCSS);

      const extractionTime = Date.now() - startTime;
      console.log(`Extraction completed in ${extractionTime}ms`);

      return {
        criticalCSS,
        mobileCSS: options.viewport.isMobile ? criticalCSS : undefined,
        desktopCSS: !options.viewport.isMobile ? criticalCSS : undefined,
        size: criticalCSS.length,
        extractionTime,
        viewport: options.viewport,
        url: options.url,
      };
    } catch (error) {
      const extractionTime = Date.now() - startTime;
      console.error(`Extraction failed after ${extractionTime}ms:`, error);

      if (error instanceof CriticalExtractionError) {
        throw error;
      } else {
        throw new CriticalExtractionError(
          `Failed to extract critical CSS for ${options.url}`,
          error
        );
      }
    } finally {
      // Clean up rendering context
      if (renderingContext) {
        try {
          await renderingContext.lcpObserver.cleanup();
        } catch (error) {
          console.warn('Error cleaning up LCP observer:', error);
        }

        try {
          await this.renderer.cleanup(contextId);
        } catch (error) {
          console.warn('Error cleaning up rendering context:', error);
        }
      }
    }
  }

  /**
   * Extract critical CSS for both mobile and desktop viewports
   */
  async extractForBothViewports(url, options = {}) {
    const baseOptions = {
      url,
      timeout: options.timeout || PERFORMANCE_CONFIG.DEFAULT_TIMEOUT,
      includeShadows: options.includeShadows ?? false,
      userAgent: options.userAgent,
    };

    // Extract for both viewports in parallel
    const [mobileResult, desktopResult] = await Promise.all([
      this.extractCriticalCSS({
        ...baseOptions,
        viewport: VIEWPORTS.mobile,
      }),
      this.extractCriticalCSS({
        ...baseOptions,
        viewport: VIEWPORTS.desktop,
      }),
    ]);

    // Combine results using mobile-first approach
    const combinedCSS = this.combineMobileDesktopCSS(
      mobileResult.criticalCSS,
      desktopResult.criticalCSS
    );

    return {
      mobile: mobileResult,
      desktop: desktopResult,
      combined: combinedCSS,
    };
  }

  /**
   * Combine mobile and desktop CSS using mobile-first approach
   */
  combineMobileDesktopCSS(mobileCSS, desktopCSS) {
    // Parse both CSS sets
    const mobileRules = this.cssParser.parseCSS(mobileCSS);
    const desktopRules = this.cssParser.parseCSS(desktopCSS);

    // Mobile rules are the base
    const combinedRules = [...mobileRules];

    // Add desktop-specific rules wrapped in media query
    for (const desktopRule of desktopRules) {
      const ruleExists = combinedRules.some(
        (mobileRule) =>
          mobileRule.selector === desktopRule.selector && !mobileRule.mediaQuery
      );

      if (ruleExists) {
        // Add only the declarations that differ
        const mobileRule = combinedRules.find(
          (r) => r.selector === desktopRule.selector && !r.mediaQuery
        );

        // Find declarations that are different or don't exist in mobile
        const desktopOnlyDeclarations = desktopRule.declarations.filter(
          (decl) => {
            const mobileDecl = mobileRule.declarations.find(
              (md) => md.property === decl.property
            );
            return !mobileDecl || mobileDecl.value !== decl.value;
          }
        );

        if (desktopOnlyDeclarations.length > 0) {
          combinedRules.push({
            ...desktopRule,
            declarations: desktopOnlyDeclarations,
            mediaQuery: '(min-width: 768px)',
          });
        }
      } else {
        // Add rule as desktop-specific
        combinedRules.push({
          ...desktopRule,
          mediaQuery: '(min-width: 768px)',
        });
      }
    }

    // Generate and return combined CSS
    return this.cssParser.generateCSS(combinedRules);
  }

  /**
   * Get detailed performance metrics for an extraction
   */
  async getPerformanceMetrics(options) {
    let renderingContext = null;
    const contextId = `${options.url}-${options.viewport.width}x${options.viewport.height}`;

    try {
      renderingContext = await this.renderer.createContext(options);

      // Load page
      await this.renderer.loadPage(renderingContext, options.url, options);

      // Get LCP metrics
      const lcpMetrics =
        await renderingContext.lcpObserver.getPerformanceMetrics();

      // Get DOM metrics
      const aboveFoldElements =
        await renderingContext.domUtils.getAboveFoldElements();
      const allCSS = await this.renderer.getAllCSS(renderingContext);
      const cssRules = this.cssParser.parseCSS(allCSS);

      return {
        lcpTime: lcpMetrics.firstContentfulPaint || 0,
        extractionTime: 0, // Would be filled by the extraction method
        totalElements: aboveFoldElements.length,
        aboveFoldElements: aboveFoldElements.filter((el) => el.isAboveFold)
          .length,
        cssRules: cssRules.length,
        filteredRules: 0, // Would be filled after filtering
      };
    } finally {
      if (renderingContext) {
        try {
          await renderingContext.lcpObserver.cleanup();
          await this.renderer.cleanup(contextId);
        } catch (error) {
          console.warn('Error cleaning up metrics collection:', error);
        }
      }
    }
  }

  /**
   * Validate extraction result
   */
  validateExtraction(result) {
    const errors = [];
    const warnings = [];

    // Check if CSS is empty
    if (!result.criticalCSS.trim()) {
      errors.push('Extracted critical CSS is empty');
    }

    // Check size limits
    if (result.size > 14000) {
      // < 14KB target
      warnings.push(
        `Critical CSS size (${result.size} bytes) exceeds recommended limit of 14KB`
      );
    }

    // Check if CSS contains critical properties
    const hasDisplay = result.criticalCSS.includes('display:');
    const hasColor = result.criticalCSS.includes('color:');
    const hasBackground = result.criticalCSS.includes('background');

    if (!hasDisplay && !hasColor && !hasBackground) {
      warnings.push('Critical CSS may be missing essential visual properties');
    }

    // Check for problematic CSS
    if (result.criticalCSS.includes('!important')) {
      warnings.push('Critical CSS contains !important declarations');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Clean up all resources
   */
  async close() {
    await this.renderer.close();
  }
}

module.exports = { CriticalCSSExtractor };
