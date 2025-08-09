// backend/src/models/Order.js
const mongoose = require("mongoose");
const Counter = require("./Counter");

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
    },
    customerInfo: {
      name: {
        type: String,
        required: [true, "Customer name is required"],
      },
      phone: {
        type: String,
        required: [true, "Customer phone is required"],
        validate: {
          validator: function (phone) {
            return /^(\+254|0)[17]\d{8}$/.test(phone);
          },
          message: "Please provide a valid Kenyan phone number",
        },
      },
      email: {
        type: String,
        validate: {
          validator: function (email) {
            return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
          },
          message: "Please provide a valid email",
        },
      },
      alternatePhone: String,
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
          required: true,
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
        notes: String,
        status: {
          type: String,
          enum: ["pending", "packed", "unavailable"],
          default: "pending",
        },
        subtotal: {
          type: Number,
          required: true,
        },
      },
    ],
    delivery: {
      type: {
        type: String,
        enum: ["pickup", "delivery"],
        required: true,
        default: "pickup",
      },
      address: {
        street: String,
        area: String,
        landmark: String,
        city: {
          type: String,
          default: "Nairobi",
        },
        instructions: String,
      },
      scheduledDate: {
        type: Date,
        required: [true, "Delivery/pickup date is required"],
      },
      scheduledTime: {
        type: String,
        enum: ["morning", "afternoon", "evening", "anytime"],
        default: "anytime",
      },
      actualDeliveryDate: Date,
      deliveryPerson: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      deliveryFee: {
        type: Number,
        default: 0,
        min: 0,
      },
      distance: Number, // in kilometers
      signature: String, // Base64 encoded signature
      photo: String, // Delivery proof photo URL
    },
    payment: {
      method: {
        type: String,
        enum: ["cash", "mpesa", "card", "bank_transfer", "credit"],
        default: "cash",
      },
      status: {
        type: String,
        enum: ["pending", "partial", "paid", "refunded"],
        default: "pending",
      },
      prepaidAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      transactions: [
        {
          amount: Number,
          method: String,
          reference: String,
          date: {
            type: Date,
            default: Date.now,
          },
          receivedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
        },
      ],
    },
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "ready",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "failed",
      ],
      default: "pending",
    },
    statusHistory: [
      {
        status: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        notes: String,
        location: {
          latitude: Number,
          longitude: Number,
        },
      },
    ],
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
      deliveryFee: {
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
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    source: {
      type: String,
      enum: ["pos", "phone", "whatsapp", "online", "walkin"],
      default: "pos",
    },
    notes: {
      internal: String, // Not visible to customer
      customer: String, // Visible to customer
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    metadata: {
      preparationTime: Number, // in minutes
      packingCompleted: Date,
      customerNotified: Boolean,
      notificationsSent: [
        {
          type: {
            type: String,
            enum: ["sms", "whatsapp", "call", "email"],
          },
          timestamp: Date,
          status: String,
          message: String,
        },
      ],
      feedbackScore: Number,
      feedbackComment: String,
      tags: [String],
    },
    cancellation: {
      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      cancelledAt: Date,
      reason: String,
      refundAmount: Number,
      refundStatus: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better query performance
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ customer: 1 });
orderSchema.index({ "customerInfo.phone": 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ "delivery.scheduledDate": 1 });
orderSchema.index({ "payment.status": 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ priority: 1, status: 1 });

// Compound indexes for common queries
orderSchema.index({ status: 1, "delivery.scheduledDate": 1 });
orderSchema.index({ "delivery.type": 1, status: 1 });
orderSchema.index({ assignedTo: 1, status: 1 });

// Virtual for order age in hours
orderSchema.virtual("ageInHours").get(function () {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60));
});

// Virtual for is overdue
orderSchema.virtual("isOverdue").get(function () {
  if (this.status === "delivered" || this.status === "cancelled") return false;
  return new Date() > this.delivery.scheduledDate;
});

// Virtual for payment balance
orderSchema.virtual("paymentBalance").get(function () {
  const totalPaid = this.payment.transactions.reduce(
    (sum, t) => sum + t.amount,
    0
  );
  return this.totals.total - totalPaid;
});

// Generate order number before saving
orderSchema.pre("save", async function (next) {
  if (this.isNew && !this.orderNumber) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        "order",
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      const date = new Date();
      const year = date.getFullYear().toString().substr(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const sequence = counter.seq.toString().padStart(5, "0");

      this.orderNumber = `ORD${year}${month}${sequence}`;
    } catch (error) {
      next(error);
    }
  }
  next();
});

