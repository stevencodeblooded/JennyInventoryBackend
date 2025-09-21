// backend/src/controllers/userController.js
const mongoose = require("mongoose");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const Sale = require("../models/Sale");
const Order = require("../models/Order");
const { asyncHandler, AppError } = require("../middleware/errorHandler");

// @desc    Get all users
// @route   GET /api/users
// @access  Private (Owner/Manager)
const getUsers = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    sort = "-createdAt",
    role,
    isActive,
    search,
  } = req.query;

  // Build query
  const query = {};

  if (role) {
    query.role = role;
  }

  if (isActive !== undefined) {
    query.isActive = isActive === "true";
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  // Execute query
  const users = await User.find(query)
    .select("-refreshTokens")
    .populate("metadata.createdBy", "name")
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await User.countDocuments(query);

  res.json({
    success: true,
    data: users,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      limit: parseInt(limit),
    },
  });
});

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private (Owner/Manager or Self)
const getUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id)
    .select("-refreshTokens")
    .populate("metadata.createdBy", "name");

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // Check access rights
  if (
    req.user.role !== "owner" &&
    req.user.role !== "manager" &&
    req.user._id.toString() !== user._id.toString()
  ) {
    return next(
      new AppError("You do not have permission to view this user", 403)
    );
  }

  // Get user statistics
  const [salesCount, ordersHandled, lastActivity] = await Promise.all([
    Sale.countDocuments({ seller: user._id }),
    Order.countDocuments({ assignedTo: user._id }),
    ActivityLog.findOne({ user: user._id }).sort("-createdAt"),
  ]);

  res.json({
    success: true,
    data: {
      user,
      statistics: {
        totalSales: salesCount,
        ordersHandled,
        lastActivity: lastActivity?.createdAt,
      },
    },
  });
});

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private (Owner/Manager)
const updateUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // FIXED: Check if role is actually being changed, not just present in request
  if (
    req.user._id.toString() === user._id.toString() &&
    req.body.role &&
    req.body.role !== user.role
  ) {
    return next(new AppError("You cannot change your own role", 400));
  }

  // FIXED: Prevent deactivating own account
  if (
    req.user._id.toString() === user._id.toString() &&
    req.body.hasOwnProperty("isActive") &&
    req.body.isActive === false
  ) {
    return next(new AppError("You cannot deactivate your own account", 400));
  }

  // Track changes for activity log
  const previousData = user.toObject();

  // Allowed updates
  const allowedUpdates = [
    "name",
    "email",
    "phone",
    "role",
    "permissions",
    "isActive",
    "settings",
  ];

  Object.keys(req.body).forEach((key) => {
    if (allowedUpdates.includes(key)) {
      user[key] = req.body[key];
    }
  });

  user.metadata.updatedBy = req.user._id;
  await user.save();

  // Log activity with changes
  await ActivityLog.logChange(
    req.user._id,
    "user.updated",
    {
      type: "user",
      id: user._id,
      name: user.name,
    },
    previousData,
    user.toObject()
  );

  res.json({
    success: true,
    message: "User updated successfully",
    data: user,
  });
});

// @desc    Delete user (deactivate)
// @route   DELETE /api/users/:id
// @access  Private (Owner only)
const deleteUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // Prevent deleting self
  if (req.user._id.toString() === user._id.toString()) {
    return next(new AppError("You cannot delete your own account", 400));
  }

  // Prevent deleting the last owner
  if (user.role === "owner") {
    const ownerCount = await User.countDocuments({
      role: "owner",
      isActive: true,
    });
    if (ownerCount <= 1) {
      return next(new AppError("Cannot delete the last owner account", 400));
    }
  }

  // Soft delete
  user.isActive = false;
  user.metadata.updatedBy = req.user._id;
  await user.save();

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "user.deleted",
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
    message: "User deactivated successfully",
  });
});

// @desc    Update user permissions
// @route   PUT /api/users/:id/permissions
// @access  Private (Owner only)
const updatePermissions = asyncHandler(async (req, res, next) => {
  const { permissions } = req.body;
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // Update permissions
  user.permissions = {
    ...user.permissions,
    ...permissions,
  };

  await user.save();

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "user.permissions_updated",
    entity: {
      type: "user",
      id: user._id,
      name: user.name,
    },
    details: {
      permissions,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Permissions updated successfully",
    data: user.permissions,
  });
});

// @desc    Reset user password
// @route   POST /api/users/:id/reset-password
// @access  Private (Owner/Manager)
const resetUserPassword = asyncHandler(async (req, res, next) => {
  const { newPassword } = req.body;
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // Update password
  user.password = newPassword;
  await user.save();

  // Clear all refresh tokens
  user.refreshTokens = [];
  await user.save();

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "user.password_reset",
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
    message: "Password reset successfully",
  });
});

// @desc    Get user activity log
// @route   GET /api/users/:id/activity
// @access  Private (Owner/Manager or Self)
const getUserActivity = asyncHandler(async (req, res, next) => {
  const { days = 7, page = 1, limit = 50 } = req.query;

  // Check access rights
  if (
    req.user.role !== "owner" &&
    req.user.role !== "manager" &&
    req.user._id.toString() !== req.params.id
  ) {
    return next(
      new AppError("You do not have permission to view this activity", 403)
    );
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(days));

  const activities = await ActivityLog.searchLogs(
    {
      user: req.params.id,
      startDate,
    },
    {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: "-createdAt",
    }
  );

  res.json({
    success: true,
    data: activities,
  });
});

