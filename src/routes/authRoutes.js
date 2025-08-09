// backend/src/routes/authRoutes.js
const router = require("express").Router();
const {
  register,
  login,
  pinLogin,
  refreshAccessToken,
  logout,
  logoutAll,
  getMe,
  updateProfile,
  changePassword,
  setPin,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");

const {
  authenticate,
  authorize,
  verifyRefreshToken,
  sensitiveOperationLimit,
} = require("../middleware/auth");

const { userValidations } = require("../middleware/validation");

const {
  authLimiter,
  passwordResetLimiter,
} = require("../middleware/rateLimiter");

// Public routes
router.post("/login", authLimiter, userValidations.login, login);
router.post("/pin-login", authLimiter, userValidations.pinLogin, pinLogin);
router.post("/refresh", verifyRefreshToken, refreshAccessToken);
router.post("/forgot-password", passwordResetLimiter, forgotPassword);
router.put(
  "/reset-password/:token",
  passwordResetLimiter,
  userValidations.changePassword,
  resetPassword
);

// Protected routes
router.use(authenticate); // All routes below require authentication

router.post(
  "/register",
  authorize("owner"),
  userValidations.register,
  register
);
router.post("/logout", logout);
router.post("/logout-all", logoutAll);
router.get("/me", getMe);
router.put("/profile", userValidations.updateProfile, updateProfile);
router.put(
  "/change-password",
  sensitiveOperationLimit(),
  userValidations.changePassword,
  changePassword
);
router.put("/set-pin", sensitiveOperationLimit(), setPin);

module.exports = router;
