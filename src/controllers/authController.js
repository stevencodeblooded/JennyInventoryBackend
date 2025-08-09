// backend/src/controllers/authController.js
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const { activityLogger } = require("../middleware/logger");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Private (Owner only)
const register = asyncHandler(async (req, res, next) => {
  const { name, email, phone, password, role, permissions } = req.body;

  // Check if user exists
  const existingUser = await User.findOne({
    $or: [{ email }, { phone }],
  });

  if (existingUser) {
    return next(
      new AppError("User with this email or phone already exists", 400)
    );
  }

  // Create user
  const user = await User.create({
    name,
    email,
    phone,
    password,
    role: role || "operator",
    permissions: permissions || undefined,
    metadata: {
      createdBy: req.user._id,
    },
  });

  // Generate token
  const token = user.generateAuthToken();
  const refreshToken = user.generateRefreshToken();
  await user.save();

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "user.created",
    entity: {
      type: "user",
      id: user._id,
      name: user.name,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.status(201).json({
    success: true,
    message: "User registered successfully",
    data: {
      user,
      token,
      refreshToken,
    },
  });
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  try {
    // Find user and verify password
    const user = await User.findByCredentials(email, password);

    // Generate tokens
    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();
    await user.save();

    // Record successful login
    await user.recordLogin(req.ip, req.get("user-agent"), true);
    activityLogger.logLogin(user, req.ip, true);

    // Log activity
    await ActivityLog.log({
      user: user._id,
      action: "user.login",
      entity: {
        type: "user",
        id: user._id,
        name: user.name,
      },
      metadata: {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      },
    });

    res.json({
      success: true,
      message: "Login successful",
      data: {
        user,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    // Log failed login attempt
    if (error.message === "Invalid credentials") {
      const user = await User.findOne({ email });
      if (user) {
        await user.recordLogin(req.ip, req.get("user-agent"), false);
        activityLogger.logLogin(user, req.ip, false);
      }
    }

    return next(new AppError(error.message, 401));
  }
});

// @desc    PIN login for quick access
// @route   POST /api/auth/pin-login
// @access  Public
const pinLogin = asyncHandler(async (req, res, next) => {
  const { email, pin } = req.body;

  try {
    // Find user and verify PIN
    const user = await User.findByPIN(email, pin);

    // Generate tokens
    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();
    await user.save();

    // Record successful login
    await user.recordLogin(req.ip, req.get("user-agent"), true);

    // Log activity
    await ActivityLog.log({
      user: user._id,
      action: "user.pin_login",
      entity: {
        type: "user",
        id: user._id,
        name: user.name,
      },
      metadata: {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      },
    });

    res.json({
      success: true,
      message: "PIN login successful",
      data: {
        user,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    // Log failed login attempt
    const user = await User.findOne({ email });
    if (user) {
      await user.recordLogin(req.ip, req.get("user-agent"), false);

      await ActivityLog.log({
        user: user._id,
        action: "user.failed_login",
        severity: "warning",
        entity: {
          type: "user",
          id: user._id,
          name: user.name,
        },
        metadata: {
          ip: req.ip,
          userAgent: req.get("user-agent"),
          loginType: "pin",
        },
      });
    }

    return next(new AppError(error.message, 401));
  }
});

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public
const refreshAccessToken = asyncHandler(async (req, res, next) => {
  const { user, refreshToken } = req;

  // Generate new access token
  const newAccessToken = user.generateAuthToken();

  res.json({
    success: true,
    message: "Token refreshed successfully",
    data: {
      token: newAccessToken,
      refreshToken,
    },
  });
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logout = asyncHandler(async (req, res, next) => {
  const { user, token } = req;

  // Remove refresh token
  if (req.body.refreshToken) {
    user.refreshTokens = user.refreshTokens.filter(
      (rt) => rt.token !== req.body.refreshToken
    );
    await user.save();
  }

  // Log activity
  await ActivityLog.log({
    user: user._id,
    action: "user.logout",
    entity: {
      type: "user",
      id: user._id,
      name: user.name,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Logged out successfully",
  });
});

// @desc    Logout from all devices
// @route   POST /api/auth/logout-all
// @access  Private
const logoutAll = asyncHandler(async (req, res, next) => {
  const { user } = req;

  // Clear all refresh tokens
  user.refreshTokens = [];
  await user.save();

  // Log activity
  await ActivityLog.log({
    user: user._id,
    action: "user.logout",
    entity: {
      type: "user",
      id: user._id,
      name: user.name,
    },
    details: {
      notes: "Logged out from all devices",
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Logged out from all devices successfully",
  });
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res, next) => {
  res.json({
    success: true,
    data: req.user,
  });
});

// @desc    Update profile
// @route   PUT /api/auth/profile
// @access  Private
const updateProfile = asyncHandler(async (req, res, next) => {
  const { name, phone, email, settings } = req.body;
  const { user } = req;

  // Check if email/phone already taken
  if (email && email !== user.email) {
    const emailExists = await User.findOne({ email });
    if (emailExists) {
      return next(new AppError("Email already in use", 400));
    }
  }

  if (phone && phone !== user.phone) {
    const phoneExists = await User.findOne({ phone });
    if (phoneExists) {
      return next(new AppError("Phone number already in use", 400));
    }
  }

  // Update fields
  if (name) user.name = name;
  if (email) user.email = email;
  if (phone) user.phone = phone;
  if (settings) user.settings = { ...user.settings, ...settings };

  await user.save();

  // Log activity
  await ActivityLog.log({
    user: user._id,
    action: "user.profile_updated",
    entity: {
      type: "user",
      id: user._id,
      name: user.name,
    },
    details: {
      changes: Object.keys(req.body),
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Profile updated successfully",
    data: user,
  });
});

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  const { user } = req;

  // Get user with password
  const userWithPassword = await User.findById(user._id).select("+password");

  // Check current password
  const isPasswordValid = await userWithPassword.comparePassword(
    currentPassword
  );
  if (!isPasswordValid) {
    return next(new AppError("Current password is incorrect", 401));
  }

  // Update password
  userWithPassword.password = newPassword;
  await userWithPassword.save();

  // Generate new tokens
  const token = userWithPassword.generateAuthToken();
  const refreshToken = userWithPassword.generateRefreshToken();
  await userWithPassword.save();

  // Log activity
  await ActivityLog.log({
    user: user._id,
    action: "user.password_changed",
    entity: {
      type: "user",
      id: user._id,
      name: user.name,
    },
    severity: "warning",
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Password changed successfully",
    data: {
      token,
      refreshToken,
    },
  });
});

// @desc    Set/Update PIN
// @route   PUT /api/auth/set-pin
// @access  Private
const setPin = asyncHandler(async (req, res, next) => {
  const { pin, password } = req.body;
  const { user } = req;

  // Verify password before setting PIN
  const userWithPassword = await User.findById(user._id).select("+password");
  const isPasswordValid = await userWithPassword.comparePassword(password);

  if (!isPasswordValid) {
    return next(new AppError("Password is incorrect", 401));
  }

  // Set PIN
  userWithPassword.pin = pin;
  await userWithPassword.save();

  res.json({
    success: true,
    message: "PIN set successfully",
  });
});

// @desc    Request password reset
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    return next(new AppError("No user found with this email", 404));
  }

  // Generate reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // In production, send email with reset token
  // For now, return token in response (development only)
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

  res.json({
    success: true,
    message: "Password reset link sent to email",
    ...(process.env.NODE_ENV === "development" && { resetUrl }),
  });
});

// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
const resetPassword = asyncHandler(async (req, res, next) => {
  const { password } = req.body;
  const { token } = req.params;

  // Hash token
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  // Find user with valid reset token
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError("Invalid or expired reset token", 400));
  }

  // Reset password
  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  // Generate new tokens
  const authToken = user.generateAuthToken();
  const refreshToken = user.generateRefreshToken();
  await user.save();

  res.json({
    success: true,
    message: "Password reset successful",
    data: {
      token: authToken,
      refreshToken,
    },
  });
});

module.exports = {
  register,
  login,
  pinLogin,
  refreshAccessToken,
  logout,
  logoutAll,
  getMe,
  updateProfile,
  changePassword,
  setPin,
  forgotPassword,
  resetPassword,
};
