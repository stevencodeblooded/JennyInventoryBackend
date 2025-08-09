// backend/src/routes/productRoutes.js
const router = require("express").Router();
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  updateStock,
  deleteProduct,
  getLowStockProducts,
  getOutOfStockProducts,
  getInventoryValue,
  bulkUpdateProducts,
  importProducts,
  getProductPerformance,
} = require("../controllers/productController");

const {
  authenticate,
  authorize,
  checkPermission,
} = require("../middleware/auth");

const {
  productValidations,
  commonValidations,
} = require("../middleware/validation");

const { uploadLimiter } = require("../middleware/rateLimiter");

// All routes require authentication
router.use(authenticate);

// Product listing routes
router.get(
  "/",
  checkPermission("products", "read"),
  commonValidations.pagination,
  getProducts
);
router.get(
  "/low-stock",
  checkPermission("products", "read"),
  getLowStockProducts
);
router.get(
  "/out-of-stock",
  checkPermission("products", "read"),
  getOutOfStockProducts
);
router.get(
  "/inventory-value",
  checkPermission("reports", "view"),
  getInventoryValue
);

// Bulk operations (Owner/Manager only)
router.put("/bulk-update", authorize("owner"), bulkUpdateProducts);
router.post(
  "/import",
  checkPermission("products", "create"),
  uploadLimiter,
  importProducts
);

// Individual product routes
router.get(
  "/:id",
  checkPermission("products", "read"),
  commonValidations.mongoId("id"),
  getProduct
);
router.post(
  "/",
  checkPermission("products", "create"),
  productValidations.create,
  createProduct
);
router.put(
  "/:id",
  checkPermission("products", "update"),
  commonValidations.mongoId("id"),
  productValidations.update,
  updateProduct
);
router.delete(
  "/:id",
  checkPermission("products", "delete"),
  commonValidations.mongoId("id"),
  deleteProduct
);

// Stock management
router.put(
  "/:id/stock",
  checkPermission("products", "update"),
  commonValidations.mongoId("id"),
  productValidations.updateStock,
  updateStock
);

// Performance metrics
router.get(
  "/:id/performance",
  checkPermission("reports", "view"),
  commonValidations.mongoId("id"),
  getProductPerformance
);

module.exports = router;
