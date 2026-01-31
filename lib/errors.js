/**
 * Base error class for critical CSS extraction failures
 */
class CriticalExtractionError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'CriticalExtractionError';
    this.cause = cause;
  }
}

/**
 * Error for timeout-related extraction failures
 */
class TimeoutError extends CriticalExtractionError {
  constructor(message, cause) {
    super(message, cause);
    this.name = 'TimeoutError';
  }
}

/**
 * Error for rendering/browser-related failures
 */
class RenderingError extends CriticalExtractionError {
  constructor(message, cause) {
    super(message, cause);
    this.name = 'RenderingError';
  }
}

/**
 * Error for network-related failures
 */
class NetworkError extends CriticalExtractionError {
  constructor(message, cause) {
    super(message, cause);
    this.name = 'NetworkError';
  }
}

/**
 * Error for validation failures
 */
class ValidationError extends CriticalExtractionError {
  constructor(message, cause) {
    super(message, cause);
    this.name = 'ValidationError';
  }
}

module.exports = {
  CriticalExtractionError,
  TimeoutError,
  RenderingError,
  NetworkError,
  ValidationError,
};
