// backend/src/models/ActivityLog.js
const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        // Auth actions
        "user.login",
        "user.logout",
        "user.pin_login",
        "user.failed_login",
        "user.password_changed",
        "user.profile_updated",

        // Product actions
        "product.created",
        "product.updated",
        "product.deleted",
        "product.stock_adjusted",
        "product.imported",

        // Sale actions
        "sale.created",
        "sale.voided",
        "sale.refunded",
        "sale.receipt_printed",

        // Order actions
        "order.created",
        "order.updated",
        "order.status_changed",
        "order.assigned",
        "order.delivered",
        "order.cancelled",

        // Customer actions
        "customer.created",
        "customer.updated",
        "customer.credit_transaction",
        "customer.note_added",

        // Report actions
        "report.generated",
        "report.exported",
        "report.emailed",

        // System actions
        "backup.created",
        "backup.restored",
        "settings.updated",
        "data.imported",
        "data.exported",
      ],
    },
    entity: {
      type: {
        type: String,
        enum: [
          "user",
          "product",
          "sale",
          "order",
          "customer",
          "category",
          "report",
          "system",
        ],
      },
      id: mongoose.Schema.Types.ObjectId,
      name: String,
    },
    details: {
      previous: mongoose.Schema.Types.Mixed,
      current: mongoose.Schema.Types.Mixed,
      changes: [String],
      reason: String,
      notes: String,
    },
    metadata: {
      ip: String,
      userAgent: String,
      device: {
        type: String,
        os: String,
        browser: String,
      },
      location: {
        city: String,
        country: String,
        coordinates: {
          type: {
            type: String,
            enum: ["Point"],
            default: "Point",
          },
          coordinates: [Number],
        },
      },
      duration: Number, // Action duration in milliseconds
      error: {
        occurred: {
          type: Boolean,
          default: false,
        },
        message: String,
        stack: String,
      },
    },
    severity: {
      type: String,
      enum: ["info", "warning", "error", "critical"],
      default: "info",
    },
    tags: [String],
  },
  {
    timestamps: true,
    capped: {
      size: 100 * 1024 * 1024, // 100MB
      max: 1000000, // Maximum 1 million documents
    },
  }
);

// Indexes
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ "entity.type": 1, "entity.id": 1 });
activityLogSchema.index({ severity: 1 });
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ tags: 1 });

// Static method to log activity
activityLogSchema.statics.log = async function (data) {
  try {
    // Parse user agent if provided
    let device = {};
    if (data.metadata?.userAgent) {
      // Simple parsing - in production, use a library like useragent
      const ua = data.metadata.userAgent.toLowerCase();
      device.browser = ua.includes("chrome")
        ? "Chrome"
        : ua.includes("firefox")
        ? "Firefox"
        : ua.includes("safari")
        ? "Safari"
        : "Other";
      device.os = ua.includes("windows")
        ? "Windows"
        : ua.includes("mac")
        ? "macOS"
        : ua.includes("linux")
        ? "Linux"
        : ua.includes("android")
        ? "Android"
        : ua.includes("ios")
        ? "iOS"
        : "Other";
      device.type = ua.includes("mobile") ? "Mobile" : "Desktop";
    }

    const log = await this.create({
      ...data,
      metadata: {
        ...data.metadata,
        device,
      },
    });

    return log;
  } catch (error) {
    console.error("Failed to create activity log:", error);
    // Don't throw - logging shouldn't break the application
  }
};

// Static method to log with automatic change detection
activityLogSchema.statics.logChange = async function (
  user,
  action,
  entity,
  previous,
  current
) {
  const changes = [];

  // Detect changes
  if (previous && current) {
    for (const key in current) {
      if (JSON.stringify(previous[key]) !== JSON.stringify(current[key])) {
        changes.push(`${key}: ${previous[key]} → ${current[key]}`);
      }
    }
  }

  return this.log({
    user,
    action,
    entity,
    details: {
      previous,
      current,
      changes,
    },
  });
};

// Static method to get user activity summary
activityLogSchema.statics.getUserActivitySummary = async function (
  userId,
  days = 7
) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return await this.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          action: "$action",
        },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: "$_id.date",
        activities: {
          $push: {
            action: "$_id.action",
            count: "$count",
          },
        },
        totalActions: { $sum: "$count" },
      },
    },
    {
      $sort: { _id: -1 },
    },
  ]);
};

// Static method to get system activity metrics
activityLogSchema.statics.getSystemMetrics = async function (hours = 24) {
  const startDate = new Date();
  startDate.setHours(startDate.getHours() - hours);

  return await this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
      },
    },
    {
      $facet: {
        byAction: [
          {
            $group: {
              _id: "$action",
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ],
        byUser: [
          {
            $group: {
              _id: "$user",
              count: { $sum: 1 },
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "_id",
              as: "user",
            },
          },
          { $unwind: "$user" },
          {
            $project: {
              userName: "$user.name",
              count: 1,
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ],
        bySeverity: [
          {
            $group: {
              _id: "$severity",
              count: { $sum: 1 },
            },
          },
        ],
        errorRate: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              errors: {
                $sum: {
                  $cond: [{ $eq: ["$metadata.error.occurred", true] }, 1, 0],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              rate: {
                $multiply: [{ $divide: ["$errors", "$total"] }, 100],
              },
            },
          },
        ],
      },
    },
  ]);
};

// Static method to search logs
activityLogSchema.statics.searchLogs = async function (
  filters = {},
  options = {}
) {
  const {
    user,
    action,
    entityType,
    entityId,
    severity,
    startDate,
    endDate,
    tags,
    search,
  } = filters;

  const { page = 1, limit = 50, sort = "-createdAt" } = options;

  const query = {};

  if (user) query.user = user;
  if (action) query.action = new RegExp(action, "i");
  if (entityType) query["entity.type"] = entityType;
  if (entityId) query["entity.id"] = entityId;
  if (severity) query.severity = severity;
  if (tags && tags.length) query.tags = { $in: tags };

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  if (search) {
    query.$or = [
      { action: new RegExp(search, "i") },
      { "entity.name": new RegExp(search, "i") },
      { "details.notes": new RegExp(search, "i") },
    ];
  }

  const total = await this.countDocuments(query);
  const logs = await this.find(query)
    .populate("user", "name email")
    .sort(sort)
    .limit(limit)
    .skip((page - 1) * limit)
    .lean();

  return {
    logs,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  };
};

const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

module.exports = ActivityLog;
