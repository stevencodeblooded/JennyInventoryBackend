// backend/src/middleware/rateLimiter.js
const rateLimit = require("express-rate-limit");
const Redis = require("ioredis");

// Create Redis client if Redis is available
let redisClient;
let RedisStore;

if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL);
    RedisStore =
      require("rate-limit-redis").default || require("rate-limit-redis");

    redisClient.on("error", (err) => {
      console.error("Redis connection error:", err);
      redisClient = null;
      RedisStore = null;
    });
  } catch (error) {
    console.log("Redis not available, using memory store for rate limiting");
    redisClient = null;
    RedisStore = null;
  }
}

// Create different rate limiters for different endpoints
const createLimiter = (options) => {
  const config = {
    windowMs: 15 * 60 * 1000, // 15 minutes default
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many requests, please try again later.",
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message:
          options.message || "Too many requests, please try again later.",
        retryAfter: Math.round(req.rateLimit.resetTime / 1000) || 60,
      });
    },
    ...options,
  };

  // Use Redis store if available, otherwise use memory store
  if (redisClient && RedisStore) {
    try {
      config.store = new RedisStore({
        // Fix: Provide sendCommand method for ioredis compatibility
        sendCommand: (...args) => redisClient.call(...args),
        prefix: "rl:",
      });
    } catch (error) {
      console.log("Failed to create Redis store, using memory store");
    }
  }

  return rateLimit(config);
};

// General API rate limiter
const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: "Too many API requests, please try again later.",
  skip: (req) => {
    // Skip rate limiting for certain IPs (e.g., office IP)
    const whitelist = process.env.RATE_LIMIT_WHITELIST?.split(",") || [];
    return whitelist.includes(req.ip);
  },
});

// Strict rate limiter for auth endpoints
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: "Too many authentication attempts, please try again later.",
  skipSuccessfulRequests: true, // Don't count successful requests
});

// Rate limiter for password reset
const passwordResetLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour
  message: "Too many password reset requests, please try again later.",
});

// Rate limiter for report generation
const reportLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 reports per hour
  message: "Report generation limit reached, please try again later.",
});

// Rate limiter for file uploads
const uploadLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 uploads per hour
  message: "Upload limit reached, please try again later.",
});

// Rate limiter for sales/orders creation
const transactionLimiter = createLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 transactions per minute
  message: "Transaction limit reached, please slow down.",
});

// Dynamic rate limiter based on user role
const createDynamicLimiter = (getLimit) => {
  return (req, res, next) => {
    const limit = getLimit(req);

    const limiter = createLimiter({
      windowMs: 15 * 60 * 1000,
      max: limit,
      keyGenerator: (req) => {
        // Use user ID if authenticated, otherwise use IP
        return req.user ? `user:${req.user._id}` : `ip:${req.ip}`;
      },
    });

    limiter(req, res, next);
  };
};

// Role-based rate limiter
const roleLimiter = createDynamicLimiter((req) => {
  if (!req.user) return 50; // Unauthenticated users

  switch (req.user.role) {
    case "owner":
      return 1000; // Very high limit for owners
    case "operator":
      return 500; // High limit for operators
    case "viewer":
      return 100; // Standard limit for viewers
    default:
      return 50;
  }
});

// Endpoint-specific rate limiter
const endpointLimiter = (endpoint, options) => {
  return createLimiter({
    ...options,
    keyGenerator: (req) => {
      // Create unique key per user per endpoint
      const userId = req.user ? req.user._id : req.ip;
      return `${userId}:${endpoint}`;
    },
  });
};

// Burst limiter for preventing sudden spikes
const burstLimiter = createLimiter({
  windowMs: 1000, // 1 second
  max: 10, // 10 requests per second
  message: "Request rate too high, please slow down.",
});

// Sliding window rate limiter for more accurate limiting
const slidingWindowLimiter = (windowMs, max) => {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.user ? `user:${req.user._id}` : `ip:${req.ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get or create request array for this key
    if (!requests.has(key)) {
      requests.set(key, []);
    }

    const userRequests = requests.get(key);

    // Remove old requests outside the window
    const validRequests = userRequests.filter((time) => time > windowStart);

    if (validRequests.length >= max) {
      const oldestRequest = Math.min(...validRequests);
      const resetTime = oldestRequest + windowMs;

      return res.status(429).json({
        success: false,
        message: "Too many requests",
        retryAfter: Math.ceil((resetTime - now) / 1000),
      });
    }

    // Add current request
    validRequests.push(now);
    requests.set(key, validRequests);

    // Clean up old entries periodically
    if (Math.random() < 0.01) {
      for (const [k, v] of requests.entries()) {
        if (v.every((time) => time < windowStart)) {
          requests.delete(k);
        }
      }
    }

    next();
  };
};

// Cost-based rate limiter for expensive operations
const costBasedLimiter = (maxCost = 100, windowMs = 60000) => {
  const costs = new Map();

  return (costFunction) => {
    return (req, res, next) => {
      const key = req.user ? `user:${req.user._id}` : `ip:${req.ip}`;
      const now = Date.now();
      const cost = costFunction(req);

      if (!costs.has(key)) {
        costs.set(key, { total: 0, resetTime: now + windowMs });
      }

      const userCost = costs.get(key);

      // Reset if window expired
      if (now > userCost.resetTime) {
        userCost.total = 0;
        userCost.resetTime = now + windowMs;
      }

      if (userCost.total + cost > maxCost) {
        return res.status(429).json({
          success: false,
          message: "Rate limit exceeded. This operation is too expensive.",
          retryAfter: Math.ceil((userCost.resetTime - now) / 1000),
        });
      }

      userCost.total += cost;
      next();
    };
  };
};

// Example cost-based limiter for reports
const reportCostLimiter = costBasedLimiter(100, 3600000); // 100 cost units per hour

const expensiveReportLimiter = reportCostLimiter((req) => {
  // Assign costs based on report type
  const costs = {
    daily: 10,
    weekly: 20,
    monthly: 30,
    yearly: 50,
    custom: 40,
  };

  return costs[req.query.type] || 20;
});

module.exports = {
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  reportLimiter,
  uploadLimiter,
  transactionLimiter,
  roleLimiter,
  endpointLimiter,
  burstLimiter,
  slidingWindowLimiter,
  costBasedLimiter,
  expensiveReportLimiter,
};
