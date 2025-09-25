const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const https = require('https');
const fs = require('fs');
const { config } = require('./config');

// Routers
const chatRouter = require('./routes/chat');
const quoteRouter = require('./routes/quote');
const newsRouter = require('./routes/news');
const redditRouter = require('./routes/reddit');

const app = express();

// CORS allowlist
// Always allow our own server origin in addition to configured allowlist
const allowed = new Set([
  ...(config.cors.allowedOrigins || []),
  `http://localhost:${config.server.port}`,
  `https://localhost:${config.server.port}`
]);
const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser clients (no Origin header)
    if (!origin) return callback(null, true);
    // Allow everything if '*' is in allowedOrigins
    if (allowed.has('*')) return callback(null, true);
    if (allowed.has(origin)) return callback(null, true);
    // Fallback: explicitly allow our own origin computed above
    try {
      const oursHttp = `http://localhost:${config.server.port}`;
      const oursHttps = `https://localhost:${config.server.port}`;
      if (origin === oursHttp || origin === oursHttps) {
        return callback(null, true);
      }
    } catch {}
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true
};
app.use(cors(corsOptions));

// Basic rate limiter (per IP)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests/minute
});
app.use(limiter);

// JSON body parsing
app.use(express.json({ limit: '1mb' }));

// API routes
app.use('/api/chat', chatRouter);
app.use('/api/quote', quoteRouter);
app.use('/api/news', newsRouter);
app.use('/api/reddit', redditRouter);

// Serve SPA static assets
const staticDir = path.resolve(__dirname, '..', 'app');
app.use(express.static(staticDir, {
  setHeaders: (res, filePath) => {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    // Never serve secrets.json even if misplaced
    if (filePath.endsWith('secrets.json')) {
      res.statusCode = 404;
      res.end();
    }
  }
}));

// SPA fallback to index.html for unknown routes (non-API)
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Centralized error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err.message || err);
  const status = err.status || 500;
  res.status(status).json({
    error: {
      message: status === 500 ? 'Internal Server Error' : err.message,
    }
  });
});

// Server startup
const port = config.server.port || 8787;
const httpsConfig = config.server.https;

// Start HTTP server
const httpServer = app.listen(port, () => {
  console.log(`HTTP server listening on http://localhost:${port}`);
});

// Start HTTPS server if enabled and certificates are provided
if (httpsConfig.enabled && httpsConfig.key && httpsConfig.cert) {
  try {
    // Check if certificate files exist
    if (fs.existsSync(httpsConfig.key) && fs.existsSync(httpsConfig.cert)) {
      const httpsOptions = {
        key: fs.readFileSync(httpsConfig.key),
        cert: fs.readFileSync(httpsConfig.cert)
      };

      const httpsPort = httpsConfig.port;
      const httpsServer = https.createServer(httpsOptions, app);

      httpsServer.listen(httpsPort, () => {
        console.log(`HTTPS server listening on https://localhost:${httpsPort}`);
      });

      console.log(`SSL certificates loaded from ${httpsConfig.key} and ${httpsConfig.cert}`);
    } else {
      console.warn('HTTPS enabled but certificate files not found. HTTPS server not started.');
      console.warn(`Expected key: ${httpsConfig.key}`);
      console.warn(`Expected cert: ${httpsConfig.cert}`);
    }
  } catch (error) {
    console.error('Error starting HTTPS server:', error.message);
  }
} else if (httpsConfig.enabled) {
  console.warn('HTTPS enabled but key or cert not configured. HTTPS server not started.');
}
