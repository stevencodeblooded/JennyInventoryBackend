// backend/src/controllers/dashboardController.js
const Sale = require("../models/Sale");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Customer = require("../models/Customer");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const { asyncHandler } = require("../middleware/errorHandler");

// @desc    Get dashboard overview
// @route   GET /api/dashboard/overview
// @access  Private
const getOverview = asyncHandler(async (req, res, next) => {
  const { period = "today" } = req.query;

  // Calculate date ranges
  const now = new Date();
  let startDate, compareStartDate;

  switch (period) {
    case "today":
      startDate = new Date(now.setHours(0, 0, 0, 0));
      compareStartDate = new Date(startDate);
      compareStartDate.setDate(compareStartDate.getDate() - 1);
      break;
    case "week":
      startDate = new Date(now.setDate(now.getDate() - 7));
      compareStartDate = new Date(startDate);
      compareStartDate.setDate(compareStartDate.getDate() - 7);
      break;
    case "month":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      compareStartDate = new Date(startDate);
      compareStartDate.setMonth(compareStartDate.getMonth() - 1);
      break;
    default:
      startDate = new Date(now.setHours(0, 0, 0, 0));
  }

  // Get current period stats
  const currentStats = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$totals.total" },
        totalOrders: { $sum: 1 },
        averageOrder: { $avg: "$totals.total" },
      },
    },
  ]);

  // Get comparison period stats
  const compareEndDate = new Date(startDate);
  const compareStats = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: compareStartDate, $lt: compareEndDate },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$totals.total" },
        totalOrders: { $sum: 1 },
        averageOrder: { $avg: "$totals.total" },
      },
    },
  ]);

  const current = currentStats[0] || {
    totalRevenue: 0,
    totalOrders: 0,
    averageOrder: 0,
  };
  const previous = compareStats[0] || {
    totalRevenue: 0,
    totalOrders: 0,
    averageOrder: 0,
  };

  // Calculate growth percentages
  const calculateGrowth = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return (((current - previous) / previous) * 100).toFixed(1);
  };

  // Get additional metrics
  const [activeProducts, totalCustomers, pendingOrders] = await Promise.all([
    Product.countDocuments({ "status.isActive": true }),
    Customer.countDocuments({ "status.isActive": true }),
    Order.countDocuments({
      status: { $in: ["pending", "confirmed", "processing"] },
    }),
  ]);

  res.json({
    success: true,
    data: {
      period,
      metrics: {
        revenue: {
          current: current.totalRevenue,
          previous: previous.totalRevenue,
          growth: calculateGrowth(current.totalRevenue, previous.totalRevenue),
        },
        orders: {
          current: current.totalOrders,
          previous: previous.totalOrders,
          growth: calculateGrowth(current.totalOrders, previous.totalOrders),
        },
        averageOrder: {
          current: current.averageOrder,
          previous: previous.averageOrder,
          growth: calculateGrowth(current.averageOrder, previous.averageOrder),
        },
        activeProducts,
        totalCustomers,
        pendingOrders,
      },
    },
  });
});

// @desc    Get real-time stats
// @route   GET /api/dashboard/realtime
// @access  Private
const getRealtimeStats = asyncHandler(async (req, res, next) => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Get active users
  const activeUsers = await User.find({
    lastActive: { $gte: fiveMinutesAgo },
    isActive: true,
  }).select("name role lastActive");

  // Get recent sales
  const recentSales = await Sale.find({
    createdAt: { $gte: oneHourAgo },
    status: "completed",
  })
    .select("receiptNumber totals.total createdAt seller")
    .populate("seller", "name")
    .sort("-createdAt")
    .limit(10);

  // Get recent activities
  const recentActivities = await ActivityLog.find({
    createdAt: { $gte: oneHourAgo },
  })
    .populate("user", "name")
    .sort("-createdAt")
    .limit(20);

  // Get current queue status
  const queueStatus = {
    pendingOrders: await Order.countDocuments({
      status: "pending",
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    }),
    processingOrders: await Order.countDocuments({
      status: { $in: ["confirmed", "processing"] },
    }),
    readyOrders: await Order.countDocuments({
      status: "ready",
    }),
  };

  res.json({
    success: true,
    data: {
      activeUsers,
      recentSales,
      recentActivities,
      queueStatus,
      serverTime: new Date(),
    },
  });
});

// @desc    Get sales chart data
// @route   GET /api/dashboard/sales-chart
// @access  Private
const getSalesChart = asyncHandler(async (req, res, next) => {
  const { period = "7days", groupBy = "day" } = req.query;

  // Calculate date range
  let startDate = new Date();
  switch (period) {
    case "24hours":
      startDate.setHours(startDate.getHours() - 24);
      break;
    case "7days":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "30days":
      startDate.setDate(startDate.getDate() - 30);
      break;
    case "12months":
      startDate.setMonth(startDate.getMonth() - 12);
      break;
  }

  // Determine grouping format
  let dateFormat;
  switch (groupBy) {
    case "hour":
      dateFormat = {
        $dateToString: { format: "%Y-%m-%d %H:00", date: "$createdAt" },
      };
      break;
    case "day":
      dateFormat = {
        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
      };
      break;
    case "week":
      dateFormat = { $dateToString: { format: "%Y-W%V", date: "$createdAt" } };
      break;
    case "month":
      dateFormat = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
      break;
  }

  const salesData = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: dateFormat,
        revenue: { $sum: "$totals.total" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json({
    success: true,
    data: {
      period,
      groupBy,
      chart: salesData,
    },
  });
});

// @desc    Get top products widget
// @route   GET /api/dashboard/top-products
// @access  Private
const getTopProducts = asyncHandler(async (req, res, next) => {
  const { days = 7, limit = 5 } = req.query;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(days));

  const topProducts = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product",
        productName: { $first: "$items.productName" },
        quantitySold: { $sum: "$items.quantity" },
        revenue: { $sum: "$items.subtotal" },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: parseInt(limit) },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },
    {
      $project: {
        productName: 1,
        quantitySold: 1,
        revenue: 1,
        currentStock: "$product.inventory.currentStock",
        image: "$product.images.0.url",
      },
    },
  ]);

  res.json({
    success: true,
    data: topProducts,
  });
});

