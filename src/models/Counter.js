// backend/src/models/Counter.js
const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    seq: {
      type: Number,
      default: 0,
    },
    prefix: {
      type: String,
      default: "",
    },
    suffix: {
      type: String,
      default: "",
    },
    lastReset: {
      type: Date,
      default: Date.now,
    },
    resetPeriod: {
      type: String,
      enum: ["daily", "monthly", "yearly", "never"],
      default: "never",
    },
  },
  {
    timestamps: true,
  }
);

// Method to get next sequence number
counterSchema.statics.getNextSequence = async function (
  counterId,
  options = {}
) {
  const counter = await this.findById(counterId);

  if (!counter) {
    // Create new counter if doesn't exist
    const newCounter = await this.create({
      _id: counterId,
      ...options,
    });
    return newCounter.seq;
  }

  // Check if reset is needed
  const now = new Date();
  let shouldReset = false;

  switch (counter.resetPeriod) {
    case "daily":
      shouldReset = now.toDateString() !== counter.lastReset.toDateString();
      break;
    case "monthly":
      shouldReset =
        now.getMonth() !== counter.lastReset.getMonth() ||
        now.getFullYear() !== counter.lastReset.getFullYear();
      break;
    case "yearly":
      shouldReset = now.getFullYear() !== counter.lastReset.getFullYear();
      break;
  }

  if (shouldReset) {
    counter.seq = 1;
    counter.lastReset = now;
  } else {
    counter.seq += 1;
  }

  await counter.save();
  return counter.seq;
};

const Counter = mongoose.model("Counter", counterSchema);

module.exports = Counter;
