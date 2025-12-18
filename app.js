// Suppress Application Insights warnings if not configured
// Azure App Service auto-injects Application Insights, but warnings appear if key is missing
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING && process.env.APPLICATIONINSIGHTS_CONNECTION_STRING.trim() === "") {
  process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = undefined;
}
if (!process.env.APPINSIGHTS_INSTRUMENTATIONKEY || process.env.APPINSIGHTS_INSTRUMENTATIONKEY.trim() === "") {
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function(chunk, encoding, callback) {
    const message = chunk.toString();
    if (message.includes("ApplicationInsights") && (message.includes("instrumentation key") || message.includes("iKey"))) {
      return true;
    }
    return originalStderrWrite(chunk, encoding, callback);
  };
  //
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  
  console.warn = function(...args) {
    const message = args.join(" ");
    if (message.includes("ApplicationInsights") && (message.includes("instrumentation key") || message.includes("iKey"))) {
      return;
    }
    originalConsoleWarn.apply(console, args);
  };
  
  console.error = function(...args) {
    const message = args.join(" ");
    if (message.includes("ApplicationInsights") && (message.includes("instrumentation key") || message.includes("iKey"))) {
      return;
    }
    originalConsoleError.apply(console, args);
  };
}

import express from "express";
import compression from "compression";
import pinoHttp from "pino-http";
import helmet from "helmet";
import { corsMiddleware, corsErrorHandler } from "./config/cors.js";
import { limiterGeneral } from "./config/rateLimiters.js";
import logger from "./config/logger.js";
import requestId from "./middlewares/requestId.js";
import loggerMiddleware from "./middlewares/logger.mw.js";
import responseMiddleware from "./middlewares/response.mw.js";
import notFound from "./middlewares/notFound.js";
import errorHandler from "./middlewares/errorHandler.js";
import templateRoutes from "./routes/template.routes.js";
import letterRoutes from "./routes/letter.routes.js";
import bookmarkRoutes from "./routes/bookmark.routes.js";
import {
  initEventSystem,
  setupConsumers,
  shutdownEventSystem,
} from "./rabbitMQ/index.js";

const app = express();

// Disable ETag generation to prevent 304 responses
app.set("etag", false);

// Initialize event system - Now using middleware
let eventSystemInitialized = false;

async function initializeEventSystem() {
  if (!process.env.RABBIT_URL) {
    logger.warn("RABBIT_URL not configured, skipping RabbitMQ initialization");
    return;
  }

  try {
    logger.info("RabbitMQ URL configured, initializing with middleware...");
    await initEventSystem();
    await setupConsumers();
    eventSystemInitialized = true;
    logger.info("Event system initialized successfully with middleware");
  } catch (error) {
    logger.warn(
      { error: error.message },
      "Event system initialization failed, continuing without messaging"
    );
  }
}

// Initialize event system on startup
initializeEventSystem();

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  if (eventSystemInitialized) {
    await shutdownEventSystem();
  }
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully...");
  if (eventSystemInitialized) {
    await shutdownEventSystem();
  }
  process.exit(0);
});

app.use(pinoHttp({ logger }));
app.use(corsMiddleware);
// Security headers with Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);
app.use(compression());
// Body parsing with size limits
app.use(express.json({ limit: "200mb", strict: true }));
app.use(express.urlencoded({ extended: true, limit: "200mb", parameterLimit: 100 }));

app.use(requestId);
app.use(loggerMiddleware);
app.use(responseMiddleware);
app.use(limiterGeneral);

app.get("/health", (req, res) =>
  res.success({
    status: "healthy",
    service: "communication-service",
    timestamp: new Date().toISOString(),
    port: process.env.PORT || 4000,
    environment: process.env.NODE_ENV || "development",
  })
);

app.get("/", (req, res) => {
  res.success({
    service: "Communication Service",
    version: "1.0.0",
    status: "running",
    environment: process.env.NODE_ENV || "development",
    endpoints: {
      health: "/health",
      templates: "/api/templates",
      letters: "/api/letters",
      bookmarks: "/api/bookmarks",
    },
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/templates", templateRoutes);
app.use("/api/letters", letterRoutes);
app.use("/api/bookmarks", bookmarkRoutes);

app.use(notFound);
app.use(corsErrorHandler);
app.use(errorHandler);

export default app;
