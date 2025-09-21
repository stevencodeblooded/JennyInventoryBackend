const mongoose = require("mongoose");

const mpesaTransactionSchema = new mongoose.Schema(
  {
    checkoutRequestId: {
      type: String,
      required: true,
      unique: true,
    },
    merchantRequestId: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    accountReference: {
      type: String,
      required: true,
    },
    transactionDesc: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "success", "failed", "cancelled"],
      default: "pending",
    },
    mpesaReceiptNumber: {
      type: String,
    },
    transactionDate: {
      type: Date,
    },
    resultCode: {
      type: String,
    },
    resultDesc: {
      type: String,
    },
    callbackData: {
      type: mongoose.Schema.Types.Mixed,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sale",
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    lastQueryAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
mpesaTransactionSchema.index({ checkoutRequestId: 1 });
mpesaTransactionSchema.index({ status: 1 });
mpesaTransactionSchema.index({ user: 1, createdAt: -1 });
mpesaTransactionSchema.index({ createdAt: 1 }); // For cleanup old records

module.exports = mongoose.model("MpesaTransaction", mpesaTransactionSchema);