// backend/src/controllers/customerController.js
const Customer = require("../models/Customer");
const Sale = require("../models/Sale");
const Order = require("../models/Order");
const ActivityLog = require("../models/ActivityLog");
const { asyncHandler, AppError } = require("../middleware/errorHandler");

// @desc    Get all customers
// @route   GET /api/customers
// @access  Private
const getCustomers = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    sort = "-createdAt",
    search,
    tier,
    status,
    hasCredit,
    tags,
  } = req.query;

  // Build query
  const query = {};

  // Search by name, phone, or email
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  // Filter by loyalty tier
  if (tier) {
    query["loyalty.tier"] = tier;
  }

  // Filter by status
  if (status !== undefined) {
    query["status.isActive"] = status === "active";
  }

  // Filter by credit status
  if (hasCredit !== undefined) {
    query["credit.isEnabled"] = hasCredit === "true";
  }

  // Filter by tags
  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : [tags];
    query.tags = { $in: tagArray };
  }

  // Execute query
  const customers = await Customer.find(query)
    .populate("metadata.createdBy", "name")
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Customer.countDocuments(query);

  res.json({
    success: true,
    data: customers,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      limit: parseInt(limit),
    },
  });
});

// @desc    Get single customer
// @route   GET /api/customers/:id
// @access  Private
const getCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id)
    .populate("metadata.createdBy", "name")
    .populate("metadata.referredBy", "name")
    .populate("notes.createdBy", "name")
    .populate("credit.transactions.recordedBy", "name");

  if (!customer) {
    return next(new AppError("Customer not found", 404));
  }

  // Get recent orders
  const recentOrders = await Order.find({ customer: customer._id })
    .select("orderNumber status totals.total createdAt")
    .sort("-createdAt")
    .limit(5);

  // Get recent sales
  const recentSales = await Sale.find({ customer: customer._id })
    .select("receiptNumber totals.total createdAt")
    .sort("-createdAt")
    .limit(5);

  res.json({
    success: true,
    data: {
      customer,
      recentOrders,
      recentSales,
    },
  });
});

// @desc    Create customer
// @route   POST /api/customers
// @access  Private
const createCustomer = asyncHandler(async (req, res, next) => {
  // Check if customer with phone already exists
  const existingCustomer = await Customer.findOne({ phone: req.body.phone });

  if (existingCustomer) {
    return next(
      new AppError("Customer with this phone number already exists", 400)
    );
  }

  // Add metadata
  req.body.metadata = {
    ...req.body.metadata,
    createdBy: req.user._id,
  };

  const customer = await Customer.create(req.body);

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "customer.created",
    entity: {
      type: "customer",
      id: customer._id,
      name: customer.name,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.status(201).json({
    success: true,
    message: "Customer created successfully",
    data: customer,
  });
});

// @desc    Update customer
// @route   PUT /api/customers/:id
// @access  Private
const updateCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    return next(new AppError("Customer not found", 404));
  }

  // Check if phone number is being changed to an existing one
  if (req.body.phone && req.body.phone !== customer.phone) {
    const phoneExists = await Customer.findOne({
      phone: req.body.phone,
      _id: { $ne: customer._id },
    });

    if (phoneExists) {
      return next(new AppError("Phone number already in use", 400));
    }
  }

  // Track changes for activity log
  const previousData = customer.toObject();

  // Don't allow direct updates to statistics or loyalty points
  delete req.body.statistics;
  delete req.body.loyalty?.points;
  delete req.body.credit?.transactions;

  // Update customer
  Object.assign(customer, req.body);
  await customer.save();

  // Log activity with changes
  await ActivityLog.logChange(
    req.user._id,
    "customer.updated",
    {
      type: "customer",
      id: customer._id,
      name: customer.name,
    },
    previousData,
    customer.toObject()
  );

  res.json({
    success: true,
    message: "Customer updated successfully",
    data: customer,
  });
});

// @desc    Delete customer (soft delete)
// @route   DELETE /api/customers/:id
// @access  Private (Owner only)
const deleteCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    return next(new AppError("Customer not found", 404));
  }

  // Check if customer has pending orders or credit balance
  const pendingOrders = await Order.countDocuments({
    customer: customer._id,
    status: { $in: ["pending", "confirmed", "processing", "ready"] },
  });

  if (pendingOrders > 0) {
    return next(
      new AppError("Cannot delete customer with pending orders", 400)
    );
  }

  if (customer.credit.used > 0) {
    return next(
      new AppError("Cannot delete customer with outstanding credit", 400)
    );
  }

  // Soft delete
  customer.status.isActive = false;
  await customer.save();

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "customer.deleted",
    entity: {
      type: "customer",
      id: customer._id,
      name: customer.name,
    },
    severity: "warning",
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Customer deleted successfully",
  });
});

// @desc    Add customer note
// @route   POST /api/customers/:id/notes
// @access  Private
const addNote = asyncHandler(async (req, res, next) => {
  const { content, isImportant } = req.body;
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    return next(new AppError("Customer not found", 404));
  }

  await customer.addNote(content, req.user._id, isImportant);

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "customer.note_added",
    entity: {
      type: "customer",
      id: customer._id,
      name: customer.name,
    },
    details: {
      noteContent: content.substring(0, 100),
      isImportant,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Note added successfully",
    data: customer.notes[customer.notes.length - 1],
  });
});

