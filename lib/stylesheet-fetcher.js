const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Fetches external stylesheets via HTTP with caching support
 * Handles CORS-restricted stylesheets that can't be accessed via browser DOM
 */
class StylesheetFetcher {
  constructor(options = {}) {
    this.cache = new Map(); // URL -> { css, expiresAt, etag, lastAccessed }
    this.maxCacheSize = options.maxCacheSize || 100;
    this.defaultTTL = options.defaultTTL || 24 * 60 * 60 * 1000; // 24 hours
    this.timeout = options.timeout || 60000; // 60 seconds
    this.retryAttempts = options.retryAttempts || 1;
  }

  /**
   * Fetch a single stylesheet with caching and retry logic
   * @param {string} url - Stylesheet URL (can be relative)
   * @param {string} pageUrl - Base page URL for resolving relative paths
   * @returns {Promise<string|null>} - CSS content or null if failed
   */
  async fetchStylesheet(url, pageUrl) {
    try {
      // Resolve relative URLs
      const resolvedUrl = this.resolveUrl(url, pageUrl);
      
      // Check cache first
      const cached = this.getFromCache(resolvedUrl);
      if (cached) {
        console.log(`Cache hit for stylesheet: ${resolvedUrl}`);
        return cached;
      }

      // Fetch with retry logic
      let lastError = null;
      for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`Retrying stylesheet fetch (attempt ${attempt + 1}): ${resolvedUrl}`);
          }