// @desc    Get low stock alerts
// @route   GET /api/dashboard/low-stock
// @access  Private
const getLowStockAlerts = asyncHandler(async (req, res, next) => {
  const { limit = 10 } = req.query;

  const lowStockProducts = await Product.find({
    "status.isActive": true,
    $expr: {
      $lte: ["$inventory.currentStock", "$inventory.minStock"],
    },
  })
    .select("name sku inventory.currentStock inventory.minStock stockStatus")
    .populate("category", "name")
    .sort("inventory.currentStock")
    .limit(parseInt(limit));

  res.json({
    success: true,
    data: {
      products: lowStockProducts,
      totalLowStock: await Product.countDocuments({
        "status.isActive": true,
        $expr: {
          $lte: ["$inventory.currentStock", "$inventory.minStock"],
        },
      }),
      outOfStock: await Product.countDocuments({
        "status.isActive": true,
        "inventory.currentStock": 0,
      }),
    },
  });
});

// @desc    Get performance metrics
// @route   GET /api/dashboard/performance
// @access  Private
const getPerformanceMetrics = asyncHandler(async (req, res, next) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thisWeek = new Date();
  thisWeek.setDate(thisWeek.getDate() - 7);

  const thisMonth = new Date();
  thisMonth.setMonth(thisMonth.getMonth() - 1);

  // Get conversion metrics
  const [todayMetrics, weekMetrics, monthMetrics] = await Promise.all([
    getConversionMetrics(today),
    getConversionMetrics(thisWeek),
    getConversionMetrics(thisMonth),
  ]);

  // Get average processing times
  const processingTimes = await Order.aggregate([
    {
      $match: {
        status: "delivered",
        createdAt: { $gte: thisMonth },
      },
    },
    {
      $project: {
        processingTime: {
          $subtract: ["$delivery.actualDeliveryDate", "$createdAt"],
        },
      },
    },
    {
      $group: {
        _id: null,
        avgProcessingTime: { $avg: "$processingTime" },
        minProcessingTime: { $min: "$processingTime" },
        maxProcessingTime: { $max: "$processingTime" },
      },
    },
  ]);

  res.json({
    success: true,
    data: {
      conversion: {
        today: todayMetrics,
        week: weekMetrics,
        month: monthMetrics,
      },
      processingTimes: processingTimes[0] || {
        avgProcessingTime: 0,
        minProcessingTime: 0,
        maxProcessingTime: 0,
      },
    },
  });
});

// Helper function to get conversion metrics
async function getConversionMetrics(startDate) {
  const orders = await Order.countDocuments({
    createdAt: { $gte: startDate },
  });

  const completedOrders = await Order.countDocuments({
    createdAt: { $gte: startDate },
    status: "delivered",
  });

  const cancelledOrders = await Order.countDocuments({
    createdAt: { $gte: startDate },
    status: "cancelled",
  });

  return {
    totalOrders: orders,
    completed: completedOrders,
    cancelled: cancelledOrders,
    conversionRate:
      orders > 0 ? ((completedOrders / orders) * 100).toFixed(1) : 0,
    cancellationRate:
      orders > 0 ? ((cancelledOrders / orders) * 100).toFixed(1) : 0,
  };
}

// @desc    Get notifications for dashboard
// @route   GET /api/dashboard/notifications
// @access  Private
const getNotifications = asyncHandler(async (req, res, next) => {
  const notifications = [];

  // Check for low stock
  const lowStockCount = await Product.countDocuments({
    "status.isActive": true,
    $expr: {
      $lte: ["$inventory.currentStock", "$inventory.minStock"],
    },
  });

  if (lowStockCount > 0) {
    notifications.push({
      type: "warning",
      category: "inventory",
      message: `${lowStockCount} products are running low on stock`,
      action: "/inventory/low-stock",
    });
  }

  // Check for pending orders
  const pendingOrders = await Order.countDocuments({
    status: "pending",
    createdAt: { $lte: new Date(Date.now() - 30 * 60 * 1000) }, // Older than 30 minutes
  });

  if (pendingOrders > 0) {
    notifications.push({
      type: "info",
      category: "orders",
      message: `${pendingOrders} orders pending for more than 30 minutes`,
      action: "/orders/pending",
    });
  }

  // Check for failed logins
  const failedLogins = await ActivityLog.countDocuments({
    action: "user.failed_login",
    createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }, // Last hour
  });

  if (failedLogins > 10) {
    notifications.push({
      type: "error",
      category: "security",
      message: `${failedLogins} failed login attempts in the last hour`,
      action: "/settings/security",
    });
  }

  res.json({
    success: true,
    data: notifications,
  });
});

module.exports = {
  getOverview,
  getRealtimeStats,
  getSalesChart,
  getTopProducts,
  getLowStockAlerts,
  getPerformanceMetrics,
  getNotifications,
};
