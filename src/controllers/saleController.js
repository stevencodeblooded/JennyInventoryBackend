// backend/src/controllers/saleController.js
const Sale = require("../models/Sale");
const Product = require("../models/Product");
const Customer = require("../models/Customer");
const ActivityLog = require("../models/ActivityLog");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const { activityLogger } = require("../middleware/logger");

// @desc    Create a new sale
// @route   POST /api/sales
// @access  Private
const createSale = asyncHandler(async (req, res, next) => {
  const { items, customer, customerInfo, payment } = req.body;

  // Validate stock availability
  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product) {
      return next(new AppError(`Product ${item.product} not found`, 404));
    }

    if (!product.status.isActive) {
      return next(
        new AppError(`Product ${product.name} is not available`, 400)
      );
    }

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

    // Add product name and current price to item
    item.productName = product.name;
    item.unitPrice = item.unitPrice || product.effectivePrice;
  }

  // Create sale
  const sale = new Sale({
    items,
    customer,
    customerInfo,
    payment,
    seller: req.user._id,
    metadata: {
      source: "pos",
      device: req.get("user-agent"),
    },
  });

  await sale.save();

  // Update product stock and sales data
  for (const item of sale.items) {
    const product = await Product.findById(item.product);

    if (product.inventory.trackInventory) {
      await product.updateStock(
        item.quantity,
        "sale",
        sale.receiptNumber,
        req.user._id
      );
    }
  }

  // Update customer statistics if customer exists
  if (customer) {
    const customerDoc = await Customer.findById(customer);
    if (customerDoc) {
      await customerDoc.updateOrderStatistics(sale.totals.total);

      // Add to favorite products
      for (const item of sale.items) {
        const favoriteIndex = customerDoc.statistics.favoriteProducts.findIndex(
          (fp) => fp.product.toString() === item.product.toString()
        );

        if (favoriteIndex > -1) {
          customerDoc.statistics.favoriteProducts[favoriteIndex].count +=
            item.quantity;
        } else {
          customerDoc.statistics.favoriteProducts.push({
            product: item.product,
            count: item.quantity,
          });
        }
      }

      await customerDoc.save();
    }
  }

  // Populate product details for response
  await sale.populate("items.product", "name sku category");

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "sale.created",
    entity: {
      type: "sale",
      id: sale._id,
      name: sale.receiptNumber,
    },
    details: {
      total: sale.totals.total,
      items: sale.items.length,
      paymentMethod: sale.payment.method,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  activityLogger.logSale(sale, req.user);

  res.status(201).json({
    success: true,
    message: "Sale completed successfully",
    data: sale,
  });
});

// @desc    Get all sales
// @route   GET /api/sales
// @access  Private
const getSales = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    sort = "-createdAt",
    startDate,
    endDate,
    seller,
    paymentMethod,
    status,
    minAmount,
    maxAmount,
    customer,
    receiptNumber,
  } = req.query;

  // Build query
  const query = {};

  // Date range filter
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  // Other filters
  if (seller) query.seller = seller;
  if (paymentMethod) query["payment.method"] = paymentMethod;
  if (status) query.status = status;
  if (customer) query.customer = customer;
  if (receiptNumber) query.receiptNumber = new RegExp(receiptNumber, "i");

  // Amount range filter
  if (minAmount || maxAmount) {
    query["totals.total"] = {};
    if (minAmount) query["totals.total"].$gte = parseFloat(minAmount);
    if (maxAmount) query["totals.total"].$lte = parseFloat(maxAmount);
  }

  // Role-based filtering
  if (req.user.role === "operator") {
    // Operators can only see their own sales
    query.seller = req.user._id;
  }

  // Execute query
  const sales = await Sale.find(query)
    .populate("seller", "name")
    .populate("customer", "name phone")
    .populate("items.product", "name sku")
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Sale.countDocuments(query);

  res.json({
    success: true,
    data: sales,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      limit: parseInt(limit),
    },
  });
});

