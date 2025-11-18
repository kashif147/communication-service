import cors from "cors";
import { AppError } from "../errors/AppError.js";

export const getCorsConfig = () => {
  const environment = process.env.NODE_ENV || "development";

  const baseOrigins = {
    development: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:8080",
      "http://localhost:8081",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
    ],
    staging: [
      "http://localhost:3000",
      "https://testportal-dabravg2h3hfbke9.canadacentral-01.azurewebsites.net",
      "https://userserviceshell-aqf6f0b8fqgmagch.canadacentral-01.azurewebsites.net",
      "https://projectshellapi-c0hqhbdwaaahbcab.northeurope-01.azurewebsites.net",
    ],
    production: [
      "https://app.yourdomain.com",
      "https://admin.yourdomain.com",
      "https://mobile.yourdomain.com",
    ],
  };

  const additionalOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
  const allowedOrigins = [
    ...(baseOrigins[environment] || baseOrigins.development),
    ...additionalOrigins.filter((origin) => origin.trim()),
  ];
  const uniqueOrigins = [...new Set(allowedOrigins)];

  return {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (uniqueOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked origin: ${origin}`);
        callback(new Error(`Not allowed by CORS. Origin: ${origin}`));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
      "X-Request-ID",
      "X-Correlation-ID",
      "X-Tenant-ID",
      "X-User-ID",
    ],
    exposedHeaders: ["X-Request-ID", "X-Correlation-ID"],
    maxAge: 86400,
  };
};

export const corsMiddleware = cors(getCorsConfig());

export const corsErrorHandler = (err, req, res, next) => {
  if (err.message && err.message.includes("Not allowed by CORS")) {
    return next(
      AppError.forbidden("CORS policy violation", {
        code: "CORS_ERROR",
        details:
          process.env.NODE_ENV === "development"
            ? err.message
            : "Cross-origin request blocked",
      })
    );
  }
  next(err);
};

