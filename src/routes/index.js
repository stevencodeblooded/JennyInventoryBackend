// backend/src/routes/index.js
const router = require("express").Router();

// Import all route modules
const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const productRoutes = require("./productRoutes");
const saleRoutes = require("./saleRoutes");
const orderRoutes = require("./orderRoutes");
const customerRoutes = require("./customerRoutes");
const reportRoutes = require("./reportRoutes");

// Dashboard routes (created inline as they're simple)
const dashboardController = require("../controllers/dashboardController");
const { authenticate, checkPermission } = require("../middleware/auth");

// Health check route (public)
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "JennySaleFlow API is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// API version info (public)
router.get("/version", (req, res) => {
  res.json({
    success: true,
    version: process.env.npm_package_version || "1.0.0",
    api: "v1",
  });
});

// Mount route modules
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/products", productRoutes);
router.use("/sales", saleRoutes);
router.use("/orders", orderRoutes);
router.use("/customers", customerRoutes);
router.use("/reports", reportRoutes);

// Dashboard routes (protected)
router.use("/dashboard", authenticate);
router.get("/dashboard/overview", dashboardController.getOverview);
router.get("/dashboard/realtime", dashboardController.getRealtimeStats);
router.get("/dashboard/sales-chart", dashboardController.getSalesChart);
router.get("/dashboard/top-products", dashboardController.getTopProducts);
router.get("/dashboard/low-stock", dashboardController.getLowStockAlerts);
router.get(
  "/dashboard/performance",
  checkPermission("reports", "view"),
  dashboardController.getPerformanceMetrics
);
router.get("/dashboard/notifications", dashboardController.getNotifications);

// Activity routes (protected)
const activityController = require("../controllers/activityController");
router.use("/activities", authenticate);
router.get(
  "/activities",
  checkPermission("users", "manage"),
  activityController.getActivities
);
router.get(
  "/activities/summary",
  checkPermission("users", "manage"),
  activityController.getActivitySummary
);
router.get(
  "/activities/user/:userId",
  activityController.getUserActivitySummary
);
router.get(
  "/activities/security",
  checkPermission("users", "manage"),
  activityController.getSecurityEvents
);
router.get(
  "/activities/stats",
  checkPermission("users", "manage"),
  activityController.getActivityStats
);
router.post(
  "/activities/export",
  checkPermission("reports", "export"),
  activityController.exportActivities
);

// Category routes (protected)
const Category = require("../models/Category");
const { asyncHandler } = require("../middleware/errorHandler");

router.use("/categories", authenticate);

router.get(
  "/categories",
  checkPermission("products", "read"),
  asyncHandler(async (req, res) => {
    const categories = await Category.find({ isActive: true })
      .populate("parent", "name")
      .sort("displayOrder name");

    res.json({
      success: true,
      data: categories,
    });
  })
);

router.get(
  "/categories/tree",
  checkPermission("products", "read"),
  asyncHandler(async (req, res) => {
    const tree = await Category.getCategoryTree();

    res.json({
      success: true,
      data: tree,
    });
  })
);

router.post(
  "/categories",
  checkPermission("products", "create"),
  asyncHandler(async (req, res) => {
    req.body.metadata = { createdBy: req.user._id };
    const category = await Category.create(req.body);

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });
  })
);

router.put(
  "/categories/:id",
  checkPermission("products", "update"),
  asyncHandler(async (req, res) => {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.json({
      success: true,
      message: "Category updated successfully",
      data: category,
    });
  })
);

// Settings routes (protected)
const Settings = require("../models/Settings");

router.use("/settings", authenticate);

router.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const settings = await Settings.getSettings();

    // Filter settings based on user role
    if (req.user.role !== "owner") {
      // Remove sensitive settings for non-owners
      delete settings.security;
      delete settings.integrations;
      delete settings.notifications.email.settings;
      delete settings.notifications.sms.settings;
    }

    res.json({
      success: true,
      data: settings,
    });
  })
);

router.put(
  "/settings",
  checkPermission("users", "manage"),
  asyncHandler(async (req, res) => {
    const settings = await Settings.updateSettings(req.body, req.user._id);

    res.json({
      success: true,
      message: "Settings updated successfully",
      data: settings,
    });
  })
);

// Catch-all route for undefined endpoints
router.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

module.exports = router;
