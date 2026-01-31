const express = require('express');
const cors = require('cors');
const extractRoute = require('./routes/extract');
const rateLimiter = require('./middleware/rateLimiter');

const app = express();

// CORS - allow all origins for now (restrict later after deployment)
app.use(
  cors({
    origin: true,
    methods: ['POST', 'GET'],
    allowedHeaders: ['Content-Type'],
  })
);

app.use(express.json({ limit: '10mb' }));

// Rate limiting: 20 requests per minute per IP
app.use('/api/extract', rateLimiter);

// Routes
app.use('/api', extractRoute);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'crit-css-extractor-backend',
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Critical CSS Extractor API',
    endpoints: {
      health: '/health',
      extract: '/api/extract (POST)',
    },
    documentation:
      'Send POST to /api/extract with { url, viewport, includeShadows }',
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message:
      process.env.NODE_ENV === 'development'
        ? err.message
        : 'Something went wrong',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});
