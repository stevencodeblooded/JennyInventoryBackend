// backend/src/controllers/productController.js
const Product = require("../models/Product");
const Category = require("../models/Category");
const ActivityLog = require("../models/ActivityLog");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const { activityLogger } = require("../middleware/logger");

// @desc    Get all products
// @route   GET /api/products
// @access  Private
const getProducts = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    sort = "-createdAt",
    search,
    category,
    status,
    minPrice,
    maxPrice,
    inStock,
    lowStock,
  } = req.query;

  // Build query
  const query = {};

  // Search by name or barcode
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { barcode: search },
      { sku: search },
    ];
  }

  // Filter by category
  if (category) {
    query.category = category;
  }

  // Filter by status
  if (status) {
    query["status.isActive"] = status === "active";
  }

  // Filter by price range
  if (minPrice || maxPrice) {
    query["pricing.sellingPrice"] = {};
    if (minPrice) query["pricing.sellingPrice"].$gte = parseFloat(minPrice);
    if (maxPrice) query["pricing.sellingPrice"].$lte = parseFloat(maxPrice);
  }

  // Filter by stock status
  if (inStock === "true") {
    query["inventory.currentStock"] = { $gt: 0 };
  } else if (inStock === "false") {
    query["inventory.currentStock"] = 0;
  }

  // Filter low stock items
  if (lowStock === "true") {
    query.$expr = {
      $lte: ["$inventory.currentStock", "$inventory.minStock"],
    };
  }

  // Execute query with pagination
  const products = await Product.find(query)
    .populate("category", "name")
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit);

  // Get total count
  const total = await Product.countDocuments(query);

  res.json({
    success: true,
    data: products,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      limit: parseInt(limit),
    },
  });
});

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Private
const getProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id)
    .populate("category", "name")
    .populate("metadata.createdBy", "name")
    .populate("stockMovements.performedBy", "name");

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  res.json({
    success: true,
    data: product,
  });
});

// @desc    Create product
// @route   POST /api/products
// @access  Private (Owner/Operator with permission)
const createProduct = asyncHandler(async (req, res, next) => {
  // Add creator info
  req.body.metadata = {
    ...req.body.metadata,
    createdBy: req.user._id,
  };

  const product = await Product.create(req.body);

  // Update category product count
  const category = await Category.findById(product.category);
  if (category) {
    await category.updateProductCount();
  }

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "product.created",
    entity: {
      type: "product",
      id: product._id,
      name: product.name,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  activityLogger.logInventoryChange(
    product,
    {
      type: "create",
      quantity: product.inventory.currentStock,
    },
    req.user
  );

  res.status(201).json({
    success: true,
    message: "Product created successfully",
    data: product,
  });
});

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private (Owner/Operator with permission)
const updateProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  // Track changes for activity log
  const previousData = product.toObject();

  // Don't allow direct stock updates through this endpoint
  delete req.body.inventory?.currentStock;
  delete req.body.stockMovements;

  // Update metadata
  req.body.metadata = {
    ...product.metadata,
    updatedBy: req.user._id,
  };

  // Update product
  Object.assign(product, req.body);
  await product.save();

  // Update category product count if category changed
  if (
    req.body.category &&
    req.body.category !== previousData.category.toString()
  ) {
    const oldCategory = await Category.findById(previousData.category);
    const newCategory = await Category.findById(req.body.category);

    if (oldCategory) await oldCategory.updateProductCount();
    if (newCategory) await newCategory.updateProductCount();
  }

  // Log activity with changes
  await ActivityLog.logChange(
    req.user._id,
    "product.updated",
    {
      type: "product",
      id: product._id,
      name: product.name,
    },
    previousData,
    product.toObject()
  );

  res.json({
    success: true,
    message: "Product updated successfully",
    data: product,
  });
});

// @desc    Update product stock
// @route   PUT /api/products/:id/stock
// @access  Private
const updateStock = asyncHandler(async (req, res, next) => {
  const { quantity, type, reference, reason } = req.body;
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  try {
    // Update stock using the model method
    await product.updateStock(quantity, type, reference, req.user._id, reason);

    // Log activity
    await ActivityLog.log({
      user: req.user._id,
      action: "product.stock_adjusted",
      entity: {
        type: "product",
        id: product._id,
        name: product.name,
      },
      details: {
        current: {
          type,
          quantity,
          newStock: product.inventory.currentStock,
          reason,
        },
      },
      metadata: {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      },
    });

    activityLogger.logInventoryChange(product, { type, quantity }, req.user);

    res.json({
      success: true,
      message: "Stock updated successfully",
      data: {
        productId: product._id,
        productName: product.name,
        previousStock:
          product.stockMovements[product.stockMovements.length - 1]
            .previousStock,
        newStock: product.inventory.currentStock,
        movement: {
          type,
          quantity,
          reason,
        },
      },
    });
  } catch (error) {
    return next(new AppError(error.message, 400));
  }
});

