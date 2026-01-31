/**
 * Viewport configurations for mobile and desktop extraction
 */
const VIEWPORTS = {
  mobile: {
    width: 360,
    height: 640,
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  },
  desktop: {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
};

/**
 * Performance configuration for extraction
 */
const PERFORMANCE_CONFIG = {
  CPU_THROTTLE_RATE: 1, // No slowdown for testing
  NETWORK_THROTTLE: {
    offline: false,
    downloadThroughput: (10 * 1024 * 1024) / 8, // Faster connection for testing
    uploadThroughput: (5 * 1024 * 1024) / 8,
    latency: 50, // Lower latency
  },
  LCP_STABILIZATION_DELAY: 200, // Shorter wait time
  ABOVE_FOLD_BUFFER: 100, // 100px buffer below viewport
  DEFAULT_TIMEOUT: 30000, // 30 seconds maximum execution time
  MAX_CONCURRENT_EXTRACTIONS: 3,
};

/**
 * User agents for different viewports
 */
const USER_AGENTS = {
  mobile:
    'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
  desktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
};

/**
 * CSS property filtering constants
 */
const CSS_CONSTANTS = {
  ALLOWED_PROPERTIES: [
    // Layout
    'display',
    'position',
    'top',
    'left',
    'right',
    'bottom',
    'z-index',
    'flex',
    'flex-direction',
    'flex-wrap',
    'flex-flow',
    'justify-content',
    'align-items',
    'align-content',
    'grid',
    'grid-template-columns',
    'grid-template-rows',
    'grid-template-areas',
    'grid-auto-columns',
    'grid-auto-rows',
    'grid-auto-flow',
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
    'margin',
    'margin-top',
    'margin-left',
    'margin-right',
    'margin-bottom',
    'padding',
    'padding-top',
    'padding-left',
    'padding-right',
    'padding-bottom',

    // Typography
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'font-variant',
    'line-height',
    'letter-spacing',
    'word-spacing',
    'text-align',
    'text-decoration',
    'text-transform',
    'text-indent',
    'white-space',
    'color',

    // Visual
    'background',
    'background-color',
    'background-image',
    'background-repeat',
    'background-position',
    'background-size',
    'background-attachment',
    'border',
    'border-color',
    'border-style',
    'border-width',
    'border-top',
    'border-left',
    'border-right',
    'border-bottom',
    'border-radius',
    'opacity',
    'visibility',

    // Other important properties
    'overflow',
    'overflow-x',
    'overflow-y',
    'transform',
    'transform-origin',
    'aspect-ratio',
    'object-fit',
    'object-position',
  ],

  EXCLUDED_SELECTORS: [
    ':hover',
    ':focus',
    ':active',
    ':visited',
    ':link',
    '::-webkit-scrollbar',
    '::-moz-scrollbar',
  ],

  EXCLUDED_MEDIA_QUERIES: ['print', 'speech', 'prefers-reduced-motion'],
};

module.exports = {
  VIEWPORTS,
  PERFORMANCE_CONFIG,
  USER_AGENTS,
  CSS_CONSTANTS,
};
