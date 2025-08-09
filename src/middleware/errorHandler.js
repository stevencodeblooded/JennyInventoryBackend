// backend/src/middleware/errorHandler.js
const ActivityLog = require("../models/ActivityLog");

// Custom error class
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Async error handler wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// MongoDB error handler
const handleMongoError = (error) => {
  let message = "Database error occurred";
  let statusCode = 500;

  // Duplicate key error
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern)[0];
    message = `${
      field.charAt(0).toUpperCase() + field.slice(1)
    } already exists`;
    statusCode = 400;
  }

  // Validation error
  if (error.name === "ValidationError") {
    const errors = Object.values(error.errors).map((err) => err.message);
    message = errors.join(". ");
    statusCode = 400;
  }

  // Cast error (invalid ID)
  if (error.name === "CastError") {
    message = `Invalid ${error.path}: ${error.value}`;
    statusCode = 400;
  }

  return { message, statusCode };
};

// JWT error handler
const handleJWTError = (error) => {
  let message = "Authentication failed";

  if (error.name === "JsonWebTokenError") {
    message = "Invalid token. Please login again.";
  }

  if (error.name === "TokenExpiredError") {
    message = "Your session has expired. Please login again.";
  }

  return { message, statusCode: 401 };
};

// Main error handler middleware
const errorHandler = async (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.stack = err.stack;

  // Default error
  let statusCode = error.statusCode || 500;
  let message = error.message || "Internal server error";
  let data = null;

  // MongoDB errors
  if (
    err.name === "MongoError" ||
    err.name === "ValidationError" ||
    err.name === "CastError"
  ) {
    const mongoError = handleMongoError(err);
    statusCode = mongoError.statusCode;
    message = mongoError.message;
  }

  // JWT errors
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    const jwtError = handleJWTError(err);
    statusCode = jwtError.statusCode;
    message = jwtError.message;
  }

  // Multer errors (file upload)
  if (err.name === "MulterError") {
    statusCode = 400;
    if (err.code === "LIMIT_FILE_SIZE") {
      message = "File size too large";
    } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
      message = "Unexpected file field";
    } else {
      message = "File upload error";
    }
  }

  // Log error for server errors
  if (statusCode >= 500) {
    console.error("ERROR:", {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      user: req.user?._id,
    });

    // Log to database
    try {
      await ActivityLog.log({
        user: req.user?._id || null,
        action: "system.error",
        severity: "error",
        entity: {
          type: "system",
          name: "error",
        },
        details: {
          message: err.message,
          stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
          url: req.originalUrl,
          method: req.method,
        },
        metadata: {
          ip: req.ip,
          userAgent: req.get("user-agent"),
          error: {
            occurred: true,
            message: err.message,
            stack: err.stack,
          },
        },
      });
    } catch (logError) {
      console.error("Failed to log error:", logError);
    }
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    message,
    data,
    ...(process.env.NODE_ENV === "development" && {
      error: {
        message: err.message,
        stack: err.stack,
      },
    }),
  });
};

// 404 handler
const notFound = (req, res, next) => {
  const error = new AppError(`Route not found - ${req.originalUrl}`, 404);
  next(error);
};

// Validation error formatter
const formatValidationError = (errors) => {
  const formattedErrors = {};

  errors.forEach((error) => {
    if (!formattedErrors[error.param]) {
      formattedErrors[error.param] = [];
    }
    formattedErrors[error.param].push(error.msg);
  });

  return formattedErrors;
};

// Database connection error handler
const handleDBConnection = (error) => {
  console.error("Database connection error:", error);

  // In production, you might want to:
  // - Send alerts to administrators
  // - Try to reconnect
  // - Switch to a backup database

  process.exit(1);
};

module.exports = {
  AppError,
  asyncHandler,
  errorHandler,
  notFound,
  formatValidationError,
  handleDBConnection,
};
