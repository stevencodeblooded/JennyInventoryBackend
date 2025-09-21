// backend/src/models/Product.js
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      minlength: [2, "Product name must be at least 2 characters"],
      maxlength: [100, "Product name cannot exceed 100 characters"],
    },
    barcode: {
      type: String,
      unique: true,
      sparse: true, // Allows null values while maintaining uniqueness
      trim: true,
    },
    sku: {
      type: String,
      unique: true,
      required: [true, "SKU is required"],
      uppercase: true,
      trim: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
    },
    subcategory: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    brand: {
      type: String,
      trim: true,
    },
    unit: {
      type: String,
      required: [true, "Unit of measurement is required"],
      enum: [
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
      ],
      default: "piece",
    },
    pricing: {
      sellingPrice: {
        type: Number,
        required: [true, "Selling price is required"],
        min: [0, "Selling price cannot be negative"],
      },
      wholesalePrice: {
        type: Number,
        min: [0, "Wholesale price cannot be negative"],
      },
      discount: {
        type: Number,
        min: [0, "Discount cannot be negative"],
        max: [100, "Discount cannot exceed 100%"],
        default: 0,
      },
      tax: {
        type: Number,
        min: [0, "Tax cannot be negative"],
        max: [100, "Tax cannot exceed 100%"],
        default: 16, // Kenya VAT
      },
    },
    inventory: {
      currentStock: {
        type: Number,
        required: [true, "Current stock is required"],
        min: [0, "Stock cannot be negative"],
        default: 0,
      },
      minStock: {
        type: Number,
        required: [true, "Minimum stock level is required"],
        min: [0, "Minimum stock cannot be negative"],
        default: 10,
      },
      maxStock: {
        type: Number,
        min: [0, "Maximum stock cannot be negative"],
      },
      reorderPoint: {
        type: Number,
        min: [0, "Reorder point cannot be negative"],
      },
      reorderQuantity: {
        type: Number,
        min: [0, "Reorder quantity cannot be negative"],
      },
      trackInventory: {
        type: Boolean,
        default: true,
      },
      allowBackorder: {
        type: Boolean,
        default: false,
      },
    },
    stockMovements: [
      {
        type: {
          type: String,
          enum: [
            "purchase",
            "sale",
            "return",
            "adjustment",
            "damage",
            "transfer",
          ],
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
        },
        previousStock: {
          type: Number,
          required: true,
        },
        newStock: {
          type: Number,
          required: true,
        },
        reference: {
          type: String, // Reference to sale, purchase order, etc.
        },
        reason: String,
        performedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    supplier: {
      name: String,
      contact: String,
      lastPurchaseDate: Date,
      lastPurchasePrice: Number,
    },
    images: [
      {
        url: String,
        alt: String,
        isPrimary: {
          type: Boolean,
          default: false,
        },
      },
    ],
    attributes: [
      {
        name: String,
        value: String,
      },
    ],
    status: {
      isActive: {
        type: Boolean,
        default: true,
      },
      isDiscontinued: {
        type: Boolean,
        default: false,
      },
      discontinuedDate: Date,
      reason: String,
    },
    performance: {
      totalSold: {
        type: Number,
        default: 0,
      },
      totalRevenue: {
        type: Number,
        default: 0,
      },
      averageDailySales: {
        type: Number,
        default: 0,
      },
      lastSoldDate: Date,
      turnoverRate: {
        type: Number,
        default: 0,
      },
    },
    metadata: {
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      importBatch: String,
      customFields: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better query performance
productSchema.index({ name: "text", description: "text" });
productSchema.index({ barcode: 1 });
productSchema.index({ sku: 1 });
productSchema.index({ category: 1, subcategory: 1 });
productSchema.index({ "status.isActive": 1 });
productSchema.index({ "inventory.currentStock": 1 });
productSchema.index({ "pricing.sellingPrice": 1 });
productSchema.index({ createdAt: -1 });

// Virtual for profit margin
productSchema.virtual("profitMargin").get(function () {
  if (this.pricing.cost === 0) return 100;
  return (
    ((this.pricing.sellingPrice - this.pricing.cost) / this.pricing.cost) *
    100
  ).toFixed(2);
});

// Virtual for stock status
productSchema.virtual("stockStatus").get(function () {
  const { currentStock, minStock } = this.inventory;

  if (currentStock === 0) return "out_of_stock";
  if (currentStock <= minStock) return "low_stock";
  if (currentStock > minStock * 3) return "overstock";
  return "in_stock";
});

// Virtual for effective price (after discount)
productSchema.virtual("effectivePrice").get(function () {
  const discount = this.pricing.discount || 0;
  return this.pricing.sellingPrice * (1 - discount / 100);
});

// Method to update stock
productSchema.methods.updateStock = async function (
  quantity,
  type,
  reference,
  userId,
  reason = null
) {
  const previousStock = this.inventory.currentStock;
  let newStock = previousStock;

  switch (type) {
    case "sale":
    case "damage":
    case "transfer":
      newStock = previousStock - quantity;
      break;
    case "purchase":
    case "return":
    case "adjustment":
      newStock = previousStock + quantity;
      break;
  }

  if (newStock < 0 && !this.inventory.allowBackorder) {
    throw new Error("Insufficient stock");
  }

  this.inventory.currentStock = newStock;

  // Record stock movement
  this.stockMovements.push({
    type,
    quantity,
    previousStock,
    newStock,
    reference,
    reason,
    performedBy: userId,
  });

  // Keep only last 100 stock movements
  if (this.stockMovements.length > 100) {
    this.stockMovements = this.stockMovements.slice(-100);
  }

  // Update performance metrics
  if (type === "sale") {
    this.performance.totalSold += quantity;
    this.performance.totalRevenue += quantity * this.effectivePrice;
    this.performance.lastSoldDate = new Date();
  }

  await this.save();
  return this;
};

// Method to check if product needs reorder
productSchema.methods.needsReorder = function () {
  const { currentStock, reorderPoint, minStock } = this.inventory;
  const triggerPoint = reorderPoint || minStock;
  return currentStock <= triggerPoint;
};

// Method to calculate stock value
productSchema.methods.getStockValue = function () {
  return this.inventory.currentStock * this.pricing.cost;
};

// Method to calculate days of stock remaining
productSchema.methods.getDaysOfStock = function () {
  if (this.performance.averageDailySales === 0) return Infinity;
  return Math.floor(
    this.inventory.currentStock / this.performance.averageDailySales
  );
};

// Static method to find low stock products
productSchema.statics.findLowStock = function () {
  return this.find({
    "status.isActive": true,
    $expr: {
      $lte: ["$inventory.currentStock", "$inventory.minStock"],
    },
  }).populate("category");
};

// Static method to find out of stock products
productSchema.statics.findOutOfStock = function () {
  return this.find({
    "status.isActive": true,
    "inventory.currentStock": 0,
  }).populate("category");
};

// Static method to calculate inventory value
productSchema.statics.calculateInventoryValue = async function () {
  const result = await this.aggregate([
    {
      $match: { "status.isActive": true },
    },
    {
      $group: {
        _id: null,
        totalValue: {
          $sum: { $multiply: ["$inventory.currentStock", "$pricing.cost"] },
        },
        totalRetailValue: {
          $sum: {
            $multiply: ["$inventory.currentStock", "$pricing.sellingPrice"],
          },
        },
        totalItems: { $sum: "$inventory.currentStock" },
      },
    },
  ]);

  return result[0] || { totalValue: 0, totalRetailValue: 0, totalItems: 0 };
};

// Pre-save middleware to update SKU if not provided
productSchema.pre("save", function (next) {
  if (!this.sku && this.isNew) {
    // Generate SKU from category and timestamp
    this.sku = `PRD${Date.now().toString(36).toUpperCase()}`;
  }
  next();
});

// Pre-save middleware to update performance metrics
productSchema.pre("save", function (next) {
  if (this.isModified("stockMovements")) {
    // Calculate average daily sales from last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentSales = this.stockMovements.filter(
      (movement) =>
        movement.type === "sale" && movement.timestamp > thirtyDaysAgo
    );

    const totalQuantity = recentSales.reduce(
      (sum, sale) => sum + sale.quantity,
      0
    );
    this.performance.averageDailySales = totalQuantity / 30;

    // Calculate turnover rate
    if (this.inventory.currentStock > 0) {
      this.performance.turnoverRate =
        this.performance.averageDailySales / this.inventory.currentStock;
    }
  }
  next();
});

const Product = mongoose.model("Product", productSchema);

module.exports = Product;
