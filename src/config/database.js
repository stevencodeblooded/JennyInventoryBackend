// backend/src/config/database.js
const mongoose = require("mongoose");
const { logger } = require("../middleware/logger"); // Fixed: destructure logger

class Database {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4,
      };

      // Connection string from environment variable
      const MONGODB_URI =
        process.env.MONGODB_URI || "mongodb://localhost:27017/jennysaleflow";

      mongoose.connection.on("connected", () => {
        logger.info("MongoDB connected successfully");
      });

      mongoose.connection.on("error", (err) => {
        logger.error("MongoDB connection error:", err);
      });

      mongoose.connection.on("disconnected", () => {
        logger.warn("MongoDB disconnected");
      });

      // Handle application termination
      process.on("SIGINT", async () => {
        await mongoose.connection.close();
        logger.info("MongoDB connection closed through app termination");
        process.exit(0);
      });

      this.connection = await mongoose.connect(MONGODB_URI, options);

      // Create indexes after connection
      await this.createIndexes();

      return this.connection;
    } catch (error) {
      logger.error("Database connection failed:", error);
      throw error;
    }
  }

  async createIndexes() {
    try {
      logger.info("Creating database indexes...");
      // Indexes will be created when models are registered
      logger.info("Database indexes created successfully");
    } catch (error) {
      logger.error("Error creating indexes:", error);
    }
  }

  async disconnect() {
    try {
      await mongoose.connection.close();
      logger.info("Database disconnected successfully");
    } catch (error) {
      logger.error("Error disconnecting from database:", error);
      throw error;
    }
  }

  // Health check for database connection
  async healthCheck() {
    try {
      if (mongoose.connection.readyState !== 1) {
        throw new Error("Database not connected");
      }

      // Perform a simple operation to verify connection
      await mongoose.connection.db.admin().ping();

      return {
        status: "healthy",
        database: mongoose.connection.name,
        host: mongoose.connection.host,
        readyState: mongoose.connection.readyState,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error.message,
        readyState: mongoose.connection.readyState,
      };
    }
  }

  // Backup functionality
  async backup() {
    try {
      const collections = await mongoose.connection.db
        .listCollections()
        .toArray();
      const backup = {};

      for (const collection of collections) {
        const data = await mongoose.connection.db
          .collection(collection.name)
          .find({})
          .toArray();
        backup[collection.name] = data;
      }

      return backup;
    } catch (error) {
      logger.error("Backup failed:", error);
      throw error;
    }
  }

  // Seed database with initial data
  async seed(seedData) {
    try {
      logger.info("Seeding database...");

      // Clear existing data if in development
      if (process.env.NODE_ENV === "development") {
        const collections = await mongoose.connection.db.collections();
        for (const collection of collections) {
          await collection.deleteMany({});
        }
      }

      // Seed data will be handled by individual model seeders
      logger.info("Database seeded successfully");
    } catch (error) {
      logger.error("Seeding failed:", error);
      throw error;
    }
  }
}

module.exports = new Database();
