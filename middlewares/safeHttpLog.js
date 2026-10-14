/**
 * Allow-list HTTP logging fields (request logger and pino-http).
 *
 * Only safe metadata is ever logged: method, route/path without its query string, status,
 * duration, correlation/request id and the internal userId / tenantId / userType set by the
 * policy middleware. Request headers (Authorization, cookies), bodies, query values, raw req/res
 * objects and error messages/stacks are never logged: they carry tokens and personal data.
 */

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
// A path segment is logged as-is only when it looks like a plain identifier.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

export const safeId = (value) => {
  const s = value == null ? "" : String(value);
  return SAFE_ID.test(s) ? s : undefined;
};

export const redactPath = (path) =>
  String(path || "")
    .split("/")
    .map((segment) => (segment === "" || SAFE_SEGMENT.test(segment) ? segment : ":redacted"))
    .join("/");

const pathWithoutQuery = (req) => String(req?.originalUrl || req?.url || "").split("?")[0];

/**
 * The matched route template (e.g. /api/templates/:id) when Express matched one; otherwise the
 * path without its query string, with any segment that is not a plain identifier replaced.
 * req.baseUrl cannot be used: Express resets it when a request leaves its router through
 * next(err), so the mount prefix is taken from the request path instead - the route template
 * matched the trailing segments, everything before them is the (redacted) mount path.
 */
export function routeOf(req) {
  const path = pathWithoutQuery(req);
  const template = req?.route && req.route.path;
  if (typeof template === "string" && !/[*?()+]/.test(template)) {
    const trim = (p) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
    const pathSegments = trim(path).split("/");
    const templateSegments = trim(template).split("/").filter(Boolean);
    const prefix = pathSegments.slice(0, pathSegments.length - templateSegments.length).join("/");
    return `${redactPath(prefix)}${template === "/" && prefix ? "" : template}`;
  }
  return redactPath(path);
}

/** Internal identifiers of the request, when present and identifier-shaped. */
export function requestIds(req) {
  const out = {};
  const correlationId = safeId(req?.correlationId);
  const requestId = safeId(req?.id);
  const userId = safeId(req?.userId ?? req?.user?.id);
  const tenantId = safeId(req?.tenantId);
  const userType = safeId(req?.user?.userType);
  if (correlationId) out.correlationId = correlationId;
  if (requestId) out.requestId = requestId;
  if (userId) out.userId = userId;
  if (tenantId) out.tenantId = tenantId;
  if (userType) out.userType = userType;
  return out;
}

/**
 * pino-http options: serializers receive the raw objects (wrapSerializers: false) and return
 * explicit fields only, so no header, cookie, body, query value or raw req/res is ever emitted.
 */
export function pinoHttpOptions(logger) {
  return {
    logger,
    wrapSerializers: false,
    autoLogging: {
      ignore: (req) => req.path === "/health" || req.path.startsWith("/health/"),
    },
    serializers: {
      req: (req) => ({ method: req.method, path: redactPath(pathWithoutQuery(req)) }),
      res: (res) => ({ statusCode: res.statusCode }),
      err: (err) => ({ name: err?.name || null, code: err?.code ?? null, status: err?.status ?? err?.statusCode ?? null }),
    },
    // pino-http calls this at request start and again when the response finishes; the fields are
    // added only at completion, once the route matched and the policy middleware set identity.
    customProps: (req, res) => (res.headersSent ? { route: routeOf(req), ...requestIds(req) } : {}),
  };
}
