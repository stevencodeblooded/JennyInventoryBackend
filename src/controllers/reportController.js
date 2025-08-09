// backend/src/controllers/reportController.js
const Sale = require("../models/Sale");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Customer = require("../models/Customer");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const { taskLogger } = require("../middleware/logger");

// @desc    Get sales report
// @route   GET /api/reports/sales
// @access  Private (Owner/Manager)
const getSalesReport = asyncHandler(async (req, res, next) => {
  const {
    startDate = new Date(new Date().setMonth(new Date().getMonth() - 1)),
    endDate = new Date(),
    groupBy = "day",
    includeDetails = false,
  } = req.query;

  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  // Get sales summary
  const salesSummary = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: null,
        totalSales: { $sum: 1 },
        totalRevenue: { $sum: "$totals.total" },
        totalDiscount: { $sum: "$totals.discount" },
        totalTax: { $sum: "$totals.tax" },
        averageSale: { $avg: "$totals.total" },
        uniqueCustomers: { $addToSet: "$customer" },
      },
    },
    {
      $project: {
        _id: 0,
        totalSales: 1,
        totalRevenue: 1,
        totalDiscount: 1,
        totalTax: 1,
        averageSale: 1,
        uniqueCustomers: { $size: { $ifNull: ["$uniqueCustomers", []] } },
      },
    },
  ]);

  // Get sales by payment method
  const salesByPayment = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: "$payment.method",
        count: { $sum: 1 },
        total: { $sum: "$totals.total" },
      },
    },
    {
      $sort: { total: -1 },
    },
  ]);

  // Get top selling products
  const topProducts = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
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
    { $limit: 10 },
  ]);

  // Get sales trend
  const dateFormat = {
    day: "%Y-%m-%d",
    week: "%Y-W%V",
    month: "%Y-%m",
  };

  const salesTrend = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: dateFormat[groupBy],
            date: "$createdAt",
          },
        },
        sales: { $sum: 1 },
        revenue: { $sum: "$totals.total" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Get hourly distribution
  const hourlyDistribution = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: { $hour: "$createdAt" },
        count: { $sum: 1 },
        revenue: { $sum: "$totals.total" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Log report generation
  await ActivityLog.log({
    user: req.user._id,
    action: "report.generated",
    entity: {
      type: "report",
      name: "Sales Report",
    },
    details: {
      startDate: start,
      endDate: end,
      groupBy,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    data: {
      period: { start, end },
      summary: salesSummary[0] || {
        totalSales: 0,
        totalRevenue: 0,
        totalDiscount: 0,
        totalTax: 0,
        averageSale: 0,
        uniqueCustomers: 0,
      },
      paymentMethods: salesByPayment,
      topProducts,
      trend: salesTrend,
      hourlyDistribution,
      ...(includeDetails && {
        rawData: await Sale.find({
          createdAt: { $gte: start, $lte: end },
          status: { $in: ["completed", "partial_refund"] },
        }).limit(1000),
      }),
    },
  });
});

// @desc    Get inventory report
// @route   GET /api/reports/inventory
// @access  Private (Owner/Manager)
const getInventoryReport = asyncHandler(async (req, res, next) => {
  const { category, includeInactive = false } = req.query;

  // Build query
  const query = {};
  if (!includeInactive) {
    query["status.isActive"] = true;
  }
  if (category) {
    query.category = category;
  }

  // Get inventory summary
  const inventoryValue = await Product.calculateInventoryValue();

  // Get stock status distribution
  const stockStatus = await Product.aggregate([
    { $match: query },
    {
      $project: {
        status: {
          $cond: [
            { $eq: ["$inventory.currentStock", 0] },
            "out_of_stock",
            {
              $cond: [
                { $lte: ["$inventory.currentStock", "$inventory.minStock"] },
                "low_stock",
                "in_stock",
              ],
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  // Get products by category
  const productsByCategory = await Product.aggregate([
    { $match: query },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        totalStock: { $sum: "$inventory.currentStock" },
        stockValue: {
          $sum: { $multiply: ["$inventory.currentStock", "$pricing.cost"] },
        },
      },
    },
    {
      $lookup: {
        from: "categories",
        localField: "_id",
        foreignField: "_id",
        as: "category",
      },
    },
    {
      $unwind: {
        path: "$category",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        categoryName: { $ifNull: ["$category.name", "Uncategorized"] },
        count: 1,
        totalStock: 1,
        stockValue: 1,
      },
    },
    { $sort: { stockValue: -1 } },
  ]);

  // Get slow moving products
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const slowMoving = await Product.find({
    ...query,
    "inventory.currentStock": { $gt: 0 },
    $or: [
      { "performance.lastSoldDate": { $lt: thirtyDaysAgo } },
      { "performance.lastSoldDate": null },
    ],
  })
    .select(
      "name sku inventory.currentStock pricing.cost performance.lastSoldDate"
    )
    .sort("-inventory.currentStock")
    .limit(20);

  // Get products needing reorder
  const needsReorder = await Product.find({
    ...query,
    $expr: {
      $lte: ["$inventory.currentStock", "$inventory.minStock"],
    },
  })
    .select(
      "name sku inventory.currentStock inventory.minStock inventory.reorderQuantity"
    )
    .populate("category", "name");

  res.json({
    success: true,
    data: {
      summary: {
        ...inventoryValue,
        stockStatusDistribution: stockStatus,
      },
      byCategory: productsByCategory,
      alerts: {
        needsReorder: needsReorder.length,
        slowMoving: slowMoving.length,
        outOfStock:
          stockStatus.find((s) => s._id === "out_of_stock")?.count || 0,
        lowStock: stockStatus.find((s) => s._id === "low_stock")?.count || 0,
      },
      slowMovingProducts: slowMoving,
      reorderList: needsReorder,
    },
  });
});

// @desc    Get staff performance report
// @route   GET /api/reports/staff-performance
// @access  Private (Owner/Manager)
const getStaffPerformance = asyncHandler(async (req, res, next) => {
  const {
    startDate = new Date(new Date().setMonth(new Date().getMonth() - 1)),
    endDate = new Date(),
    userId,
  } = req.query;

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Build query
  const query = {
    createdAt: { $gte: start, $lte: end },
  };

  if (userId) {
    query.seller = userId;
  }

  // Get sales performance by user
  const salesPerformance = await Sale.aggregate([
    { $match: { ...query, status: { $in: ["completed", "partial_refund"] } } },
    {
      $group: {
        _id: "$seller",
        totalSales: { $sum: 1 },
        totalRevenue: { $sum: "$totals.total" },
        averageSale: { $avg: "$totals.total" },
        voidedSales: {
          $sum: { $cond: [{ $eq: ["$status", "voided"] }, 1, 0] },
        },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    {
      $unwind: {
        path: "$user",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        userName: { $ifNull: ["$user.name", "Unknown"] },
        userRole: { $ifNull: ["$user.role", "N/A"] },
        totalSales: 1,
        totalRevenue: 1,
        averageSale: 1,
        voidedSales: 1,
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  // Get order fulfillment performance
  const orderPerformance = await Order.aggregate([
    { $match: query },
    {
      $group: {
        _id: "$assignedTo",
        totalOrders: { $sum: 1 },
        deliveredOrders: {
          $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
        },
        cancelledOrders: {
          $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
        },
        averageDeliveryTime: {
          $avg: {
            $cond: [
              { $eq: ["$status", "delivered"] },
              { $subtract: ["$delivery.actualDeliveryDate", "$createdAt"] },
              null,
            ],
          },
        },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    {
      $unwind: {
        path: "$user",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        userName: { $ifNull: ["$user.name", "Unknown"] },
        totalOrders: 1,
        deliveredOrders: 1,
        cancelledOrders: 1,
        deliveryRate: {
          $multiply: [{ $divide: ["$deliveredOrders", "$totalOrders"] }, 100],
        },
        averageDeliveryTime: 1,
      },
    },
  ]);

  // Get activity summary
  const activitySummary = await ActivityLog.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        ...(userId && { user: userId }),
      },
    },
    {
      $group: {
        _id: "$user",
        totalActions: { $sum: 1 },
        actionTypes: { $addToSet: "$action" },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    {
      $unwind: {
        path: "$user",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        userName: { $ifNull: ["$user.name", "Unknown"] },
        totalActions: 1,
        uniqueActions: { $size: "$actionTypes" },
        lastActive: { $ifNull: ["$user.lastActive", null] },
      },
    },
  ]);

  res.json({
    success: true,
    data: {
      period: { start, end },
      salesPerformance,
      orderPerformance,
      activitySummary,
    },
  });
});

// @desc    Get customer analytics report
// @route   GET /api/reports/customer-analytics
// @access  Private (Owner/Manager)
const getCustomerAnalytics = asyncHandler(async (req, res, next) => {
  const {
    startDate = new Date(new Date().setMonth(new Date().getMonth() - 3)),
    endDate = new Date(),
  } = req.query;

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Get customer acquisition trend
  const acquisitionTrend = await Customer.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m", date: "$createdAt" },
        },
        newCustomers: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Get customer segments
  const segments = await Customer.getSegments();

  // Get customer lifetime value distribution
  const ltv = await Customer.aggregate([
    {
      $match: { "status.isActive": true },
    },
    {
      $bucket: {
        groupBy: "$statistics.totalSpent",
        boundaries: [0, 10000, 50000, 100000, 500000, Infinity],
        default: "Other",
        output: {
          count: { $sum: 1 },
          avgOrderValue: { $avg: "$statistics.averageOrderValue" },
          avgOrders: { $avg: "$statistics.totalOrders" },
        },
      },
    },
  ]);

  // Get retention metrics
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const retentionData = await Customer.aggregate([
    {
      $facet: {
        totalCustomers: [
          { $match: { createdAt: { $lte: threeMonthsAgo } } },
          { $count: "count" },
        ],
        activeCustomers: [
          {
            $match: {
              createdAt: { $lte: threeMonthsAgo },
              "statistics.lastOrderDate": { $gte: threeMonthsAgo },
            },
          },
          { $count: "count" },
        ],
        churnedCustomers: [
          {
            $match: {
              createdAt: { $lte: threeMonthsAgo },
              $or: [
                { "statistics.lastOrderDate": { $lt: threeMonthsAgo } },
                { "statistics.lastOrderDate": null },
              ],
            },
          },
          { $count: "count" },
        ],
      },
    },
  ]);

  const retention = {
    totalCustomers: retentionData[0].totalCustomers[0]?.count || 0,
    activeCustomers: retentionData[0].activeCustomers[0]?.count || 0,
    churnedCustomers: retentionData[0].churnedCustomers[0]?.count || 0,
  };

  retention.retentionRate =
    retention.totalCustomers > 0
      ? ((retention.activeCustomers / retention.totalCustomers) * 100).toFixed(
          2
        )
      : 0;

  // Get top customers
  const topCustomers = await Customer.find({ "status.isActive": true })
    .select(
      "name phone statistics.totalSpent statistics.totalOrders loyalty.tier"
    )
    .sort("-statistics.totalSpent")
    .limit(10);

  res.json({
    success: true,
    data: {
      period: { start, end },
      acquisition: acquisitionTrend,
      segments,
      lifetimeValue: ltv,
      retention,
      topCustomers,
    },
  });
});

// @desc    Get financial summary report
// @route   GET /api/reports/financial-summary
// @access  Private (Owner only)
const getFinancialSummary = asyncHandler(async (req, res, next) => {
  const {
    startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    endDate = new Date(),
    compareWith = "lastMonth",
  } = req.query;

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Calculate comparison period
  let compareStart, compareEnd;
  const periodLength = end - start;

  if (compareWith === "lastMonth") {
    compareEnd = new Date(start);
    compareEnd.setDate(compareEnd.getDate() - 1);
    compareStart = new Date(compareEnd - periodLength);
  } else if (compareWith === "lastYear") {
    compareStart = new Date(start);
    compareStart.setFullYear(compareStart.getFullYear() - 1);
    compareEnd = new Date(end);
    compareEnd.setFullYear(compareEnd.getFullYear() - 1);
  }

  // Get current period data
  const currentPeriod = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: null,
        revenue: { $sum: "$totals.total" },
        orders: { $sum: 1 },
        tax: { $sum: "$totals.tax" },
        discount: { $sum: "$totals.discount" },
      },
    },
  ]);

  // Get comparison period data
  const comparisonPeriod = compareStart
    ? await Sale.aggregate([
        {
          $match: {
            createdAt: { $gte: compareStart, $lte: compareEnd },
            status: { $in: ["completed", "partial_refund"] },
          },
        },
        {
          $group: {
            _id: null,
            revenue: { $sum: "$totals.total" },
            orders: { $sum: 1 },
            tax: { $sum: "$totals.tax" },
            discount: { $sum: "$totals.discount" },
          },
        },
      ])
    : [];

  // Get expense categories (simplified - in production, this would come from expense tracking)
  const expenses = {
    purchases: 0, // Would calculate from purchase orders
    salaries: 0, // Would come from payroll
    rent: 0, // Fixed costs
    utilities: 0,
    other: 0,
  };

  // Calculate metrics
  const current = currentPeriod[0] || {
    revenue: 0,
    orders: 0,
    tax: 0,
    discount: 0,
  };
  const previous = comparisonPeriod[0] || {
    revenue: 0,
    orders: 0,
    tax: 0,
    discount: 0,
  };

  const metrics = {
    revenue: {
      current: current.revenue,
      previous: previous.revenue,
      change:
        previous.revenue > 0
          ? (
              ((current.revenue - previous.revenue) / previous.revenue) *
              100
            ).toFixed(2)
          : 0,
    },
    orders: {
      current: current.orders,
      previous: previous.orders,
      change:
        previous.orders > 0
          ? (
              ((current.orders - previous.orders) / previous.orders) *
              100
            ).toFixed(2)
          : 0,
    },
    averageOrderValue: {
      current: current.orders > 0 ? current.revenue / current.orders : 0,
      previous: previous.orders > 0 ? previous.revenue / previous.orders : 0,
    },
    profit: {
      current:
        current.revenue - Object.values(expenses).reduce((a, b) => a + b, 0),
      margin:
        current.revenue > 0
          ? (
              ((current.revenue -
                Object.values(expenses).reduce((a, b) => a + b, 0)) /
                current.revenue) *
              100
            ).toFixed(2)
          : 0,
    },
  };

  res.json({
    success: true,
    data: {
      period: { start, end },
      comparisonPeriod: compareStart
        ? { start: compareStart, end: compareEnd }
        : null,
      metrics,
      expenses,
      tax: {
        collected: current.tax,
        rate: 16,
      },
      discounts: {
        total: current.discount,
        average: current.orders > 0 ? current.discount / current.orders : 0,
      },
    },
  });
});

// @desc    Export report to Excel
// @route   POST /api/reports/export/excel
// @access  Private (Owner/Manager)
const exportToExcel = asyncHandler(async (req, res, next) => {
  const { reportType, filters } = req.body;

  // For now, return a simple response
  // In production, you would implement actual Excel export using exceljs
  res.json({
    success: true,
    message: `${reportType} report export initiated`,
    data: {
      reportType,
      filters,
      format: "excel",
    },
  });
});

// @desc    Get dashboard summary
// @route   GET /api/reports/dashboard
// @access  Private
const getDashboardSummary = asyncHandler(async (req, res, next) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Get today's sales
  const todaysSales = await Sale.aggregate([
    {
      $match: {
        createdAt: { $gte: today, $lt: tomorrow },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        revenue: { $sum: "$totals.total" },
      },
    },
  ]);

  // Get pending orders
  const pendingOrders = await Order.countDocuments({
    status: { $in: ["pending", "confirmed", "processing", "ready"] },
  });

  // Get low stock alerts
  const lowStockCount = await Product.countDocuments({
    "status.isActive": true,
    $expr: {
      $lte: ["$inventory.currentStock", "$inventory.minStock"],
    },
  });

  // Get recent activities
  const recentActivities = await ActivityLog.find({
    user: { $ne: null },
  })
    .populate("user", "name")
    .sort("-createdAt")
    .limit(10);

  // Get quick stats
  const quickStats = {
    todaysSales: todaysSales[0] || { count: 0, revenue: 0 },
    pendingOrders,
    lowStockAlerts: lowStockCount,
    activeUsers: await User.countDocuments({
      isActive: true,
      lastActive: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  };

  res.json({
    success: true,
    data: {
      quickStats,
      recentActivities,
    },
  });
});

module.exports = {
  getSalesReport,
  getInventoryReport,
  getStaffPerformance,
  getCustomerAnalytics,
  getFinancialSummary,
  exportToExcel,
  getDashboardSummary,
};
