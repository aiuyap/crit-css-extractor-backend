class FontHandler {
  constructor(page) {
    this.page = page;
  }

  /**
   * Get all @font-face rules from the page
   */
  async getFontFaces() {
    return await this.page.evaluate(() => {
      const fontFaces = [];

      // Get @font-face rules from all stylesheets
      const styleSheets = Array.from(document.styleSheets);

      function extractFontFaces(sheet) {
        const faces = [];

        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule.type === CSSRule.FONT_FACE_RULE) {
              const fontFace = rule;
              const style = fontFace.style;

              faces.push({
                fontFamily: style.getPropertyValue('font-family').trim(),
                src: style.getPropertyValue('src').trim(),
                fontDisplay:
                  style.getPropertyValue('font-display').trim() || 'auto',
                fontWeight:
                  style.getPropertyValue('font-weight').trim() || undefined,
                fontStyle:
                  style.getPropertyValue('font-style').trim() || undefined,
                unicodeRange:
                  style.getPropertyValue('unicode-range').trim() || undefined,
              });
            }
          }
        } catch (e) {
          // CORS or other access issues - skip this stylesheet
        }

        return faces;
      }

      for (const sheet of styleSheets) {
        fontFaces.push(...extractFontFaces(sheet));
      }

      return fontFaces;
    });
  }

  /**
   * Analyze font usage by visible text elements
   */
  async analyzeFontUsage() {
    return await this.page.evaluate(() => {
      const fontUsage = new Map();

      function getFontFamily(element) {
        const computedStyle = window.getComputedStyle(element);
        return computedStyle.getPropertyValue('font-family').trim();
      }

      function getTextContent(element) {
        const text = element.textContent || '';
        return text.trim();
      }

      function isElementVisible(element) {
        const style = window.getComputedStyle(element);

        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0'
        ) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function isElementAboveFold(element) {
        const rect = element.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const buffer = 100;

        return rect.bottom > -buffer && rect.top < viewportHeight + buffer;
      }

      // Analyze all text elements
      const allElements = Array.from(document.querySelectorAll('*'));

      for (const element of allElements) {
        if (!isElementVisible(element)) continue;

        const text = getTextContent(element);
        if (!text) continue;

        const fontFamily = getFontFamily(element);
        const isAboveFold = isElementAboveFold(element);

        if (!fontUsage.has(fontFamily)) {
          fontUsage.set(fontFamily, {
            fontFamily,
            elements: 0,
            totalCharacters: 0,
            isCritical: false,
          });
        }

        const usage = fontUsage.get(fontFamily);
        usage.elements++;
        usage.totalCharacters += text.length;

        if (isAboveFold) {
          usage.isCritical = true;
        }
      }

      return Array.from(fontUsage.values());
    });
  }

  /**
   * Generate critical @font-face rules based on usage
   */
  async getCriticalFontFaces() {
    const fontFaces = await this.getFontFaces();
    const fontUsage = await this.analyzeFontUsage();

    // Create a set of critical font families
    const criticalFontFamilies = new Set(
      fontUsage
        .filter((usage) => usage.isCritical)
        .map((usage) => usage.fontFamily)
    );

    // Generate CSS for critical fonts
    const criticalFontCSS = [];

    for (const fontFace of fontFaces) {
      // Check if this font family is used by critical content
      const isCritical = criticalFontFamilies.has(fontFace.fontFamily);

      if (isCritical) {
        // Ensure font-display: swap for performance
        const fontDisplay =
          fontFace.fontDisplay === 'auto' ? 'swap' : fontFace.fontDisplay;

        let css = `@font-face {
  font-family: ${fontFace.fontFamily};
  src: ${fontFace.src};
  font-display: ${fontDisplay};`;

        if (fontFace.fontWeight) {
          css += `
  font-weight: ${fontFace.fontWeight};`;
        }

        if (fontFace.fontStyle) {
          css += `
  font-style: ${fontFace.fontStyle};`;
        }

        if (fontFace.unicodeRange) {
          css += `
  unicode-range: ${fontFace.unicodeRange};`;
        }

        css += '\n}\n';
        criticalFontCSS.push(css);
      }
    }

    return criticalFontCSS.join('\n');
  }

  /**
   * Generate preload hints for critical fonts
   */
  async generateFontPreloads() {
    const fontFaces = await this.getFontFaces();
    const fontUsage = await this.analyzeFontUsage();

    // Create a set of critical font families
    const criticalFontFamilies = new Set(
      fontUsage
        .filter((usage) => usage.isCritical)
        .map((usage) => usage.fontFamily)
    );

    const preloads = [];

    for (const fontFace of fontFaces) {
      if (criticalFontFamilies.has(fontFace.fontFamily)) {
        // Extract font URLs from src declaration
        const urlMatches = fontFace.src.match(/url\(['"]?([^'"]+)['"]?\)/g);

        if (urlMatches) {
          for (const match of urlMatches) {
            const url = match.replace(/url\(['"]?|['"]?\)/g, '');

            // Determine font type from extension
            let type = 'font/woff2'; // Default to woff2
            if (url.endsWith('.woff')) type = 'font/woff';
            else if (url.endsWith('.ttf')) type = 'font/ttf';
            else if (url.endsWith('.eot'))
              type = 'application/vnd.ms-fontobject';
            else if (url.endsWith('.svg')) type = 'image/svg+xml';

            const crossorigin =
              url.startsWith('/') || url.startsWith('http')
                ? ' crossorigin'
                : '';

            preloads.push(
              `<link rel="preload" as="font" type="${type}" href="${url}"${crossorigin}>`
            );
          }
        }
      }
    }

    return preloads;
  }

  /**
   * Get font loading performance metrics
   */
  async getFontMetrics() {
    return await this.page.evaluate(() => {
      // Get font loading timing
      const navigation = performance.getEntriesByType('navigation')[0];
      const fontEntries = performance
        .getEntriesByType('resource')
        .filter(
          (entry) =>
            entry.name.includes('.woff') ||
            entry.name.includes('.ttf') ||
            entry.name.includes('.eot')
        );

      const totalFontLoadTime = fontEntries.reduce((total, entry) => {
        const perfEntry = entry;
        return total + (perfEntry.responseEnd - perfEntry.requestStart);
      }, 0);

      // Get fonts used on page
      const fontsUsed = new Set();
      const allElements = Array.from(document.querySelectorAll('*'));

      for (const element of allElements) {
        const style = window.getComputedStyle(element);
        const fontFamily = style.getPropertyValue('font-family').trim();
        if (fontFamily && style.display !== 'none') {
          fontsUsed.add(fontFamily);
        }
      }

      return {
        totalFonts: fontEntries.length,
        criticalFonts: 0, // Would need more complex analysis to determine this
        fontLoadTime: totalFontLoadTime,
        fontsUsed: Array.from(fontsUsed),
      };
    });
  }

  /**
   * Optimize font loading strategy
   */
  async optimizeFontLoading() {
    const criticalFontCSS = await this.getCriticalFontFaces();
    const preloads = await this.generateFontPreloads();
    const fontMetrics = await this.getFontMetrics();

    const recommendations = [];

    // Generate recommendations based on analysis
    if (fontMetrics.totalFonts > 6) {
      recommendations.push(
        'Consider reducing the number of font families to improve performance'
      );
    }

    if (fontMetrics.fontLoadTime > 1000) {
      recommendations.push(
        'Font loading time is high - consider using font-display: swap and preloading critical fonts'
      );
    }

    if (preloads.length === 0) {
      recommendations.push(
        'No font preloads generated - consider adding preload hints for critical fonts'
      );
    }

    return {
      css: criticalFontCSS,
      preloads,
      recommendations,
    };
  }
}

module.exports = { FontHandler };
