// backend/src/routes/userRoutes.js
const router = require("express").Router();
const {
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
} = require("../controllers/userController");

const {
  authenticate,
  authorize,
  checkPermission,
} = require("../middleware/auth");

const {
  userValidations,
  commonValidations,
} = require("../middleware/validation");

// All routes require authentication
router.use(authenticate);

// User management routes (Owner/Manager only)
router.get(
  "/",
  checkPermission("users", "manage"),
  commonValidations.pagination,
  getUsers
);
router.put("/bulk-update", authorize("owner"), bulkUpdateUsers);

// Individual user routes
router.get("/:id", commonValidations.mongoId("id"), getUser);
router.put(
  "/:id",
  checkPermission("users", "manage"),
  commonValidations.mongoId("id"),
  updateUser
);
router.delete(
  "/:id",
  authorize("owner"),
  commonValidations.mongoId("id"),
  deleteUser
);

// User permission and security routes
router.put(
  "/:id/permissions",
  authorize("owner"),
  commonValidations.mongoId("id"),
  updatePermissions
);
router.post(
  "/:id/reset-password",
  checkPermission("users", "manage"),
  commonValidations.mongoId("id"),
  resetUserPassword
);

// User activity and performance routes
router.get(
  "/:id/activity",
  commonValidations.mongoId("id"),
  commonValidations.pagination,
  getUserActivity
);
router.get(
  "/:id/performance",
  commonValidations.mongoId("id"),
  getUserPerformance
);
router.get(
  "/:id/login-history",
  commonValidations.mongoId("id"),
  getLoginHistory
);

module.exports = router;