// @desc    Get single sale
// @route   GET /api/sales/:id
// @access  Private
const getSale = asyncHandler(async (req, res, next) => {
  const sale = await Sale.findById(req.params.id)
    .populate("seller", "name email")
    .populate("customer", "name phone email")
    .populate("items.product", "name sku category barcode")
    .populate("voidInfo.voidedBy", "name")
    .populate("refundInfo.refundedBy", "name");

  if (!sale) {
    return next(new AppError("Sale not found", 404));
  }

  // Check access rights
  if (
    req.user.role === "operator" &&
    sale.seller.toString() !== req.user._id.toString()
  ) {
    return next(new AppError("You do not have access to this sale", 403));
  }

  res.json({
    success: true,
    data: sale,
  });
});

// @desc    Void a sale
// @route   POST /api/sales/:id/void
// @access  Private (Owner/Operator with permission)
const voidSale = asyncHandler(async (req, res, next) => {
  const { reason } = req.body;
  const sale = await Sale.findById(req.params.id);

  if (!sale) {
    return next(new AppError("Sale not found", 404));
  }

  try {
    await sale.void(req.user._id, reason);

    // Log activity
    await ActivityLog.log({
      user: req.user._id,
      action: "sale.voided",
      entity: {
        type: "sale",
        id: sale._id,
        name: sale.receiptNumber,
      },
      severity: "warning",
      details: {
        reason,
        total: sale.totals.total,
      },
      metadata: {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      },
    });

    res.json({
      success: true,
      message: "Sale voided successfully",
      data: sale,
    });
  } catch (error) {
    return next(new AppError(error.message, 400));
  }
});

// @desc    Refund sale items
// @route   POST /api/sales/:id/refund
// @access  Private (Owner/Operator with permission)
const refundSale = asyncHandler(async (req, res, next) => {
  const { items, reason } = req.body;
  const sale = await Sale.findById(req.params.id);

  if (!sale) {
    return next(new AppError("Sale not found", 404));
  }

  try {
    await sale.refund(req.user._id, items, reason);

    // Update customer statistics if applicable
    if (sale.customer) {
      const customer = await Customer.findById(sale.customer);
      if (customer) {
        const refundAmount = sale.refundInfo.totalRefunded;
        customer.statistics.totalSpent -= refundAmount;
        customer.statistics.averageOrderValue =
          customer.statistics.totalSpent / customer.statistics.totalOrders;
        await customer.save();
      }
    }

    // Log activity
    await ActivityLog.log({
      user: req.user._id,
      action: "sale.refunded",
      entity: {
        type: "sale",
        id: sale._id,
        name: sale.receiptNumber,
      },
      severity: "warning",
      details: {
        reason,
        refundAmount: sale.refundInfo.totalRefunded,
        items: items.length,
      },
      metadata: {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      },
    });

    res.json({
      success: true,
      message: "Refund processed successfully",
      data: sale,
    });
  } catch (error) {
    return next(new AppError(error.message, 400));
  }
});

// @desc    Get daily sales summary
// @route   GET /api/sales/daily-summary
// @access  Private
const getDailySummary = asyncHandler(async (req, res, next) => {
  const { date = new Date() } = req.query;

  const summary = await Sale.getDailySales(new Date(date));

  // Get sales by payment method
  const salesByPayment = await Sale.aggregate([
    {
      $match: {
        createdAt: {
          $gte: new Date(new Date(date).setHours(0, 0, 0, 0)),
          $lte: new Date(new Date(date).setHours(23, 59, 59, 999)),
        },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: "$payment.method",
        count: { $sum: 1 },
        total: { $sum: "$totals.total" },
      },
    },
  ]);

  res.json({
    success: true,
    data: {
      date: new Date(date).toISOString().split("T")[0],
      summary: summary[0] || {
        totalSales: 0,
        totalRevenue: 0,
        totalDiscount: 0,
        totalTax: 0,
        averageSale: 0,
      },
      paymentMethods: salesByPayment,
    },
  });
});

