// backend/src/middleware/validation.js
const { body, param, query, validationResult } = require("express-validator");

// Validation result handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array().map((err) => ({
        field: err.param,
        message: err.msg,
        value: err.value,
      })),
    });
  }

  next();
};

// User validations
const userValidations = {
  register: [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Name is required")
      .isLength({ min: 2, max: 50 })
      .withMessage("Name must be between 2 and 50 characters"),
    body("email")
      .trim()
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),
    body("phone")
      .trim()
      .notEmpty()
      .withMessage("Phone is required")
      .matches(/^(\+254|0)[17]\d{8}$/)
      .withMessage("Invalid Kenyan phone number"),
    body("password")
      .notEmpty()
      .withMessage("Password is required")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("role")
      .optional()
      .isIn(["owner", "operator", "viewer"])
      .withMessage("Invalid role"),
    handleValidationErrors,
  ],

  login: [
    body("email")
      .trim()
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),
    body("password").notEmpty().withMessage("Password is required"),
    handleValidationErrors,
  ],

  pinLogin: [
    body("email")
      .trim()
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),
    body("pin")
      .notEmpty()
      .withMessage("PIN is required")
      .isLength({ min: 4, max: 6 })
      .withMessage("PIN must be 4-6 digits")
      .isNumeric()
      .withMessage("PIN must contain only numbers"),
    handleValidationErrors,
  ],

  updateProfile: [
    body("name")
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage("Name must be between 2 and 50 characters"),
    body("phone")
      .optional()
      .trim()
      .matches(/^(\+254|0)[17]\d{8}$/)
      .withMessage("Invalid Kenyan phone number"),
    body("email")
      .optional()
      .trim()
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),
    handleValidationErrors,
  ],

  changePassword: [
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .notEmpty()
      .withMessage("New password is required")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    handleValidationErrors,
  ],
};

// Product validations
const productValidations = {
  create: [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Product name is required")
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be between 2 and 100 characters"),
    body("category")
      .notEmpty()
      .withMessage("Category is required")
      .isMongoId()
      .withMessage("Invalid category ID"),
    body("unit")
      .notEmpty()
      .withMessage("Unit is required")
      .isIn([
        "piece",
        "kg",
        "g",
        "l",
        "ml",
        "dozen",
        "pack",
        "box",
        "bag",
        "bottle",
        "can",
      ])
      .withMessage("Invalid unit"),
    body("pricing.sellingPrice")
      .notEmpty()
      .withMessage("Selling price is required")
      .isFloat({ min: 0 })
      .withMessage("Selling price must be a positive number"),
    body("inventory.currentStock")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Stock must be a non-negative integer"),
    body("inventory.minStock")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Minimum stock must be a non-negative integer"),
    handleValidationErrors,
  ],

  update: [
    param("id").isMongoId().withMessage("Invalid product ID"),
    body("name")
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be between 2 and 100 characters"),
    body("category").optional().isMongoId().withMessage("Invalid category ID"),
    body("pricing.cost")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Cost must be a positive number"),
    body("pricing.sellingPrice")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Selling price must be a positive number"),
    handleValidationErrors,
  ],

  updateStock: [
    param("id").isMongoId().withMessage("Invalid product ID"),
    body("quantity")
      .notEmpty()
      .withMessage("Quantity is required")
      .isInt()
      .withMessage("Quantity must be an integer"),
    body("type")
      .notEmpty()
      .withMessage("Type is required")
      .isIn(["purchase", "sale", "return", "adjustment", "damage", "transfer"])
      .withMessage("Invalid stock movement type"),
    body("reason")
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage("Reason cannot exceed 200 characters"),
    handleValidationErrors,
  ],
};

// Sale validations
const saleValidations = {
  create: [
    body("items")
      .isArray({ min: 1 })
      .withMessage("At least one item is required"),
    body("items.*.product")
      .notEmpty()
      .withMessage("Product ID is required")
      .isMongoId()
      .withMessage("Invalid product ID"),
    body("items.*.quantity")
      .notEmpty()
      .withMessage("Quantity is required")
      .isInt({ min: 1 })
      .withMessage("Quantity must be at least 1"),
    body("items.*.unitPrice")
      .notEmpty()
      .withMessage("Unit price is required")
      .isFloat({ min: 0 })
      .withMessage("Price must be non-negative"),
    body("payment.method")
      .notEmpty()
      .withMessage("Payment method is required")
      .isIn(["cash", "mpesa", "card", "bank_transfer", "credit", "mixed"])
      .withMessage("Invalid payment method"),
    body("payment.totalPaid")
      .notEmpty()
      .withMessage("Total paid is required")
      .isFloat({ min: 0 })
      .withMessage("Total paid must be non-negative"),
    handleValidationErrors,
  ],

  void: [
    param("id").isMongoId().withMessage("Invalid sale ID"),
    body("reason")
      .notEmpty()
      .withMessage("Reason is required")
      .trim()
      .isLength({ min: 5, max: 200 })
      .withMessage("Reason must be 5-200 characters"),
    handleValidationErrors,
  ],

  refund: [
    param("id").isMongoId().withMessage("Invalid sale ID"),
    body("items")
      .isArray({ min: 1 })
      .withMessage("At least one item to refund is required"),
    body("items.*.productId")
      .notEmpty()
      .withMessage("Product ID is required")
      .isMongoId()
      .withMessage("Invalid product ID"),
    body("items.*.quantity")
      .notEmpty()
      .withMessage("Quantity is required")
      .isInt({ min: 1 })
      .withMessage("Quantity must be at least 1"),
    body("reason")
      .notEmpty()
      .withMessage("Reason is required")
      .trim()
      .isLength({ min: 5, max: 200 })
      .withMessage("Reason must be 5-200 characters"),
    handleValidationErrors,
  ],
};

