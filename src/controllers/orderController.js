// backend/src/controllers/orderController.js
const Order = require("../models/Order");
const Product = require("../models/Product");
const Customer = require("../models/Customer");
const Settings = require("../models/Settings");
const ActivityLog = require("../models/ActivityLog");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const { activityLogger } = require("../middleware/logger");

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const createOrder = asyncHandler(async (req, res, next) => {
  const { customerInfo, items, delivery, payment, notes, priority } = req.body;

  // Validate items and check stock
  const validatedItems = [];
  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product) {
      return next(new AppError(`Product not found`, 404));
    }

    if (!product.status.isActive) {
      return next(
        new AppError(`Product ${product.name} is not available`, 400)
      );
    }

    // Check stock availability
    if (
      product.inventory.trackInventory &&
      product.inventory.currentStock < item.quantity &&
      !product.inventory.allowBackorder
    ) {
      return next(
        new AppError(
          `Insufficient stock for ${product.name}. Available: ${product.inventory.currentStock}`,
          400
        )
      );
    }

    validatedItems.push({
      ...item,
      product: product._id,
      productName: product.name,
      unitPrice: item.unitPrice || product.effectivePrice,
    });
  }

  // Get delivery fee from settings
  const settings = await Settings.getSettings();
  let deliveryFee = 0;

  if (delivery.type === "delivery") {
    deliveryFee = settings.calculateDeliveryFee(
      delivery.address?.area || "default"
    );
  }

  // Check or create customer
  let customerId = null;
  if (customerInfo.phone) {
    const existingCustomer = await Customer.findOne({
      phone: customerInfo.phone,
    });
    if (existingCustomer) {
      customerId = existingCustomer._id;
      // Update customer info if needed
      if (customerInfo.name && customerInfo.name !== existingCustomer.name) {
        existingCustomer.name = customerInfo.name;
      }
      if (customerInfo.email && customerInfo.email !== existingCustomer.email) {
        existingCustomer.email = customerInfo.email;
      }
      await existingCustomer.save();
    } else {
      // Create new customer
      const newCustomer = await Customer.create({
        name: customerInfo.name,
        phone: customerInfo.phone,
        email: customerInfo.email,
        metadata: {
          source: "order",
          createdBy: req.user._id,
        },
      });
      customerId = newCustomer._id;
    }
  }

  // Create order
  const order = new Order({
    customer: customerId,
    customerInfo,
    items: validatedItems,
    delivery: {
      ...delivery,
      deliveryFee,
    },
    payment: payment || { method: "cash", status: "pending" },
    priority: priority || "normal",
    notes,
    source: "pos",
    createdBy: req.user._id,
    assignedTo: req.user._id,
  });

  await order.save();

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "order.created",
    entity: {
      type: "order",
      id: order._id,
      name: order.orderNumber,
    },
    details: {
      total: order.totals.total,
      items: order.items.length,
      deliveryType: order.delivery.type,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  activityLogger.logOrder(order, req.user);

  res.status(201).json({
    success: true,
    message: "Order created successfully",
    data: order,
  });
});

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private
const getOrders = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    sort = "-createdAt",
    status,
    priority,
    deliveryType,
    deliveryDate,
    customer,
    assignedTo,
    search,
  } = req.query;

  // Build query
  const query = {};

  if (status) {
    query.status = Array.isArray(status) ? { $in: status } : status;
  }

  if (priority) {
    query.priority = priority;
  }

  if (deliveryType) {
    query["delivery.type"] = deliveryType;
  }

  if (deliveryDate) {
    const date = new Date(deliveryDate);
    const startOfDay = new Date(date.setHours(0, 0, 0, 0));
    const endOfDay = new Date(date.setHours(23, 59, 59, 999));
    query["delivery.scheduledDate"] = {
      $gte: startOfDay,
      $lte: endOfDay,
    };
  }

  if (customer) {
    query.customer = customer;
  }

  if (assignedTo) {
    query.assignedTo = assignedTo;
  }

  if (search) {
    query.$or = [
      { orderNumber: new RegExp(search, "i") },
      { "customerInfo.name": new RegExp(search, "i") },
      { "customerInfo.phone": new RegExp(search, "i") },
    ];
  }

  // Execute query
  const orders = await Order.find(query)
    .populate("customer", "name phone")
    .populate("createdBy", "name")
    .populate("assignedTo", "name")
    .populate("items.product", "name sku")
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Order.countDocuments(query);

  res.json({
    success: true,
    data: orders,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      limit: parseInt(limit),
    },
  });
});

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
const getOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id)
    .populate("customer", "name phone email addresses")
    .populate("createdBy", "name email")
    .populate("assignedTo", "name email phone")
    .populate("items.product", "name sku barcode category")
    .populate("statusHistory.updatedBy", "name");

  if (!order) {
    return next(new AppError("Order not found", 404));
  }

  res.json({
    success: true,
    data: order,
  });
});

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private
const updateOrderStatus = asyncHandler(async (req, res, next) => {
  const { status, notes, location } = req.body;
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError("Order not found", 404));
  }

  // Validate status transition
  const validTransitions = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["processing", "cancelled"],
    processing: ["ready", "cancelled"],
    ready: ["out_for_delivery", "delivered", "cancelled"],
    out_for_delivery: ["delivered", "failed"],
    delivered: [],
    cancelled: [],
    failed: ["out_for_delivery", "cancelled"],
  };

  if (!validTransitions[order.status].includes(status)) {
    return next(
      new AppError(
        `Cannot change status from ${order.status} to ${status}`,
        400
      )
    );
  }

  // Update status
  await order.updateStatus(status, req.user._id, notes, location);

  // Handle stock updates for cancellation
  if (status === "cancelled") {
    // Don't update stock for orders as they haven't been fulfilled yet
    // Stock is only reduced when order is delivered
  }

  // Handle stock updates for delivery
  if (status === "delivered") {
    // Reduce stock for delivered items
    for (const item of order.items) {
      const product = await Product.findById(item.product);
      if (product && product.inventory.trackInventory) {
        await product.updateStock(
          item.quantity,
          "sale",
          order.orderNumber,
          req.user._id,
          "Order delivered"
        );
      }
    }

    // Update customer statistics
    if (order.customer) {
      const customer = await Customer.findById(order.customer);
      if (customer) {
        await customer.updateOrderStatistics(order.totals.total);
      }
    }
  }

  // Send notification if configured
  if (settings.notifications.sms.enabled) {
    // Send SMS notification based on status
    await order.sendNotification(
      "sms",
      `Your order ${order.orderNumber} is now ${status}`
    );
  }

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "order.status_changed",
    entity: {
      type: "order",
      id: order._id,
      name: order.orderNumber,
    },
    details: {
      previous: { status: order.status },
      current: { status },
      notes,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Order status updated successfully",
    data: order,
  });
});

