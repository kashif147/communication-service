import { defaultPolicyMiddleware } from "./policy.middleware.js";
import { tenantContextWarn } from "./tenantContext.mw.js";

/**
 * Caller classification for the identity-free `/internal/*` routes
 * (Phase 2B Stream 3C, audit H-03/H-04/T-10).
 *
 * This does NOT redesign service-to-service auth. It encodes the current
 * contract:
 *  - The DEV gateway strips client-supplied `x-internal-request`, so a request
 *    that carries it and NO user identity came from the internal network.
 *    Its tenant is the internal caller's `x-tenant-id` header; body/query/params
 *    tenantId are never consulted.
 *  - If ANY user identity is present (gateway-verified headers or a bearer
 *    token), the caller is a user: the internal header grants nothing, and the
 *    trusted user tenant (set by requirePermission + tenantContextWarn) wins.
 */

function headerValue(req, name) {
  const v = req.headers?.[name];
  return Array.isArray(v) ? v[0] : v;
}

export function isInternalRequest(req) {
  const v = headerValue(req, "x-internal-request");
  return v === "true" || v === "1";
}

export function hasUserIdentity(req) {
  const auth = headerValue(req, "authorization");
  return Boolean(
    (typeof auth === "string" && auth.trim()) ||
      headerValue(req, "x-jwt-verified") === "true" ||
      headerValue(req, "x-auth-source") ||
      headerValue(req, "x-user-id")
  );
}

/**
 * @returns {{kind: "user"} | {kind: "internal", tenantId: string|undefined} | {kind: "none"}}
 */
export function classifyCaller(req) {
  if (hasUserIdentity(req)) return { kind: "user" };
  if (isInternalRequest(req)) {
    const tenantId = headerValue(req, "x-tenant-id");
    return { kind: "internal", tenantId: typeof tenantId === "string" && tenantId.trim() ? tenantId.trim() : undefined };
  }
  return { kind: "none" };
}

/** CRM staff user, from the PDP-confirmed identity only. */
export function isCrmUser(req) {
  const t = String(req.user?.userType || "").toUpperCase();
  return t === "CRM";
}

/**
 * The caller's own profile id, ONLY from trusted identity context. Today
 * neither the platform JWT nor the gateway carries a profileId, so this is
 * null for every caller and portal members are denied (fail closed) — a
 * cross-service profile lookup is out of scope here.
 */
export function getTrustedOwnProfileId(req) {
  const v = req.ctx?.profileId || req.user?.profileId;
  return v ? String(v) : null;
}

/**
 * Route middleware for an internal route that a user session may also reach.
 * - user identity  -> requirePermission(resource, action) -> tenantContextWarn;
 *                     req.callerKind = "user", req.tenantId = trusted tenant.
 * - internal-only  -> req.callerKind = "internal", req.internalTenantId = header tenant (400 if absent).
 * - neither        -> 403.
 */
export function createInternalOrUserAccess({ permission, tenantGuard = tenantContextWarn }) {
  return (req, res, next) => {
    const caller = classifyCaller(req);
    if (caller.kind === "user") {
      req.callerKind = "user";
      return permission(req, res, (err) => {
        if (err) return next(err);
        return tenantGuard(req, res, next);
      });
    }
    if (caller.kind === "internal") {
      if (!caller.tenantId) return res.fail("x-tenant-id header is required", 400);
      req.callerKind = "internal";
      req.internalTenantId = caller.tenantId;
      return next();
    }
    return res.fail("Internal endpoint: x-internal-request header required", 403);
  };
}

export const internalOrUserRead = createInternalOrUserAccess({
  permission: defaultPolicyMiddleware.requirePermission("communication", "read"),
});
