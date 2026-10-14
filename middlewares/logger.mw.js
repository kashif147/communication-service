import logger from "../config/logger.js";
import { routeOf, requestIds } from "./safeHttpLog.js";

/**
 * General request log - allow-list only (same model as user-service).
 *
 * One entry per request, written when the response ends, with safe metadata only: method, matched
 * route (mount prefix kept on error paths), status, duration, correlation/request id and the
 * internal userId / tenantId. Bodies, query strings, headers (Authorization, cookies, user agent)
 * and anything derived from them are never logged. A new field is logged only by adding it here.
 */
export function requestLogEntry(req, res, durationMs) {
  const entry = {
    method: req.method,
    route: routeOf(req),
    status: res.headersSent ? res.statusCode : 0,
    durationMs,
    ...requestIds(req),
  };
  if (!res.writableFinished) entry.outcome = "aborted";
  return entry;
}

export default function loggerMiddleware(req, res, next) {
  // Skip logging for health check endpoints
  if (req.path === "/health" || req.path.startsWith("/health/")) {
    return next();
  }

  const start = process.hrtime.bigint();
  let logged = false;
  const log = () => {
    if (logged) return;
    logged = true;
    const durationMs = Number((process.hrtime.bigint() - start) / 1000000n);
    const entry = requestLogEntry(req, res, durationMs);
    if (entry.status >= 400 || entry.status === 0) logger.warn(entry, "HTTP request");
    else logger.info(entry, "HTTP request");
  };
  res.on("finish", log);
  res.on("close", log);
  next();
}
