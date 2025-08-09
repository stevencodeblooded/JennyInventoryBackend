// backend/src/middleware/logger.js
const winston = require("winston");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, "../../logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log colors
const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "white",
};

// Tell winston about our colors
winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Define console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define which transports to use
const transports = [
  // Console transport
  new winston.transports.Console({
    format: process.env.NODE_ENV === "development" ? consoleFormat : format,
  }),

  // Error log file
  new winston.transports.File({
    filename: path.join(logsDir, "error.log"),
    level: "error",
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),

  // Combined log file
  new winston.transports.File({
    filename: path.join(logsDir, "combined.log"),
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
];

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  levels,
  format,
  transports,
  exitOnError: false,
});

// Create a stream object for Morgan
logger.stream = {
  write: (message) => logger.http(message.trim()),
};

// Morgan middleware for HTTP request logging
const morganMiddleware = morgan(
  ':remote-addr - :remote-user [:date[iso]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" - :response-time ms',
  {
    stream: logger.stream,
    skip: (req, res) => {
      // Skip logging for health checks
      return req.url === "/health" || req.url === "/api/health";
    },
  }
);

// Request logger middleware
const requestLogger = (req, res, next) => {
  // Store start time
  req.startTime = Date.now();

  // Log request
  logger.info("Incoming request", {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    userId: req.user?._id,
  });

  // Log response
  const originalSend = res.send;
  res.send = function (data) {
    res.responseTime = Date.now() - req.startTime;

    // Log based on status code
    const logLevel =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    logger[logLevel]("Request completed", {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: res.responseTime,
      userId: req.user?._id,
    });

    originalSend.call(this, data);
  };

  next();
};

// Activity logger for important business events
const activityLogger = {
  logSale: (sale, user) => {
    logger.info("Sale completed", {
      saleId: sale._id,
      receiptNumber: sale.receiptNumber,
      total: sale.totals.total,
      userId: user._id,
      userName: user.name,
    });
  },

  logOrder: (order, user) => {
    logger.info("Order created", {
      orderId: order._id,
      orderNumber: order.orderNumber,
      total: order.totals.total,
      userId: user._id,
      userName: user.name,
    });
  },

  logInventoryChange: (product, change, user) => {
    logger.info("Inventory updated", {
      productId: product._id,
      productName: product.name,
      changeType: change.type,
      quantity: change.quantity,
      newStock: product.inventory.currentStock,
      userId: user._id,
      userName: user.name,
    });
  },

  logLogin: (user, ip, success = true) => {
    const level = success ? "info" : "warn";
    logger[level]("Login attempt", {
      userId: user._id,
      email: user.email,
      success,
      ip,
    });
  },

  logError: (error, context = {}) => {
    logger.error("Application error", {
      message: error.message,
      stack: error.stack,
      ...context,
    });
  },
};

// Performance logger
const performanceLogger = (threshold = 1000) => {
  return (req, res, next) => {
    const start = process.hrtime();

    res.on("finish", () => {
      const [seconds, nanoseconds] = process.hrtime(start);
      const duration = seconds * 1000 + nanoseconds / 1000000;

      if (duration > threshold) {
        logger.warn("Slow request detected", {
          method: req.method,
          url: req.url,
          duration: `${duration.toFixed(2)}ms`,
          threshold: `${threshold}ms`,
        });
      }
    });

    next();
  };
};

// Database query logger
const queryLogger = {
  logQuery: (collection, operation, duration, success = true) => {
    const level = success ? "debug" : "error";
    logger[level]("Database query", {
      collection,
      operation,
      duration: `${duration}ms`,
      success,
    });
  },
};

// Scheduled task logger
const taskLogger = {
  start: (taskName) => {
    logger.info("Scheduled task started", { taskName });
  },

  complete: (taskName, duration) => {
    logger.info("Scheduled task completed", {
      taskName,
      duration: `${duration}ms`,
    });
  },

  error: (taskName, error) => {
    logger.error("Scheduled task failed", {
      taskName,
      error: error.message,
      stack: error.stack,
    });
  },
};

// Export everything
module.exports = {
  logger,
  morganMiddleware,
  requestLogger,
  activityLogger,
  performanceLogger,
  queryLogger,
  taskLogger,
};
