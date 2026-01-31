// Simple in-memory rate limiter: 20 requests per minute per IP
const requestCounts = new Map();

const RATE_LIMIT = 20; // requests per window
const WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Rate limiting middleware
 * Tracks requests per IP address and limits to 20 per minute
 */
function rateLimiter(req, res, next) {
  const clientIP =
    req.ip ||
    req.connection.remoteAddress ||
    req.headers['x-forwarded-for'] ||
    'unknown';
  const now = Date.now();

  // Clean up old entries periodically (every 100 requests)
  if (requestCounts.size > 1000) {
    const cutoff = now - WINDOW_MS;
    for (const [ip, data] of requestCounts.entries()) {
      if (data.resetTime < cutoff) {
        requestCounts.delete(ip);
      }
    }
  }

  // Check if IP exists in map
  if (!requestCounts.has(clientIP)) {
    // First request from this IP
    requestCounts.set(clientIP, {
      count: 1,
      resetTime: now + WINDOW_MS,
    });
    return next();
  }

  const record = requestCounts.get(clientIP);

  // Check if window has expired
  if (now > record.resetTime) {
    // Reset the window
    record.count = 1;
    record.resetTime = now + WINDOW_MS;
    return next();
  }

  // Check if limit exceeded
  if (record.count >= RATE_LIMIT) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);

    return res.status(429).json({
      error: 'Rate limit exceeded',
      message:
        'Maximum 20 requests per minute allowed. Please try again later.',
      retryAfter: retryAfter,
      limit: RATE_LIMIT,
      window: '1 minute',
    });
  }

  // Increment count and allow request
  record.count++;
  next();
}

module.exports = rateLimiter;
