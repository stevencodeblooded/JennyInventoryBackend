// backend/src/config/app.js
module.exports = {
  // Application settings
  app: {
    name: "JennySaleFlow",
    version: process.env.npm_package_version || "1.0.0",
    description: "Inventory and Sales Management System",
    environment: process.env.NODE_ENV || "development",
    port: process.env.PORT || 5000,
    url: process.env.APP_URL || "http://localhost:5000",
    timezone: process.env.TZ || "Africa/Nairobi",
  },

  // Database configuration
  database: {
    uri: process.env.MONGODB_URI || "mongodb://localhost:27017/jennysaleflow",
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    },
  },

  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || "your-super-secret-jwt-key-change-this",
    refreshSecret:
      process.env.JWT_REFRESH_SECRET || "your-refresh-secret-key-change-this",
    expiresIn: process.env.JWT_EXPIRES_IN || "24h",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },

  // Email configuration
  email: {
    enabled: process.env.EMAIL_ENABLED === "true",
    from: process.env.EMAIL_FROM || "noreply@jennysaleflow.com",
    smtp: {
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },
  },

  // SMS configuration (Africa's Talking)
  sms: {
    enabled: process.env.SMS_ENABLED === "true",
    provider: process.env.SMS_PROVIDER || "africastalking",
    africastalking: {
      username: process.env.AT_USERNAME || "sandbox",
      apiKey: process.env.AT_API_KEY,
      from: process.env.AT_SENDER_ID || "JennySale",
    },
  },

  // File upload configuration
  upload: {
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ["image/jpeg", "image/png", "image/gif", "application/pdf"],
    destination: "./uploads",
  },

  // Redis configuration (for caching and rate limiting)
  redis: {
    url: process.env.REDIS_URL,
    options: {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: true,
    },
  },

  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again later.",
  },

  // CORS configuration
  cors: {
    origins: process.env.ALLOWED_ORIGINS?.split(",") || [
      "http://localhost:3000",
    ],
    credentials: true,
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || "info",
    format: process.env.LOG_FORMAT || "combined",
    directory: "./logs",
  },

  // Security
  security: {
    bcryptRounds: 12,
    sessionTimeout: 12 * 60 * 60 * 1000, // 12 hours
    maxLoginAttempts: 5,
    lockoutTime: 30 * 60 * 1000, // 30 minutes
    apiKey: process.env.API_KEY,
  },

  // Business rules
  business: {
    currency: "KES",
    taxRate: 16, // Kenya VAT
    lowStockThreshold: 10,
    orderTimeout: 24 * 60 * 60 * 1000, // 24 hours
    defaultCreditLimit: 50000,
  },

  // Backup configuration
  backup: {
    enabled: process.env.BACKUP_ENABLED === "true",
    schedule: process.env.BACKUP_SCHEDULE || "0 2 * * *", // 2 AM daily
    retention: parseInt(process.env.BACKUP_RETENTION || "30"), // days
    destination: process.env.BACKUP_PATH || "./backups",
  },

  // Feature flags
  features: {
    multiLocation: process.env.FEATURE_MULTI_LOCATION === "true",
    loyaltyProgram: process.env.FEATURE_LOYALTY === "true",
    onlineOrdering: process.env.FEATURE_ONLINE_ORDERS === "true",
    mobileApp: process.env.FEATURE_MOBILE_APP === "true",
  },
};
