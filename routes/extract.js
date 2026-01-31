const express = require('express');
const { CriticalCSSExtractor } = require('../lib/extractor');
const { VIEWPORTS } = require('../lib/constants');
const { ValidationError, CriticalExtractionError } = require('../lib/errors');

const router = express.Router();

/**
 * POST /api/extract
 * Extract critical CSS from a URL
 *
 * Request body:
 * {
 *   url: string (required),
 *   viewport: 'mobile' | 'desktop' | 'both' (default: 'both'),
 *   includeShadows: boolean (default: false),
 *   userAgent: string (optional)
 * }
 */
router.post('/extract', async (req, res) => {
  const startTime = Date.now();

  try {
    // Parse request body
    const body = req.body;

    // Validate input
    const validationResult = validateExtractionRequest(body);
    if (!validationResult.isValid) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validationResult.errors,
      });
    }

    const { url, viewport = 'both', includeShadows = false, userAgent } = body;

    // Create extractor instance
    const extractor = new CriticalCSSExtractor();

    try {
      let result;

      if (viewport === 'both') {
        // Extract for both mobile and desktop
        result = await extractor.extractForBothViewports(url, {
          includeShadows,
          userAgent,
        });

        // Log extraction metrics
        const processingTime = Date.now() - startTime;
        console.log(`Extraction completed for ${url} in ${processingTime}ms`);
        console.log(
          `Mobile CSS: ${result.mobile.size} bytes, Desktop CSS: ${result.desktop.size} bytes`
        );

        res.json({
          success: true,
          url,
          viewport: 'both',
          mobile: {
            css: result.mobile.criticalCSS,
            size: result.mobile.size,
            extractionTime: result.mobile.extractionTime,
          },
          desktop: {
            css: result.desktop.criticalCSS,
            size: result.desktop.size,
            extractionTime: result.desktop.extractionTime,
          },
          combined: {
            css: result.combined,
            size: result.combined.length,
          },
          processingTime,
        });
      } else {
        // Extract for specific viewport
        const viewportConfig =
          viewport === 'mobile' ? VIEWPORTS.mobile : VIEWPORTS.desktop;

        const singleResult = await extractor.extractCriticalCSS({
          url,
          viewport: viewportConfig,
          includeShadows,
          userAgent,
        });

        // Validate extraction result
        const validation = extractor.validateExtraction(singleResult);

        // Log extraction metrics
        const processingTime = Date.now() - startTime;
        console.log(
          `Extraction completed for ${url} (${viewport}) in ${processingTime}ms`
        );
        console.log(`CSS size: ${singleResult.size} bytes`);

        res.json({
          success: true,
          url,
          viewport,
          css: singleResult.criticalCSS,
          size: singleResult.size,
          extractionTime: singleResult.extractionTime,
          validation,
          processingTime,
        });
      }
    } finally {
      // Clean up extractor resources
      await extractor.close();
    }
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`Extraction failed after ${processingTime}ms:`, error);

    if (error instanceof ValidationError) {
      return res.status(400).json({
        error: 'Validation error',
        message: error.message,
        processingTime,
      });
    } else if (error instanceof CriticalExtractionError) {
      return res.status(500).json({
        error: 'Extraction failed',
        message: error.message,
        processingTime,
      });
    } else {
      return res.status(500).json({
        error: 'Internal server error',
        message: 'An unexpected error occurred',
        processingTime,
      });
    }
  }
});

/**
 * GET /api/extract
 * Method not allowed - extraction requires POST
 */
router.get('/extract', (req, res) => {
  res.status(405).json({
    error: 'Method not allowed',
    message: 'Please use POST to extract critical CSS',
  });
});

/**
 * Validate extraction request body
 * @param {Object} body - Request body
 * @returns {Object} { isValid: boolean, errors: string[] }
 */
function validateExtractionRequest(body) {
  const errors = [];

  // Check required fields
  if (!body.url || typeof body.url !== 'string') {
    errors.push('URL is required and must be a string');
  } else {
    // Validate URL format
    try {
      new URL(body.url);

      // Check if URL is accessible (http/https)
      const url = new URL(body.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push('URL must use HTTP or HTTPS protocol');
      }
    } catch {
      errors.push('URL is not valid');
    }
  }

  // Validate viewport option
  if (body.viewport && !['mobile', 'desktop', 'both'].includes(body.viewport)) {
    errors.push('Viewport must be one of: mobile, desktop, both');
  }

  // Validate boolean options
  if (
    body.includeShadows !== undefined &&
    typeof body.includeShadows !== 'boolean'
  ) {
    errors.push('includeShadows must be a boolean');
  }

  if (body.userAgent !== undefined && typeof body.userAgent !== 'string') {
    errors.push('userAgent must be a string');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = router;
