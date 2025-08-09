// backend/src/models/Customer.js
const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Customer name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      validate: {
        validator: function (phone) {
          return /^(\+254|0)[17]\d{8}$/.test(phone);
        },
        message: "Please provide a valid Kenyan phone number",
      },
    },
    alternatePhone: {
      type: String,
      validate: {
        validator: function (phone) {
          return !phone || /^(\+254|0)[17]\d{8}$/.test(phone);
        },
        message: "Please provide a valid Kenyan phone number",
      },
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
      validate: {
        validator: function (email) {
          return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        },
        message: "Please provide a valid email",
      },
    },
    addresses: [
      {
        type: {
          type: String,
          enum: ["home", "work", "other"],
          default: "home",
        },
        street: String,
        area: {
          type: String,
          required: true,
        },
        landmark: String,
        city: {
          type: String,
          default: "Nairobi",
        },
        county: {
          type: String,
          default: "Nairobi",
        },
        instructions: String,
        isDefault: {
          type: Boolean,
          default: false,
        },
        location: {
          type: {
            type: String,
            enum: ["Point"],
            default: "Point",
          },
          coordinates: {
            type: [Number], // [longitude, latitude]
            default: [36.8219, -1.2921], // Nairobi coordinates
          },
        },
      },
    ],
    preferences: {
      communication: {
        sms: { type: Boolean, default: true },
        whatsapp: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        calls: { type: Boolean, default: true },
      },
      language: {
        type: String,
        enum: ["en", "sw"],
        default: "en",
      },
      paymentMethod: {
        type: String,
        enum: ["cash", "mpesa", "card", "credit"],
        default: "cash",
      },
    },
    loyalty: {
      points: {
        type: Number,
        default: 0,
        min: 0,
      },
      tier: {
        type: String,
        enum: ["bronze", "silver", "gold", "platinum"],
        default: "bronze",
      },
      joinDate: {
        type: Date,
        default: Date.now,
      },
      expiryDate: Date,
    },
    credit: {
      isEnabled: {
        type: Boolean,
        default: false,
      },
      limit: {
        type: Number,
        default: 0,
        min: 0,
      },
      used: {
        type: Number,
        default: 0,
        min: 0,
      },
      dueDate: Date,
      transactions: [
        {
          type: {
            type: String,
            enum: ["credit", "payment"],
          },
          amount: Number,
          reference: String,
          balance: Number,
          date: {
            type: Date,
            default: Date.now,
          },
          recordedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
        },
      ],
    },
    statistics: {
      totalOrders: {
        type: Number,
        default: 0,
      },
      totalSpent: {
        type: Number,
        default: 0,
      },
      averageOrderValue: {
        type: Number,
        default: 0,
      },
      lastOrderDate: Date,
      favoriteProducts: [
        {
          product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
          },
          count: Number,
        },
      ],
      orderFrequency: {
        type: Number,
        default: 0, // Orders per month
      },
    },
    tags: [
      {
        type: String,
        lowercase: true,
        trim: true,
      },
    ],
    notes: [
      {
        content: String,
        createdBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        isImportant: {
          type: Boolean,
          default: false,
        },
      },
    ],
    status: {
      isActive: {
        type: Boolean,
        default: true,
      },
      isBlacklisted: {
        type: Boolean,
        default: false,
      },
      blacklistReason: String,
      lastActivity: {
        type: Date,
        default: Date.now,
      },
    },
    metadata: {
      source: {
        type: String,
        enum: ["walk-in", "phone", "referral", "online", "import"],
        default: "walk-in",
      },
      referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer",
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      importBatch: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
customerSchema.index({ phone: 1 });
customerSchema.index({ email: 1 });
customerSchema.index({ name: "text" });
customerSchema.index({ "status.isActive": 1 });
customerSchema.index({ "loyalty.tier": 1 });
customerSchema.index({ tags: 1 });
customerSchema.index({ "addresses.location": "2dsphere" });

// Virtual for available credit
customerSchema.virtual("availableCredit").get(function () {
  if (!this.credit.isEnabled) return 0;
  return this.credit.limit - this.credit.used;
});

// Virtual for loyalty tier requirements
customerSchema.virtual("nextTierRequirement").get(function () {
  const requirements = {
    bronze: { spent: 0, orders: 0 },
    silver: { spent: 50000, orders: 10 },
    gold: { spent: 150000, orders: 25 },
    platinum: { spent: 300000, orders: 50 },
  };

  const tiers = ["bronze", "silver", "gold", "platinum"];
  const currentIndex = tiers.indexOf(this.loyalty.tier);

  if (currentIndex === tiers.length - 1) return null;

  const nextTier = tiers[currentIndex + 1];
  const requirement = requirements[nextTier];

  return {
    tier: nextTier,
    spentNeeded: Math.max(0, requirement.spent - this.statistics.totalSpent),
    ordersNeeded: Math.max(0, requirement.orders - this.statistics.totalOrders),
  };
});

// Method to update statistics after order
customerSchema.methods.updateOrderStatistics = async function (orderAmount) {
  this.statistics.totalOrders += 1;
  this.statistics.totalSpent += orderAmount;
  this.statistics.lastOrderDate = new Date();
  this.statistics.averageOrderValue =
    this.statistics.totalSpent / this.statistics.totalOrders;
  this.status.lastActivity = new Date();

  // Update loyalty points (1 point per 100 KES)
  const pointsEarned = Math.floor(orderAmount / 100);
  this.loyalty.points += pointsEarned;

  // Check for tier upgrade
  await this.updateLoyaltyTier();

  await this.save();
  return this;
};

// Method to update loyalty tier
customerSchema.methods.updateLoyaltyTier = async function () {
  const { totalSpent, totalOrders } = this.statistics;

  let newTier = "bronze";
  if (totalSpent >= 300000 && totalOrders >= 50) {
    newTier = "platinum";
  } else if (totalSpent >= 150000 && totalOrders >= 25) {
    newTier = "gold";
  } else if (totalSpent >= 50000 && totalOrders >= 10) {
    newTier = "silver";
  }

  if (newTier !== this.loyalty.tier) {
    this.loyalty.tier = newTier;
    // Could trigger notification here
  }
};

// Method to add credit transaction
customerSchema.methods.addCreditTransaction = async function (
  type,
  amount,
  reference,
  userId
) {
  if (!this.credit.isEnabled) {
    throw new Error("Credit not enabled for this customer");
  }

  let newBalance = this.credit.used;

  if (type === "credit") {
    if (this.credit.used + amount > this.credit.limit) {
      throw new Error("Credit limit exceeded");
    }
    newBalance += amount;
  } else if (type === "payment") {
    newBalance = Math.max(0, newBalance - amount);
  }

  this.credit.used = newBalance;
  this.credit.transactions.push({
    type,
    amount,
    reference,
    balance: newBalance,
    recordedBy: userId,
  });

  // Keep only last 50 transactions
  if (this.credit.transactions.length > 50) {
    this.credit.transactions = this.credit.transactions.slice(-50);
  }

  await this.save();
  return this;
};

// Method to add note
customerSchema.methods.addNote = async function (
  content,
  userId,
  isImportant = false
) {
  this.notes.push({
    content,
    createdBy: userId,
    isImportant,
  });

  // Keep only last 20 notes
  if (this.notes.length > 20) {
    this.notes = this.notes.slice(-20);
  }

  await this.save();
  return this;
};

// Static method to find customers by location
customerSchema.statics.findByLocation = function (
  coordinates,
  maxDistance = 5000
) {
  return this.find({
    "addresses.location": {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: coordinates,
        },
        $maxDistance: maxDistance,
      },
    },
  });
};

// Static method to get customer segments
customerSchema.statics.getSegments = async function () {
  return await this.aggregate([
    {
      $match: { "status.isActive": true },
    },
    {
      $group: {
        _id: "$loyalty.tier",
        count: { $sum: 1 },
        totalRevenue: { $sum: "$statistics.totalSpent" },
        avgOrderValue: { $avg: "$statistics.averageOrderValue" },
      },
    },
    {
      $sort: { totalRevenue: -1 },
    },
  ]);
};

const Customer = mongoose.model("Customer", customerSchema);

module.exports = Customer;
