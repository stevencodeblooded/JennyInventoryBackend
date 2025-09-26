// backend/src/server.js - Vercel Serverless Compatible
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

// Simple logging for serverless environment
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
};

// Trust proxy for Vercel
app.set("trust proxy", 1);

// Simplified helmet configuration for serverless
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
      "http://localhost:3000",
      "http://localhost:3001",
    ];

    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (
      allowedOrigins.indexOf(origin) !== -1 ||
      process.env.NODE_ENV === "development"
    ) {
      callback(null, true);
    } else {
      // Allow all origins for now - restrict in production as needed
      callback(null, true);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  exposedHeaders: ["X-Total-Count", "X-Page-Count"],
  maxAge: 86400,
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
  log.info(`${req.method} ${req.path} - ${req.ip || "unknown"}`);
  next();
});

// Basic rate limiting for serverless
const rateLimit = require("express-rate-limit");
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", apiLimiter);

// Database connection management for serverless
let mongoose;
let isConnected = false;
let connectionPromise = null;

const connectDB = async () => {
  // Return existing connection if available
  if (isConnected && mongoose?.connection?.readyState === 1) {
    return true;
  }

  // Return existing connection promise if in progress
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    try {
      if (!mongoose) {
        mongoose = require("mongoose");
      }

      // Only connect if not already connected
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGODB_URI, {
          useNewUrlParser: true,
          useUnifiedTopology: true,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
          maxPoolSize: 10,
          minPoolSize: 1,
          maxIdleTimeMS: 30000,
          bufferCommands: false,
          // bufferMaxEntries: 0,
        });
      }

      isConnected = mongoose.connection.readyState === 1;
      if (isConnected) {
        log.info("Database connected successfully");
      }
      return isConnected;
    } catch (error) {
      log.error("Database connection failed: " + error.message);
      isConnected = false;
      throw error;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
};

// Database middleware - ensure connection before handling requests
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    log.error("Database connection error: " + error.message);

    // For health check, continue without DB
    if (req.path === "/api/v1/health" || req.path === "/") {
      return next();
    }

    // For other routes, return error
    return res.status(500).json({
      success: false,
      message: "Database connection failed",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Service temporarily unavailable",
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
    environment: process.env.NODE_ENV,
  });
});

// Health check route
app.get("/api/v1/health", async (req, res) => {
  let dbStatus = false;

  try {
    dbStatus = await connectDB();
  } catch (error) {
    log.error("Health check DB error: " + error.message);
  }

  res.json({
    success: true,
    message: "API is healthy",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    database: {
      connected: dbStatus,
      status:
        mongoose?.connection?.readyState === 1 ? "connected" : "disconnected",
    },
    version: "v1",
  });
});

// Load routes with comprehensive error handling
let routesLoaded = false;
try {
  const routes = require("./routes");
  app.use("/api/v1", routes);
  routesLoaded = true;
  log.info("Routes loaded successfully");
} catch (error) {
  log.error("Failed to load routes: " + error.message);

  // Provide fallback routes if main routes fail
  app.get("/api/v1", (req, res) => {
    res.json({
      success: false,
      message: "API routes temporarily unavailable",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Routes loading error",
      timestamp: new Date().toISOString(),
      routesLoaded: false,
    });
  });

  // Basic test endpoint
  app.get("/api/v1/test", (req, res) => {
    res.json({
      success: true,
      message: "Basic API endpoint working",
      timestamp: new Date().toISOString(),
    });
  });
}

// Static files handling (with error protection)
try {
  const uploadsPath = path.join(__dirname, "../uploads");
  app.use("/uploads", express.static(uploadsPath));
  log.info("Static files middleware configured");
} catch (error) {
  log.warn("Uploads directory not accessible: " + error.message);
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    availableRoutes: [
      "GET /",
      "GET /api/v1/health",
      routesLoaded ? "GET /api/v1/*" : "Routes unavailable",
    ],
  });
});

