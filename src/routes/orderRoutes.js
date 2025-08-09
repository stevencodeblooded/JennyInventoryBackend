// backend/src/routes/orderRoutes.js
const router = require("express").Router();
const {
  createOrder,
  getOrders,
  getOrder,
  updateOrderStatus,
  updateOrder,
  assignOrder,
  getPendingOrders,
  getDeliveryQueue,
  getOrderMetrics,
  recordOrderPayment,
  cancelOrder,
} = require("../controllers/orderController");

const {
  authenticate,
  authorize,
  checkPermission,
} = require("../middleware/auth");

const {
  orderValidations,
  commonValidations,
} = require("../middleware/validation");

const { transactionLimiter } = require("../middleware/rateLimiter");

// All routes require authentication
router.use(authenticate);

// Order creation and listing routes
router.post(
  "/",
  checkPermission("orders", "create"),
  transactionLimiter,
  orderValidations.create,
  createOrder
);
router.get(
  "/",
  checkPermission("orders", "read"),
  commonValidations.pagination,
  getOrders
);
router.get("/pending", checkPermission("orders", "read"), getPendingOrders);
router.get(
  "/delivery-queue",
  checkPermission("orders", "read"),
  getDeliveryQueue
);
router.get(
  "/metrics",
  checkPermission("reports", "view"),
  commonValidations.dateRange,
  getOrderMetrics
);

// Individual order routes
router.get(
  "/:id",
  checkPermission("orders", "read"),
  commonValidations.mongoId("id"),
  getOrder
);
router.put(
  "/:id",
  checkPermission("orders", "update"),
  commonValidations.mongoId("id"),
  updateOrder
);

// Order status and assignment routes
router.put(
  "/:id/status",
  checkPermission("orders", "update"),
  commonValidations.mongoId("id"),
  orderValidations.updateStatus,
  updateOrderStatus
);
router.put(
  "/:id/assign",
  authorize("owner", "manager"),
  commonValidations.mongoId("id"),
  assignOrder
);

// Order payment and cancellation
router.post(
  "/:id/payment",
  checkPermission("orders", "update"),
  commonValidations.mongoId("id"),
  recordOrderPayment
);
router.post(
  "/:id/cancel",
  checkPermission("orders", "update"),
  commonValidations.mongoId("id"),
  cancelOrder
);

module.exports = router;