// @desc    Update order details
// @route   PUT /api/orders/:id
// @access  Private
const updateOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError("Order not found", 404));
  }

  // Don't allow updates to delivered or cancelled orders
  if (["delivered", "cancelled"].includes(order.status)) {
    return next(
      new AppError("Cannot update delivered or cancelled orders", 400)
    );
  }

  const allowedUpdates = [
    "customerInfo",
    "delivery",
    "priority",
    "notes",
    "assignedTo",
  ];

  // Only update allowed fields
  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) {
      order[field] = req.body[field];
    }
  });

  await order.save();

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "order.updated",
    entity: {
      type: "order",
      id: order._id,
      name: order.orderNumber,
    },
    details: {
      changes: Object.keys(req.body),
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Order updated successfully",
    data: order,
  });
});

// @desc    Assign order to delivery person
// @route   PUT /api/orders/:id/assign
// @access  Private (Owner/Manager)
const assignOrder = asyncHandler(async (req, res, next) => {
  const { userId } = req.body;
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError("Order not found", 404));
  }

  if (order.status !== "ready") {
    return next(
      new AppError("Order must be ready before assigning for delivery", 400)
    );
  }

  await order.assignToDeliveryPerson(userId);

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "order.assigned",
    entity: {
      type: "order",
      id: order._id,
      name: order.orderNumber,
    },
    details: {
      assignedTo: userId,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Order assigned successfully",
    data: order,
  });
});

// @desc    Get pending orders
// @route   GET /api/orders/pending
// @access  Private
const getPendingOrders = asyncHandler(async (req, res, next) => {
  const orders = await Order.getPendingOrders();

  res.json({
    success: true,
    data: orders,
    total: orders.length,
  });
});

// @desc    Get delivery queue
// @route   GET /api/orders/delivery-queue
// @access  Private
const getDeliveryQueue = asyncHandler(async (req, res, next) => {
  const { date = new Date() } = req.query;

  const orders = await Order.getDeliveryQueue(new Date(date));

  res.json({
    success: true,
    data: orders,
    total: orders.length,
  });
});

// @desc    Get order metrics
// @route   GET /api/orders/metrics
// @access  Private (Owner/Manager)
const getOrderMetrics = asyncHandler(async (req, res, next) => {
  const {
    startDate = new Date(new Date().setDate(new Date().getDate() - 30)),
    endDate = new Date(),
  } = req.query;

  const metrics = await Order.getOrderMetrics(
    new Date(startDate),
    new Date(endDate)
  );

  res.json({
    success: true,
    data: metrics[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      averageOrderValue: 0,
      deliveredOrders: 0,
      cancelledOrders: 0,
      averageDeliveryTime: 0,
    },
  });
});

// @desc    Record order payment
// @route   POST /api/orders/:id/payment
// @access  Private
const recordOrderPayment = asyncHandler(async (req, res, next) => {
  const { amount, method, reference } = req.body;
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError("Order not found", 404));
  }

  await order.recordPayment(amount, method, reference, req.user._id);

  res.json({
    success: true,
    message: "Payment recorded successfully",
    data: {
      orderNumber: order.orderNumber,
      paymentStatus: order.payment.status,
      balance: order.paymentBalance,
    },
  });
});

// @desc    Cancel order
// @route   POST /api/orders/:id/cancel
// @access  Private
const cancelOrder = asyncHandler(async (req, res, next) => {
  const { reason } = req.body;
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new AppError("Order not found", 404));
  }

  if (["delivered", "cancelled"].includes(order.status)) {
    return next(new AppError("Cannot cancel this order", 400));
  }

  order.status = "cancelled";
  order.cancellation = {
    cancelledBy: req.user._id,
    cancelledAt: new Date(),
    reason,
  };

  await order.save();

  // Send notification
  if (order.customer) {
    await order.sendNotification(
      "sms",
      `Your order ${order.orderNumber} has been cancelled. Reason: ${reason}`
    );
  }

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "order.cancelled",
    entity: {
      type: "order",
      id: order._id,
      name: order.orderNumber,
    },
    severity: "warning",
    details: {
      reason,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Order cancelled successfully",
    data: order,
  });
});

module.exports = {
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
};
