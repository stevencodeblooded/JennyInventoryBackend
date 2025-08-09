// backend/src/models/Settings.js
const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: "system_settings",
    },
    business: {
      name: {
        type: String,
        required: true,
        default: "JennySaleFlow",
      },
      tagline: String,
      logo: {
        url: String,
        alt: String,
      },
      address: {
        street: String,
        area: String,
        city: {
          type: String,
          default: "Nairobi",
        },
        county: {
          type: String,
          default: "Nairobi",
        },
        country: {
          type: String,
          default: "Kenya",
        },
        postalCode: String,
      },
      contact: {
        phone: {
          type: String,
          required: true,
          default: "+254700000000", // Fixed: Added default phone number
        },
        alternatePhone: String,
        email: String,
        website: String,
      },
      registration: {
        businessNumber: String,
        taxId: String,
        vatNumber: String,
        licenses: [
          {
            type: String,
            number: String,
            expiryDate: Date,
          },
        ],
      },
      operatingHours: {
        monday: { open: String, close: String, isClosed: Boolean },
        tuesday: { open: String, close: String, isClosed: Boolean },
        wednesday: { open: String, close: String, isClosed: Boolean },
        thursday: { open: String, close: String, isClosed: Boolean },
        friday: { open: String, close: String, isClosed: Boolean },
        saturday: { open: String, close: String, isClosed: Boolean },
        sunday: { open: String, close: String, isClosed: Boolean },
      },
    },
    sales: {
      tax: {
        enabled: {
          type: Boolean,
          default: true,
        },
        rate: {
          type: Number,
          default: 16, // Kenya VAT
          min: 0,
          max: 100,
        },
        inclusive: {
          type: Boolean,
          default: false,
        },
      },
      receipt: {
        header: String,
        footer: String,
        showLogo: {
          type: Boolean,
          default: true,
        },
        paperSize: {
          type: String,
          enum: ["58mm", "80mm", "A4"],
          default: "80mm",
        },
        printCopy: {
          type: Number,
          default: 1,
          min: 1,
          max: 3,
        },
      },
      payment: {
        methods: [
          {
            name: String,
            enabled: Boolean,
            instructions: String,
          },
        ],
        mpesa: {
          enabled: Boolean,
          tillNumber: String,
          paybillNumber: String,
          accountName: String,
        },
        creditTerms: {
          enabled: Boolean,
          defaultDays: {
            type: Number,
            default: 30,
          },
          interestRate: {
            type: Number,
            default: 0,
          },
        },
      },
      discounts: {
        maxPercentage: {
          type: Number,
          default: 50,
          min: 0,
          max: 100,
        },
        requireApproval: {
          type: Boolean,
          default: true,
        },
        approvalThreshold: {
          type: Number,
          default: 20,
        },
      },
    },
    inventory: {
      lowStockAlert: {
        enabled: {
          type: Boolean,
          default: true,
        },
        threshold: {
          type: Number,
          default: 10,
        },
      },
      autoReorder: {
        enabled: {
          type: Boolean,
          default: false,
        },
        leadTime: {
          type: Number,
          default: 7, // days
        },
      },
      barcodeFormat: {
        type: String,
        enum: ["EAN13", "CODE128", "QR"],
        default: "CODE128",
      },
      trackExpiry: {
        enabled: {
          type: Boolean,
          default: false,
        },
        alertDays: {
          type: Number,
          default: 30,
        },
      },
    },
    orders: {
      delivery: {
        enabled: {
          type: Boolean,
          default: true,
        },
        freeDeliveryThreshold: {
          type: Number,
          default: 0,
        },
        zones: [
          {
            name: String,
            areas: [String],
            fee: Number,
            estimatedTime: String,
          },
        ],
        defaultFee: {
          type: Number,
          default: 200,
        },
      },
      confirmation: {
        requireEmail: {
          type: Boolean,
          default: false,
        },
        requireSMS: {
          type: Boolean,
          default: true,
        },
        autoConfirm: {
          type: Boolean,
          default: false,
        },
      },
      cancellation: {
        allowCustomer: {
          type: Boolean,
          default: true,
        },
        timeLimit: {
          type: Number,
          default: 30, // minutes
        },
        reasons: [String],
      },
    },
    notifications: {
      email: {
        enabled: {
          type: Boolean,
          default: false,
        },
        provider: {
          type: String,
          enum: ["sendgrid", "mailgun", "smtp"],
          default: "smtp",
        },
        settings: {
          from: String,
          replyTo: String,
          smtp: {
            host: String,
            port: Number,
            secure: Boolean,
            user: String,
            pass: String,
          },
        },
        templates: {
          orderConfirmation: String,
          orderDelivered: String,
          lowStock: String,
          dailyReport: String,
        },
      },
      sms: {
        enabled: {
          type: Boolean,
          default: true,
        },
        provider: {
          type: String,
          enum: ["africastalking", "twilio", "advanta"],
          default: "africastalking",
        },
        settings: {
          apiKey: String,
          username: String,
          senderId: String,
          accountSid: String,
          authToken: String,
        },
        templates: {
          orderConfirmation: String,
          orderReady: String,
          orderDelivered: String,
          paymentReminder: String,
        },
      },
      whatsapp: {
        enabled: {
          type: Boolean,
          default: false,
        },
        provider: {
          type: String,
          enum: ["twilio", "whatsapp_business"],
          default: "twilio",
        },
        settings: {
          phoneNumber: String,
          apiKey: String,
          accountSid: String,
          authToken: String,
        },
      },
    },
    security: {
      sessionTimeout: {
        type: Number,
        default: 720, // minutes (12 hours)
      },
      passwordPolicy: {
        minLength: {
          type: Number,
          default: 6,
        },
        requireUppercase: {
          type: Boolean,
          default: false,
        },
        requireNumbers: {
          type: Boolean,
          default: false,
        },
        requireSpecialChars: {
          type: Boolean,
          default: false,
        },
        expiryDays: {
          type: Number,
          default: 0, // 0 means no expiry
        },
      },
      twoFactorAuth: {
        enabled: {
          type: Boolean,
          default: false,
        },
        methods: {
          sms: Boolean,
          email: Boolean,
          app: Boolean,
        },
      },
      ipWhitelist: {
        enabled: {
          type: Boolean,
          default: false,
        },
        addresses: [String],
      },
      backups: {
        automatic: {
          type: Boolean,
          default: true,
        },
        frequency: {
          type: String,
          enum: ["daily", "weekly", "monthly"],
          default: "daily",
        },
        time: {
          type: String,
          default: "02:00",
        },
        retention: {
          type: Number,
          default: 30, // days
        },
      },
    },
    currency: {
      code: {
        type: String,
        default: "KES",
      },
      symbol: {
        type: String,
        default: "KSh",
      },
      position: {
        type: String,
        enum: ["before", "after"],
        default: "before",
      },
      decimalPlaces: {
        type: Number,
        default: 2,
      },
      thousandsSeparator: {
        type: String,
        default: ",",
      },
      decimalSeparator: {
        type: String,
        default: ".",
      },
    },
    features: {
      pos: {
        enabled: {
          type: Boolean,
          default: true,
        },
        quickSale: {
          type: Boolean,
          default: true,
        },
        tableMode: {
          type: Boolean,
          default: false,
        },
      },
      loyalty: {
        enabled: {
          type: Boolean,
          default: true,
        },
        pointsPerCurrency: {
          type: Number,
          default: 1, // 1 point per 100 KES
        },
        redemptionRate: {
          type: Number,
          default: 0.5, // 1 point = 0.5 KES
        },
      },
      multiLocation: {
        enabled: {
          type: Boolean,
          default: false,
        },
        locations: [
          {
            name: String,
            code: String,
            address: String,
            manager: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
            },
          },
        ],
      },
    },
    integrations: {
      accounting: {
        enabled: {
          type: Boolean,
          default: false,
        },
        software: {
          type: String,
          enum: ["quickbooks", "sage", "zoho_books"],
        },
        settings: mongoose.Schema.Types.Mixed,
      },
      ecommerce: {
        enabled: {
          type: Boolean,
          default: false,
        },
        platform: {
          type: String,
          enum: ["woocommerce", "shopify", "custom"],
        },
        settings: mongoose.Schema.Types.Mixed,
      },
      analytics: {
        googleAnalytics: {
          enabled: Boolean,
          trackingId: String,
        },
        customTracking: {
          enabled: Boolean,
          endpoint: String,
        },
      },
    },
    metadata: {
      version: {
        type: String,
        default: "1.0.0",
      },
      lastUpdated: {
        type: Date,
        default: Date.now,
      },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      setupCompleted: {
        type: Boolean,
        default: false,
      },
      setupSteps: {
        business: { type: Boolean, default: false },
        tax: { type: Boolean, default: false },
        payment: { type: Boolean, default: false },
        notifications: { type: Boolean, default: false },
        users: { type: Boolean, default: false },
      },
    },
  },
  {
    timestamps: true,
    minimize: false, // Keep empty objects
  }
);

