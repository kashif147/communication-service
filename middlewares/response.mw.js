import { AppError } from "../errors/AppError.js";

export default function responseMiddleware(req, res, next) {
  res.success = (data, message = "Success") =>
    res.status(200).json({
      status: "success",
      message,
      data,
      timestamp: new Date().toISOString(),
    });

  res.created = (data, message = "Created successfully") =>
    res.status(201).json({
      status: "success",
      message,
      data,
      timestamp: new Date().toISOString(),
    });

  res.fail = (message = "Bad request", status = 400, details = {}) =>
    res.status(status).json({
      status: "fail",
      message,
      details,
      timestamp: new Date().toISOString(),
    });

  res.notFound = (message = "Not found", details = {}) =>
    res.status(404).json({
      status: "fail",
      message,
      details,
      timestamp: new Date().toISOString(),
    });

  res.unauthorized = (message = "Unauthorized", details = {}) =>
    res.status(401).json({
      status: "fail",
      message,
      details,
      timestamp: new Date().toISOString(),
    });

  res.forbidden = (message = "Forbidden", details = {}) =>
    res.status(403).json({
      status: "fail",
      message,
      details,
      timestamp: new Date().toISOString(),
    });

  res.serverError = (message = "Internal server error", details = {}) =>
    res.status(500).json({
      status: "error",
      message,
      details,
      timestamp: new Date().toISOString(),
    });

  res.appError = (error) => {
    if (error instanceof AppError) {
      return res.status(error.status).json({
        status: "fail",
        message: error.message,
        code: error.code,
        ...error,
        timestamp: new Date().toISOString(),
      });
    }
    return res.serverError(error.message, { originalError: error });
  };

  // Standardized not found responses (200 OK instead of 404)
  res.notFoundList = (message = "No records found") => {
    res.status(200).json({
      success: true,
      data: [],
      message,
    });
  };

  res.notFoundRecord = (message = "Record not found") => {
    res.status(200).json({
      success: true,
      data: null,
      message,
    });
  };

  next();
}

