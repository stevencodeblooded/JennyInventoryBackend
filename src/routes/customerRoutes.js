// backend/src/routes/customerRoutes.js
const router = require("express").Router();
const {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  addNote,
  updateCredit,
  addCreditTransaction,
  getPurchaseHistory,
  getSegments,
  getNearbyCustomers,
  getCustomersWithBirthdays,
  exportCustomers,
} = require("../controllers/customerController");

const {
  authenticate,
  authorize,
  checkPermission,
} = require("../middleware/auth");

const {
  customerValidations,
  commonValidations,
} = require("../middleware/validation");

// All routes require authentication
router.use(authenticate);

// Customer listing and search routes
router.get(
  "/",
  checkPermission("orders", "read"),
  commonValidations.pagination,
  getCustomers
);
router.get("/segments", checkPermission("reports", "view"), getSegments);
router.get("/nearby", checkPermission("orders", "read"), getNearbyCustomers);
router.get(
  "/birthdays",
  checkPermission("orders", "read"),
  getCustomersWithBirthdays
);
router.get("/export", checkPermission("reports", "export"), exportCustomers);

// Individual customer routes
router.get(
  "/:id",
  checkPermission("orders", "read"),
  commonValidations.mongoId("id"),
  getCustomer
);
router.post(
  "/",
  checkPermission("orders", "create"),
  customerValidations.create,
  createCustomer
);
router.put(
  "/:id",
  checkPermission("orders", "update"),
  commonValidations.mongoId("id"),
  customerValidations.update,
  updateCustomer
);
router.delete(
  "/:id",
  authorize("owner"),
  commonValidations.mongoId("id"),
  deleteCustomer
);

// Customer interaction routes
router.post(
  "/:id/notes",
  checkPermission("orders", "update"),
  commonValidations.mongoId("id"),
  addNote
);
router.get(
  "/:id/purchases",
  checkPermission("orders", "read"),
  commonValidations.mongoId("id"),
  commonValidations.dateRange,
  getPurchaseHistory
);

// Credit management routes (restricted)
router.put(
  "/:id/credit",
  authorize("owner", "manager"),
  commonValidations.mongoId("id"),
  updateCredit
);
router.post(
  "/:id/credit-transaction",
  checkPermission("orders", "update"),
  commonValidations.mongoId("id"),
  addCreditTransaction
);

module.exports = router;
