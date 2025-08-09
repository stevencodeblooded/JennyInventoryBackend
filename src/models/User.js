// backend/src/models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [50, "Name cannot exceed 50 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: function (email) {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        },
        message: "Please provide a valid email",
      },
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      validate: {
        validator: function (phone) {
          // Kenyan phone number format
          return /^(\+254|0)[17]\d{8}$/.test(phone);
        },
        message: "Please provide a valid Kenyan phone number",
      },
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    pin: {
      type: String,
      required: false,
      minlength: 4,
      maxlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ["owner", "operator", "viewer"],
      default: "operator",
    },
    permissions: {
      products: {
        create: { type: Boolean, default: false },
        read: { type: Boolean, default: true },
        update: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      sales: {
        create: { type: Boolean, default: true },
        read: { type: Boolean, default: true },
        void: { type: Boolean, default: false },
      },
      orders: {
        create: { type: Boolean, default: true },
        read: { type: Boolean, default: true },
        update: { type: Boolean, default: true },
        delete: { type: Boolean, default: false },
      },
      reports: {
        view: { type: Boolean, default: false },
        export: { type: Boolean, default: false },
      },
      users: {
        manage: { type: Boolean, default: false },
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    accountLockedUntil: {
      type: Date,
      default: null,
    },
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    refreshTokens: [
      {
        token: String,
        createdAt: {
          type: Date,
          default: Date.now,
        },
        expiresAt: Date,
        deviceInfo: String,
      },
    ],
    settings: {
      notifications: {
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: true },
        lowStock: { type: Boolean, default: true },
        dailyReport: { type: Boolean, default: true },
      },
      theme: {
        type: String,
        enum: ["light", "dark", "auto"],
        default: "light",
      },
      language: {
        type: String,
        enum: ["en", "sw"],
        default: "en",
      },
    },
    metadata: {
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      loginHistory: [
        {
          timestamp: Date,
          ip: String,
          userAgent: String,
          success: Boolean,
        },
      ],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better query performance
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ lastActive: -1 });

// Virtual for full permissions based on role
userSchema.virtual("fullPermissions").get(function () {
  if (this.role === "owner") {
    return {
      products: { create: true, read: true, update: true, delete: true },
      sales: { create: true, read: true, void: true },
      orders: { create: true, read: true, update: true, delete: true },
      reports: { view: true, export: true },
      users: { manage: true },
    };
  }
  return this.permissions;
});

// Hash password before saving
userSchema.pre("save", async function (next) {
  // Only hash if password is modified
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    this.passwordChangedAt = Date.now() - 1000; // Subtract 1 second to ensure token is created after password change
    next();
  } catch (error) {
    next(error);
  }
});

// Hash PIN before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("pin") || !this.pin) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.comparePIN = async function (candidatePIN) {
  if (!this.pin) return false;
  return await bcrypt.compare(candidatePIN, this.pin);
};

userSchema.methods.generateAuthToken = function () {
  const token = jwt.sign(
    {
      _id: this._id,
      email: this.email,
      role: this.role,
      permissions: this.fullPermissions,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "24h",
    }
  );
  return token;
};

userSchema.methods.generateRefreshToken = function () {
  const token = jwt.sign({ _id: this._id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: "7d",
  });

  // Store refresh token
  this.refreshTokens.push({
    token,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  // Keep only last 5 refresh tokens
  if (this.refreshTokens.length > 5) {
    this.refreshTokens = this.refreshTokens.slice(-5);
  }

  return token;
};

userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");

  this.passwordResetToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.passwordResetExpires = Date.now() + 30 * 60 * 1000; // 30 minutes

  return resetToken;
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

userSchema.methods.isAccountLocked = function () {
  return this.accountLockedUntil && this.accountLockedUntil > Date.now();
};

userSchema.methods.incrementFailedLogin = async function () {
  this.failedLoginAttempts += 1;

  // Lock account after 5 failed attempts
  if (this.failedLoginAttempts >= 5) {
    this.accountLockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  }

  await this.save({ validateBeforeSave: false });
};

userSchema.methods.resetFailedLogin = async function () {
  this.failedLoginAttempts = 0;
  this.accountLockedUntil = null;
  await this.save({ validateBeforeSave: false });
};

userSchema.methods.recordLogin = async function (
  ip,
  userAgent,
  success = true
) {
  this.metadata.loginHistory.push({
    timestamp: new Date(),
    ip,
    userAgent,
    success,
  });

  // Keep only last 20 login records
  if (this.metadata.loginHistory.length > 20) {
    this.metadata.loginHistory = this.metadata.loginHistory.slice(-20);
  }

  if (success) {
    this.lastLogin = new Date();
    this.lastActive = new Date();
  }

  await this.save({ validateBeforeSave: false });
};

// Static methods
userSchema.statics.findByCredentials = async function (email, password) {
  const user = await this.findOne({ email }).select("+password");

  if (!user) {
    throw new Error("Invalid credentials");
  }

  if (user.isAccountLocked()) {
    throw new Error("Account is locked. Please try again later.");
  }

  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    await user.incrementFailedLogin();
    throw new Error("Invalid credentials");
  }

  await user.resetFailedLogin();
  return user;
};

userSchema.statics.findByPIN = async function (email, pin) {
  const user = await this.findOne({ email }).select("+pin");

  if (!user || !user.pin) {
    throw new Error("PIN login not enabled for this account");
  }

  if (user.isAccountLocked()) {
    throw new Error("Account is locked. Please try again later.");
  }

  const isPINValid = await user.comparePIN(pin);

  if (!isPINValid) {
    await user.incrementFailedLogin();
    throw new Error("Invalid PIN");
  }

  await user.resetFailedLogin();
  return user;
};

// Remove sensitive data when converting to JSON
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.pin;
  delete user.passwordResetToken;
  delete user.passwordResetExpires;
  delete user.refreshTokens;
  delete user.__v;
  return user;
};

const User = mongoose.model("User", userSchema);

module.exports = User;