// Order validations
const orderValidations = {
  create: [
    body("customerInfo.name")
      .trim()
      .notEmpty()
      .withMessage("Customer name is required"),
    body("customerInfo.phone")
      .trim()
      .notEmpty()
      .withMessage("Customer phone is required")
      .matches(/^(\+254|0)[17]\d{8}$/)
      .withMessage("Invalid Kenyan phone number"),
    body("items")
      .isArray({ min: 1 })
      .withMessage("At least one item is required"),
    body("items.*.product")
      .notEmpty()
      .withMessage("Product ID is required")
      .isMongoId()
      .withMessage("Invalid product ID"),
    body("items.*.quantity")
      .notEmpty()
      .withMessage("Quantity is required")
      .isInt({ min: 1 })
      .withMessage("Quantity must be at least 1"),
    body("delivery.type")
      .notEmpty()
      .withMessage("Delivery type is required")
      .isIn(["pickup", "delivery"])
      .withMessage("Invalid delivery type"),
    body("delivery.scheduledDate")
      .notEmpty()
      .withMessage("Scheduled date is required")
      .isISO8601()
      .withMessage("Invalid date format"),
    body("delivery.address")
      .if(body("delivery.type").equals("delivery"))
      .notEmpty()
      .withMessage("Delivery address is required for delivery orders"),
    handleValidationErrors,
  ],

  updateStatus: [
    param("id").isMongoId().withMessage("Invalid order ID"),
    body("status")
      .notEmpty()
      .withMessage("Status is required")
      .isIn([
        "pending",
        "confirmed",
        "processing",
        "ready",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "failed",
      ])
      .withMessage("Invalid status"),
    body("notes")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Notes cannot exceed 500 characters"),
    handleValidationErrors,
  ],
};

// Customer validations
const customerValidations = {
  create: [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Name is required")
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be between 2 and 100 characters"),
    body("phone")
      .trim()
      .notEmpty()
      .withMessage("Phone is required")
      .matches(/^(\+254|0)[17]\d{8}$/)
      .withMessage("Invalid Kenyan phone number"),
    body("email")
      .optional()
      .trim()
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),
    handleValidationErrors,
  ],

  update: [
    param("id").isMongoId().withMessage("Invalid customer ID"),
    body("name")
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be between 2 and 100 characters"),
    body("phone")
      .optional()
      .trim()
      .matches(/^(\+254|0)[17]\d{8}$/)
      .withMessage("Invalid Kenyan phone number"),
    body("email")
      .optional()
      .trim()
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),
    handleValidationErrors,
  ],
};

// Common validations
const commonValidations = {
  mongoId: (paramName = "id") => [
    param(paramName).isMongoId().withMessage(`Invalid ${paramName}`),
    handleValidationErrors,
  ],

  pagination: [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
    query("sort")
      .optional()
      .matches(/^-?\w+$/)
      .withMessage("Invalid sort format"),
    handleValidationErrors,
  ],

  dateRange: [
    query("startDate")
      .optional()
      .isISO8601()
      .withMessage("Invalid start date format"),
    query("endDate")
      .optional()
      .isISO8601()
      .withMessage("Invalid end date format")
      .custom((value, { req }) => {
        if (req.query.startDate && value) {
          return new Date(value) >= new Date(req.query.startDate);
        }
        return true;
      })
      .withMessage("End date must be after start date"),
    handleValidationErrors,
  ],
};

// Category validations
const categoryValidations = {
  create: [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Category name is required")
      .isLength({ min: 2, max: 50 })
      .withMessage("Name must be between 2 and 50 characters"),
    body("description")
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage("Description cannot exceed 200 characters"),
    body("parent")
      .optional()
      .isMongoId()
      .withMessage("Invalid parent category ID"),
    handleValidationErrors,
  ],
};

// Settings validations
const settingsValidations = {
  update: [
    body("business.name")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("Business name cannot be empty"),
    body("business.contact.phone")
      .optional()
      .trim()
      .matches(/^(\+254|0)[17]\d{8}$/)
      .withMessage("Invalid phone number"),
    body("sales.tax.rate")
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage("Tax rate must be between 0 and 100"),
    body("currency.code")
      .optional()
      .isLength({ min: 3, max: 3 })
      .withMessage("Currency code must be 3 characters"),
    handleValidationErrors,
  ],
};

module.exports = {
  handleValidationErrors,
  userValidations,
  productValidations,
  saleValidations,
  orderValidations,
  customerValidations,
  commonValidations,
  categoryValidations,
  settingsValidations,
};
