# Critical CSS Extractor Backend

Backend API for extracting critical CSS from websites using Playwright.

## Deployment

This backend is designed to run on Railway (or similar Node.js hosting).

### Railway Deployment

1. Push this code to a GitHub repository
2. Go to https://railway.app
3. Create New Project → Deploy from GitHub repo
4. Select this repository
5. Railway will auto-detect Node.js and deploy

### Environment Variables

Optional environment variables:

- `NODE_ENV=production` - Production mode
- `PORT=3000` - Server port (Railway sets this automatically)

## API Usage

### POST /api/extract

Extract critical CSS from a URL.

**Request Body:**

```json
{
  "url": "https://example.com",
  "viewport": "both", // "mobile", "desktop", or "both"
  "includeShadows": false,
  "userAgent": "optional custom user agent"
}
```

**Response:**

```json
{
  "success": true,
  "url": "https://example.com",
  "viewport": "both",
  "mobile": {
    "css": "/* critical CSS */",
    "size": 1234,
    "extractionTime": 5000
  },
  "desktop": {
    "css": "/* critical CSS */",
    "size": 2345,
    "extractionTime": 6000
  },
  "combined": {
    "css": "/* combined CSS */",
    "size": 3456
  },
  "processingTime": 7000
}
```

### GET /health

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-01-29T22:00:00.000Z",
  "service": "crit-css-extractor-backend"
}
```

## Rate Limiting

- 20 requests per minute per IP address
- Returns 429 status code when limit exceeded

## Tech Stack

- Express.js
- Playwright (browser automation)
- css-tree (CSS parsing)

## Local Development

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Run in development mode
npm run dev

# Server runs on http://localhost:3000
```

## Frontend Integration

The frontend should call:

```
POST https://your-railway-app.up.railway.app/api/extract
```

Set the `BACKEND_URL` environment variable in your frontend to point to this Railway app URL.