// Ensure only one settings document exists
settingsSchema.index({ _id: 1 }, { unique: true });

// Static method to get settings
settingsSchema.statics.getSettings = async function () {
  let settings = await this.findById("system_settings");

  if (!settings) {
    settings = await this.create({ _id: "system_settings" });
  }

  return settings;
};

// Static method to update settings
settingsSchema.statics.updateSettings = async function (updates, userId) {
  const settings = await this.getSettings();

  // Deep merge updates
  Object.keys(updates).forEach((key) => {
    if (typeof updates[key] === "object" && !Array.isArray(updates[key])) {
      settings[key] = { ...settings[key], ...updates[key] };
    } else {
      settings[key] = updates[key];
    }
  });

  settings.metadata.lastUpdated = new Date();
  settings.metadata.updatedBy = userId;

  await settings.save();
  return settings;
};

// Method to format currency
settingsSchema.methods.formatCurrency = function (amount) {
  const {
    symbol,
    position,
    decimalPlaces,
    thousandsSeparator,
    decimalSeparator,
  } = this.currency;

  const formatted = amount
    .toFixed(decimalPlaces)
    .replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSeparator)
    .replace(".", decimalSeparator);

  return position === "before"
    ? `${symbol}${formatted}`
    : `${formatted}${symbol}`;
};

// Method to check feature availability
settingsSchema.methods.isFeatureEnabled = function (feature) {
  const parts = feature.split(".");
  let current = this.features;

  for (const part of parts) {
    if (!current[part]) return false;
    current = current[part];
  }

  return current.enabled || current === true;
};

// Method to get notification settings for a specific channel
settingsSchema.methods.getNotificationSettings = function (channel) {
  const settings = this.notifications[channel];
  if (!settings || !settings.enabled) return null;

  return {
    ...settings.settings,
    templates: settings.templates,
  };
};

// Method to calculate delivery fee
settingsSchema.methods.calculateDeliveryFee = function (area) {
  if (!this.orders.delivery.enabled) return 0;

  const zone = this.orders.delivery.zones.find((z) =>
    z.areas.some((a) => a.toLowerCase() === area.toLowerCase())
  );

  return zone ? zone.fee : this.orders.delivery.defaultFee;
};

const Settings = mongoose.model("Settings", settingsSchema);

module.exports = Settings;