// @desc    Get user performance metrics
// @route   GET /api/users/:id/performance
// @access  Private (Owner/Manager or Self)
const getUserPerformance = asyncHandler(async (req, res, next) => {
  let { startDate, endDate, period } = req.query;

  // Handle period parameter
  if (period) {
    endDate = new Date();
    startDate = new Date();

    switch (period) {
      case "week":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "month":
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case "year":
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(startDate.getMonth() - 1);
    }
  } else {
    // Use provided dates or default to last month
    startDate = startDate
      ? new Date(startDate)
      : new Date(new Date().setMonth(new Date().getMonth() - 1));
    endDate = endDate ? new Date(endDate) : new Date();
  }

  // Check access rights
  if (
    req.user.role !== "owner" &&
    req.user.role !== "manager" &&
    req.user._id.toString() !== req.params.id
  ) {
    return next(
      new AppError("You do not have permission to view this data", 403)
    );
  }

  const userId = req.params.id;

  // Get sales performance - FIX: Add 'new' keyword
  const salesPerformance = await Sale.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(userId), // FIXED
        createdAt: { $gte: startDate, $lte: endDate },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: null,
        totalSales: { $sum: 1 },
        totalRevenue: { $sum: "$totals.total" },
        averageSale: { $avg: "$totals.total" },
        totalItems: { $sum: { $size: "$items" } },
      },
    },
  ]);

  // Get daily breakdown - FIX: Add 'new' keyword
  const dailyPerformance = await Sale.aggregate([
    {
      $match: {
        seller: new mongoose.Types.ObjectId(userId), // FIXED
        createdAt: { $gte: startDate, $lte: endDate },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        sales: { $sum: 1 },
        revenue: { $sum: "$totals.total" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Get order performance - FIX: Add 'new' keyword
  const orderPerformance = await Order.aggregate([
    {
      $match: {
        assignedTo: new mongoose.Types.ObjectId(userId), // FIXED
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  // ADD: Get user ranking based on sales performance
  const userRanking = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: "$seller",
        totalSales: { $sum: 1 },
        totalRevenue: { $sum: "$totals.total" },
      },
    },
    {
      $sort: { totalRevenue: -1 }, // Sort by revenue descending
    },
    {
      $group: {
        _id: null,
        users: {
          $push: {
            userId: "$_id",
            totalSales: "$totalSales",
            totalRevenue: "$totalRevenue",
          },
        },
      },
    },
    {
      $unwind: {
        path: "$users",
        includeArrayIndex: "rank",
      },
    },
    {
      $match: {
        "users.userId": new mongoose.Types.ObjectId(userId),
      },
    },
  ]);

  // Calculate total number of active users with sales in this period
  const totalUsersWithSales = await Sale.distinct("seller", {
    createdAt: { $gte: startDate, $lte: endDate },
    status: { $in: ["completed", "partial_refund"] },
  });

  const currentUserRank =
    userRanking.length > 0 ? userRanking[0].rank + 1 : null;
  const totalUsers = totalUsersWithSales.length;

  res.json({
    success: true,
    data: {
      period: { startDate, endDate },
      sales: salesPerformance[0] || {
        totalSales: 0,
        totalRevenue: 0,
        averageSale: 0,
        totalItems: 0,
      },
      dailyPerformance,
      orders: orderPerformance,
      // ADD: Include ranking information
      ranking: {
        rank: currentUserRank,
        totalUsers: totalUsers,
      },
    },
  });
});

// @desc    Bulk update users
// @route   PUT /api/users/bulk-update
// @access  Private (Owner only)
const bulkUpdateUsers = asyncHandler(async (req, res, next) => {
  const { userIds, updates } = req.body;

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return next(new AppError("User IDs are required", 400));
  }

  // Prevent updating own account in bulk
  if (userIds.includes(req.user._id.toString())) {
    return next(
      new AppError("Cannot update your own account in bulk operation", 400)
    );
  }

  // Allowed bulk updates
  const allowedUpdates = ["role", "isActive", "permissions"];
  const updateData = {};

  Object.keys(updates).forEach((key) => {
    if (allowedUpdates.includes(key)) {
      updateData[key] = updates[key];
    }
  });

  updateData["metadata.updatedBy"] = req.user._id;

  // Perform bulk update
  const result = await User.updateMany(
    { _id: { $in: userIds } },
    { $set: updateData }
  );

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "user.bulk_updated",
    entity: {
      type: "user",
      name: "Multiple users",
    },
    details: {
      userCount: result.modifiedCount,
      updates: updateData,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: `${result.modifiedCount} users updated successfully`,
    data: {
      matched: result.matchedCount,
      modified: result.modifiedCount,
    },
  });
});

// @desc    Get login history
// @route   GET /api/users/:id/login-history
// @access  Private (Owner/Manager or Self)
const getLoginHistory = asyncHandler(async (req, res, next) => {
  // Check access rights
  if (
    req.user.role !== "owner" &&
    req.user.role !== "manager" &&
    req.user._id.toString() !== req.params.id
  ) {
    return next(
      new AppError("You do not have permission to view this data", 403)
    );
  }

  const user = await User.findById(req.params.id).select(
    "metadata.loginHistory"
  );

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  res.json({
    success: true,
    data: user.metadata.loginHistory || [],
  });
});

module.exports = {
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  updatePermissions,
  resetUserPassword,
  getUserActivity,
  getUserPerformance,
  bulkUpdateUsers,
  getLoginHistory,
};