// @desc    Delete product (soft delete)
// @route   DELETE /api/products/:id
// @access  Private (Owner only)
const deleteProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  // Soft delete
  product.status.isActive = false;
  product.status.isDiscontinued = true;
  product.status.discontinuedDate = new Date();
  product.status.reason = req.body.reason || "Deleted by user";
  product.metadata.updatedBy = req.user._id;

  await product.save();

  // Update category product count
  const category = await Category.findById(product.category);
  if (category) {
    await category.updateProductCount();
  }

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "product.deleted",
    entity: {
      type: "product",
      id: product._id,
      name: product.name,
    },
    severity: "warning",
    details: {
      reason: product.status.reason,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: "Product deleted successfully",
  });
});

// @desc    Get low stock products
// @route   GET /api/products/low-stock
// @access  Private
const getLowStockProducts = asyncHandler(async (req, res, next) => {
  const products = await Product.findLowStock();

  res.json({
    success: true,
    data: products,
    total: products.length,
  });
});

// @desc    Get out of stock products
// @route   GET /api/products/out-of-stock
// @access  Private
const getOutOfStockProducts = asyncHandler(async (req, res, next) => {
  const products = await Product.findOutOfStock();

  res.json({
    success: true,
    data: products,
    total: products.length,
  });
});

// @desc    Get inventory value
// @route   GET /api/products/inventory-value
// @access  Private (Owner/Operator with permission)
const getInventoryValue = asyncHandler(async (req, res, next) => {
  const value = await Product.calculateInventoryValue();

  res.json({
    success: true,
    data: {
      ...value,
      potentialProfit: value.totalRetailValue - value.totalValue,
    },
  });
});

// @desc    Bulk update products
// @route   PUT /api/products/bulk-update
// @access  Private (Owner only)
const bulkUpdateProducts = asyncHandler(async (req, res, next) => {
  const { productIds, updates } = req.body;

  if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
    return next(new AppError("Product IDs are required", 400));
  }

  // Allowed fields for bulk update
  const allowedUpdates = ["category", "status.isActive", "pricing.discount"];
  const updateData = {};

  Object.keys(updates).forEach((key) => {
    if (allowedUpdates.includes(key)) {
      updateData[key] = updates[key];
    }
  });

  updateData["metadata.updatedBy"] = req.user._id;

  // Perform bulk update
  const result = await Product.updateMany(
    { _id: { $in: productIds } },
    { $set: updateData }
  );

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "product.bulk_updated",
    entity: {
      type: "product",
      name: "Multiple products",
    },
    details: {
      productCount: result.modifiedCount,
      updates: updateData,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: `${result.modifiedCount} products updated successfully`,
    data: {
      matched: result.matchedCount,
      modified: result.modifiedCount,
    },
  });
});

// @desc    Import products from CSV/Excel
// @route   POST /api/products/import
// @access  Private (Owner/Operator with permission)
const importProducts = asyncHandler(async (req, res, next) => {
  // This would handle file upload and parsing
  // For now, expecting products array in body
  const { products } = req.body;

  if (!products || !Array.isArray(products)) {
    return next(new AppError("Products array is required", 400));
  }

  const importBatch = `IMPORT_${Date.now()}`;
  const results = {
    success: [],
    failed: [],
  };

  for (const productData of products) {
    try {
      // Add metadata
      productData.metadata = {
        createdBy: req.user._id,
        importBatch,
      };

      // Create product
      const product = await Product.create(productData);
      results.success.push({
        name: product.name,
        sku: product.sku,
      });
    } catch (error) {
      results.failed.push({
        data: productData,
        error: error.message,
      });
    }
  }

  // Log activity
  await ActivityLog.log({
    user: req.user._id,
    action: "product.imported",
    entity: {
      type: "product",
      name: "Bulk import",
    },
    details: {
      importBatch,
      total: products.length,
      success: results.success.length,
      failed: results.failed.length,
    },
    metadata: {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  res.json({
    success: true,
    message: `Import completed. ${results.success.length} products imported successfully.`,
    data: results,
  });
});

// @desc    Get product performance metrics
// @route   GET /api/products/:id/performance
// @access  Private
const getProductPerformance = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  // Calculate additional metrics
  const metrics = {
    basic: {
      totalSold: product.performance.totalSold,
      totalRevenue: product.performance.totalRevenue,
      averageDailySales: product.performance.averageDailySales,
      lastSoldDate: product.performance.lastSoldDate,
      turnoverRate: product.performance.turnoverRate,
    },
    inventory: {
      currentStock: product.inventory.currentStock,
      stockValue: product.getStockValue(),
      daysOfStock: product.getDaysOfStock(),
      stockStatus: product.stockStatus,
    },
    profitability: {
      unitCost: product.pricing.cost,
      unitPrice: product.pricing.sellingPrice,
      profitMargin: product.profitMargin,
      totalProfit:
        product.performance.totalRevenue -
        product.performance.totalSold * product.pricing.cost,
    },
  };

  res.json({
    success: true,
    data: metrics,
  });
});

module.exports = {
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
};