// @desc    Get sales report
// @route   GET /api/sales/report
// @access  Private (Owner/Operator with permission)
const getSalesReport = asyncHandler(async (req, res, next) => {
  const {
    startDate = new Date(new Date().setDate(new Date().getDate() - 30)),
    endDate = new Date(),
    groupBy = "day", // day, week, month
  } = req.query;

  const dateFormat = {
    day: "%Y-%m-%d",
    week: "%Y-W%V",
    month: "%Y-%m",
  };

  const report = await Sale.aggregate([
    {
      $match: {
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: dateFormat[groupBy],
            date: "$createdAt",
          },
        },
        sales: { $sum: 1 },
        revenue: { $sum: "$totals.total" },
        discount: { $sum: "$totals.discount" },
        tax: { $sum: "$totals.tax" },
        items: { $sum: { $size: "$items" } },
      },
    },
    {
      $sort: { _id: 1 },
    },
    {
      $project: {
        period: "$_id",
        sales: 1,
        revenue: 1,
        discount: 1,
        tax: 1,
        items: 1,
        averageSale: { $divide: ["$revenue", "$sales"] },
      },
    },
  ]);

  // Get top products for the period
  const topProducts = await Sale.getTopProducts(
    new Date(startDate),
    new Date(endDate),
    10
  );

  // Get sales by seller
  const salesBySeller = await Sale.getSalesBySeller(
    new Date(startDate),
    new Date(endDate)
  );

  res.json({
    success: true,
    data: {
      period: {
        start: startDate,
        end: endDate,
      },
      summary: {
        totalSales: report.reduce((sum, r) => sum + r.sales, 0),
        totalRevenue: report.reduce((sum, r) => sum + r.revenue, 0),
        totalDiscount: report.reduce((sum, r) => sum + r.discount, 0),
        totalTax: report.reduce((sum, r) => sum + r.tax, 0),
      },
      timeline: report,
      topProducts,
      salesBySeller,
    },
  });
});

