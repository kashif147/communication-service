#!/usr/bin/env node

import dotenvFlow from "dotenv-flow";
dotenvFlow.config();
import { connectDB, disconnectDB } from "../config/db.js";
import { shutdownEventSystem } from "../rabbitMQ/index.js";
import logger from "../config/logger.js";
import app from "../app.js";

let server;

async function start() {
  const port = Number(process.env.PORT || 4000);
  server = app.listen(port, () => {
    logger.info({ port }, "API listening");
  });

  connectDB(
    process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      "mongodb://127.0.0.1:27017/communication-service?replicaSet=rs0"
  ).catch((err) =>
    logger.warn(
      { err: err.message },
      "Mongo connect failed at boot; continuing without DB"
    )
  );
}

async function shutdown(signal) {
  try {
    logger.info({ signal }, "Shutting down");
    if (server) {
      await new Promise((res) => server.close(res));
    }
    await Promise.allSettled([shutdownEventSystem(), disconnectDB()]);
    process.exit(0);
  } catch (e) {
    logger.error(e, "Shutdown error");
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => {
  logger.error(err, "Unhandled rejection");
  shutdown("unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.error(err, "Uncaught exception");
  shutdown("uncaughtException");
});

start().catch((err) => {
  logger.error({ err, stack: err.stack }, "Failed to start");
  process.exit(1);
});
