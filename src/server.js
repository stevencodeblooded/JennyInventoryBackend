// backend/src/server.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const compression = require("compression");
const hpp = require("hpp");
const path = require("path");
require("dotenv").config();

// Debug: Test logger import
console.log("=== DEBUGGING LOGGER IMPORT ===");
try {
  const loggerModule = require("./middleware/logger");
  console.log("Logger module imported successfully");
  console.log("Available exports:", Object.keys(loggerModule));
  console.log("Logger object:", typeof loggerModule.logger);

  if (loggerModule.logger) {
    console.log(
      "Logger methods:",
      Object.getOwnPropertyNames(loggerModule.logger)
    );
    console.log("Logger.info type:", typeof loggerModule.logger.info);
    console.log("Logger.error type:", typeof loggerModule.logger.error);
  }
} catch (error) {
  console.error("Failed to import logger:", error);
  process.exit(1);
}

// Import custom modules
const database = require("./config/database");
const routes = require("./routes");
const { errorHandler, notFound } = require("./middleware/errorHandler");

// Import logger with detailed debugging
const loggerModule = require("./middleware/logger");
const logger = loggerModule.logger;
const morganMiddleware = loggerModule.morganMiddleware;
const requestLogger = loggerModule.requestLogger;
const performanceLogger = loggerModule.performanceLogger;

// Test logger before proceeding
console.log("=== TESTING LOGGER ===");
try {
  logger.info("Logger test successful");
  console.log("Logger test passed!");
} catch (error) {
  console.error("Logger test failed:", error);
  process.exit(1);
}

const { apiLimiter } = require("./middleware/rateLimiter");

// Create Express app
const app = express();

// Trust proxy (for deployment behind reverse proxy)
app.set("trust proxy", 1);

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
      "http://localhost:3000",
    ];

    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (
      allowedOrigins.indexOf(origin) !== -1 ||
      process.env.NODE_ENV === "development"
    ) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  exposedHeaders: ["X-Total-Count", "X-Page-Count"],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Security and optimization middleware
app.use(mongoSanitize()); // Prevent MongoDB injection
app.use(compression()); // Compress responses
app.use(hpp()); // Prevent HTTP parameter pollution

// Logging middleware
app.use(morganMiddleware);
app.use(requestLogger);
app.use(performanceLogger(1000)); // Log requests taking longer than 1 second

// Rate limiting
app.use("/api/", apiLimiter);

// Static files (for uploaded images, etc.)
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// API routes
app.use("/api/v1", routes);

// Root route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to JennySaleFlow API",
    version: "v1",
    documentation: "/api/v1/docs",
    health: "/api/v1/health",
  });
});

// Error handling
app.use(notFound);
app.use(errorHandler);

// Database connection and server startup
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to database
    await database.connect();
    logger.info("Database connected successfully");

    // Create default settings if not exist
    const Settings = require("./models/Settings");
    await Settings.getSettings();

    // Create default categories if none exist
    const Category = require("./models/Category");
    const categoryCount = await Category.countDocuments();

    if (categoryCount === 0) {
      logger.info("Creating default categories...");
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
      logger.info("Default categories created");
    }

    // Create default admin user if none exists
    const User = require("./models/User");
    const ownerCount = await User.countDocuments({ role: "owner" });

    if (ownerCount === 0) {
      logger.info("Creating default admin user...");
      const defaultAdmin = await User.create({
        name: "Admin User",
        email: process.env.ADMIN_EMAIL || "admin@jennysaleflow.com",
        phone: process.env.ADMIN_PHONE || "+254700000000",
        password: process.env.ADMIN_PASSWORD || "Admin@123",
        role: "owner",
        isActive: true,
      });
      logger.info(`Default admin created with email: ${defaultAdmin.email}`);
    }

    // Start server
    const server = app.listen(PORT, () => {
      logger.info(
        `Server running in ${process.env.NODE_ENV} mode on port ${PORT}`
      );
      logger.info(`API URL: http://localhost:${PORT}/api/v1`);
    });

    // Handle graceful shutdown
    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received. Shutting down gracefully...");

      server.close(() => {
        logger.info("HTTP server closed");
      });

      await database.disconnect();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      logger.info("SIGINT received. Shutting down gracefully...");

      server.close(() => {
        logger.info("HTTP server closed");
      });

      await database.disconnect();
      process.exit(0);
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      process.exit(1);
    });
  } catch (error) {
    console.error("=== ERROR IN STARTSERVER ===");
    console.error("Error object:", error);
    console.error("Logger available:", !!logger);
    console.error("Logger.error type:", typeof logger?.error);

    // Try using console as fallback
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;