// @desc    Update customer credit
// @route   PUT /api/customers/:id/credit
// @access  Private (Owner/Manager)
const updateCredit = asyncHandler(async (req, res, next) => {
  const { isEnabled, limit } = req.body;
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    return next(new AppError("Customer not found", 404));
  }

  // Update credit settings
  if (isEnabled !== undefined) {
    customer.credit.isEnabled = isEnabled;
  }

  if (limit !== undefined) {
    if (limit < customer.credit.used) {
      return next(
        new AppError("Credit limit cannot be less than amount used", 400)
      );
    }
    customer.credit.limit = limit;
  }

  await customer.save();

  res.json({
    success: true,
    message: "Credit settings updated successfully",
    data: {
      credit: customer.credit,
      availableCredit: customer.availableCredit,
    },
  });
});

// @desc    Add credit transaction
// @route   POST /api/customers/:id/credit-transaction
// @access  Private
const addCreditTransaction = asyncHandler(async (req, res, next) => {
  const { type, amount, reference } = req.body;
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    return next(new AppError("Customer not found", 404));
  }

  try {
    await customer.addCreditTransaction(type, amount, reference, req.user._id);

    // Log activity
    await ActivityLog.log({
      user: req.user._id,
      action: "customer.credit_transaction",
      entity: {
        type: "customer",
        id: customer._id,
        name: customer.name,
      },
      details: {
        type,
        amount,
        reference,
        newBalance: customer.credit.used,
      },
      metadata: {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      },
    });

    res.json({
      success: true,
      message: "Credit transaction recorded successfully",
      data: {
        credit: customer.credit,
        availableCredit: customer.availableCredit,
      },
    });
  } catch (error) {
    return next(new AppError(error.message, 400));
  }
});

// @desc    Get customer purchase history
// @route   GET /api/customers/:id/purchases
// @access  Private
const getPurchaseHistory = asyncHandler(async (req, res, next) => {
  const { startDate, endDate, page = 1, limit = 20 } = req.query;
  const customer = await Customer.findById(req.params.id);

  if (!customer) {
    return next(new AppError("Customer not found", 404));
  }

  // Build query
  const query = { customer: customer._id };

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  // Get sales
  const sales = await Sale.find(query)
    .select("receiptNumber totals.total createdAt items")
    .populate("items.product", "name")
    .sort("-createdAt")
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const totalSales = await Sale.countDocuments(query);

  // Get orders
  const orders = await Order.find(query)
    .select("orderNumber totals.total createdAt status")
    .sort("-createdAt")
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const totalOrders = await Order.countDocuments(query);

  res.json({
    success: true,
    data: {
      sales: {
        data: sales,
        total: totalSales,
      },
      orders: {
        data: orders,
        total: totalOrders,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
      },
    },
  });
});

// @desc    Get customer segments
// @route   GET /api/customers/segments
// @access  Private (Owner/Manager)
const getSegments = asyncHandler(async (req, res, next) => {
  const segments = await Customer.getSegments();

  // Get additional segment data
  const segmentDetails = await Promise.all(
    segments.map(async (segment) => {
      const topCustomers = await Customer.find({ "loyalty.tier": segment._id })
        .select("name phone statistics.totalSpent")
        .sort("-statistics.totalSpent")
        .limit(5);

      return {
        ...segment,
        topCustomers,
      };
    })
  );

  res.json({
    success: true,
    data: segmentDetails,
  });
});

// @desc    Search customers by location
// @route   GET /api/customers/nearby
// @access  Private
const getNearbyCustomers = asyncHandler(async (req, res, next) => {
  const { latitude, longitude, maxDistance = 5000 } = req.query;

  if (!latitude || !longitude) {
    return next(new AppError("Latitude and longitude are required", 400));
  }

  const customers = await Customer.findByLocation(
    [parseFloat(longitude), parseFloat(latitude)],
    parseInt(maxDistance)
  );

  res.json({
    success: true,
    data: customers,
    total: customers.length,
  });
});

// @desc    Get customers with birthdays
// @route   GET /api/customers/birthdays
// @access  Private
const getCustomersWithBirthdays = asyncHandler(async (req, res, next) => {
  const { month = new Date().getMonth() + 1 } = req.query;

  const customers = await Customer.aggregate([
    {
      $match: {
        "status.isActive": true,
        $expr: {
          $eq: [{ $month: "$metadata.birthday" }, parseInt(month)],
        },
      },
    },
    {
      $project: {
        name: 1,
        phone: 1,
        email: 1,
        "loyalty.tier": 1,
        birthday: "$metadata.birthday",
        dayOfMonth: { $dayOfMonth: "$metadata.birthday" },
      },
    },
    {
      $sort: { dayOfMonth: 1 },
    },
  ]);

  res.json({
    success: true,
    data: customers,
    month: parseInt(month),
  });
});

// @desc    Export customers
// @route   GET /api/customers/export
// @access  Private (Owner/Manager)
const exportCustomers = asyncHandler(async (req, res, next) => {
  const { format = "csv", fields } = req.query;

  // Get all active customers
  const customers = await Customer.find({ "status.isActive": true })
    .select(
      fields || "name phone email loyalty.tier statistics.totalSpent createdAt"
    )
    .lean();

  // In production, this would generate actual CSV/Excel file
  // For now, return the data
  res.json({
    success: true,
    message: `Export ready in ${format} format`,
    data: {
      format,
      count: customers.length,
      customers:
        process.env.NODE_ENV === "development" ? customers.slice(0, 10) : [],
    },
  });
});

module.exports = {
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
};
