// backend/src/models/Sale.js
const mongoose = require("mongoose");
const Counter = require("./Counter"); // We'll create this for receipt numbers

const saleSchema = new mongoose.Schema(
  {
    receiptNumber: {
      type: String,
      required: true,
      unique: true,
    },
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        productName: {
          type: String,
          required: true, // Store name at time of sale
        },
        quantity: {
          type: Number,
          required: true,
          min: [1, "Quantity must be at least 1"],
        },
        unitPrice: {
          type: Number,
          required: true,
          min: [0, "Price cannot be negative"],
        },
        discount: {
          amount: {
            type: Number,
            default: 0,
          },
          percentage: {
            type: Number,
            default: 0,
            min: [0, "Discount cannot be negative"],
            max: [100, "Discount cannot exceed 100%"],
          },
        },
        tax: {
          rate: {
            type: Number,
            default: 16, // Kenya VAT
          },
          amount: {
            type: Number,
            default: 0,
          },
        },
        subtotal: {
          type: Number,
          required: true,
        },
      },
    ],
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
    },
    customerInfo: {
      name: String,
      phone: String,
      email: String,
    },
    payment: {
      method: {
        type: String,
        enum: ["cash", "mpesa", "card", "bank_transfer", "credit", "mixed"],
        required: true,
        default: "cash",
      },
      status: {
        type: String,
        enum: ["paid", "pending", "partial", "refunded", "failed"],
        required: true,
        default: "paid",
      },
      details: [
        {
          method: {
            type: String,
            enum: ["cash", "mpesa", "card", "bank_transfer", "credit"],
          },
          amount: Number,
          reference: String,
          transactionId: String,
        },
      ],
      totalPaid: {
        type: Number,
        required: true,
        min: 0,
      },
      change: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    totals: {
      subtotal: {
        type: Number,
        required: true,
        min: 0,
      },
      discount: {
        type: Number,
        default: 0,
        min: 0,
      },
      tax: {
        type: Number,
        default: 0,
        min: 0,
      },
      total: {
        type: Number,
        required: true,
        min: 0,
      },
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["completed", "voided", "refunded", "partial_refund"],
      default: "completed",
    },
    voidInfo: {
      voidedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      voidedAt: Date,
      reason: String,
    },
    refundInfo: {
      refundedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      refundedAt: Date,
      refundedItems: [
        {
          product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
          },
          quantity: Number,
          amount: Number,
        },
      ],
      totalRefunded: Number,
      reason: String,
    },
    metadata: {
      source: {
        type: String,
        enum: ["pos", "online", "phone", "walkin"],
        default: "pos",
      },
      device: String,
      location: String,
      notes: String,
      syncStatus: {
        type: String,
        enum: ["synced", "pending", "failed"],
        default: "synced",
      },
      offlineId: String, // For offline sales
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better query performance
saleSchema.index({ receiptNumber: 1 });
saleSchema.index({ customer: 1 });
saleSchema.index({ seller: 1 });
saleSchema.index({ "payment.method": 1 });
saleSchema.index({ "payment.status": 1 });
saleSchema.index({ status: 1 });
saleSchema.index({ createdAt: -1 });
saleSchema.index({ "totals.total": 1 });
saleSchema.index({ "metadata.source": 1 });
saleSchema.index({ "metadata.syncStatus": 1 });

// Compound indexes for common queries
saleSchema.index({ seller: 1, createdAt: -1 });
saleSchema.index({ status: 1, createdAt: -1 });
saleSchema.index({ "payment.status": 1, createdAt: -1 });

// Virtual for profit calculation
saleSchema.virtual("profit").get(function () {
  let totalProfit = 0;
  this.items.forEach((item) => {
    if (item.product && item.product.pricing) {
      const itemProfit =
        (item.unitPrice - item.product.pricing.cost) * item.quantity;
      totalProfit += itemProfit;
    }
  });
  return totalProfit;
});

// Generate receipt number before saving
saleSchema.pre("save", async function (next) {
  if (this.isNew && !this.receiptNumber) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        "receipt",
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      const date = new Date();
      const year = date.getFullYear().toString().substr(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const day = date.getDate().toString().padStart(2, "0");
      const sequence = counter.seq.toString().padStart(5, "0");

      this.receiptNumber = `RCP${year}${month}${day}${sequence}`;
    } catch (error) {
      next(error);
    }
  }
  next();
});

