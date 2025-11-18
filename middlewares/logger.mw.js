import logger from "../config/logger.js";

export default function loggerMiddleware(req, res, next) {
  const startTime = Date.now();

  const logData = {
    method: req.method,
    url: req.url,
    path: req.path,
    query: req.query,
    userAgent: req.get("User-Agent"),
    ip: req.ip || req.connection.remoteAddress,
    requestId: req.id,
    user: req.user?.id,
    tenantId: req.tenantId,
  };

  if (
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    req.body &&
    Object.keys(req.body).length
  ) {
    const sanitizedBody = sanitizeRequestBody(req.body);
    logData.body = sanitizedBody;
  }

  logger.info(logData, `Incoming ${req.method} ${req.url}`);

  const originalEnd = res.end;
  res.end = function (chunk, encoding) {
    const duration = Date.now() - startTime;

    const responseLog = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      requestId: req.id,
      user: req.user?.id,
      tenantId: req.tenantId,
    };

    if (res.statusCode >= 400) {
      logger.warn(
        responseLog,
        `Response ${res.statusCode} for ${req.method} ${req.url}`
      );
    } else {
      logger.info(
        responseLog,
        `Response ${res.statusCode} for ${req.method} ${req.url}`
      );
    }

    originalEnd.call(this, chunk, encoding);
  };

  next();
}

function sanitizeRequestBody(body) {
  const sensitiveFields = ["password", "token", "secret", "key", "authorization"];
  const sanitized = { ...body };

  sensitiveFields.forEach((field) => {
    if (sanitized[field]) {
      sanitized[field] = "[REDACTED]";
    }
  });

  return sanitized;
}

