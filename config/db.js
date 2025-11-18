import mongoose from "mongoose";
import logger from "./logger.js";

export async function connectDB(
  uri = process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    "mongodb://localhost:27017/communication-service"
) {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: process.env.NODE_ENV !== "production",
  });
  logger.info({ db: mongoose.connection.name }, "Mongo connected");
  return mongoose.connection;
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info("Mongo disconnected");
  }
}