          const result = await this.fetchWithCache(resolvedUrl);
          return result;
        } catch (error) {
          lastError = error;
          if (attempt < this.retryAttempts) {
            console.warn(`Stylesheet fetch failed, will retry: ${resolvedUrl} - ${error.message}`);
          }
        }
      }

      // All retries failed
      console.error(`Failed to fetch stylesheet after ${this.retryAttempts + 1} attempts: ${resolvedUrl} - ${lastError?.message}`);
      return null;
    } catch (error) {
      console.error(`Error fetching stylesheet ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Fetch multiple stylesheets in parallel
   * @param {string[]} urls - Array of stylesheet URLs
   * @param {string} pageUrl - Base page URL
   * @returns {Promise<string[]>} - Array of CSS contents (nulls filtered out)
   */
  async fetchMultiple(urls, pageUrl) {
    if (!urls || urls.length === 0) {
      return [];
    }

    console.log(`Fetching ${urls.length} external stylesheets...`);
    
    const fetchPromises = urls.map(url => this.fetchStylesheet(url, pageUrl));
    const results = await Promise.allSettled(fetchPromises);
    
    const successful = results
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value);
    
    const failedCount = results.length - successful.length;
    if (failedCount > 0) {
      console.warn(`Failed to fetch ${failedCount} stylesheet(s)`);
    }
    
    console.log(`Successfully fetched ${successful.length}/${urls.length} stylesheets`);
    return successful;
  }

  /**
   * Resolve a URL against a base URL
   * @param {string} url - URL to resolve (can be relative)
   * @param {string} baseUrl - Base URL
   * @returns {string} - Absolute URL
   */
  resolveUrl(url, baseUrl) {
    try {
      // If already absolute, return as-is
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      
      // If protocol-relative, add protocol from base
      if (url.startsWith('//')) {
        const base = new URL(baseUrl);
        return `${base.protocol}${url}`;
      }
      
      // Resolve relative URL
      return new URL(url, baseUrl).href;
    } catch (error) {
      console.warn(`Failed to resolve URL ${url} against ${baseUrl}:`, error.message);
      return url;
    }
  }

  /**
   * Check cache for a URL
   * @param {string} url - URL to check
   * @returns {string|null} - Cached CSS or null
   */
  getFromCache(url) {
    const cached = this.cache.get(url);
    if (!cached) {
      return null;
    }

    // Check if expired
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(url);
      return null;
    }

    // Update last accessed for LRU
    cached.lastAccessed = Date.now();
    return cached.css;
  }

  /**
   * Store result in cache with LRU eviction
   * @param {string} url - URL
   * @param {string} css - CSS content
   * @param {number} ttl - Time to live in milliseconds
   * @param {string|null} etag - ETag for revalidation
   */
  setCache(url, css, ttl, etag = null) {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxCacheSize) {
      this.evictLRU();
    }

    this.cache.set(url, {
      css,
      expiresAt: Date.now() + ttl,
      etag,
      lastAccessed: Date.now(),
    });
  }

  /**
   * Evict least recently used cache entry
   */
  evictLRU() {
    let oldestUrl = null;
    let oldestTime = Infinity;

    for (const [url, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestUrl = url;
      }
    }

    if (oldestUrl) {
      this.cache.delete(oldestUrl);
      console.log(`Evicted LRU cache entry: ${oldestUrl}`);
    }
  }

  /**
   * Fetch stylesheet with caching support and ETag revalidation
   * @param {string} url - Absolute URL
   * @returns {Promise<string>} - CSS content
   */
  async fetchWithCache(url) {
    const cached = this.cache.get(url);
    
    // Try ETag revalidation if we have a cached entry
    if (cached && cached.etag) {
      try {
        const result = await this.httpRequest(url, { 'If-None-Match': cached.etag });
        
        if (result.statusCode === 304) {
          // Not modified, use cached version
          console.log(`ETag revalidation: 304 Not Modified for ${url}`);
          cached.lastAccessed = Date.now();
          return cached.css;
        }
        
        // New content, cache it
        const ttl = this.parseCacheControl(result.headers) || this.defaultTTL;
        this.setCache(url, result.body, ttl, result.headers.etag);
        return result.body;
      } catch (error) {
        // Revalidation failed, try fresh fetch
        console.warn(`ETag revalidation failed for ${url}, fetching fresh:`, error.message);
      }
    }

    // Fresh fetch
    const result = await this.httpRequest(url);
    const ttl = this.parseCacheControl(result.headers) || this.defaultTTL;
    this.setCache(url, result.body, ttl, result.headers.etag);
    
    console.log(`Fetched and cached stylesheet: ${url} (${result.body.length} bytes, TTL: ${Math.round(ttl / 1000 / 60)} min)`);
    return result.body;
  }

  /**
   * Make HTTP request with timeout
   * @param {string} url - URL to fetch
   * @param {Object} headers - Additional headers
   * @returns {Promise<Object>} - { statusCode, headers, body }
   */
  httpRequest(url, headers = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/css,*/*;q=0.1',
          ...headers,
        },
      };

      const req = client.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: data,
            });
          } else if (res.statusCode === 304) {
            // Not modified
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: '',
            });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout after ${this.timeout}ms`));
      });

      req.end();
    });
  }

  /**
   * Parse Cache-Control header to get TTL
   * @param {Object} headers - Response headers
   * @returns {number|null} - TTL in milliseconds or null
   */
  parseCacheControl(headers) {
    const cacheControl = headers['cache-control'];
    if (!cacheControl) {
      return null;
    }

    // Check for max-age directive
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (maxAgeMatch) {
      const maxAge = parseInt(maxAgeMatch[1], 10);
      // Cap at 24 hours even if CDN says longer
      return Math.min(maxAge * 1000, this.defaultTTL);
    }

    // Check for s-maxage (shared cache)
    const sMaxAgeMatch = cacheControl.match(/s-maxage=(\d+)/);
    if (sMaxAgeMatch) {
      const sMaxAge = parseInt(sMaxAgeMatch[1], 10);
      return Math.min(sMaxAge * 1000, this.defaultTTL);
    }

    return null;
  }

  /**
   * Clear all cached entries
   */
  clearCache() {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`Cleared ${size} cached stylesheet(s)`);
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache stats
   */
  getCacheStats() {
    const now = Date.now();
    let valid = 0;
    let expired = 0;

    for (const entry of this.cache.values()) {
      if (entry.expiresAt > now) {
        valid++;
      } else {
        expired++;
      }
    }

    return {
      total: this.cache.size,
      valid,
      expired,
      maxSize: this.maxCacheSize,
    };
  }
}

module.exports = { StylesheetFetcher };