// Calculate totals before saving
orderSchema.pre("save", function (next) {
  if (this.isModified("items") || this.isModified("delivery.deliveryFee")) {
    let subtotal = 0;
    let totalDiscount = 0;

    this.items.forEach((item) => {
      const itemSubtotal = item.unitPrice * item.quantity;

      let discount = 0;
      if (item.discount.percentage > 0) {
        discount = itemSubtotal * (item.discount.percentage / 100);
      } else if (item.discount.amount > 0) {
        discount = item.discount.amount;
      }

      item.subtotal = itemSubtotal - discount;
      subtotal += itemSubtotal;
      totalDiscount += discount;
    });

    const netAmount = subtotal - totalDiscount;
    const tax = netAmount * 0.16; // Kenya VAT

    this.totals.subtotal = subtotal;
    this.totals.discount = totalDiscount;
    this.totals.deliveryFee = this.delivery.deliveryFee || 0;
    this.totals.tax = tax;
    this.totals.total = netAmount + tax + this.totals.deliveryFee;
  }
  next();
});

// Update status history when status changes
orderSchema.pre("save", function (next) {
  if (this.isModified("status")) {
    this.statusHistory.push({
      status: this.status,
      updatedBy: this.assignedTo || this.createdBy,
    });
  }
  next();
});

// Instance methods
orderSchema.methods.updateStatus = async function (
  newStatus,
  userId,
  notes,
  location
) {
  this.status = newStatus;
  this.statusHistory.push({
    status: newStatus,
    updatedBy: userId,
    notes,
    location,
  });

  // Update specific fields based on status
  switch (newStatus) {
    case "confirmed":
      this.metadata.customerNotified = false;
      break;
    case "ready":
      this.metadata.packingCompleted = new Date();
      break;
    case "delivered":
      this.delivery.actualDeliveryDate = new Date();
      this.payment.status = "paid"; // Assuming payment on delivery
      break;
    case "cancelled":
      this.cancellation.cancelledBy = userId;
      this.cancellation.cancelledAt = new Date();
      break;
  }

  await this.save();
  return this;
};

orderSchema.methods.assignToDeliveryPerson = async function (userId) {
  this.assignedTo = userId;
  this.delivery.deliveryPerson = userId;
  this.status = "out_for_delivery";

  this.statusHistory.push({
    status: "out_for_delivery",
    updatedBy: userId,
    notes: "Order assigned for delivery",
  });

  await this.save();
  return this;
};

orderSchema.methods.recordPayment = async function (
  amount,
  method,
  reference,
  userId
) {
  this.payment.transactions.push({
    amount,
    method,
    reference,
    receivedBy: userId,
  });

  const totalPaid = this.payment.transactions.reduce(
    (sum, t) => sum + t.amount,
    0
  );

  if (totalPaid >= this.totals.total) {
    this.payment.status = "paid";
  } else if (totalPaid > 0) {
    this.payment.status = "partial";
  }

  await this.save();
  return this;
};

orderSchema.methods.sendNotification = async function (type, message) {
  // This would integrate with SMS/WhatsApp service
  this.metadata.notificationsSent.push({
    type,
    timestamp: new Date(),
    status: "sent",
    message,
  });

  this.metadata.customerNotified = true;
  await this.save();
  return this;
};

// Static methods
orderSchema.statics.getPendingOrders = function () {
  return this.find({
    status: { $in: ["pending", "confirmed", "processing", "ready"] },
  })
    .populate("customer")
    .populate("items.product")
    .sort({ priority: -1, createdAt: 1 });
};

orderSchema.statics.getDeliveryQueue = function (date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return this.find({
    "delivery.scheduledDate": { $gte: startOfDay, $lte: endOfDay },
    "delivery.type": "delivery",
    status: { $in: ["ready", "out_for_delivery"] },
  })
    .populate("assignedTo")
    .sort({ priority: -1, "delivery.scheduledTime": 1 });
};

orderSchema.statics.getOrderMetrics = async function (startDate, endDate) {
  return await this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: "$totals.total" },
        averageOrderValue: { $avg: "$totals.total" },
        deliveredOrders: {
          $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
        },
        cancelledOrders: {
          $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
        },
        averageDeliveryTime: {
          $avg: {
            $cond: [
              { $eq: ["$status", "delivered"] },
              { $subtract: ["$delivery.actualDeliveryDate", "$createdAt"] },
              null,
            ],
          },
        },
      },
    },
  ]);
};

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
