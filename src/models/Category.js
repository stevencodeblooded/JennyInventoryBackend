// backend/src/models/Category.js
const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      unique: true,
      trim: true,
      minlength: [2, "Category name must be at least 2 characters"],
      maxlength: [50, "Category name cannot exceed 50 characters"],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      maxlength: [200, "Description cannot exceed 200 characters"],
    },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    icon: {
      type: String,
      default: "folder",
    },
    color: {
      type: String,
      default: "#6B7280",
      validate: {
        validator: function (color) {
          return /^#[0-9A-F]{6}$/i.test(color);
        },
        message: "Please provide a valid hex color",
      },
    },
    image: {
      url: String,
      alt: String,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    metadata: {
      productCount: {
        type: Number,
        default: 0,
      },
      totalRevenue: {
        type: Number,
        default: 0,
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
categorySchema.index({ name: 1 });
categorySchema.index({ slug: 1 });
categorySchema.index({ parent: 1 });
categorySchema.index({ displayOrder: 1 });

// Virtual for subcategories
categorySchema.virtual("subcategories", {
  ref: "Category",
  localField: "_id",
  foreignField: "parent",
});

// Virtual for full path
categorySchema.virtual("fullPath").get(async function () {
  let path = [this.name];
  let current = this;

  while (current.parent) {
    current = await mongoose.model("Category").findById(current.parent);
    if (current) {
      path.unshift(current.name);
    } else {
      break;
    }
  }

  return path.join(" > ");
});

// Generate slug before saving
categorySchema.pre("save", function (next) {
  if (!this.slug || this.isModified("name")) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }
  next();
});

// Static method to get category tree
categorySchema.statics.getCategoryTree = async function () {
  const categories = await this.find({ isActive: true })
    .sort("displayOrder name")
    .lean();

  const buildTree = (parentId = null) => {
    return categories
      .filter((cat) => String(cat.parent) === String(parentId))
      .map((cat) => ({
        ...cat,
        children: buildTree(cat._id),
      }));
  };

  return buildTree();
};

// Update product count
categorySchema.methods.updateProductCount = async function () {
  const Product = mongoose.model("Product");
  const count = await Product.countDocuments({
    category: this._id,
    "status.isActive": true,
  });

  this.metadata.productCount = count;
  await this.save();
};

const Category = mongoose.model("Category", categorySchema);

module.exports = Category;
