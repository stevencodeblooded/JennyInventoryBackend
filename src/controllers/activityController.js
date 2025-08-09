// backend/src/controllers/activityController.js
const ActivityLog = require("../models/ActivityLog");
const { asyncHandler, AppError } = require("../middleware/errorHandler");

// @desc    Get activity logs
// @route   GET /api/activities
// @access  Private (Owner/Manager)
const getActivities = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 50,
    user,
    action,
    entityType,
    severity,
    startDate,
    endDate,
    search,
  } = req.query;

  // Build filters
  const filters = {};

  if (user) filters.user = user;
  if (action) filters.action = action;
  if (entityType) filters.entityType = entityType;
  if (severity) filters.severity = severity;
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;
  if (search) filters.search = search;

  // Get logs with pagination
  const result = await ActivityLog.searchLogs(filters, {
    page: parseInt(page),
    limit: parseInt(limit),
    sort: "-createdAt",
  });

  res.json({
    success: true,
    data: result.logs,
    pagination: result.pagination,
  });
});

// @desc    Get activity summary
// @route   GET /api/activities/summary
// @access  Private (Owner/Manager)
const getActivitySummary = asyncHandler(async (req, res, next) => {
  const { hours = 24 } = req.query;

  const metrics = await ActivityLog.getSystemMetrics(parseInt(hours));

  res.json({
    success: true,
    data: metrics[0] || {
      byAction: [],
      byUser: [],
      bySeverity: [],
      errorRate: [{ rate: 0 }],
    },
  });
});

// @desc    Get user activity summary
// @route   GET /api/activities/user/:userId
// @access  Private (Owner/Manager or Self)
const getUserActivitySummary = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { days = 7 } = req.query;

  // Check access rights
  if (
    req.user.role !== "owner" &&
    req.user.role !== "manager" &&
    req.user._id.toString() !== userId
  ) {
    return next(
      new AppError("You do not have permission to view this data", 403)
    );
  }

  const summary = await ActivityLog.getUserActivitySummary(
    userId,
    parseInt(days)
  );

  res.json({
    success: true,
    data: summary,
  });
});

// @desc    Get security events
// @route   GET /api/activities/security
// @access  Private (Owner/Manager)
const getSecurityEvents = asyncHandler(async (req, res, next) => {
  const { days = 7 } = req.query;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(days));

  const securityEvents = await ActivityLog.find({
    createdAt: { $gte: startDate },
    $or: [
      {
        action: {
          $regex: "failed_login|password_changed|permissions_updated",
          $options: "i",
        },
      },
      { severity: { $in: ["warning", "error", "critical"] } },
    ],
  })
    .populate("user", "name email")
    .sort("-createdAt")
    .limit(100);

  // Group by type
  const groupedEvents = {
    failedLogins: [],
    passwordChanges: [],
    permissionChanges: [],
    errors: [],
    other: [],
  };

  securityEvents.forEach((event) => {
    if (event.action.includes("failed_login")) {
      groupedEvents.failedLogins.push(event);
    } else if (event.action.includes("password")) {
      groupedEvents.passwordChanges.push(event);
    } else if (event.action.includes("permission")) {
      groupedEvents.permissionChanges.push(event);
    } else if (event.severity === "error" || event.severity === "critical") {
      groupedEvents.errors.push(event);
    } else {
      groupedEvents.other.push(event);
    }
  });

  res.json({
    success: true,
    data: {
      summary: {
        total: securityEvents.length,
        failedLogins: groupedEvents.failedLogins.length,
        passwordChanges: groupedEvents.passwordChanges.length,
        permissionChanges: groupedEvents.permissionChanges.length,
        errors: groupedEvents.errors.length,
      },
      events: groupedEvents,
    },
  });
});

// @desc    Export activity logs
// @route   POST /api/activities/export
// @access  Private (Owner only)
const exportActivities = asyncHandler(async (req, res, next) => {
  const { startDate, endDate, format = "csv" } = req.body;

  const logs = await ActivityLog.find({
    createdAt: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  })
    .populate("user", "name email")
    .sort("-createdAt")
    .lean();

  // In production, this would generate actual file
  res.json({
    success: true,
    message: `Export ready in ${format} format`,
    data: {
      format,
      count: logs.length,
      logs: process.env.NODE_ENV === "development" ? logs.slice(0, 10) : [],
    },
  });
});

// @desc    Get activity statistics
// @route   GET /api/activities/stats
// @access  Private (Owner/Manager)
const getActivityStats = asyncHandler(async (req, res, next) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thisWeek = new Date();
  thisWeek.setDate(thisWeek.getDate() - 7);

  const thisMonth = new Date();
  thisMonth.setMonth(thisMonth.getMonth() - 1);

  // Get counts for different periods
  const [todayCount, weekCount, monthCount] = await Promise.all([
    ActivityLog.countDocuments({ createdAt: { $gte: today } }),
    ActivityLog.countDocuments({ createdAt: { $gte: thisWeek } }),
    ActivityLog.countDocuments({ createdAt: { $gte: thisMonth } }),
  ]);

  // Get most active users
  const mostActiveUsers = await ActivityLog.aggregate([
    {
      $match: { createdAt: { $gte: thisWeek } },
    },
    {
      $group: {
        _id: "$user",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $project: {
        userName: "$user.name",
        userRole: "$user.role",
        activityCount: "$count",
      },
    },
  ]);

  // Get most common actions
  const commonActions = await ActivityLog.aggregate([
    {
      $match: { createdAt: { $gte: thisWeek } },
    },
    {
      $group: {
        _id: "$action",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  res.json({
    success: true,
    data: {
      counts: {
        today: todayCount,
        thisWeek: weekCount,
        thisMonth: monthCount,
      },
      mostActiveUsers,
      commonActions,
    },
  });
});

module.exports = {
  getActivities,
  getActivitySummary,
  getUserActivitySummary,
  getSecurityEvents,
  exportActivities,
  getActivityStats,
};
