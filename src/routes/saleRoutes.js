// backend/src/routes/saleRoutes.js
const router = require("express").Router();
const {
  createSale,
  getSales,
  getSale,
  voidSale,
  refundSale,
  getDailySummary,
  getSalesReport,
  printReceipt,
  quickSale,
  getSalesByProduct,
  getPendingPayments,
  recordPayment,
  initiateMpesaPayment,
  checkMpesaPaymentStatus,
  mpesaCallback,
} = require("../controllers/saleController");

const {
  authenticate,
  authorize,
  checkPermission,
} = require("../middleware/auth");

const {
  saleValidations,
  commonValidations,
} = require("../middleware/validation");

const { transactionLimiter } = require("../middleware/rateLimiter");

// M-Pesa callback route (must be BEFORE authentication)
router.post("/mpesa/callback", mpesaCallback);

// All routes require authentication
router.use(authenticate);

// Sale creation routes
router.post(
  "/",
  checkPermission("sales", "create"),
  transactionLimiter,
  saleValidations.create,
  createSale
);
router.post(
  "/quick-sale",
  checkPermission("sales", "create"),
  transactionLimiter,
  quickSale
);

// Sale listing and reporting routes
router.get(
  "/",
  checkPermission("sales", "read"),
  commonValidations.pagination,
  commonValidations.dateRange,
  getSales
);
router.get("/daily-summary", checkPermission("sales", "read"), getDailySummary);
router.get(
  "/report",
  checkPermission("reports", "view"),
  commonValidations.dateRange,
  getSalesReport
);
router.get(
  "/pending-payments",
  checkPermission("sales", "read"),
  getPendingPayments
);
router.get(
  "/by-product/:productId",
  checkPermission("sales", "read"),
  commonValidations.mongoId("productId"),
  getSalesByProduct
);

// Individual sale routes
router.get(
  "/:id",
  checkPermission("sales", "read"),
  commonValidations.mongoId("id"),
  getSale
);
router.get(
  "/:id/receipt",
  checkPermission("sales", "read"),
  commonValidations.mongoId("id"),
  printReceipt
);

// Sale modification routes (restricted)
router.post(
  "/:id/void",
  checkPermission("sales", "void"),
  commonValidations.mongoId("id"),
  saleValidations.void,
  voidSale
);
router.post(
  "/:id/refund",
  checkPermission("sales", "void"),
  commonValidations.mongoId("id"),
  saleValidations.refund,
  refundSale
);
router.post(
  "/:id/payment",
  checkPermission("sales", "create"),
  commonValidations.mongoId("id"),
  recordPayment
);

// M-Pesa payment routes (these need authentication)
router.post("/mpesa/initiate", initiateMpesaPayment);
router.get("/mpesa/status/:checkoutRequestId", checkMpesaPaymentStatus);

module.exports = router;