// Calculate totals before saving
saleSchema.pre("save", function (next) {
  if (this.isModified("items")) {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    this.items.forEach((item) => {
      // Calculate item subtotal
      const itemSubtotal = item.unitPrice * item.quantity;

      // Calculate discount
      let discount = 0;
      if (item.discount.percentage > 0) {
        discount = itemSubtotal * (item.discount.percentage / 100);
      } else if (item.discount.amount > 0) {
        discount = item.discount.amount;
      }

      // Calculate tax on discounted amount
      const taxableAmount = itemSubtotal - discount;
      const tax = taxableAmount * (item.tax.rate / 100);

      item.tax.amount = tax;
      item.subtotal = taxableAmount + tax;

      subtotal += itemSubtotal;
      totalDiscount += discount;
      totalTax += tax;
    });

    this.totals.subtotal = subtotal;
    this.totals.discount = totalDiscount;
    this.totals.tax = totalTax;
    this.totals.total = subtotal - totalDiscount + totalTax;
  }
  next();
});

// Instance methods
saleSchema.methods.void = async function (userId, reason) {
  if (this.status === "voided") {
    throw new Error("Sale is already voided");
  }

  this.status = "voided";
  this.voidInfo = {
    voidedBy: userId,
    voidedAt: new Date(),
    reason,
  };

  // Restore stock for each item
  for (const item of this.items) {
    const Product = mongoose.model("Product");
    const product = await Product.findById(item.product);
    if (product) {
      await product.updateStock(
        item.quantity,
        "return",
        this.receiptNumber,
        userId,
        `Voided sale: ${reason}`
      );
    }
  }

  await this.save();
  return this;
};

saleSchema.methods.refund = async function (userId, items, reason) {
  if (this.status === "voided") {
    throw new Error("Cannot refund a voided sale");
  }

  const refundedItems = [];
  let totalRefunded = 0;

  for (const refundItem of items) {
    const saleItem = this.items.find(
      (item) => item.product.toString() === refundItem.productId
    );

    if (!saleItem) {
      throw new Error(`Product ${refundItem.productId} not found in sale`);
    }

    if (refundItem.quantity > saleItem.quantity) {
      throw new Error(`Cannot refund more than sold quantity`);
    }

    const refundAmount =
      (saleItem.subtotal / saleItem.quantity) * refundItem.quantity;

    refundedItems.push({
      product: refundItem.productId,
      quantity: refundItem.quantity,
      amount: refundAmount,
    });

    totalRefunded += refundAmount;

    // Restore stock
    const Product = mongoose.model("Product");
    const product = await Product.findById(refundItem.productId);
    if (product) {
      await product.updateStock(
        refundItem.quantity,
        "return",
        this.receiptNumber,
        userId,
        `Refund: ${reason}`
      );
    }
  }

  this.refundInfo = {
    refundedBy: userId,
    refundedAt: new Date(),
    refundedItems,
    totalRefunded,
    reason,
  };

  // Update status
  if (totalRefunded >= this.totals.total) {
    this.status = "refunded";
  } else {
    this.status = "partial_refund";
  }

  await this.save();
  return this;
};

// Static methods
saleSchema.statics.getDailySales = async function (date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return await this.aggregate([
    {
      $match: {
        createdAt: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: null,
        totalSales: { $sum: 1 },
        totalRevenue: { $sum: "$totals.total" },
        totalDiscount: { $sum: "$totals.discount" },
        totalTax: { $sum: "$totals.tax" },
        paymentMethods: {
          $push: "$payment.method",
        },
      },
    },
    {
      $project: {
        _id: 0,
        totalSales: 1,
        totalRevenue: 1,
        totalDiscount: 1,
        totalTax: 1,
        averageSale: { $divide: ["$totalRevenue", "$totalSales"] },
      },
    },
  ]);
};

saleSchema.statics.getTopProducts = async function (
  startDate,
  endDate,
  limit = 10
) {
  return await this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product",
        productName: { $first: "$items.productName" },
        totalQuantity: { $sum: "$items.quantity" },
        totalRevenue: { $sum: "$items.subtotal" },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },
  ]);
};

saleSchema.statics.getSalesBySeller = async function (startDate, endDate) {
  return await this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
        status: { $in: ["completed", "partial_refund"] },
      },
    },
    {
      $group: {
        _id: "$seller",
        totalSales: { $sum: 1 },
        totalRevenue: { $sum: "$totals.total" },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "seller",
      },
    },
    { $unwind: "$seller" },
    {
      $project: {
        sellerName: "$seller.name",
        totalSales: 1,
        totalRevenue: 1,
        averageSale: { $divide: ["$totalRevenue", "$totalSales"] },
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);
};

const Sale = mongoose.model("Sale", saleSchema);

module.exports = Sale;