// @desc    Print receipt
// @route   GET /api/sales/:id/receipt
// @access  Private
const printReceipt = asyncHandler(async (req, res, next) => {
  const sale = await Sale.findById(req.params.id)
    .populate("seller", "name")
    .populate("customer", "name phone")
    .populate("items.product", "name sku");

  if (!sale) {
    return next(new AppError("Sale not found", 404));
  }

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "sale.receipt_printed",
    entity: {
      type: "sale",
      id: sale._id,
      name: sale.receiptNumber,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  // In production, this would generate a PDF or format for thermal printer
  res.json({
    success: true,
    data: {
      receipt: sale,
      printFormat: "thermal", // or 'pdf'
    },
  });
});

// @desc    Quick sale (simplified sale creation)
// @route   POST /api/sales/quick-sale
// @access  Private
const quickSale = asyncHandler(async (req, res, next) => {
  const { items, paymentAmount } = req.body;

  // Validate and prepare items
  const saleItems = [];
  let total = 0;

  for (const item of items) {
    const product = await Product.findById(item.product);

    if (!product) {
      return next(new AppError(`Product not found`, 404));
    }

    if (
      product.inventory.trackInventory &&
      product.inventory.currentStock < item.quantity
    ) {
      return next(new AppError(`Insufficient stock for ${product.name}`, 400));
    }

    const saleItem = {
      product: item.product,
      productName: product.name,
      quantity: item.quantity,
      unitPrice: product.effectivePrice,
      discount: {
        amount: 0,
        percentage: 0,
      },
      tax: {
        rate: 16,
        amount: 0,
      },
      subtotal: 0,
    };

    saleItems.push(saleItem);
    total += saleItem.unitPrice * saleItem.quantity;
  }

  // Create sale with cash payment
  const sale = new Sale({
    items: saleItems,
    payment: {
      method: "cash",
      status: "paid",
      totalPaid: paymentAmount,
      change: paymentAmount - total,
      details: [
        {
          method: "cash",
          amount: paymentAmount,
        },
      ],
    },
    seller: req.user._id,
    metadata: {
      source: "pos",
      device: "quick-sale",
    },
  });

  await sale.save();

  // Update stock
  for (const item of sale.items) {
    const product = await Product.findById(item.product);
    if (product.inventory.trackInventory) {
      await product.updateStock(
        item.quantity,
        "sale",
        sale.receiptNumber,
        req.user._id
      );
    }
  }

  res.status(201).json({
    success: true,
    message: "Quick sale completed",
    data: {
      receiptNumber: sale.receiptNumber,
      total: sale.totals.total,
      change: sale.payment.change,
      items: sale.items.length,
    },
  });
});

// @desc    Get sales by product
// @route   GET /api/sales/by-product/:productId
// @access  Private
const getSalesByProduct = asyncHandler(async (req, res, next) => {
  const { productId } = req.params;
  const { startDate, endDate } = req.query;

  const query = {
    "items.product": productId,
    status: { $in: ["completed", "partial_refund"] },
  };

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const sales = await Sale.find(query)
    .select("receiptNumber createdAt items totals")
    .sort("-createdAt")
    .limit(100);

  // Calculate product-specific metrics
  const productSales = sales.map((sale) => {
    const productItems = sale.items.filter(
      (item) => item.product.toString() === productId
    );

    return {
      saleId: sale._id,
      receiptNumber: sale.receiptNumber,
      date: sale.createdAt,
      quantity: productItems.reduce((sum, item) => sum + item.quantity, 0),
      revenue: productItems.reduce((sum, item) => sum + item.subtotal, 0),
    };
  });

  const summary = {
    totalQuantitySold: productSales.reduce((sum, s) => sum + s.quantity, 0),
    totalRevenue: productSales.reduce((sum, s) => sum + s.revenue, 0),
    numberOfSales: productSales.length,
  };

  res.json({
    success: true,
    data: {
      summary,
      sales: productSales,
    },
  });
});

// @desc    Get pending payments
// @route   GET /api/sales/pending-payments
// @access  Private
const getPendingPayments = asyncHandler(async (req, res, next) => {
  const sales = await Sale.find({
    "payment.status": { $in: ["pending", "partial"] },
  })
    .populate("customer", "name phone")
    .populate("seller", "name")
    .sort("-createdAt");

  const summary = sales.reduce(
    (acc, sale) => {
      const pending = sale.totals.total - sale.payment.totalPaid;
      acc.totalPending += pending;
      acc.count += 1;
      return acc;
    },
    { totalPending: 0, count: 0 }
  );

  res.json({
    success: true,
    data: {
      summary,
      sales,
    },
  });
});

// @desc    Record payment for pending sale
// @route   POST /api/sales/:id/payment
// @access  Private
const recordPayment = asyncHandler(async (req, res, next) => {
  const { amount, method, reference } = req.body;
  const sale = await Sale.findById(req.params.id);

  if (!sale) {
    return next(new AppError("Sale not found", 404));
  }

  if (sale.payment.status === "paid") {
    return next(new AppError("Sale is already fully paid", 400));
  }

  // Add payment detail
  sale.payment.details.push({
    method,
    amount,
    reference,
    transactionId: reference,
  });

  // Update total paid
  sale.payment.totalPaid += amount;

  // Update payment status
  if (sale.payment.totalPaid >= sale.totals.total) {
    sale.payment.status = "paid";
    sale.payment.change = sale.payment.totalPaid - sale.totals.total;
  } else {
    sale.payment.status = "partial";
  }

  await sale.save();

  // Update customer credit if applicable
  if (sale.customer && method === "credit") {
    const customer = await Customer.findById(sale.customer);
    if (customer) {
      await customer.addCreditTransaction(
        "payment",
        amount,
        sale.receiptNumber,
        req.user._id
      );
    }
  }

  res.json({
    success: true,
    message: "Payment recorded successfully",
    data: {
      receiptNumber: sale.receiptNumber,
      totalPaid: sale.payment.totalPaid,
      balance: sale.totals.total - sale.payment.totalPaid,
      paymentStatus: sale.payment.status,
    },
  });
});

module.exports = {
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
};
