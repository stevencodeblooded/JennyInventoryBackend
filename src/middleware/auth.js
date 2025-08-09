// backend/src/middleware/auth.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");

// Verify JWT token
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      throw new Error();
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find user
    const user = await User.findOne({
      _id: decoded._id,
      isActive: true,
    });

    if (!user) {
      throw new Error();
    }

    // Check if password changed after token was issued
    if (user.changedPasswordAfter(decoded.iat)) {
      throw new Error("Password recently changed. Please login again.");
    }

    // Update last active
    user.lastActive = new Date();
    await user.save({ validateBeforeSave: false });

    // Attach user to request
    req.user = user;
    req.token = token;

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Please authenticate",
      error: error.message,
    });
  }
};

// Check specific permission
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }

    next();
  };
};

// Check specific resource permission
const checkPermission = (resource, action) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Owner has all permissions
    if (req.user.role === "owner") {
      return next();
    }

    // Check specific permission
    const hasPermission = req.user.permissions[resource]?.[action];

    if (!hasPermission) {
      // Log unauthorized attempt
      ActivityLog.log({
        user: req.user._id,
        action: `${resource}.${action}.denied`,
        severity: "warning",
        metadata: {
          ip: req.ip,
          userAgent: req.get("user-agent"),
        },
      });

      return res.status(403).json({
        success: false,
        message: `You do not have permission to ${action} ${resource}`,
      });
    }

    next();
  };
};

// Verify refresh token
const verifyRefreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new Error("Refresh token required");
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Find user and check if refresh token exists
    const user = await User.findById(decoded._id);

    if (!user || !user.isActive) {
      throw new Error("User not found");
    }

    // Check if refresh token exists in user's tokens
    const tokenExists = user.refreshTokens.some(
      (rt) => rt.token === refreshToken && rt.expiresAt > new Date()
    );

    if (!tokenExists) {
      throw new Error("Invalid refresh token");
    }

    req.user = user;
    req.refreshToken = refreshToken;

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid refresh token",
      error: error.message,
    });
  }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findOne({
        _id: decoded._id,
        isActive: true,
      });

      if (user && !user.changedPasswordAfter(decoded.iat)) {
        req.user = user;
        req.token = token;
      }
    }
  } catch (error) {
    // Ignore errors - this is optional
  }

  next();
};

// Rate limiting for sensitive operations
const sensitiveOperationLimit = (maxAttempts = 5, windowMinutes = 15) => {
  const attempts = new Map();

  return (req, res, next) => {
    const key = `${req.ip}-${req.path}`;
    const now = Date.now();
    const window = windowMinutes * 60 * 1000;

    // Clean old attempts
    for (const [k, v] of attempts.entries()) {
      if (now - v.firstAttempt > window) {
        attempts.delete(k);
      }
    }

    const userAttempts = attempts.get(key) || { count: 0, firstAttempt: now };

    if (userAttempts.count >= maxAttempts) {
      const timeLeft = Math.ceil(
        (window - (now - userAttempts.firstAttempt)) / 60000
      );

      return res.status(429).json({
        success: false,
        message: `Too many attempts. Please try again in ${timeLeft} minutes.`,
      });
    }

    userAttempts.count++;
    attempts.set(key, userAttempts);

    // Add cleanup function
    res.on("finish", () => {
      if (res.statusCode < 400) {
        attempts.delete(key);
      }
    });

    next();
  };
};

// Check if user owns resource or has permission
const checkResourceOwnership = (model, paramName = "id") => {
  return async (req, res, next) => {
    try {
      const resource = await model.findById(req.params[paramName]);

      if (!resource) {
        return res.status(404).json({
          success: false,
          message: "Resource not found",
        });
      }

      // Owner can access everything
      if (req.user.role === "owner") {
        req.resource = resource;
        return next();
      }

      // Check if user owns the resource
      const ownerId = resource.createdBy || resource.user || resource.owner;

      if (ownerId && ownerId.toString() === req.user._id.toString()) {
        req.resource = resource;
        return next();
      }

      // Otherwise check permissions
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error checking resource ownership",
        error: error.message,
      });
    }
  };
};

// Validate API key for external integrations
const validateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.header("X-API-Key");

    if (!apiKey) {
      throw new Error("API key required");
    }

    // In production, store API keys in database
    // For now, check against environment variable
    if (apiKey !== process.env.API_KEY) {
      throw new Error("Invalid API key");
    }

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid API key",
      error: error.message,
    });
  }
};

module.exports = {
  authenticate,
  authorize,
  checkPermission,
  verifyRefreshToken,
  optionalAuth,
  sensitiveOperationLimit,
  checkResourceOwnership,
  validateApiKey,
};
