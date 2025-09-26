// backend/src/server.js - Serverless Compatible Version
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const compression = require("compression");
const hpp = require("hpp");
const path = require("path");
require("dotenv").config();

// Create Express app
const app = express();

// Simple logging for serverless (avoid complex logger setup)
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
};

// Trust proxy (for deployment behind reverse proxy)
app.set("trust proxy", 1);

// Basic security middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Simplified for serverless
    crossOriginEmbedderPolicy: false,
  })
);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
      "http://localhost:3000",
      "https://your-frontend-domain.vercel.app", // Add your frontend domain
    ];

    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (
      allowedOrigins.indexOf(origin) !== -1 ||
      process.env.NODE_ENV === "development"
    ) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins for now, restrict later
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
};

app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Security and optimization middleware
app.use(mongoSanitize());
app.use(compression());
app.use(hpp());

// Simple request logging for serverless
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Basic rate limiting (simplified for serverless)
const rateLimit = require("express-rate-limit");
const basicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});
app.use("/api/", basicLimiter);

// Database connection (simplified for serverless)
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;

  try {
    const mongoose = require("mongoose");
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    isConnected = true;
    log.info("Database connected successfully");
  } catch (error) {
    log.error("Database connection failed: " + error.message);
    throw error;
  }
};

// Middleware to ensure DB connection
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Database connection failed",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
});

// Root route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to JennySaleFlow API",
    version: "v1",
    documentation: "/api/v1/docs",
    health: "/api/v1/health",
    timestamp: new Date().toISOString(),
  });
});

// Health check route
app.get("/api/v1/health", (req, res) => {
  res.json({
    success: true,
    message: "API is healthy",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    database: isConnected ? "connected" : "disconnected",
  });
});

// API routes
try {
  const routes = require("./routes");
  app.use("/api/v1", routes);
} catch (error) {
  log.error("Failed to load routes: " + error.message);

  // Fallback route if main routes fail
  app.use("/api/v1", (req, res) => {
    res.status(500).json({
      success: false,
      message: "Routes not available",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  });
}

// Error handling middleware
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.path,
  });
});

app.use((err, req, res, next) => {
  log.error("Unhandled error: " + err.message);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
});

// For local development only
if (process.env.NODE_ENV !== "production" && require.main === module) {
  const PORT = process.env.PORT || 5000;

  const startLocalServer = async () => {
    try {
      await connectDB();

      app.listen(PORT, () => {
        log.info(`Server running locally on port ${PORT}`);
        log.info(`API URL: http://localhost:${PORT}/api/v1`);
      });
    } catch (error) {
      log.error("Failed to start local server: " + error.message);
      process.exit(1);
    }
  };

  startLocalServer();
}

// Export for Vercel
module.exports = app;