// backend/src/routes/reportRoutes.js
const router = require("express").Router();
const {
  getSalesReport,
  getInventoryReport,
  getStaffPerformance,
  getCustomerAnalytics,
  getFinancialSummary,
  exportToExcel,
  getDashboardSummary,
} = require("../controllers/reportController");

const {
  authenticate,
  authorize,
  checkPermission,
} = require("../middleware/auth");

const { commonValidations } = require("../middleware/validation");

const {
  reportLimiter,
  expensiveReportLimiter,
} = require("../middleware/rateLimiter");

// All routes require authentication and report viewing permission
router.use(authenticate);
router.use(checkPermission("reports", "view"));

// Dashboard summary (available to all with report permission)
router.get("/dashboard", getDashboardSummary);

// Standard reports
router.get(
  "/sales",
  reportLimiter,
  commonValidations.dateRange,
  getSalesReport
);
router.get("/inventory", reportLimiter, getInventoryReport);
router.get(
  "/customer-analytics",
  reportLimiter,
  commonValidations.dateRange,
  getCustomerAnalytics
);

// Restricted reports (Owner/Manager only)
router.get(
  "/staff-performance",
  authorize("owner", "manager"),
  reportLimiter,
  commonValidations.dateRange,
  getStaffPerformance
);
router.get(
  "/financial-summary",
  authorize("owner"),
  expensiveReportLimiter,
  commonValidations.dateRange,
  getFinancialSummary
);

// Export functionality (requires export permission)
router.post(
  "/export/excel",
  checkPermission("reports", "export"),
  reportLimiter,
  exportToExcel
);

module.exports = router;