// Global error handler
app.use((err, req, res, next) => {
  log.error(`Unhandled error on ${req.method} ${req.path}: ${err.message}`);

  // Log stack trace in development
  if (process.env.NODE_ENV === "development") {
    log.error("Stack trace: " + err.stack);
  }

  const statusCode = err.status || err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: "Something went wrong!",
    error:
      process.env.NODE_ENV === "development"
        ? {
            message: err.message,
            stack: err.stack,
            status: statusCode,
          }
        : "Internal server error",
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
  });
});

// Initialize default data function (only run in development/local)
async function initializeDefaultData() {
  if (process.env.NODE_ENV === "production") {
    log.info("Skipping data initialization in production");
    return;
  }

  try {
    log.info("Initializing default data...");

    // Initialize settings
    const Settings = require("./models/Settings");
    await Settings.getSettings();
    log.info("Settings initialized");

    // Create default categories
    const Category = require("./models/Category");
    const categoryCount = await Category.countDocuments();

    if (categoryCount === 0) {
      log.info("Creating default categories...");
      const defaultCategories = [
        { name: "Electronics", icon: "laptop", color: "#3B82F6" },
        { name: "Clothing", icon: "shirt", color: "#10B981" },
        { name: "Food & Beverages", icon: "coffee", color: "#F59E0B" },
        { name: "Home & Garden", icon: "home", color: "#8B5CF6" },
        { name: "Health & Beauty", icon: "heart", color: "#EC4899" },
        { name: "Sports & Outdoors", icon: "activity", color: "#EF4444" },
        { name: "Books & Stationery", icon: "book", color: "#6366F1" },
        { name: "Toys & Games", icon: "gamepad-2", color: "#14B8A6" },
        { name: "Other", icon: "package", color: "#6B7280" },
      ];

      for (let i = 0; i < defaultCategories.length; i++) {
        await Category.create({
          ...defaultCategories[i],
          displayOrder: i,
        });
      }
      log.info(`Created ${defaultCategories.length} default categories`);
    }

    // Create default admin user
    const User = require("./models/User");
    const ownerCount = await User.countDocuments({ role: "owner" });

    if (ownerCount === 0) {
      log.info("Creating default admin user...");
      const defaultAdmin = await User.create({
        name: "Admin User",
        email: process.env.ADMIN_EMAIL || "admin@jennysaleflow.com",
        phone: process.env.ADMIN_PHONE || "+254700000000",
        password: process.env.ADMIN_PASSWORD || "Admin@123",
        role: "owner",
        isActive: true,
      });
      log.info(`Default admin created with email: ${defaultAdmin.email}`);
    }

    log.info("Default data initialization completed");
  } catch (error) {
    log.error("Error initializing default data: " + error.message);
    // Don't throw - let the app continue without default data
  }
}

// Handle graceful shutdown (for local development)
if (process.env.NODE_ENV !== "production") {
  process.on("SIGTERM", () => {
    log.info("SIGTERM received, closing database connection...");
    if (mongoose?.connection) {
      mongoose.connection.close(() => {
        log.info("MongoDB connection closed");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });

  process.on("SIGINT", () => {
    log.info("SIGINT received, closing database connection...");
    if (mongoose?.connection) {
      mongoose.connection.close(() => {
        log.info("MongoDB connection closed");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
}

// Local development server (only runs when not in production)
if (process.env.NODE_ENV !== "production" && require.main === module) {
  const PORT = process.env.PORT || 5000;

  const startLocalServer = async () => {
    try {
      log.info("Starting local development server...");

      // Connect to database
      await connectDB();

      // Initialize default data
      await initializeDefaultData();

      // Start listening
      const server = app.listen(PORT, () => {
        log.info(`🚀 Server running locally on port ${PORT}`);
        log.info(`📍 Environment: ${process.env.NODE_ENV}`);
        log.info(`🌐 API URL: http://localhost:${PORT}/api/v1`);
        log.info(`✅ Routes loaded: ${routesLoaded}`);
        log.info(`💾 Database: ${isConnected ? "Connected" : "Disconnected"}`);
      });

      // Handle server errors
      server.on("error", (error) => {
        log.error("Server error: " + error.message);
        process.exit(1);
      });
    } catch (error) {
      log.error("Failed to start local server: " + error.message);
      process.exit(1);
    }
  };

  startLocalServer();
}

// Export the Express app for Vercel
module.exports = app;
